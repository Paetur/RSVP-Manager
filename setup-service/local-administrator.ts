import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { SetupError } from "./management.ts";
import { block, quote } from "./schema.ts";
import { installationAssets } from "./installation.ts";

type Assets = ReturnType<typeof installationAssets>;
type Query = (sql: string, parameters?: unknown[]) => Promise<any[]>;
const localSteps = ["database", "administrator", "verification"];
const eventData = ["households", "guests", "food_items", "food_claims", "other_items", "event_locations", "event_sessions", "message_templates", "invitation_send_queue", "invitation_deliveries", "guest_session_responses", "rsvp_submissions"]
  .map(table => "EXISTS(SELECT 1 FROM public." + table + ")").join(" OR ");

// This mode only creates the first account on an installed, empty local schema.
// Database installation, local Edge deployment and Auth settings remain operator steps.
export class LocalAdministratorInstallation {
  config: { projectUrl: string; publicKey: string; serviceKey: string; siteUrl: string; databaseUrl: string };
  assets: Assets;
  fetcher: typeof fetch;
  queryOverride?: Query;
  db: any = null;
  state: any = null;
  initialized = false;
  existingInstallation = false;
  installationId = randomUUID();
  busy = false;
  constructor(input: Record<string, unknown>, assets: Assets, fetcher = fetch, query?: Query) {
    const fields = ["target", "projectUrl", "publicKey", "serviceKey", "siteUrl", "databaseUrl"];
    if (input.target !== "local" || Object.keys(input).some(key => !fields.includes(key)) ||
        fields.slice(1).some(key => typeof input[key] !== "string" || !(input[key] as string).trim() || (input[key] as string).length > 4096))
      throw new SetupError("credentials", "Provide the local connection, privileged credentials and website address.");
    const value = Object.fromEntries(fields.slice(1).map(key => [key, (input[key] as string).trim()])) as typeof this.config;
    let api: URL, database: URL, site: URL;
    try { api = new URL(value.projectUrl); database = new URL(value.databaseUrl); site = new URL(value.siteUrl); }
    catch { throw new SetupError("local_connection", "Use valid local API, PostgreSQL and website addresses."); }
    const loopback = (host: string) => ["127.0.0.1", "localhost", "[::1]"].includes(host);
    if (!loopback(api.hostname) || !["http:", "https:"].includes(api.protocol) || api.username || api.password || api.search || api.hash || api.pathname !== "/" ||
        !loopback(database.hostname) || !["postgres:", "postgresql:"].includes(database.protocol) || !database.username || !/^\/[A-Za-z0-9_-]+$/.test(database.pathname) || database.search || database.hash)
      throw new SetupError("local_connection", "Local setup connects only to loopback Supabase and PostgreSQL addresses.");
    const localSite = loopback(site.hostname) || site.hostname.endsWith(".local");
    if (!(site.protocol === "https:" || (site.protocol === "http:" && localSite)) || site.username || site.password || site.search || site.hash)
      throw new SetupError("site", "Use an HTTPS website URL, or a local HTTP address, without credentials or a query.");
    const role = (key: string) => { try { return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role; } catch { return null; } };
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(value.publicKey) && role(value.publicKey) !== "anon")
      throw new SetupError("public_key", "The browser key must be a publishable key or an anon JWT.");
    if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(value.serviceKey) && role(value.serviceKey) !== "service_role")
      throw new SetupError("service_key", "Provide a secret key or a service_role JWT for the trusted service only.");
    value.projectUrl = api.origin;
    value.siteUrl = site.href.replace(/\/*$/, "/");
    this.config = value; this.assets = assets; this.fetcher = fetcher; this.queryOverride = query;
  }
  async rows(sql: string, parameters: unknown[] = []) {
    try {
      if (this.queryOverride) return await this.queryOverride(sql, parameters);
      if (!this.db) {
        this.db = new pg.Client({ connectionString: this.config.databaseUrl, connectionTimeoutMillis: 10000, statement_timeout: 30000, ssl: false });
        this.db.on("error", () => {});
        await this.db.connect();
      }
      const result = await this.db.query(sql, parameters);
      return Array.isArray(result) ? result[result.length - 1].rows : result.rows;
    } catch {
      if (this.db) await this.db.query("ROLLBACK").catch(() => {});
      throw new SetupError("local_database", "The local database check could not be completed. Check its connection and schema, then retry.", 502);
    }
  }
  client(secret = false) {
    return createClient(this.config.projectUrl, secret ? this.config.serviceKey : this.config.publicKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (input, init) => {
        try {
          const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
          if (url.origin !== this.config.projectUrl) throw Error();
          return await this.fetcher(input, { ...init, redirect: "error", signal: AbortSignal.timeout(30000) });
        } catch { return new Response('{"message":"Supabase Auth could not be reached"}', { status:503, headers:{"Content-Type":"application/json"} }); }
      } },
    });
  }
  async refresh() {
    const [available] = await this.rows("SELECT to_regclass('app_private.installation_state') IS NOT NULL AS marker,to_regclass('public.admins') IS NOT NULL AS admins");
    if (!available?.marker || !available.admins)
      throw new SetupError("schema", "Install the current local database schema before creating its first administrator.", 409);
    this.state = (await this.rows("SELECT * FROM app_private.installation_state WHERE id"))[0] || null;
    const count = Number((await this.rows("SELECT count(*) AS count FROM public.admins"))[0].count);
    const published = (await this.rows("SELECT is_published FROM public.event_settings WHERE id=1"))[0]?.is_published;
    this.initialized = !!this.state?.initialized_at || published !== false || (count > 0 && (!this.state || !this.state.progress.local));
    if (this.initialized) return;
    if ((await this.rows("SELECT ("+eventData+") AS populated"))[0]?.populated)
      throw new SetupError("installed", "The local event already contains data. First-time setup will not change it.",409);
    if (this.state) {
      if (!this.state.progress.local || this.state.installer_hash !== this.assets.digest || this.state.site_url !== this.config.siteUrl)
        throw new SetupError("installation", "Resume the matching setup mode, release and website address. Existing installation progress will not be replaced.", 409);
      this.installationId = this.state.installation_id;
      if (count > 0 && (!this.state.first_admin_id || count !== 1))
        throw new SetupError("installed", "Administrator records already exist. Use the existing installation or its recovery procedure.", 409);
    }
  }
  async connect() {
    await this.refresh();
    if (!this.initialized && !(await this.rows(this.assets.plan.verifySQL))[0]?.valid)
      throw new SetupError("schema", "Required local schema objects or permissions are missing. Complete the local installation first.", 409);
    let probe: Response;
    try { probe = await this.fetcher(this.config.projectUrl + "/auth/v1/settings", { headers:{apikey:this.config.publicKey}, redirect:"error", signal:AbortSignal.timeout(15000) }); }
    catch { throw new SetupError("connection", "The project's public Auth endpoint could not be reached.", 502); }
    if (!probe.ok) throw new SetupError("public_key", "Supabase rejected the project's public browser key.", 401);
    const { error } = await this.client(true).auth.admin.listUsers({page:1,perPage:1});
    if (error) throw new SetupError("service_key", "Supabase rejected the privileged key or Auth Admin access.", 401);
    await this.checkApiCheckpoint();
    if (this.initialized) this.existingInstallation = true;
    return this.publicState();
  }
  async checkApiCheckpoint() {
    const status=await this.client().rpc("get_setup_status");
    if (status.error || !status.data || typeof status.data.initialized!=="boolean")
      throw new SetupError("schema", "The local API setup checkpoint could not be verified. Complete the local installation first.",409);
    const locked=status.data.setup_locked===true || status.data.initialized===true;
    if ((locked && !this.initialized && !this.state?.first_admin_id) || (this.initialized && !locked))
      throw new SetupError("installed", "The local API and database setup checkpoints differ. Verify both connections before continuing.",409);
  }
  publicState() {
    return { connected:true, local:true, initialized:this.initialized, existingInstallation:this.existingInstallation, version:this.assets.version, siteUrl:this.state?.site_url || this.config.siteUrl,
      steps:Object.fromEntries(localSteps.map(step=>[step,!!this.state?.progress[step]])),
      publicConfig:this.initialized ? {supabaseUrl:this.config.projectUrl,supabaseKey:this.config.publicKey} : null };
  }
  async mark(step: string) {
    await this.rows("UPDATE app_private.installation_state SET progress=progress||jsonb_build_object($1::text,true),updated_at=now() WHERE id AND installation_id=$2::uuid", [step,this.installationId]);
    await this.refresh();
  }
  async run(step: string, input: Record<string,unknown> = {}) {
    if (!localSteps.includes(step)) throw new SetupError("step", "Use the supported local setup steps.", 409);
    if (this.initialized) return this.publicState();
    if (this.busy) throw new SetupError("busy", "A setup step is already running. Wait for its result.", 409);
    this.busy = true;
    try {
      await this.refresh();
      if (this.initialized) return this.publicState();
      if (localSteps.slice(0,localSteps.indexOf(step)).some(prior=>!this.state?.progress[prior]))
        throw new SetupError("sequence", "Complete the preceding setup steps first.", 409);
      if (step === "administrator" && this.state?.progress.administrator) return this.publicState();
      if (step === "database") await this.database();
      if (step === "administrator") await this.administrator(input);
      if (step === "verification") await this.verification();
      return this.publicState();
    } finally { this.busy=false; }
  }
  async database() {
    if (!(await this.rows(this.assets.plan.verifySQL))[0]?.valid)
      throw new SetupError("schema", "Required local schema objects or permissions are missing. Complete the local installation first.", 409);
    if (this.state?.progress.database) return;
    await this.rows(`BEGIN;SELECT pg_advisory_xact_lock(19421,9201);
${block(`IF EXISTS(SELECT 1 FROM public.admins) OR EXISTS(SELECT 1 FROM public.event_settings WHERE is_published) OR (${eventData}) THEN RAISE EXCEPTION 'Existing installation'; END IF;`)}
INSERT INTO app_private.installation_state(id,installation_id,schema_version,release_version,installer_hash,site_url,progress) VALUES(true,${quote(this.installationId)}::uuid,${quote(this.assets.schema)},${quote(this.assets.version)},${quote(this.assets.digest)},${quote(this.config.siteUrl)},'{"database":true,"local":true}') ON CONFLICT(id) DO NOTHING;COMMIT;`);
    await this.refresh();
  }
  async administrator(input: Record<string,unknown>) {
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "", password=input.password;
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length>254 || typeof password!=="string" || password.length<6 || password.length>1024)
      throw new SetupError("administrator", "Enter an administrator email and a password of at least 6 characters.");
    await this.checkApiCheckpoint();
    await this.rows(`BEGIN;SELECT pg_advisory_xact_lock(19421,9201);
${block(`IF NOT EXISTS(SELECT 1 FROM app_private.installation_state WHERE id AND installation_id=${quote(this.installationId)}::uuid AND initialized_at IS NULL AND (admin_email IS NULL OR admin_email=${quote(email)})) OR EXISTS(SELECT 1 FROM public.event_settings WHERE is_published) OR (${eventData}) THEN RAISE EXCEPTION 'Administrator initialization is closed'; END IF;`)}
UPDATE app_private.installation_state SET admin_email=${quote(email)} WHERE id;COMMIT;`);
    let user=(await this.rows("SELECT id,email_confirmed_at FROM auth.users WHERE lower(email)=$1",[email]))[0];
    const service=this.client(true);
    if (!user) {
      const result=await service.auth.admin.createUser({email,password,email_confirm:true});
      if (result.error || !result.data.user) throw new SetupError("administrator", "The Auth administrator account could not be created. Check project password requirements and retry; an existing account will not be duplicated.",502);
      user=result.data.user;
    } else if (!user.email_confirmed_at) {
      throw new SetupError("administrator", "Confirm the existing Auth account before using it for first administrator setup.",409);
    }
    const sameUser=(await this.rows("SELECT id,email,email_confirmed_at FROM auth.users WHERE id=$1::uuid AND lower(email)=$2",[user.id,email]))[0];
    if (!sameUser?.email_confirmed_at)
      throw new SetupError("local_connection", "The local Auth account does not match the database connection. Verify both connections before continuing.",409);
    const login=this.client();
    try {
      const signed=await login.auth.signInWithPassword({email,password});
      if (signed.error || signed.data.user?.id!==user.id)
        throw new SetupError("login", "Administrator sign-in failed. For an existing account, enter its current password.",401);
      await this.rows(`BEGIN;SELECT pg_advisory_xact_lock(19421,9201);
${block(`IF NOT EXISTS(SELECT 1 FROM app_private.installation_state WHERE id AND installation_id=${quote(this.installationId)}::uuid AND initialized_at IS NULL AND admin_email=${quote(email)}) OR EXISTS(SELECT 1 FROM public.admins WHERE user_id<>${quote(user.id)}::uuid) OR EXISTS(SELECT 1 FROM public.event_settings WHERE is_published) OR (${eventData}) THEN RAISE EXCEPTION 'Administrator initialization is closed'; END IF;`)}
INSERT INTO public.admins(user_id,name) VALUES(${quote(user.id)}::uuid,'Primary Administrator') ON CONFLICT(user_id) DO NOTHING;
UPDATE app_private.installation_state SET first_admin_id=${quote(user.id)}::uuid WHERE id;COMMIT;`);
      const access=await login.rpc("is_admin");
      if (access.error || access.data!==true) throw new SetupError("permissions", "The Auth account exists, but its application administrator/session permissions could not be verified.",502);
      await this.mark("administrator");
    } finally { await login.auth.signOut({scope:"local"}).catch(()=>{}); }
  }
  async verification() {
    if (!(await this.rows(this.assets.plan.verifySQL))[0]?.valid)
      throw new SetupError("schema", "Required schema objects or RLS are missing. Setup has not been finalized.",502);
    const user=(await this.rows("SELECT a.user_id FROM public.admins a JOIN auth.users u ON u.id=a.user_id WHERE a.user_id=$1::uuid AND a.access_state='active' AND a.access_permissions=app_private.permission_preset('full') AND u.email_confirmed_at IS NOT NULL",[this.state.first_admin_id]))[0];
    if (!user) throw new SetupError("administrator", "The confirmed full administrator account could not be verified. Setup has not been finalized.",502);
    for (const [slug,body,expected] of [["guest-gateway",{action:"get_invitation_v2",args:{p_code:"AAAAAAAA"}},200],["admin-invitations",{},401]] as const) {
      let result: Response;
      try { result=await this.fetcher(this.config.projectUrl+"/functions/v1/"+slug,{method:"POST",headers:{"Content-Type":"application/json",apikey:this.config.publicKey,Origin:new URL(this.config.siteUrl).origin},body:JSON.stringify(body),redirect:"error",signal:AbortSignal.timeout(30000)}); }
      catch { throw new SetupError("functions", "An Edge Function could not be reached. Complete local deployment and retry verification.",502); }
      if(result.status!==expected)throw new SetupError("functions", "An Edge Function did not pass its protected runtime probe. Check origin/JWT settings and retry.",502);
    }
    await this.rows(`BEGIN;SELECT pg_advisory_xact_lock(19421,9201);
${block(`IF EXISTS(SELECT 1 FROM public.event_settings WHERE is_published) OR (SELECT count(*) FROM public.admins)<>1 OR (${eventData}) THEN RAISE EXCEPTION 'Installation changed'; END IF;`)}
UPDATE app_private.installation_state SET initialized_at=now(),admin_email=NULL,progress=progress||'{"verification":true}',updated_at=now() WHERE id AND installation_id=${quote(this.installationId)}::uuid AND initialized_at IS NULL;COMMIT;`);
    await this.refresh();
  }
  forget() {
    this.config.databaseUrl="";this.config.serviceKey="";
    const db=this.db;this.db=null;
    if(db) void db.end().catch(()=>{});
  }
}
