(function () {
  "use strict";
  const presetGroups = {
    wedding: [
      ["wedding_family", "Family"],
      ["wedding_friends", "Friends"],
    ],
    reunion: [
      ["reunion_family", "Family"],
      ["reunion_friends", "Friends"],
    ],
    conference: [
      ["conference_attendees", "Attendees"],
      ["conference_speakers", "Speakers"],
    ],
    custom: [["general", "General"]],
  };
  window.RSVP_ADMIN_PLANNING = {
    create({
      R,
      T,
      getStore,
      can,
      planningName,
      languages,
      managementForm,
      field,
      iconAction,
      saveForm,
      managementRpc,
    }) {
      const $ = (id) => document.getElementById(id);
      function renderPlanningSettings() {
        const host = $("planningConfigHost");
        host.replaceChildren();
        const original = getStore().settings?.planning_config;
        if (!original || !can("settings")) return;
        const panel = R.dom("section", { class: "panel settings-card" });
        panel.dataset.settingsCard = "event-planning";
        const heading = R.dom("div", { class: "settings-card-heading" });
        heading.append(R.dom("h3", {}, T("Event planning")));
        panel.append(heading);
        host.append(panel);
        const current = getStore().settings.event_type;
        const presets = [
          ["wedding", T("Wedding")],
          ["reunion", T("Reunion")],
          ["conference", T("Conference")],
          ["custom", T("Custom")],
        ];
        const presetName =
          presets.find(([value]) => value === current)?.[1] || T("Custom");
        if (!Object.hasOwn(presetGroups, current))
          presets[3] = [current, T("Custom")];
        const summary = R.dom("div", { class: "planning-summary" });
        const overview = R.dom("dl", { class: "record-read-grid" });
        overview.append(
          R.dom("dt", {}, T("Event preset")),
          R.dom("dd", {}, presetName),
        );
        summary.append(overview, R.dom("h4", {}, T("Shared labels")));
        const shared = R.dom("dl", { class: "record-read-grid" });
        for (const key of ["households", "guests"]) {
          const title = T("interface.messages." + key);
          shared.append(
            R.dom("dt", {}, title),
            R.dom("dd", {}, planningName(original.labels[key]) || title),
          );
        }
        summary.append(shared, R.dom("h4", {}, T("Top-level groups")));
        const groups = R.dom("ul");
        for (const group of original.groups)
          groups.append(R.dom("li", {}, planningName(group.names) || group.id));
        summary.append(groups);
        panel.append(summary);
        if (!can("settings", "edit")) return;
        const draft = structuredClone(original),
          form = managementForm();
        form.dataset.formKey = "event-planning";
        form.classList.add("planning-editor");
        const preset = field(form, T("Event preset"), current, presets);
        const snapshot = R.dom("input", { type: "hidden" });
        snapshot.value = JSON.stringify(draft);
        form.append(snapshot);
        const sync = () => {
          snapshot.value = JSON.stringify(draft);
          snapshot.dispatchEvent(new Event("change", { bubbles: true }));
        };
        const apply = R.dom(
          "button",
          { type: "button", class: "small-tool" },
          T("Use preset suggestions"),
        );
        form.append(
          apply,
          R.dom(
            "p",
            { class: "micro span-2" },
            T(
              "Preset suggestions add missing groups and fill blank labels. Review them before saving.",
            ),
          ),
        );
        const codes = [...new Map([["en", "English"], ...languages()])];
        const labelFields = R.dom("fieldset", {
          class: "span-2 planning-fields",
        });
        const groupFields = R.dom("div", { class: "span-2 planning-groups" });
        form.append(labelFields, groupFields);
        function nameFields(container, names, required = false) {
          for (const [code, label] of codes) {
            const input = field(
              container,
              label,
              names[code],
              null,
              "text",
              required && code === "en",
              140,
            );
            input.addEventListener("input", () => {
              if (input.value.trim()) names[code] = input.value.trim();
              else delete names[code];
              sync();
            });
          }
        }
        function renderFields() {
          labelFields.replaceChildren(R.dom("legend", {}, T("Shared labels")));
          for (const key of ["households", "guests"]) {
            const box = R.dom("fieldset", { class: "planning-fields" });
            box.append(R.dom("legend", {}, T("interface.messages." + key)));
            nameFields(box, draft.labels[key]);
            labelFields.append(box);
          }
          groupFields.replaceChildren();
          draft.groups.forEach((group, index) => {
            const box = R.dom("fieldset", { class: "planning-fields" });
            box.append(
              R.dom(
                "legend",
                {},
                planningName(group.names) || T("Top-level group"),
              ),
            );
            nameFields(box, group.names, true);
            const actions = R.dom("div", { class: "form-actions" });
            for (const direction of [-1, 1]) {
              const position = index + direction;
              actions.append(
                iconAction(
                  direction === -1 ? "up" : "down",
                  T(direction === -1 ? "Move group up" : "Move group down"),
                  () => {
                    [draft.groups[index], draft.groups[position]] = [
                      draft.groups[position],
                      draft.groups[index],
                    ];
                    renderFields();
                    sync();
                  },
                  position < 0 || position >= draft.groups.length,
                ),
              );
            }
            const remove = R.dom(
              "button",
              { type: "button", class: "small-tool" },
              T("Remove group"),
            );
            remove.disabled =
              draft.groups.length === 1 ||
              getStore().households.some(
                (h) => h.planning_group_id === group.id,
              );
            remove.addEventListener("click", () => {
              draft.groups.splice(index, 1);
              renderFields();
              sync();
            });
            actions.append(remove);
            box.append(actions);
            groupFields.append(box);
          });
          const add = R.dom(
            "button",
            { type: "button", class: "small-tool" },
            T("Add group"),
          );
          add.disabled = draft.groups.length >= 40;
          add.addEventListener("click", () => {
            draft.groups.push({
              id: "group_" + R.randomId().replaceAll("-", ""),
              names: {},
            });
            renderFields();
            sync();
            groupFields
              .querySelectorAll("fieldset")
              .item(draft.groups.length - 1)
              ?.querySelector("input")
              ?.focus();
          });
          groupFields.append(add);
        }
        apply.addEventListener("click", async () => {
          await window.RSVP_I18N.loadCatalogs(codes.map(([code]) => code));
          const names = (source) =>
            Object.fromEntries(
              codes.map(([code]) => [
                code,
                window.RSVP_I18N.t(source, {}, code),
              ]),
            );
          for (const [id, source] of Object.hasOwn(presetGroups, preset.value)
            ? presetGroups[preset.value]
            : presetGroups.custom) {
            if (
              draft.groups.length < 40 &&
              !draft.groups.some((group) => group.id === id)
            )
              draft.groups.push({ id, names: names(source) });
          }
          if (preset.value === "conference") {
            for (const [key, source] of [
              ["households", "Bookings"],
              ["guests", "Participants"],
            ]) {
              draft.labels[key] = { ...names(source), ...draft.labels[key] };
            }
          }
          renderFields();
          sync();
        });
        renderFields();
        panel.append(
          saveForm(form, T("Save"), () =>
            managementRpc("admin_save_planning_configuration", {
              p_config: draft,
              p_expected_config: original,
              p_preset: preset.value,
              p_expected_preset: current,
            }),
          ),
        );
        form
          .querySelector("[data-discard]")
          ?.addEventListener("click", renderPlanningSettings);
      }
      return { render: renderPlanningSettings };
    },
  };
})();
