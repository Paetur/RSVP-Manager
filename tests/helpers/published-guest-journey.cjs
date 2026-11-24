// An in-memory application database and generated gateway, with no deployed credentials.
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { stripTypeScriptTypes } = require("node:module");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");
const { createDatabase, signIn } = require("./alpha-database.cjs");

const apiOrigin = "https://guest-journey-api.example.invalid";
const serviceKey = "synthetic-guest-journey-service";
const rpcPrefix = "/rest/v1/rpc/";
const gatewayArguments = {
  guest_gateway_allow_request: ["p_ip_hash", "p_code", "p_action"],
  get_invitation_logged: ["p_code"],
  issue_household_visit_receipt: ["p_code", "p_session_id"],
  acknowledge_household_visit: ["p_code", "p_receipt_id", "p_session_id"],
  get_household_food: ["p_code"],
  set_household_food_interest: ["p_code", "p_interest", "p_expected_interest"],
  add_household_guest: ["p_code", "p_guest_id", "p_first_name", "p_last_name", "p_is_child"],
  set_household_food_claim: ["p_code", "p_food_item_id", "p_quantity", "p_notes"],
  confirm_household_food: ["p_code", "p_expected_claims"],
  submit_household_rsvp: ["p_code", "p_request_id", "p_responses", "p_comment"],
  submit_household_response: ["p_code", "p_request_id", "p_responses", "p_comment", "p_food_interest"],
};
const jsonArguments = new Set(["p_expected_claims", "p_responses"]);

function createGateway(origin, asService, refusals, bridgeErrors) {
  const file = join(__dirname, "../../supabase/studio/guest-gateway.ts");
  const code = stripTypeScriptTypes(readFileSync(file, "utf8")).replace(/^export /gm, "");
  const fetchRpc = async (url, options) => {
    // The gateway can only reach the listed RPCs on this disposable database.
    const target = new URL(url);
    const name = target.pathname.slice(rpcPrefix.length);
    assert.equal(target.origin, apiOrigin);
    assert.equal(target.pathname, rpcPrefix + name);
    assert.equal(options.method, "POST");
    assert.equal(options.headers.apikey, serviceKey);
    assert.equal(options.headers.Authorization, "Bearer " + serviceKey);
    assert.ok(Object.hasOwn(gatewayArguments, name), "Unexpected gateway RPC: " + name);
    const body = JSON.parse(options.body);
    const keys = gatewayArguments[name].filter(key => Object.hasOwn(body, key));
    assert.equal(keys.length, Object.keys(body).length, "Unexpected gateway arguments for " + name);
    const values = keys.map(key =>
      jsonArguments.has(key) ? JSON.stringify(body[key]) : body[key],
    );
    const parameters = keys.map((key, index) =>
      key + " => $" + (index + 1) + (jsonArguments.has(key) ? "::jsonb" : ""),
    );
    try {
      const value = await asService("SELECT public." + name + "(" + parameters.join(", ") + ") v", values);
      return Response.json(value === "" || value === undefined ? null : value);
    } catch (error) {
      refusals.push({ name, message: error.message });
      return Response.json(null, { status: error.code === "42501" ? 403 : 400 });
    }
  };
  let handler;
  runInNewContext(
    code,
    {
      URL,
      Request,
      Response,
      TextEncoder,
      TextDecoder,
      AbortSignal,
      crypto: webcrypto,
      Deno: {
        env: {
          get: key =>
            ({
              RSVP_SITE_ORIGIN: origin,
              SUPABASE_URL: apiOrigin,
              SUPABASE_SERVICE_ROLE_KEY: serviceKey,
            })[key],
        },
        serve: value => { handler = value; },
      },
      fetch: (url, options) => fetchRpc(url, options).catch(error => {
        bridgeErrors.push(error.message);
        throw error;
      }),
    },
    { filename: file },
  );
  assert.equal(typeof handler, "function");
  return handler;
}

async function createGuestJourneyFixture(origin) {
  const db = await createDatabase();
  const get = async (sql, values = []) => (await db.query(sql, values)).rows[0]?.v;
  try {
    const households = [];
    for (const [householdName, firstName] of [
      ["Morgan", "Alex"], ["Riley", "Sam"], ["Quinn", "Robin"], ["Taylor", "Avery"],
    ]) {
      const id = await get(
        "INSERT INTO public.households(household_name,planning_group_id,language,food) VALUES($1,'general','en',true) RETURNING id v",
        [householdName],
      );
      const guest = await get(
        "INSERT INTO public.guests(household_id,first_name,last_name) VALUES($1,$2,'Fixture') RETURNING id v",
        [id, firstName],
      );
      households.push({ id, guest, name: householdName });
    }
    const venue = await get(
      "INSERT INTO public.event_locations(name) VALUES('Synthetic Hall') RETURNING id v",
    );
    const sessions = [];
    for (const [index, name] of ["Ceremony", "Reception"].entries()) {
      const session = await get(
        "INSERT INTO public.event_sessions(session_key,name,location_id,sort_order) VALUES($1,$2,$3,$4) RETURNING id v",
        [name.toLowerCase(), name, venue, index + 1],
      );
      sessions.push(session);
      for (const { id } of households) {
        await db.query(
          "INSERT INTO public.household_session_defaults(household_id,session_id,is_invited) VALUES($1,$2,true)",
          [id, session],
        );
      }
    }
    const item = await get(
      "INSERT INTO public.food_items(name_en,quantity_needed) VALUES('Synthetic fruit basket',1) RETURNING id v",
    );
    await db.exec(
      "UPDATE public.event_settings SET event_name='Synthetic celebration', event_date=current_date+14, rsvp_deadline=now()+interval '1 day', food_stage='interest', food_enabled=false WHERE id=1",
    );

    await signIn(db);
    await db.exec("RESET ROLE");
    const { sub, claims } = (
      await db.query("SELECT current_setting('request.jwt.claim.sub') sub, current_setting('request.jwt.claims') claims")
    ).rows[0];
    await db.query("SELECT set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)");
    const asRole = (role, sql, values = []) => db.transaction(async tx => {
      await tx.exec("SET LOCAL ROLE " + role);
      if (role === "authenticated") {
        await tx.query(
          "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
          [sub, claims],
        );
      }
      return (await tx.query(sql, values)).rows[0]?.v;
    });
    const organizer = (sql, values) => asRole("authenticated", sql, values);
    const setPublished = async published => {
      assert.equal(
        await organizer("UPDATE public.event_settings SET is_published=$1 WHERE id=1 RETURNING is_published v", [published]),
        published,
      );
    };
    await setPublished(true);
    for (const household of households) {
      household.code = await get("SELECT invite_code v FROM public.households WHERE id=$1", [household.id]);
      assert.match(household.code, /^[A-HJ-NP-Z2-9]{8}$/);
    }
    const refusals = [];
    const bridgeErrors = [];
    return {
      gateway: createGateway(origin, (sql, values) => asRole("service_role", sql, values), refusals, bridgeErrors),
      refusals,
      bridgeErrors,
      languageConfiguration: () => asRole("anon", "SELECT public.get_language_configuration() v"),
      households,
      sessions,
      item,
      setPublished,
      correct: (person, status) => organizer(
        "SELECT public.admin_correct_rsvp($1,$2,$3,'Synthetic correction') v",
        [person.guest, sessions[0], status],
      ),
      reopen: person => organizer(
        "SELECT public.admin_reopen_household_rsvp($1,'Synthetic reopening') v",
        [person.id],
      ),
      enableFood: () => db.exec("UPDATE public.event_settings SET food_enabled=true WHERE id=1"),
      openFoodChoices: () => organizer("SELECT public.admin_set_food_stage('selection','interest') v"),
      denyFoodAccess: person => organizer("SELECT public.admin_set_food_access($1,false,true,'Synthetic permission check') v", [person.id]),
      resetDeadline: () => db.exec("UPDATE public.event_settings SET rsvp_deadline=now()+interval '1 day' WHERE id=1"),
      responseState: person => get(`
        SELECT jsonb_build_object('rsvp', h.rsvp_state, 'food', h.food_interest, 'submissions',
          (SELECT count(*) FROM public.rsvp_submissions WHERE household_id=h.id)) v
        FROM public.households h WHERE id=$1
      `, [person.id]),
      expireDeadline: () => db.exec("UPDATE public.event_settings SET rsvp_deadline=now()-interval '1 day' WHERE id=1"),
      allowLate: person => organizer(
        "SELECT public.admin_authorize_late_rsvp($1,now()+interval '1 day','Synthetic late response') v",
        [person.id],
      ),
      // Each compressed browser phase stands in for a separate visit. Rate-limit
      // behavior itself has dedicated gateway/database acceptance coverage.
      startNextVisit: () => db.exec("DELETE FROM public.guest_gateway_rate_limits"),
      snapshot: async () => ({
        guests: await get("SELECT count(*)::int v FROM public.guests"),
        submissions: (await db.query("SELECT household_id,submission_number FROM public.rsvp_submissions")).rows,
        claims: (await db.query("SELECT household_id,food_item_id,quantity FROM public.food_claims")).rows,
        confirmed: (await db.query("SELECT id FROM public.households WHERE food_confirmed")).rows,
      }),
      close: () => db.close(),
    };
  } catch (error) {
    await db.close();
    throw error;
  }
}

module.exports = { createGuestJourneyFixture };
