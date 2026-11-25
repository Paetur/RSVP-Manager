// Disposable Supabase/Management HTTP behavior; never reads live configuration.
const { createDatabase } = require("./alpha-database.cjs");
const crypto = require("node:crypto");
const ref = "abcdefghijklmnopqrst",
  publicKey = "sb_publishable_setup_synthetic",
  serviceKey = "sb_" + "secret_" + "setup_synthetic",
  accessToken = "sbp_setup_synthetic_access_token";
async function fixture({ installed = false } = {}) {
  const db = await createDatabase({ install: installed });
  const calls = [],
    secrets = new Map([["UNRELATED_SECRET", "keep-this-value"]]),
    functions = new Map();
  const authConfig = {
      site_url: "https://previous.example.invalid/",
      uri_allow_list: "https://keep.example.invalid/",
    },
    restConfig = { db_schema: "public,app_private", max_rows: 1000 };
  const state = {
    fail: null,
    loseCreate: false,
    sessions: new Map(),
    created: 0,
    createdBodies: [],
  };
  const response = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const digest = (value) =>
    crypto.createHash("sha256").update(value).digest("hex");
  const user = (row) => ({
    id: row.id,
    aud: "authenticated",
    role: "authenticated",
    email: row.email,
    email_confirmed_at: row.email_confirmed_at,
    created_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
  });
  const fetcher = async (input, init = {}) => {
    const url = new URL(
        typeof input === "string" ? input : input.url || String(input),
      ),
      method = init.method || "GET",
      headers = new Headers(init.headers || {}),
      body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    const path = url.pathname;
    calls.push({ path, method });
    if (
      state.fail &&
      path.includes(state.fail.path) &&
      method === state.fail.method
    ) {
      const fail = state.fail;
      state.fail = null;
      return response(
        { message: fail.message || serviceKey + " " + accessToken },
        fail.status || 500,
      );
    }
    if (url.hostname === "api.supabase.com") {
      if (headers.get("authorization") !== "Bearer " + accessToken)
        return response({ message: "invalid token" }, 401);
      const root = "/v1/projects/" + ref;
      if (!path.startsWith(root)) return response({}, 404);
      const route = path.slice(root.length);
      if (!route) return response({ id: ref, status: "ACTIVE_HEALTHY" });
      if (route === "/database/query") {
        try {
          if (state.failSql && /fresh alpha installation/i.test(body.query)) {
            state.failSql = false;
            await db.exec(
              body.query.replace(
                /COMMIT;\s*$/,
                "SELECT setup_synthetic_missing();COMMIT;",
              ),
            );
          }
          if (body.read_only && !/^\s*SELECT\b/i.test(body.query))
            throw Error("Expected read-only query");
          // Management's read-only role cannot execute protected private helpers.
          const unquoted = body.query.replace(/E?'(?:[^']|'')*'/g, "''");
          if (body.read_only && /\bapp_private\.permission_preset\s*\(/.test(unquoted))
            throw Error("permission denied for function permission_preset");
          if (body.parameters?.length)
            return response((await db.query(body.query, body.parameters)).rows);
          const result = await db.exec(body.query);
          return response(result.at(-1)?.rows || []);
        } catch (error) {
          await db.exec("ROLLBACK").catch(() => {});
          state.lastSqlError = error.message;
          state.lastSqlPosition = error.position;
          state.lastSqlQuery = body.query;
          return response({ message: "SQL failure: " + error.message }, 400);
        }
      }
      if (route === "/secrets") {
        if (method === "POST") {
          for (const item of body) secrets.set(item.name, item.value);
          return response(null);
        }
        return response(
          [...secrets].map(([name, value]) => ({
            name,
            digest: digest(value),
          })),
        );
      }
      if (route === "/functions") return response([...functions.values()]);
      if (route === "/functions/deploy") {
        const metadata = JSON.parse(body.get("metadata")),
          file = body.get("file"),
          slug = url.searchParams.get("slug");
        if (
          !file ||
          file.name !== "index.ts" ||
          metadata.entrypoint_path !== "index.ts"
        )
          return response({}, 400);
        const code = await file.text();
        if (!code.includes("Source:")) return response({}, 400);
        const item = {
          slug,
          name: metadata.name,
          status: "ACTIVE",
          verify_jwt: metadata.verify_jwt,
          version: (functions.get(slug)?.version || 0) + 1,
        };
        functions.set(slug, item);
        return response(item, 201);
      }
      if (route.startsWith("/functions/")) {
        if (functions.has(route.slice(11))) {
          if (state.activationDelays > 0) {
            state.activationDelays--;
            return response({ ...functions.get(route.slice(11)), status: "DEPLOYING" });
          }
          return response(functions.get(route.slice(11)));
        } else return response({}, 404);
      }
      if (route === "/config/auth") {
        if (method === "PATCH") Object.assign(authConfig, body);
        return response(authConfig);
      }
      if (route === "/postgrest") {
        if (method === "PATCH") Object.assign(restConfig, body);
        return response(restConfig);
      }
      return response({}, 404);
    }
    if (url.hostname !== ref + ".supabase.co")
      throw Error("Unexpected outbound host in setup fixture");
    const key = headers.get("apikey");
    if (path === "/auth/v1/settings")
      return key === publicKey
        ? response({ external: { email: true } })
        : response({}, 401);
    if (path.startsWith("/auth/v1/admin/")) {
      if (key !== serviceKey) return response({ message: "invalid key" }, 401);
      if (path === "/auth/v1/admin/users" && method === "GET")
        return response({
          users: (await db.query("SELECT * FROM auth.users")).rows.map(user),
          aud: "authenticated",
        });
      if (path === "/auth/v1/admin/users" && method === "POST") {
        state.createdBodies.push({ ...body });
        const id = crypto.randomUUID();
        await db.query(
          "INSERT INTO auth.users(id,email,email_confirmed_at,encrypted_password) VALUES($1,$2,$3,$4)",
          [
            id,
            body.email,
            body.email_confirm ? new Date().toISOString() : null,
            body.password,
          ],
        );
        state.created++;
        if (state.loseCreate) {
          state.loseCreate = false;
          throw Error("Synthetic lost creation response");
        }
        return response(
          user(
            (await db.query("SELECT * FROM auth.users WHERE id=$1", [id]))
              .rows[0],
          ),
        );
      }
      const id = path.slice("/auth/v1/admin/users/".length);
      if (method === "PUT" && body.email_confirm)
        await db.query(
          "UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1",
          [id],
        );
      const row = (await db.query("SELECT * FROM auth.users WHERE id=$1", [id]))
        .rows[0];
      return row
        ? response(user(row))
        : response({ message: "not found" }, 404);
    }
    if (path === "/auth/v1/token") {
      const row = (
        await db.query(
          "SELECT * FROM auth.users WHERE lower(email)=$1 AND encrypted_password=$2",
          [body.email, body.password],
        )
      ).rows[0];
      if (!row) return response({ msg: "Invalid login credentials" }, 400);
      const session = crypto.randomUUID();
      await db.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)", [
        session,
        row.id,
      ]);
      const token = [
        "eyJhbGciOiJIUzI1NiJ9",
        Buffer.from(
          JSON.stringify({
            sub: row.id,
            role: "authenticated",
            session_id: session,
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
        ).toString("base64url"),
        "synthetic_signature",
      ].join(".");
      state.sessions.set(token, { uid: row.id, session });
      return response({
        access_token: token,
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "synthetic_refresh",
        user: user(row),
      });
    }
    if (path === "/auth/v1/logout") return response({});
    if (path === "/rest/v1/rpc/is_admin") {
      const token = (headers.get("authorization") || "").slice(7),
        session = state.sessions.get(token);
      if (!session) return response({ message: "no session" }, 401);
      await db.exec("BEGIN;SET LOCAL ROLE authenticated");
      try {
        await db.query(
          "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
          [
            session.uid,
            JSON.stringify({ sub: session.uid, session_id: session.session }),
          ],
        );
        const result = (await db.query("SELECT public.is_admin() AS value"))
          .rows[0].value;
        await db.exec("COMMIT");
        return response(result);
      } catch (error) {
        await db.exec("ROLLBACK");
        throw error;
      }
    }
    if (path === "/rest/v1/rpc/get_setup_status") {
      await db.exec("SET ROLE anon");
      try {
        return response((await db.query("SELECT public.get_setup_status() AS value")).rows[0].value);
      } finally { await db.exec("RESET ROLE"); }
    }
    if (path === "/functions/v1/guest-gateway") {
      if (state.runtimeDelays > 0) {
        state.runtimeDelays--;
        return response({ error: "Propagation pending" }, 503);
      }
      return secrets.get("RSVP_SITE_ORIGIN") === headers.get("origin")
        ? response(null)
        : response({ error: "origin" }, 403);
    }
    if (path === "/functions/v1/admin-invitations")
      return response(
        { error: "Sign in again before sending an invitation" },
        401,
      );
    return response({}, 404);
  };
  return {
    db,
    fetcher,
    calls,
    secrets,
    functions,
    authConfig,
    restConfig,
    state,
    config: {
      projectUrl: "https://" + ref + ".supabase.co",
      projectRef: ref,
      publicKey,
      serviceKey,
      accessToken,
      siteUrl: "https://event.example.invalid/wedding/",
    },
  };
}
module.exports = { fixture, ref, publicKey, serviceKey, accessToken };
