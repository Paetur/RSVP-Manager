const { refreshFixture } = require("./helpers/admin-toolbar.cjs");
// Actual guest/admin controllers with synthetic API responses only.
const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { server, mock, extra, stageExtra, out } =
  createFoodHarness("guest-rsvp-food");
const rootId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  childId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  leafId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const behavior = `
fixtures.event_settings[0].food_stage='selection';window.__foodAnswer=true;window.__groups=[];window.__rsvpCalls=[];window.__quantityCalls=[];
fixtures.food_categories=[{id:cat1,name:'Meal',parent_id:null,sort_order:1},{id:cat2,name:'Desserts',parent_id:cat1,sort_order:1},{id:'${leafId}',name:'Cakes',parent_id:cat2,sort_order:1}];
fixtures.food_items=[{id:'ffffffff-ffff-4fff-8fff-ffffffffffff',name_en:'Nut-free cake',category:'Cakes',quantity_needed:6,quantity_type:'Batch(s)',description_en:'Bring in a labelled container',active:true},{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',name_en:'Fruit cake',category:'Cakes',quantity_needed:4,quantity_type:'Piece(s)',active:true}];fixtures.food_claims=[];
const persisted=sessionStorage.getItem('guest-rsvp-food-confirmed');if(persisted){const x=JSON.parse(persisted);Object.assign(window.__invite.household,{rsvp_state:'locked',rsvp_comment:x.comment});for(const link of window.__invite.invitations)link.response=x.responses.find(r=>r.guest_id===link.guest_id&&r.session_id===link.session_id)?.status;}
const previousGuest=client.functions.invoke;client.functions.invoke=async(name,request)=>{const {action,args}=request.body;
if(action==='submit_household_rsvp'){window.__rsvpCalls.push(structuredClone(args));if(window.__failRsvp){window.__failRsvp=false;return {error:{message:'Synthetic network failure'}};}window.__invite.household.rsvp_state='locked';window.__invite.household.rsvp_comment=args.p_comment;for(const link of window.__invite.invitations)link.response=args.p_responses.find(r=>r.guest_id===link.guest_id&&r.session_id===link.session_id)?.status;sessionStorage.setItem('guest-rsvp-food-confirmed',JSON.stringify({comment:args.p_comment,responses:args.p_responses}));return {data:{submission_id:'saved'}};}
if(action==='set_household_food_claim'){window.__quantityCalls.push(structuredClone(args));if(window.__quantityFail){window.__quantityFail=false;return {error:{message:'Synthetic capacity conflict'}};}fixtures.food_claims=fixtures.food_claims.filter(c=>c.food_item_id!==args.p_food_item_id);if(args.p_quantity)fixtures.food_claims.push({food_item_id:args.p_food_item_id,quantity:args.p_quantity,notes:args.p_notes??'Keep cold'});return {data:null};}
return previousGuest(name,request);};
const previousAdmin=client.rpc;client.rpc=async(name,args)=>{if(name==='admin_save_food_category'){const c=fixtures.food_categories.find(c=>c.id===args.p_category_id);window.__categorySave=structuredClone(args);if(c){for(const f of fixtures.food_items)if(f.category===c.name)f.category=args.p_name;Object.assign(c,{name:args.p_name,parent_id:args.p_parent_id});return {data:c.id};}const id=crypto.randomUUID();fixtures.food_categories.push({id,name:args.p_name,parent_id:args.p_parent_id,sort_order:10});return {data:id};}return previousAdmin(name,args);};
fixtures.households[1].latest_rsvp_submission_id='new-submission';fixtures.rsvp_submissions=[{id:'new-submission',household_id:h2,comment:'Admin can see the RSVP comment'}];
`;
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  let cases = 0;
  try {
    fs.mkdirSync(out, { recursive: true });
    for (const width of [390, 1160])
      for (const language of ["en", "de", "fo"]) {
        const page = await browser.newPage({
            viewport: { width, height: 1000 },
          }),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.addInitScript(
          ({ language }) => {
            localStorage.setItem("rsvp-interface-language", language);
            localStorage.setItem("event-appearance", "dark");
          },
          { language },
        );
        await page.route("**/supabase.min.js", (r) =>
          r.fulfill({
            contentType: "text/javascript",
            body: mock + "\n" + extra + "\n" + stageExtra + "\n" + behavior +
              "\nwindow.__invite.household.language=" + JSON.stringify(language) + ";",
          }),
        );
        await page.route("**maps.google.com/**", (r) =>
          r.fulfill({ contentType: "text/html", body: "Map fixture" }),
        );
        const url = "http://127.0.0.1:" + server.address().port;
        await page.goto(url + "/?ABCDEFGH");
        const inlineValidation = page.locator("#rsvpValidation");
        await page.locator("#saveRsvp").press("Enter");
        assert.equal(
          await inlineValidation.textContent(),
          require(`../locales/${language}/interface.json`).messages
            .choose_a_response_for_every_invited_guest_and_session,
        );
        await page.waitForFunction((narrow) => {
          const firstAnswer = document.querySelector("#rsvpRows input[value=attending]");
          const inViewport = node => {
            const { top, bottom } = node.getBoundingClientRect();
            return top >= 0 && bottom <= innerHeight;
          };
          return document.activeElement === firstAnswer &&
            inViewport(firstAnswer.closest("label")) &&
            inViewport(document.getElementById("rsvpValidation")) &&
            (!narrow || inViewport(document.getElementById("saveRsvp")));
        }, width < 700);
        const geometry = await inlineValidation.evaluate(warning => {
          const focusedChoice = document.activeElement.closest("label");
          const [first, second] = focusedChoice.closest(".response-options").querySelectorAll("label");
          const warningBox = warning.getBoundingClientRect();
          const firstBox = first.getBoundingClientRect();
          const secondBox = second.getBoundingClientRect();
          const style = getComputedStyle(focusedChoice);
          const outline = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
          return {
            leftDifference: warningBox.left - firstBox.left,
            rightDifference: warningBox.right - secondBox.right,
            gap: warningBox.top - Math.max(firstBox.bottom, secondBox.bottom),
            outline,
          };
        });
        assert.ok(Math.abs(geometry.leftDifference) <= 1, "the warning aligns with the first answer's left edge");
        assert.ok(Math.abs(geometry.rightDifference) <= 1, "the warning aligns with the second answer's right edge");
        assert.ok(geometry.outline > 0 && geometry.gap >= geometry.outline - 0.5,
          "the warning stays below the answers and their keyboard focus ring");
        assert.equal(await page.locator("#confirmRsvp").isVisible(), false);
        assert.equal(await page.evaluate(() => window.__rsvpCalls.length), 0);
        await page.locator("#rsvpRows input[value=attending]").first().check();
        assert.equal(await inlineValidation.isHidden(), true);
        assert.equal(await page.locator("#guestStatus").isHidden(), true);
        const comment =
          'No nuts, please.\n<img src=x onerror="window.__unsafe=true">';
        await page.locator("#rsvpCommentDisclosure summary").click();
        await page.locator("#rsvpComment").fill(comment);
        await page.locator("#saveRsvp").click();
        assert.equal(
          await page.locator("#rsvpCommentPreview p").textContent(),
          comment,
        );
        assert.equal(await page.locator("#rsvpCommentPreview img").count(), 0);
        await page.locator("#editRsvp").click();
        assert.equal(await page.locator("#rsvpComment").inputValue(), comment);
        assert.equal(await inlineValidation.isHidden(), true);
        await page.locator("#saveRsvp").click();
        if (language === "en")
          await page.locator("#invitationCard").screenshot({
            path: path.join(out, "rsvp-comment-review-" + width + ".png"),
          });
        await page.evaluate(() => (window.__failRsvp = true));
        await page.locator("#confirmRsvp").click();
        await page.waitForFunction(() => window.__rsvpCalls.length === 1);
        assert(await page.locator("#confirmRsvp").isVisible());
        await page.locator("#confirmRsvp").click();
        await page.waitForFunction(
          () => window.__invite.household.rsvp_state === "locked",
        );
        const calls = await page.evaluate(() => window.__rsvpCalls);
        assert.equal(calls.length, 2);
        assert.equal(calls[0].p_request_id, calls[1].p_request_id);
        assert.equal(calls[1].p_comment, comment);
        assert.equal(
          await page.locator("#rsvpCommentPreview p").textContent(),
          comment,
        );
        await page.goto(url + "/?ABCDEFGH");
        await page.locator("#rsvpCommentPreview").waitFor();
        assert.equal(await inlineValidation.isHidden(), true);
        assert.equal(
          await page.locator("#rsvpCommentPreview p").textContent(),
          comment,
        );
        const leaf = page.locator('[data-category-id="' + leafId + '"]');
        assert.equal(
          await page
            .locator(
              '[data-category-id="' +
                rootId +
                '"] > [data-category-id="' +
                childId +
                '"] > [data-category-id="' +
                leafId +
                '"]',
            )
            .count(),
          1,
        );
        assert(
          await leaf
            .getByText("Bring in a labelled container", { exact: false })
            .isVisible(),
        );
        const choice = leaf.locator("button[data-item-id]").first(),
          quantity = leaf.locator("input[data-item-id]").first();
        assert((await quantity.getAttribute("max")) === "6");
        await quantity.fill("3");
        await quantity.dispatchEvent("change");
        await choice.click();
        await page.waitForFunction(
          () =>
            window.__quantityCalls.length === 1 &&
            document
              .querySelector("#foodList button[data-item-id]")
              ?.getAttribute("aria-pressed") === "true",
        );
        assert.equal(
          await page.evaluate(() => window.__quantityCalls[0].p_quantity),
          3,
        );
        assert.equal(await quantity.inputValue(), "3");
        await quantity.fill("2");
        await quantity.dispatchEvent("change");
        await page.waitForFunction(
          () =>
            window.__quantityCalls.length === 2 &&
            document.querySelector("#foodList input[data-item-id]")?.value ===
              "2" &&
            !document.querySelector("#foodList input[data-item-id]")?.disabled,
        );
        assert.equal(
          await quantity.evaluate((n) => document.activeElement === n),
          true,
        );
        assert.equal(
          await page.evaluate(() => window.__quantityCalls[1].p_notes),
          "Keep cold",
          "quantity changes retain an existing claim note",
        );
        if (language === "en")
          await page.locator("#foodCard").screenshot({
            path: path.join(out, "food-quantity-tree-" + width + ".png"),
          });
        await page.locator("#confirmFood").click();
        assert(
          (
            await page.locator("#foodReview .food-review-list").textContent()
          ).includes("2 × Nut-free cake"),
        );
        assert.equal(
          await page.locator("#foodReviewTitle").evaluate(heading => document.activeElement === heading),
          true,
          "opening review transfers focus from the quantity field to the review heading",
        );
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 2,
          ),
        );
        assert.deepEqual(errors, []);
        assert.equal(await page.evaluate(() => window.__unsafe), undefined);
        await page.close();
        cases++;
      }
    const page = await browser.newPage({
        viewport: { width: 1160, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() =>
      localStorage.setItem("rsvp-interface-language", "en"),
    );
    await page.route("**/supabase.min.js", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: mock + "\n" + extra + "\n" + stageExtra + "\n" + behavior,
      }),
    );
    await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
    await page.waitForFunction(
      () => document.querySelector("#inviteOverviewCounts .invite-stat-row"),
    );
    await page.locator("[data-tab=invites]").click();
    await page
      .locator(
        '#inviteRows [data-invite-household="22222222-2222-4222-8222-222222222222"]',
      )
      .evaluate((n) => (n.open = true));
    await page.waitForFunction(() =>
      document.querySelector(
        "#invite-rsvp-22222222-2222-4222-8222-222222222222",
      ),
    );
    assert(
      (
        await page.locator(".admin-rsvp-comment").first().textContent()
      ).includes("Admin can see"),
    );
    await page.locator("[data-tab=food]").click();
    await page.locator("#expandFood").click();
    assert.equal(
      await page
        .locator(
          '[data-food-category-id="' +
            rootId +
            '"] > .food-subcategories > [data-food-category-id="' +
            childId +
            '"] > .food-subcategories > [data-food-category-id="' +
            leafId +
            '"]',
        )
        .count(),
      1,
    );
    const root = page.locator('[data-food-category-id="' + rootId + '"]');
    assert.equal(
      await root.locator(":scope > summary > .tree-count").textContent(),
      "1 sub-category",
    );
    assert.equal(
      await page
        .locator(
          '[data-food-category-id="' + leafId + '"] > summary > .tree-count',
        )
        .textContent(),
      "2 items · Quantity: 0/10",
    );
    assert.equal(
      await root
        .locator(":scope > summary > .food-heading-actions > button")
        .filter({ hasText: "Add sub-category" })
        .count(),
      0,
      "sub-category creation is only in the + popup",
    );
    const plus = root
      .locator(":scope > summary")
      .getByRole("button", { name: "Add item or sub-category", exact: true });
    await plus.click();
    const addMenu = page.getByRole("dialog", {
      name: "Add item or sub-category",
      exact: true,
    });
    assert.equal(await addMenu.getByRole("button").count(), 2);
    await page.keyboard.press("Escape");
    assert.equal(
      await plus.evaluate((button) => button === document.activeElement),
      true,
      "Escape returns focus to +",
    );
    await plus.click();
    await addMenu
      .getByRole("button", { name: "Add sub-category", exact: true })
      .click();
    assert.equal(await addMenu.isVisible(), false);
    assert.equal(
      await page
        .locator("#addCategoryForm .food-category-fields label")
        .first()
        .textContent(),
      "Category name",
    );
    assert.equal(
      await page
        .locator("#addCategoryForm .food-category-fields")
        .evaluate((row) => {
          const boxes = [...row.children].map((n) => n.getBoundingClientRect());
          return Math.abs(boxes[0].top - boxes[1].top) < 2;
        }),
      true,
      "creation Name/Parent share a desktop row",
    );
    assert.equal(await page.locator("#newCategoryParent").inputValue(), rootId);
    await page.locator("#categoryName").fill("Cookies");
    await page.locator("#addCategoryForm button[type=submit]").click();
    await page.waitForFunction(
      () =>
        window.__categorySave?.p_name === "Cookies" &&
        document.querySelectorAll("#adminFoodList .food-category").length === 4,
    );
    assert.equal(
      await page.evaluate(() => window.__categorySave.p_parent_id),
      rootId,
    );
    assert.equal(
      await page
        .locator('[data-tree-key="food:Cookies"] > summary > .tree-count')
        .textContent(),
      "",
    );
    await root
      .locator(":scope > summary")
      .getByRole("button", { name: "Rename food category", exact: true })
      .click();
    const edit = root.locator(":scope > .food-category-name-form");
    for (const width of [1160, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const sameRow = await edit
        .locator(".food-category-fields")
        .evaluate((row) => {
          const boxes = [...row.children].map((n) => n.getBoundingClientRect());
          return Math.abs(boxes[0].top - boxes[1].top) < 2;
        });
      assert.equal(
        sameRow,
        width > 600,
        "edit Name/Parent respond to available width",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      await edit.screenshot({
        path: path.join(out, "category-editor-" + width + ".png"),
      });
    }
    await plus.click();
    assert.equal(
      await addMenu.evaluate((menu) => {
        const r = menu.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth;
      }),
      true,
      "phone popup fits the screen",
    );
    await addMenu.screenshot({
      path: path.join(out, "category-add-popup-390.png"),
    });
    await page.keyboard.press("Escape");
    assert.equal(
      await edit.locator('select option[value="' + leafId + '"]').count(),
      0,
    );
    await edit
      .getByRole("button", { name: "Delete category", exact: true })
      .click();
    assert(
      (await page.locator("#adminMessage").textContent()).includes(
        "Move sub-categories",
      ),
    );
    await page
      .locator("#adminFoodList")
      .screenshot({ path: path.join(out, "admin-category-tree.png") });
    await page.setViewportSize({ width: 390, height: 1000 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
      "nested admin categories fit phones",
    );
    await page
      .locator("#adminFoodList")
      .screenshot({ path: path.join(out, "admin-category-tree-phone.png") });
    // Counts and quantity summaries are independent: zero-capacity items still count.
    await page.evaluate(() => {
      for (const item of fixtures.food_items) item.quantity_needed = 0;
    });
    await refreshFixture(page);
    await page.waitForFunction(
      () => !document.querySelector("#refreshButton").disabled,
    );
    await page.locator("#expandFood").click();
    assert.equal(
      await page
        .locator(
          '[data-food-category-id="' + leafId + '"] > summary > .tree-count',
        )
        .textContent(),
      "2 items",
    );
    assert.equal(
      await page.locator("#adminFoodList .food-quantity-summary").count(),
      0,
      "zero-over-zero item summaries are hidden",
    );
    await page.evaluate(() => {
      fixtures.food_claims.push({
        food_item_id: fixtures.food_items[0].id,
        household_id: fixtures.households[0].id,
        quantity: 1,
      });
    });
    await refreshFixture(page);
    await page.waitForFunction(
      () => !document.querySelector("#refreshButton").disabled,
    );
    await page.locator("#expandFood").click();
    assert.equal(
      await page
        .locator(
          '[data-food-category-id="' + leafId + '"] > summary > .tree-count',
        )
        .textContent(),
      "2 items · Quantity: 1/0",
    );
    assert.equal(
      await page.locator("#adminFoodList .food-quantity-summary").count(),
      1,
      "existing commitments remain visible even at zero capacity",
    );
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(() => fixtures.event_settings[0].is_published),
      false,
    );
    await page.close();
    console.log(
      "PASS new guest browser: " +
        cases +
        " phone/desktop/EN-DE-FO cases; comment review/edit/retry/reload/XSS, quantity updates/focus/remaining need/notes/review, nested guest/admin categories, parent creation and deletion guards; event unpublished.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
