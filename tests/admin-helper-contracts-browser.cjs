// Shared helper contracts on real browser DOM, with synthetic RPCs only.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { createFoodHarness } = require("./helpers/food-browser-harness.cjs");
const { server, mock, extra } = createFoodHarness("admin-helper-contracts");
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
        viewport: { width: 1024, height: 1000 },
      }),
      errors = [];
    page.setDefaultTimeout(8000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() =>
      localStorage.setItem("rsvp-interface-language", "en"),
    );
    await page.route("**maps.google.com/**", (r) =>
      r.fulfill({ contentType: "text/html", body: "Map fixture" }),
    );
    await page.route("**/supabase.min.js", (r) =>
      r.fulfill({ contentType: "text/javascript", body: mock + "\n" + extra }),
    );
    await page.goto("http://127.0.0.1:" + server.address().port + "/admin/");
    await page.waitForFunction(
      () =>
        document.querySelectorAll("#adminFoodList>.food-category").length >= 2,
    );
    const result = await page.evaluate(async () => {
      const R = window.RSVP,
        T = (...args) => window.RSVP_I18N.t(...args);
      let checks = 0;
      const check = (condition, message) => {
        checks++;
        if (!condition) throw Error(message);
      };
      const tick = () => new Promise((r) => setTimeout(r, 0));
      const root = document.createElement("section");
      document.body.append(root);
      let editing = true,
        opened = 0;
      const iconAction = (kind, title, fn) => {
        const b = R.dom("button", { type: "button" }, title);
        b.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          fn();
        });
        return b;
      };
      const forms = window.RSVP_ADMIN_FORMS.create({
        R,
        T,
        isEditing: () => editing,
        iconAction,
      });
      const independent = window.RSVP_ADMIN_FORMS.create({
        R,
        T,
        isEditing: () => editing,
        iconAction,
      });
      function make(key) {
        const details = document.createElement("details");
        details.innerHTML =
          '<summary>Record <span class="session-order-actions"></span></summary>';
        const f = document.createElement("form");
        f.dataset.formKey = key;
        f.innerHTML =
          '<label>Name<input name="title" value="Original"></label><label>Enabled<input type="checkbox" name="enabled" checked></label><label>First<input type="radio" name="choice" value="first" checked></label><label>Second<input type="radio" name="choice" value="second"></label><label>Option<select name="option"><option value="a">A</option><option value="b">B</option></select></label><label>Notes<textarea name="notes">Original note</textarea></label>';
        const save = R.dom("button", { type: "submit" }, "Save"),
          cancel = R.dom("button", { type: "button" }, "Cancel");
        cancel.dataset.discard = "true";
        forms.formActions(f, save, cancel);
        cancel.addEventListener("click", () => forms.restoreDraft(f));
        details.append(f);
        root.append(details);
        return { f, details, save, cancel };
      }
      const first = make("record");
      let { f, details, save, cancel } = first;
      const listeners = {};
      const add = f.addEventListener.bind(f);
      f.addEventListener = (type, fn, ...rest) => {
        listeners[type] = (listeners[type] || 0) + 1;
        return add(type, fn, ...rest);
      };
      forms.cleanSave(f);
      forms.cleanSave(f, false);
      forms.cleanSave(f, false);
      check(
        listeners.input === 1 && listeners.change === 1,
        "rebinding cleanSave must not duplicate listeners",
      );
      check(save.disabled, "unchanged form must not save");
      forms.readingView(f, "record", () => opened++);
      forms.readingView(f, "record", () => opened++);
      check(
        details.querySelectorAll('[data-record-pencil="record"]').length === 1,
        "one pencil after repeated read-mode setup",
      );
      check(
        details.querySelectorAll('[data-reading-for="record"]').length === 1,
        "one reading row after repeated setup",
      );
      let pencil = details.querySelector("[data-record-pencil]");
      pencil.click();
      check(
        opened === 1 && details.open && f.classList.contains("record-open"),
        "opening must retain record/disclosure state",
      );
      check(
        document.activeElement === f.elements.title,
        "opening must focus the first field",
      );
      f.elements.title.value = "Draft";
      f.elements.enabled.checked = false;
      f.elements.choice.value = "second";
      f.elements.option.value = "b";
      f.elements.notes.value = "Draft note";
      f.dispatchEvent(new Event("input", { bubbles: true }));
      check(!save.disabled, "dirty form must enable Save");
      f.dataset.restoreOnly = "true";
      f.cleanSaveUpdate();
      check(save.disabled, "restore-only records must never save");
      delete f.dataset.restoreOnly;
      editing = false;
      f.cleanSaveUpdate();
      check(save.disabled, "current View mode must disable Save");
      editing = true;
      f.cleanSaveUpdate();
      check(!save.disabled, "current Edit mode must re-enable dirty Save");
      f.setAttribute("aria-busy", "true");
      f.cleanSaveUpdate();
      check(
        save.disabled && cancel.disabled,
        "pending save must disable Save/Cancel",
      );
      forms.restoreDraft(f);
      check(
        f.elements.title.value === "Draft",
        "pending save must not discard draft",
      );
      f.removeAttribute("aria-busy");
      f.cleanSaveUpdate();
      cancel.click();
      check(
        f.elements.title.value === "Original" &&
          f.elements.enabled.checked &&
          f.elements.choice.value === "first" &&
          f.elements.option.value === "a" &&
          f.elements.notes.value === "Original note",
        "Cancel must restore text, checkbox, radio, select and textarea snapshots",
      );
      check(
        save.disabled && !f.classList.contains("record-open"),
        "Cancel must close and clean record editor",
      );
      check(
        document.activeElement === pencil,
        "Cancel must return focus to the pencil",
      );
      const danger = R.dom(
        "button",
        { type: "button", class: "danger" },
        "Delete",
      );
      forms.footerAction(f, danger);
      check(
        danger.closest(".editor-lifecycle-actions") &&
          danger.classList.contains("danger"),
        "footer action must retain destructive styling and placement",
      );
      pencil.click();
      forms.formFeedback(f, "error", "Synthetic conflict");
      const replacement = make("record");
      details.remove();
      forms.cleanSave(replacement.f);
      forms.readingView(replacement.f, "record");
      check(
        replacement.f.classList.contains("record-open"),
        "open state must survive rebuilding the same record",
      );
      check(
        replacement.f
          .querySelector(".form-feedback")
          .textContent.includes("Synthetic conflict"),
        "feedback must survive rebuilding the same record",
      );
      const separate = make("record");
      independent.cleanSave(separate.f);
      independent.readingView(separate.f, "record");
      check(
        !separate.f.classList.contains("record-open") &&
          !separate.f.querySelector(".form-feedback"),
        "helper instances must not share feedback or disclosure maps",
      );
      replacement.f.dataset.initialDraft = "true";
      forms.cleanSave(replacement.f);
      check(
        !replacement.save.disabled,
        "initial drafts retain their create/save behavior",
      );

      const flow = {
        calls: 0,
        reloads: 0,
        mode: "hold",
        messages: [],
        scrolls: [],
      };
      const positions = new Map();
      let releaseSave, autoForm;
      const pipeline = window.RSVP_ADMIN_FORMS.create({
        R,
        T,
        isEditing: () => editing,
        iconAction,
        getActiveTab: () => "households",
        rememberDisclosure: (key, open) => positions.set(key, open),
        reload: async () => {
          flow.reloads++;
          if (flow.mode === "reload-failure") return false;
          if (flow.freshOnReload) {
            const fresh = pipeline.managementForm();
            fresh.id = autoForm.id;
            fresh.dataset.formKey = autoForm.dataset.formKey;
            pipeline.field(fresh, "Title", "Draft");
            pipeline.saveForm(fresh, "Save test", async () => true);
            const target = fresh.saveActions.querySelector(
              "button[data-discard]:not(:disabled)",
            );
            const focus = target.focus.bind(target);
            target.focus = (options) => {
              flow.focusRequest = options;
              focus(options);
            };
            autoForm.replaceWith(fresh);
            flow.newForm = fresh;
          }
          return true;
        },
        show: (text, type) => flow.messages.push({ text, type }),
      });
      autoForm = pipeline.managementForm();
      autoForm.dataset.formKey = "pipeline";
      const autoName = pipeline.field(
        autoForm,
        "Title",
        "Original",
        null,
        "text",
        true,
        20,
      );
      const autoCheck = pipeline.field(
        autoForm,
        "Enabled",
        true,
        null,
        "checkbox",
      );
      pipeline.field(autoForm, "Choice", "a", [
        ["a", "A"],
        ["b", "B"],
      ]);
      root.append(autoForm);
      pipeline.saveForm(autoForm, "Save test", async () => {
        flow.calls++;
        if (flow.mode === "hold")
          return new Promise((resolve) => {
            releaseSave = resolve;
          });
        if (flow.mode === "fail") throw Error("Synthetic pipeline failure");
        return true;
      });
      const autoSave = autoForm.saveActions.querySelector(
        'button[type="submit"]',
      );
      const autoCancel = autoForm.saveActions.querySelector("[data-discard]");
      check(
        autoName.required &&
          autoName.maxLength === 20 &&
          autoName.getAttribute("aria-label") === "Title",
        "field builder preserves required/length/accessible label",
      );
      check(
        autoCheck.checked &&
          autoCheck.parentElement.firstElementChild === autoCheck,
        "checkbox field stays inline before its label",
      );
      autoName.value = "Draft";
      autoForm.dispatchEvent(new Event("input", { bubbles: true }));
      const submit = () =>
        autoForm.dispatchEvent(
          new Event("submit", { cancelable: true, bubbles: true }),
        );
      editing = false;
      submit();
      await tick();
      check(flow.calls === 0, "save pipeline must read current editing mode");
      editing = true;
      submit();
      await tick();
      check(
        flow.calls === 1 &&
          autoForm.getAttribute("aria-busy") === "true" &&
          autoSave.disabled,
        "pending pipeline save is guarded",
      );
      autoCancel.click();
      submit();
      await tick();
      check(
        autoName.value === "Draft" && flow.calls === 1,
        "busy Cancel and duplicate submits must retain the pending draft",
      );
      releaseSave(false);
      await tick();
      check(
        flow.reloads === 0 &&
          !autoForm.hasAttribute("aria-busy") &&
          !autoSave.disabled,
        "aborted save must release controls without reloading",
      );
      flow.mode = "fail";
      submit();
      await tick();
      check(
        autoName.value === "Draft" &&
          flow.reloads === 0 &&
          flow.messages.at(-1).text === "Synthetic pipeline failure",
        "failed save must retain draft and surface error",
      );
      flow.mode = "reload-failure";
      submit();
      await tick();
      check(
        flow.reloads === 1 && !flow.messages.some((m) => m.type === "success"),
        "failed reload must not emit a success notification",
      );
      const tree = document.createElement("details"),
        editor = document.createElement("details");
      tree.open = true;
      tree.dataset.treeKey = "tree";
      tree.append(document.createElement("summary"));
      editor.open = true;
      editor.className = "household-inline-editor";
      editor.dataset.householdDetailKey = "editor";
      editor.append(document.createElement("summary"));
      tree.append(editor);
      root.append(tree);
      editor.append(autoForm);
      autoForm.id = "contract-household";
      autoForm.dataset.formKey = "household:contract";
      const scrollBy = window.scrollBy;
      window.scrollBy = (options) => flow.scrolls.push(options);
      try {
        flow.mode = "success";
        flow.freshOnReload = true;
        submit();
        await tick();
        check(
          positions.get("tree") && positions.get("editor"),
          "save must retain ancestor disclosure state before reload",
        );
        check(
          flow.scrolls.length === 1 &&
            flow.focusRequest?.preventScroll === true &&
            document.activeElement ===
              flow.newForm.saveActions.querySelector("[data-discard]"),
          "successful household reload must focus enabled Cancel and retain relative position correction",
        );
        check(
          flow.newForm.querySelector("input").value === "Draft" &&
            flow.newForm.saveActions.querySelector('button[type="submit"]')
              .disabled,
          "refreshed form must use the saved clean baseline",
        );
      } finally {
        window.scrollBy = scrollBy;
      }

      let store = { claims: [] },
        canEdit = true,
        reloads = 0,
        completed = 0;
      const calls = [],
        messages = [],
        prompts = [];
      const state = {
        bound: true,
        archived: false,
        updated_at: "revision-1",
        reject: true,
        confirm: true,
      };
      const originalConfirm = window.RSVP_INLINE.confirm;
      window.RSVP_INLINE.confirm = async (text) => {
        prompts.push(text);
        return state.confirm;
      };
      try {
        const life = window.RSVP_ADMIN_LIFECYCLE.create({
          R,
          T,
          getStore: () => store,
          isEditing: () => editing,
          can: () => canEdit,
          iconAction,
          managementRpc: async (name, args) => {
            calls.push({ name, ...args });
            if (name !== "admin_item_lifecycle") return {};
            if (state.failInspect) throw Error("Synthetic inspection failure");
            if (args.p_action === "inspect") return { ...state };
            if (state.reject) throw Error("Synthetic revision conflict");
            state.archived = args.p_action === "archive";
            state.updated_at = "revision-2";
            return {};
          },
          reload: async () => {
            reloads++;
          },
          show: (text, type) => messages.push({ text, type }),
        });
        const record = {
          id: "item",
          name_en: "Synthetic item",
          updated_at: "revision-0",
        };
        let host = life.lifecycleControls(
          "food_items",
          record,
          () => completed++,
        );
        root.append(host);
        let button = host.querySelector("button");
        check(
          button.textContent === "Delete",
          "initial unbound presentation remains Delete",
        );
        editing = false;
        button.click();
        await tick();
        check(calls.length === 0, "View mode must not inspect or mutate");
        editing = true;
        state.confirm = false;
        button.click();
        await tick();
        check(
          calls.length === 1 && calls[0].p_action === "inspect",
          "cancelled action must inspect but never write",
        );
        check(!button.disabled, "cancelled action must re-enable control");
        state.confirm = true;
        button.click();
        await tick();
        check(
          calls.at(-1).p_action === "archive",
          "latest server binding must override stale Delete presentation",
        );
        check(
          calls.at(-1).p_expected_updated_at === "revision-0",
          "original record revision must be forwarded",
        );
        check(
          !state.archived &&
            reloads === 0 &&
            completed === 0 &&
            messages.at(-1).text === "Synthetic revision conflict",
          "rejected action must retain state and surface error",
        );
        check(!button.disabled, "rejected action must re-enable control");
        state.reject = false;
        host = life.lifecycleControls(
          "food_items",
          { ...record, updated_at: null },
          () => completed++,
        );
        root.append(host);
        button = host.querySelector("button");
        button.click();
        await tick();
        check(
          calls.at(-1).p_action === "archive" &&
            calls.at(-1).p_expected_updated_at === "revision-1",
          "missing local revision must use inspected revision",
        );
        check(
          state.archived && reloads === 1 && completed === 1,
          "successful action must notify and reload once",
        );
        const archived = life.lifecycleControls(
          "food_items",
          {
            ...record,
            updated_at: null,
            food_group_id: "group",
            archived_at: "synthetic",
          },
          () => completed++,
        );
        root.append(archived);
        const before = calls.length,
          promptCount = prompts.length;
        archived.querySelector("button").click();
        await tick();
        check(
          calls.length === before + 1 && prompts.length === promptCount,
          "archived bound record must not offer destructive confirmation",
        );
        archived.querySelectorAll("button")[1].click();
        await tick();
        check(
          calls.at(-1).p_action === "restore" &&
            !state.archived &&
            completed === 2 &&
            reloads === 2,
          "Restore must retain the guarded restore path",
        );
        state.failInspect = true;
        button.click();
        await tick();
        check(
          messages.at(-1).text === "Synthetic inspection failure" &&
            !button.disabled,
          "inspection failure must surface and release button",
        );
        canEdit = false;
        check(
          life.lifecycleControls("food_items", record) === null &&
            life.lifecycleControls("other_items", {
              id: "task",
              item: "Task",
              status: "open",
            }) === null,
          "section permissions must suppress lifecycle controls",
        );
        canEdit = true;
        store = { claims: [{ food_item_id: "new-item" }] };
        check(
          life
            .lifecycleControls("food_items", {
              id: "new-item",
              name_en: "New item",
            })
            .querySelector("button").textContent === "Archive",
          "new controls must read the current store",
        );
        state.failInspect = false;
        state.confirm = true;
        const household = {
          id: "household",
          household_name: "Synthetic household",
        };
        store = { ...store, settings: { is_published: false } };
        const recordDelete = life.deleteRecordButton("households", household);
        store = { ...store, settings: { is_published: true } };
        let requestCount = calls.length;
        recordDelete.click();
        await tick();
        check(
          calls.length === requestCount,
          "active published records must stay protected using current settings",
        );
        const archivedDelete = life.deleteRecordButton("guests", {
          id: "guest",
          first_name: "Synthetic",
          archived_at: "synthetic",
        });
        state.confirm = false;
        archivedDelete.click();
        await tick();
        check(
          calls.length === requestCount,
          "record deletion cancellation must not write",
        );
        state.confirm = true;
        archivedDelete.click();
        await tick();
        check(
          calls.at(-1).name === "admin_delete_archived_record" &&
            calls.at(-1).p_entity === "guests" &&
            calls.at(-1).p_id === "guest",
          "archived deletion keeps its original server boundary",
        );
        const archiveRecord = life.archiveButton("households", household);
        requestCount = calls.length;
        editing = false;
        archiveRecord.click();
        await tick();
        check(
          calls.length === requestCount,
          "record archive must honor current View mode",
        );
        editing = true;
        archiveRecord.click();
        await tick();
        check(
          calls.at(-1).name === "admin_set_archived" &&
            calls.at(-1).p_archived === true,
          "household archive keeps the original payload",
        );
        const restoreRecord = life.archiveButton("guests", {
          id: "guest",
          archived_at: "synthetic",
        });
        restoreRecord.click();
        await tick();
        check(
          calls.at(-1).name === "admin_set_archived" &&
            calls.at(-1).p_archived === false,
          "guest restore keeps the original payload",
        );
      } finally {
        window.RSVP_INLINE.confirm = originalConfirm;
        root.remove();
      }
      return { checks };
    });
    assert.ok(result.checks >= 25);
    assert.deepEqual(errors, []);
    console.log(
      "PASS shared helper contracts: " +
        result.checks +
        " checks for clean/draft/read-mode/focus/map isolation, live mode/store, inspection/cancellation/revisions, failed actions and Restore.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
