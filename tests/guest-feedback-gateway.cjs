// Gateway handler validation with a synthetic service adapter, never a real API.
const assert = require("node:assert/strict");
(async () => {
  let handler;
  global.Deno = {
    serve: (fn) => (handler = fn),
    env: {
      get: (key) =>
        ({
          RSVP_SITE_ORIGIN: "https://example.invalid",
          SUPABASE_URL: "https://synthetic.invalid",
          SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-key",
        })[key],
    },
  };
  const originalFetch = global.fetch;
  const calls = [];
  try {
    global.fetch = async (url, options) => {
      calls.push({ url, args: JSON.parse(options.body), authorization: options.headers.Authorization });
      return new Response(
        JSON.stringify(
          url.endsWith("guest_gateway_allow_request") ? true : { ok: true },
        ),
        { status: 200 },
      );
    };
    await import("../supabase/functions/guest-gateway/index.ts");
    const send = (action, args, origin = "https://example.invalid") =>
      handler(
        new Request("https://gateway.invalid", {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({ action, args }),
        }),
      );
    const person = {
      p_code: "ABCDEFGH",
      p_guest_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      p_first_name: "New",
      p_last_name: "Person",
      p_is_child: false,
    };
    assert.equal((await send("add_household_guest", person)).status, 200);
    assert.equal(
      calls.at(-1).url,
      "https://synthetic.invalid/rest/v1/rpc/add_household_guest",
    );
    for (const args of [
      { ...person, p_household_id: "forged" },
      { ...person, p_first_name: " " },
      { ...person, p_first_name: "x".repeat(121) },
      { ...person, p_guest_id: "bad" },
      { ...person, p_is_child: "false" },
    ])
      assert.equal((await send("add_household_guest", args)).status, 400);
    const interest = {
      p_code: "ABCDEFGH",
      p_interest: true,
      p_expected_interest: null,
    };
    assert.equal(
      (await send("set_household_food_interest", interest)).status,
      200,
    );
    for (const args of [
      { ...interest, p_interest: "yes" },
      { ...interest, p_interest: null },
      { ...interest, p_expected_interest: "false" },
      { ...interest, p_household_id: "forged" },
    ])
      assert.equal(
        (await send("set_household_food_interest", args)).status,
        400,
      );
    const group = {
      p_code: "ABCDEFGH",
      p_group_id: person.p_guest_id,
      p_quantity: 1,
    };
    assert.equal((await send("set_household_food_group", group)).status, 200);
    for (const args of [
      { ...group, p_quantity: 2 },
      { ...group, p_group_id: "bad" },
      { ...group, p_household_id: "other" },
    ])
      assert.equal((await send("set_household_food_group", args)).status, 400);
    assert.equal(
      (await send("set_household_food_group", group, "https://other.invalid"))
        .status,
      403,
    );
    const reviewed = {
      p_code: "ABCDEFGH",
      p_expected_claims: [{ food_item_id: person.p_guest_id, quantity: 1 }],
    };
    assert.equal((await send("confirm_household_food", reviewed)).status, 200);
    for (const args of [
      { ...reviewed, p_expected_claims: [] },
      {
        ...reviewed,
        p_expected_claims: [{ food_item_id: "bad", quantity: 1 }],
      },
      {
        ...reviewed,
        p_expected_claims: [{ food_item_id: person.p_guest_id, quantity: 0 }],
      },
      { ...reviewed, p_household_id: "forged" },
    ])
      assert.equal((await send("confirm_household_food", args)).status, 400);
    const response = {
      p_code: "ABCDEFGH",
      p_request_id: person.p_guest_id,
      p_responses: [
        {
          guest_id: person.p_guest_id,
          session_id: person.p_guest_id,
          status: "attending",
        },
      ],
      p_comment: "No nuts, please",
    };
    assert.equal((await send("submit_household_rsvp", response)).status, 200);
    assert.equal(calls.at(-1).args.p_comment, "No nuts, please");
    for (const args of [
      { ...response, p_comment: "x".repeat(2001) },
      { ...response, p_comment: 42 },
      { ...response, p_household_id: "forged" },
    ])
      assert.equal((await send("submit_household_rsvp", args)).status, 400);
    const combined = { ...response, p_food_interest: false };
    const combinedStart = calls.length;
    assert.equal((await send("submit_household_response", combined)).status, 200);
    assert.deepEqual(calls.slice(combinedStart).map(({ url }) => url.split("/").at(-1)), [
      "guest_gateway_allow_request",
      "submit_household_response",
    ]);
    assert.equal(calls[combinedStart].args.p_action, "submit_household_response");
    assert.deepEqual(calls.at(-1).args, combined);
    assert.equal(calls.at(-1).authorization, "Bearer synthetic-server-key");
    for (const args of [
      response,
      { ...combined, p_food_interest: null },
      { ...combined, p_food_interest: "true" },
      { ...combined, p_comment: "x".repeat(2001) },
      { ...combined, p_responses: [] },
      { ...combined, p_responses: [{ ...response.p_responses[0], status: "maybe" }] },
      { ...combined, p_household_id: "forged" },
    ])
      assert.equal((await send("submit_household_response", args)).status, 400);
    assert.equal(calls.length, combinedStart + 2, "Invalid combined requests stop before the service adapter");
    for (const p_quantity of [0, 1, 6, 1000])
      assert.equal(
        (
          await send("set_household_food_claim", {
            p_code: "ABCDEFGH",
            p_food_item_id: person.p_guest_id,
            p_quantity,
          })
        ).status,
        200,
      );
    for (const p_quantity of [-1, 1.5, 1001])
      assert.equal(
        (
          await send("set_household_food_claim", {
            p_code: "ABCDEFGH",
            p_food_item_id: person.p_guest_id,
            p_quantity,
          })
        ).status,
        400,
      );
    console.log(
      "PASS gateway: one validated combined response call, scoped RSVP comments and quantity bounds, companions and Food Groups, forged targets and exact origins",
    );
  } finally {
    global.fetch = originalFetch;
    delete global.Deno;
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
