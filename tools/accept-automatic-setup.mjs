#!/usr/bin/env node
// Explicit opt-in live acceptance. Never creates, deletes or resets a project.
// Pass credentials through protected stdin; output contains only sanitized acceptance results.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { Installation, installationAssets, steps } from "../setup-service/installation.ts";
import { SetupError } from "../setup-service/management.ts";

export async function acceptAutomaticSetup(input, options = {}) {
  const root = options.root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const acceptedProjectRef = options.acceptedProjectRef;
  if (!/^[a-z]{20}$/.test(acceptedProjectRef || "") ||
      input?.credentials?.projectRef !== acceptedProjectRef)
    throw new SetupError("target", "Explicitly accept the exact empty project reference before running live acceptance.");
  if (!input?.administrator || typeof input.administrator.email !== "string" ||
      typeof input.administrator.password !== "string" || !input.administrator.password)
    throw new SetupError("administrator", "Provide the test administrator credentials through protected standard input.");
  const attempts = options.attempts ?? 5, delayMs = options.delayMs ?? 2000;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5 ||
      !Number.isFinite(delayMs) || delayMs < 0 || delayMs > 5000)
    throw new SetupError("options", "Acceptance retry bounds are invalid.");
  const log = options.log || (() => {}), fetcher = options.fetcher || fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 15 * 60_000);
  let mutationCount = 0;
  const measuredFetch = async (url, init = {}) => {
    const endpoint = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
    const method = init.method || "GET";
    if (!["GET", "HEAD"].includes(method)) {
      let readOnly = false;
      if (endpoint.hostname === "api.supabase.com" &&
          endpoint.pathname.endsWith("/database/query") && typeof init.body === "string") {
        try { readOnly = JSON.parse(init.body).read_only === true; } catch {}
      }
      if (!readOnly) mutationCount++;
    }
    return fetcher(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  };
  const assets = installationAssets(root), installation = new Installation(input.credentials, assets, measuredFetch);
  let reopened, login;
  const rejectNonempty = () => { throw new SetupError("empty_project", "Live acceptance requires an empty dedicated project. Use the companion to resume an interrupted setup; no project was reset."); };
  const outcomes = [];
  async function retry(name, action) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (timeout.aborted) throw new SetupError("timeout", "Acceptance timed out; saved project progress is preserved.");
      log({ step: name, status: "running", attempt });
      try {
        const result = await action();
        outcomes.push({ step: name, attempts: attempt });
        log({ step: name, status: "passed", attempt });
        return result;
      } catch (error) {
        if (attempt === attempts || !(error instanceof SetupError) ||
            ![429, 502, 503].includes(error.status)) throw error;
        log({ step: name, status: "retrying", attempt });
        await pause(delayMs, undefined, { signal: timeout });
      }
    }
  }
  try {
    const connected = await installation.connect();
    if (connected.initialized) rejectNonempty();
    const tables = await installation.rows(
      "SELECT n.nspname||'.'||c.relname AS name FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','app_private') AND c.relkind IN ('r','p')",
      [], true);
    if (tables.length) rejectNonempty();
    const users = await installation.client(true).auth.admin.listUsers({ page: 1, perPage: 1 });
    if (users.error) throw new SetupError("auth_probe", "Auth administrator access could not be verified.");
    if (users.data.users.length) rejectNonempty();
    for (const relation of ["storage.objects", "storage.buckets"]) {
      const [{ present }] = await installation.rows("SELECT to_regclass($1) IS NOT NULL AS present", [relation], true);
      if (present) {
        const [{ count }] = await installation.rows("SELECT count(*) AS count FROM " + relation, [], true);
        if (Number(count)) rejectNonempty();
      }
    }
    if ((await installation.management.request("/functions")).length) rejectNonempty();
    const preflightMutations = mutationCount;
    if (preflightMutations !== 0)
      throw new SetupError("preflight", "Acceptance preflight attempted an unexpected write.");
    log({ step: "empty-project", status: "passed" });
    for (const step of steps)
      await retry(step, () => installation.run(step, step === "administrator" ? input.administrator : {}));
    const completed = installation.publicState(), publicConfig = completed.publicConfig;
    if (!completed.initialized || !publicConfig ||
        Object.keys(publicConfig).sort().join(",") !== "supabaseKey,supabaseUrl" ||
        publicConfig.supabaseKey !== input.credentials.publicKey ||
        publicConfig.supabaseUrl !== input.credentials.projectUrl.replace(/\/$/, ""))
      throw new SetupError("public_config", "The completed public configuration did not match the selected project.");
    const visible = JSON.stringify(completed);
    for (const secret of [input.credentials.serviceKey, input.credentials.accessToken, input.administrator.password])
      if (secret && visible.includes(secret))
        throw new SetupError("public_config", "The completed state contained a private value.");
    login = installation.client();
    await retry("administrator-login", async () => {
      const signed = await login.auth.signInWithPassword(input.administrator);
      const permission = signed.error ? null : await login.rpc("is_admin");
      if (signed.error || permission?.error || permission?.data !== true)
        throw new SetupError("login", "The created administrator could not sign in with application administrator access.");
    });
    await login.auth.signOut({ scope: "local" });
    login = null;
    const publicStatus = await installation.client().rpc("get_setup_status");
    if (publicStatus.error || publicStatus.data?.initialized !== true ||
        publicStatus.data?.setup_locked !== true ||
        Object.keys(publicStatus.data).some(name => !["initialized", "setup_locked", "schema_version"].includes(name)))
      throw new SetupError("public_status", "The public setup completion probe was not locked or exposed unexpected fields.");
    const beforeReopen = mutationCount;
    reopened = new Installation(input.credentials, assets, measuredFetch);
    const existing = await reopened.connect();
    if (!existing.initialized || !existing.existingInstallation)
      throw new SetupError("reopen", "Completed setup was not recognized when reopened.");
    for (const step of steps) await reopened.run(step, input.administrator);
    if (mutationCount !== beforeReopen)
      throw new SetupError("reopen", "Reopening completed setup attempted a write.");
    const [{ is_published }] = await reopened.rows("SELECT is_published FROM public.event_settings WHERE id=1", [], true);
    if (is_published !== false)
      throw new SetupError("publication", "The acceptance event must remain unpublished.");
    log({ step: "initialized-reopen", status: "passed" });
    return {
      accepted: true, projectRef: acceptedProjectRef, version: assets.version,
      installerSha256: assets.digest, steps: outcomes,
      administratorLogin: true, publicConfigurationOnly: true,
      initializedReopenWithoutWrites: true, eventPublished: false,
      projectCreated: false, projectReset: false, projectDeleted: false
    };
  } finally {
    if (login) await login.auth.signOut({ scope: "local" }).catch(() => {});
    installation.forget(); reopened?.forget();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== "--accept-empty-project" || process.stdin.isTTY)
      throw new SetupError("usage", "Usage: provide protected JSON on stdin to node --experimental-strip-types tools/accept-automatic-setup.mjs --accept-empty-project PROJECT_REF");
    let raw = "", bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 65536) throw new SetupError("input", "Acceptance input is too large.");
      raw += chunk;
    }
    let input;
    try { input = JSON.parse(raw); } catch { throw new SetupError("input", "Acceptance input must be valid JSON."); }
    raw = "";
    const result = await acceptAutomaticSetup(input, {
      acceptedProjectRef: args[1],
      log: entry => process.stderr.write(JSON.stringify(entry) + "\n")
    });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    const code = error instanceof SetupError ? error.code : "acceptance_failed";
    process.stderr.write(JSON.stringify({ accepted: false, code,
      error: "Automatic setup acceptance did not finish. No reset or cleanup was attempted; inspect the trusted companion and resume preserved project progress." }) + "\n");
    process.exitCode = 1;
  }
}
