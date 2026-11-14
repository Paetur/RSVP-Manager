import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { credentials, Management, SetupError } from "./management.ts";
import type { Credentials } from "./management.ts";
import { hash, quote, block, schemaPlan } from "./schema.ts";

export const steps = [
  "database",
  "administrator",
  "secrets",
  "functions",
  "configuration",
  "verification",
] as const;
type Step = (typeof steps)[number];
type State = {
  installation_id: string;
  site_url: string;
  installer_hash: string;
  first_admin_id: string | null;
  admin_email: string | null;
  initialized_at: string | null;
  progress: Record<string, any>;
};
type Assets = {
  installer: string;
  digest: string;
  version: string;
  schema: string;
  plan: ReturnType<typeof schemaPlan>;
  functions: {
    slug: string;
    code: string;
    digest: string;
    verify_jwt: boolean;
  }[];
};

export function installationAssets(root: string): Assets {
  const installer = readFileSync(join(root, "supabase/install.sql"), "utf8"),
    installManifest = JSON.parse(
      readFileSync(join(root, "supabase/install-manifest.json"), "utf8"),
    ),
    functionManifest = JSON.parse(
      readFileSync(join(root, "supabase/studio/manifest.json"), "utf8"),
    ),
    version = readFileSync(join(root, "VERSION"), "utf8").trim();
  if (
    hash(installer) !== installManifest.installerSha256 ||
    installManifest.applicationVersion !== version ||
    functionManifest.version !== version
  )
    throw new SetupError(
      "assets",
      "Setup assets do not match this release. Regenerate/verify the installer and Studio function bundles.",
      500,
    );
  const functions = ["guest-gateway", "admin-invitations"].map((slug) => {
    const entry = functionManifest.functions[slug];
    if (!entry || entry.file !== slug + ".ts" || entry.verify_jwt !== false)
      throw new SetupError(
        "assets",
        "Required function configuration is missing.",
        500,
      );
    const code = readFileSync(
      join(root, "supabase/studio", entry.file),
      "utf8",
    );
    if (hash(code) !== entry.sha256)
      throw new SetupError(
        "assets",
        "An Edge Function bundle failed its release integrity check.",
        500,
      );
    for (const [name, digest] of Object.entries(entry.sources))
      if (
        !name.startsWith("supabase/functions/") ||
        name.includes("..") ||
        hash(readFileSync(join(root, name))) !== digest
      )
        throw new SetupError(
          "assets",
          "Function sources and generated bundles differ.",
          500,
        );
    return { slug, code, digest: entry.sha256, verify_jwt: entry.verify_jwt };
  });
  return {
    installer,
    digest: hash(installer),
    version,
    schema: installManifest.baseline.slice(0, 14),
    plan: schemaPlan(installer),
    functions,
  };
}

export class Installation {
  config: Credentials;
  management: Management;
  assets: Assets;
  fetcher: typeof fetch;
  state: State | null = null;
  initialized = false;
  existingInstallation = false;
  installationId: string = randomUUID();
  busy = false;
  constructor(
    input: Record<string, unknown>,
    assets: Assets,
    fetcher: typeof fetch = fetch,
  ) {
    this.config = credentials(input);
    this.assets = assets;
    this.fetcher = fetcher;
    this.management = new Management(this.config, fetcher);
  }
  client(secret = false) {
    return createClient(
      this.config.projectUrl,
      secret ? this.config.serviceKey : this.config.publicKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: {
          fetch: async (input, init) => {
            // Supabase Auth logs thrown transport errors. Return a sanitized HTTP failure instead,
            // and never follow redirects carrying privileged request headers.
            try {
              const endpoint = new URL(
                typeof input === "string"
                  ? input
                  : input instanceof URL
                    ? input.href
                    : input.url,
              );
              if (endpoint.origin !== this.config.projectUrl)
                throw Error("Unexpected Auth endpoint");
              return await this.fetcher(input, {
                ...init,
                redirect: "error",
                signal: AbortSignal.timeout(30_000),
              });
            } catch {
              return new Response(
                JSON.stringify({
                  message: "Supabase Auth could not be reached",
                  code: "setup_transport",
                }),
                {
                  status: 503,
                  headers: { "Content-Type": "application/json" },
                },
              );
            }
          },
        },
      },
    );
  }
  async rows(
    sql: string,
    parameters: unknown[] = [],
    readOnly = false,
  ): Promise<any[]> {
    const rows = await this.management.query(sql, parameters, readOnly);
    if (!Array.isArray(rows))
      throw new SetupError(
        "query",
        "Unexpected database response; retry this step.",
        502,
      );
    return rows;
  }
  async refresh() {
    const [{ marker, admins }] = await this.rows(
      "SELECT to_regclass('app_private.installation_state') IS NOT NULL AS marker,to_regclass('public.admins') IS NOT NULL AS admins",
      [],
      true,
    );
    this.state = marker
      ? (
          await this.rows(
            "SELECT * FROM app_private.installation_state WHERE id",
            [],
            true,
          )
        )[0] || null
      : null;
    const adminCount = admins
      ? Number(
          (
            await this.rows(
              "SELECT count(*) AS count FROM public.admins",
              [],
              true,
            )
          )[0].count,
        )
      : 0;
    this.initialized =
      !!this.state?.initialized_at || (adminCount > 0 && !this.state);
    if (this.state && !this.initialized) {
      if (this.state.installer_hash !== this.assets.digest)
        throw new SetupError(
          "version",
          "This partial installation belongs to a different installer build. Resume with that matching build; setup will not overwrite it.",
        );
      if (this.state.site_url !== this.config.siteUrl)
        throw new SetupError(
          "site",
          "Resume using the same website address as the partial installation.",
        );
      this.installationId = this.state.installation_id;
      if (adminCount > 0 && (!this.state.first_admin_id || adminCount !== 1))
        throw new SetupError(
          "installed",
          "Administrator records already exist. Use the existing installation or its recovery procedure.",
          409,
        );
    }
    return this.state;
  }
  async connect() {
    const project = await this.management.request("");
    if (
      ![project.id, project.ref].includes(this.config.projectRef) ||
      (project.status && project.status !== "ACTIVE_HEALTHY")
    )
      throw new SetupError(
        "project",
        "The selected project is not ready or does not match its reference. Wait for it to become healthy, then retry.",
      );
    let publicProbe: Response;
    try {
      publicProbe = await this.fetcher(
        this.config.projectUrl + "/auth/v1/settings",
        {
          headers: { apikey: this.config.publicKey },
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      throw new SetupError(
        "connection",
        "The project's public Auth endpoint could not be reached.",
        502,
      );
    }
    if (!publicProbe.ok)
      throw new SetupError(
        "public_key",
        "Supabase rejected the project's public browser key.",
        401,
      );
    const { error } = await this.client(true).auth.admin.listUsers({
      page: 1,
      perPage: 1,
    });
    if (error)
      throw new SetupError(
        "service_key",
        "Supabase rejected the privileged key or Auth Admin access.",
        401,
      );
    await this.management.request("/functions");
    await this.management.request("/secrets");
    await this.management.request("/config/auth");
    await this.management.request("/postgrest");
    await this.refresh();
    this.existingInstallation = this.initialized;
    return this.publicState();
  }
  publicState() {
    return {
      connected: true,
      initialized: this.initialized,
      existingInstallation: this.existingInstallation,
      version: this.assets.version,
      projectRef: this.config.projectRef,
      siteUrl: this.state?.site_url || this.config.siteUrl,
      steps: Object.fromEntries(
        steps.map((step) => [step, !!this.state?.progress[step]]),
      ),
      publicConfig: this.initialized
        ? {
            supabaseUrl: this.config.projectUrl,
            supabaseKey: this.config.publicKey,
          }
        : null,
    };
  }
  async mark(step: Step, result: any = true) {
    await this.rows(
      "UPDATE app_private.installation_state SET progress=progress||jsonb_build_object($1::text,$2::jsonb),updated_at=now() WHERE id AND installation_id=$3::uuid RETURNING installation_id",
      [step, JSON.stringify(result), this.installationId],
    );
    await this.refresh();
  }
  async run(step: Step, input: Record<string, unknown> = {}) {
    if (!steps.includes(step))
      throw new SetupError("step", "Unknown setup step.");
    if (this.initialized) return this.publicState();
    if (this.busy)
      throw new SetupError(
        "busy",
        "A setup step is already running. Wait for its result.",
        409,
      );
    this.busy = true;
    try {
      await this.refresh();
      if (this.initialized) return this.publicState();
      const prior = steps.slice(0, steps.indexOf(step));
      if (prior.some((key) => !this.state?.progress[key]))
        throw new SetupError(
          "sequence",
          "Complete the preceding setup steps first.",
          409,
        );
      await this[step](input);
      return this.publicState();
    } finally {
      this.busy = false;
    }
  }
  async database(_input: Record<string, unknown>) {
    const catalog = await this.rows(
      "SELECT n.nspname||'.'||c.relname AS name FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','app_private') AND c.relkind IN ('r','p')",
      [],
      true,
    );
    const unknown = catalog.some(
      (row) => !this.assets.plan.tables.includes(row.name),
    );
    if (unknown)
      throw new SetupError(
        "schema",
        "This project contains unrelated or incompatible application tables. Use a dedicated project; setup will not replace them.",
        409,
      );
    if (this.state?.progress.database) {
      if (!(await this.rows(this.assets.plan.verifySQL, [], true))[0]?.valid)
        throw new SetupError(
          "schema",
          "The schema changed after initialization. Repair it with the matching release before continuing.",
          409,
        );
      return;
    }
    const initial = catalog.length === 0;
    const claim = `INSERT INTO app_private.installation_state(id,installation_id,schema_version,release_version,installer_hash,site_url,progress) VALUES(true,${quote(this.installationId)}::uuid,${quote(this.assets.schema)},${quote(this.assets.version)},${quote(this.assets.digest)},${quote(this.config.siteUrl)},'{"database":true}') ON CONFLICT(id) DO NOTHING;
${block(`
 IF EXISTS(SELECT 1 FROM public.admins) OR EXISTS(SELECT 1 FROM public.event_settings WHERE is_published) THEN RAISE EXCEPTION 'Existing installation cannot be initialized'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app_private.installation_state WHERE id AND installer_hash=${quote(this.assets.digest)} AND site_url=${quote(this.config.siteUrl)} AND initialized_at IS NULL) THEN RAISE EXCEPTION 'Installation changed'; END IF;
`)}
`;
    const verification = block(
      `IF NOT (${this.assets.plan.verifyExpression}) THEN RAISE EXCEPTION 'Existing schema objects are incompatible'; END IF;`,
    );
    const query = initial
      ? this.assets.installer.replace(
          /COMMIT;\s*$/,
          () => claim + verification + "\nCOMMIT;",
        )
      : this.assets.plan.repairSQL + claim + verification + "\nCOMMIT;";
    await this.rows(query);
    await this.refresh();
    if (!(await this.rows(this.assets.plan.verifySQL, [], true))[0]?.valid)
      throw new SetupError(
        "schema",
        "Required schema verification failed. No setup completion was recorded.",
        502,
      );
    await this.mark("database");
  }
  async administrator(input: Record<string, unknown>) {
    const email =
        typeof input.email === "string" ? input.email.trim().toLowerCase() : "",
      password = input.password;
    if (
      !/^\S+@\S+\.\S+$/.test(email) ||
      email.length > 254 ||
      typeof password !== "string" ||
      password.length < 6 ||
      password.length > 1024
    )
      throw new SetupError(
        "administrator",
        "Enter an administrator email and a password of at least 6 characters.",
      );
    await this.rows(`BEGIN;SELECT pg_advisory_xact_lock(19421,9201);
${block(`
 IF EXISTS(SELECT 1 FROM app_private.installation_state WHERE id AND (initialized_at IS NOT NULL OR (admin_email IS NOT NULL AND admin_email<>${quote(email)}))) THEN RAISE EXCEPTION 'Different administrator or completed installation'; END IF;
`)}
UPDATE app_private.installation_state SET admin_email=${quote(email)} WHERE id;COMMIT;`);
    const service = this.client(true);
    let user = (
      await this.rows(
        "SELECT id,email_confirmed_at FROM auth.users WHERE lower(email)=$1",
        [email],
        true,
      )
    )[0];
    if (!user) {
      const result = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (result.error || !result.data.user) {
        // The request may have committed before its response was lost. Retry finds that user.
        throw new SetupError(
          "administrator",
          "The Auth administrator account could not be created. Check project password requirements and retry; an existing account will not be duplicated.",
          502,
        );
      }
      user = {
        id: result.data.user.id,
        email_confirmed_at: result.data.user.email_confirmed_at,
      };
    } else if (!user.email_confirmed_at) {
      const result = await service.auth.admin.updateUserById(user.id, {
        email_confirm: true,
      });
      if (result.error)
        throw new SetupError(
          "administrator",
          "The existing Auth account could not be confirmed.",
          502,
        );
    }
    const login = this.client();
    try {
      const signed = await login.auth.signInWithPassword({ email, password });
      if (signed.error || signed.data.user?.id !== user.id)
        throw new SetupError(
          "login",
          "Administrator sign-in failed. For an existing account, enter its current password.",
          401,
        );
      await this.rows(`BEGIN;SELECT pg_advisory_xact_lock(19421,9201);
${block(`
 IF EXISTS(SELECT 1 FROM app_private.installation_state WHERE id AND initialized_at IS NOT NULL) OR EXISTS(SELECT 1 FROM public.admins WHERE user_id<>${quote(user.id)}::uuid) THEN RAISE EXCEPTION 'Administrator initialization is closed'; END IF;
`)}
INSERT INTO public.admins(user_id,name) VALUES(${quote(user.id)}::uuid,'Primary Administrator') ON CONFLICT(user_id) DO NOTHING;
UPDATE app_private.installation_state SET first_admin_id=${quote(user.id)}::uuid WHERE id;COMMIT;`);
      const access = await login.rpc("is_admin");
      if (access.error || access.data !== true)
        throw new SetupError(
          "permissions",
          "The Auth account exists, but its application administrator/session permissions could not be verified.",
          502,
        );
      await this.mark("administrator");
    } finally {
      await login.auth.signOut({ scope: "local" }).catch(() => {});
    }
  }
  async secrets(input: Record<string, unknown>) {
    const entries = [
      { name: "RSVP_SITE_ORIGIN", value: new URL(this.config.siteUrl).origin },
      { name: "RSVP_SITE_URL", value: this.config.siteUrl },
    ];
    if (input.optional !== undefined) {
      if (!Array.isArray(input.optional) || input.optional.length > 10)
        throw new SetupError(
          "secrets",
          "Provide at most ten optional application secrets.",
        );
      for (const entry of input.optional) {
        if (
          !entry ||
          typeof entry.name !== "string" ||
          !/^RSVP_[A-Z0-9_]{1,70}$/.test(entry.name) ||
          entries.some((item) => item.name === entry.name) ||
          typeof entry.value !== "string" ||
          !entry.value ||
          entry.value.length > 8192 ||
          entry.value === this.config.accessToken ||
          entry.value === this.config.serviceKey
        )
          throw new SetupError(
            "secrets",
            "Optional secrets need unique RSVP_ names and nonempty values. Platform-managed SUPABASE_ secrets cannot be changed here.",
          );
        entries.push({ name: entry.name, value: entry.value });
      }
    }
    await this.management.request("/secrets", "POST", entries);
    const digests = Object.fromEntries(
      entries.map((entry) => [entry.name, hash(entry.value)]),
    );
    await this.verifySecrets(digests);
    await this.mark("secrets", digests);
  }
  async verifySecrets(expected: Record<string, string>) {
    const secrets = await this.management.request("/secrets");
    for (const [name, digest] of Object.entries(expected)) {
      const actual = secrets.find((secret: any) => secret.name === name);
      if (!actual || (actual.digest && actual.digest.toLowerCase() !== digest))
        throw new SetupError(
          "secrets",
          "A required application secret is missing or differs. Retry the Secrets step.",
          502,
        );
    }
  }
  async functions(_input: Record<string, unknown>) {
    for (const bundle of this.assets.functions) {
      const list = await this.management.request("/functions"),
        existing = list.find((fn: any) => fn.slug === bundle.slug);
      if (existing && existing.verify_jwt !== bundle.verify_jwt)
        throw new SetupError(
          "function_config",
          "An existing required function has a conflicting Verify JWT setting. Setup will not silently change it; review its configuration and retry.",
          409,
        );
      const form = new FormData();
      form.append(
        "metadata",
        JSON.stringify({
          name: existing?.name || bundle.slug,
          entrypoint_path: "index.ts",
          verify_jwt: existing?.verify_jwt ?? bundle.verify_jwt,
        }),
      );
      form.append(
        "file",
        new Blob([bundle.code], { type: "application/typescript" }),
        "index.ts",
      );
      await this.management.request(
        "/functions/deploy?slug=" + bundle.slug,
        "POST",
        form,
      );
      const deployed = await this.management.request(
        "/functions/" + bundle.slug,
      );
      if (
        deployed.status !== "ACTIVE" ||
        deployed.verify_jwt !== bundle.verify_jwt
      )
        throw new SetupError(
          "functions",
          "An Edge Function has not become active with the required settings. Retry Functions.",
          502,
        );
    }
    await this.mark("functions");
  }
  async configuration(_input: Record<string, unknown>) {
    const current = await this.management.request("/config/auth"),
      redirect = new URL("admin/?admin-invitation=1", this.config.siteUrl).href,
      allow = [
        ...new Set([
          ...(current.uri_allow_list || "")
            .split(",")
            .map((url: string) => url.trim())
            .filter(Boolean),
          redirect,
        ]),
      ];
    await this.management.request("/config/auth", "PATCH", {
      site_url: this.config.siteUrl,
      uri_allow_list: allow.join(","),
    });
    const rest = await this.management.request("/postgrest"),
      schemas = [
        ...new Set([
          ...(rest.db_schema || "")
            .split(",")
            .map((name: string) => name.trim())
            .filter((name: string) => name && name !== "app_private"),
          "public",
        ]),
      ];
    await this.management.request("/postgrest", "PATCH", {
      db_schema: schemas.join(","),
    });
    // Defaults already come from the baseline. Only fill an unset installation URL.
    await this.rows(
      "UPDATE public.event_settings SET website_url=coalesce(website_url,$1) WHERE id=1",
      [this.config.siteUrl],
    );
    await this.mark("configuration");
  }
  async verification(_input: Record<string, unknown>) {
    if (!(await this.rows(this.assets.plan.verifySQL, [], true))[0]?.valid)
      throw new SetupError(
        "schema",
        "Required schema objects or RLS are missing. Setup has not been finalized.",
        502,
      );
    const state = this.state!;
    if (
      (
        await this.rows(
          "SELECT is_published FROM public.event_settings WHERE id=1",
          [],
          true,
        )
      )[0]?.is_published !== false
    )
      throw new SetupError(
        "publication",
        "Keep the event unpublished until setup verification is complete.",
        409,
      );
    const admin = (
      await this.rows(
        "SELECT a.user_id FROM public.admins a JOIN auth.users u ON u.id=a.user_id WHERE a.user_id=$1::uuid AND a.access_state='active' AND a.access_permissions=app_private.permission_preset('full') AND u.email_confirmed_at IS NOT NULL",
        [state.first_admin_id],
        true,
      )
    )[0];
    if (!admin)
      throw new SetupError(
        "administrator",
        "The confirmed full administrator account could not be verified. Setup has not been finalized.",
        502,
      );
    const user = await this.client(true).auth.admin.getUserById(
      state.first_admin_id!,
    );
    if (user.error || !user.data.user)
      throw new SetupError(
        "administrator",
        "The administrator could not be found in Supabase Authentication.",
        502,
      );
    await this.verifySecrets(state.progress.secrets);
    const list = await this.management.request("/functions");
    for (const bundle of this.assets.functions)
      if (
        !list.some(
          (fn: any) =>
            fn.slug === bundle.slug &&
            fn.status === "ACTIVE" &&
            fn.verify_jwt === bundle.verify_jwt,
        )
      )
        throw new SetupError(
          "functions",
          "A required Edge Function is missing or inactive.",
          502,
        );
    for (const [slug, body, status] of [
      [
        "guest-gateway",
        { action: "get_invitation_v2", args: { p_code: "AAAAAAAA" } },
        200,
      ],
      ["admin-invitations", {}, 401],
    ] as const) {
      let result: Response;
      try {
        result = await this.fetcher(
          this.config.projectUrl + "/functions/v1/" + slug,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: this.config.publicKey,
              Origin: new URL(this.config.siteUrl).origin,
            },
            body: JSON.stringify(body),
            redirect: "error",
            signal: AbortSignal.timeout(30_000),
          },
        );
      } catch {
        throw new SetupError(
          "functions",
          "An Edge Function could not be reached. Allow deployment propagation and retry verification.",
          502,
        );
      }
      if (result.status !== status)
        throw new SetupError(
          "functions",
          "An Edge Function did not pass its protected runtime probe. Check origin/JWT settings and retry.",
          502,
        );
    }
    const auth = await this.management.request("/config/auth"),
      rest = await this.management.request("/postgrest");
    if (
      auth.site_url !== this.config.siteUrl ||
      !(auth.uri_allow_list || "")
        .split(",")
        .includes(
          new URL("admin/?admin-invitation=1", this.config.siteUrl).href,
        ) ||
      !(rest.db_schema || "").split(",").includes("public") ||
      (rest.db_schema || "").split(",").includes("app_private")
    )
      throw new SetupError(
        "configuration",
        "Auth redirect or Data API schema configuration differs. Retry Configuration.",
        502,
      );
    await this.rows(
      `BEGIN;SELECT pg_advisory_xact_lock(19421,9201);UPDATE app_private.installation_state SET initialized_at=now(),admin_email=NULL,progress=progress||'{"verification":true}',updated_at=now() WHERE id AND installation_id=${quote(this.installationId)}::uuid;COMMIT;`,
    );
    await this.refresh();
  }
  forget() {
    this.config.accessToken = "";
    this.config.serviceKey = "";
  }
}
