(function () {
  "use strict";
  window.RSVP_ADMIN_FEATURES = {
    create({
      R,
      T,
      getStore,
      isEditing,
      can,
      languages,
      field,
      saveForm,
      managementRpc,
    }) {
      const $ = (id) => document.getElementById(id);
      function renderFeatures() {
        const host = $("eventFeaturesHost");
        host.replaceChildren();
        const store = getStore();
        const e = store.settings || {};
        const heading = R.dom("div", { class: "settings-card-heading" });
        heading.append(R.dom("h3", {}, T("Features")));
        host.append(
          heading,
          R.dom(
            "p",
            { class: "muted" },
            T("Disabled features are hidden. Existing data is kept."),
          ),
        );
        const form = R.dom("form", { class: "form-grid" });
        form.dataset.formKey = "event-features";
        function tick(text, checked) {
          const label = R.dom("label", { class: "checkbox-label" }),
            input = R.dom("input", { type: "checkbox" });
          input.checked = checked;
          label.append(input, document.createTextNode(T(text)));
          form.append(label);
          return input;
        }
        const food = tick("Food", e.food_enabled !== false),
          other = tick("Other", e.other_enabled !== false);
        const stages = R.dom("fieldset", {
          class: "span-2 feature-stage-options",
        });
        stages.append(R.dom("legend", {}, T("interface.messages.food_stage")));
        for (const [value, key, help] of [
          ["interest", "food_stage_interest", "food_interest_question"],
          ["selection", "food_stage_selection", "food_selection_help"],
        ]) {
          const label = R.dom("label", {
              class: "checkbox-label feature-stage-card",
            }),
            input = R.dom("input", {
              type: "radio",
              name: "food_stage",
              value,
            }),
            copy = R.dom("span", { class: "feature-stage-copy" });
          input.checked = value === (e.food_stage || "interest");
          copy.append(
            R.dom("strong", {}, T("interface.messages." + key)),
            R.dom("span", { class: "muted" }, T("interface.messages." + help)),
          );
          label.append(input, copy);
          stages.append(label);
        }
        form.append(
          stages,
          R.dom(
            "p",
            { class: "micro span-2" },
            T("interface.messages.food_stage_help"),
          ),
        );
        const copy = {};
        for (const [code, label] of languages().filter(
          ([code]) =>
            !store.languages.length ||
            store.languages.some((l) => l.language_code === code && l.enabled),
        )) {
          copy[code] = field(
            form,
            T("Food explanation") + " · " + label,
            e.food_introduction?.[code] || "",
            null,
            "textarea",
            false,
            6000,
          );
          copy[code].parentElement.classList.add("span-2");
        }
        const update = () => {
          food.disabled = other.disabled =
            !isEditing() || !can("settings", "edit");
          stages.disabled =
            !food.checked || !isEditing() || !can("settings", "edit");
          for (const input of Object.values(copy))
            input.disabled =
              !food.checked || !isEditing() || !can("settings", "edit");
        };
        food.addEventListener("change", update);
        update();
        host.append(
          saveForm(form, T("interface.messages.save"), async () => {
            const stage =
              form.elements.namedItem("food_stage").value ||
              e.food_stage ||
              "interest";
            if (
              food.checked &&
              stage === "selection" &&
              e.food_stage !== "selection" &&
              !confirm(T("interface.messages.food_stage_confirm"))
            )
              return false;
            await managementRpc("admin_save_features", {
              p_food: food.checked,
              p_other: other.checked,
              p_stage: stage,
              p_introduction: {
                ...e.food_introduction,
                ...Object.fromEntries(
                  Object.entries(copy).map(([code, input]) => [
                    code,
                    input.value.trim(),
                  ]),
                ),
              },
              p_expected: {
                food_enabled: e.food_enabled !== false,
                other_enabled: e.other_enabled !== false,
                food_stage: e.food_stage || "interest",
                food_introduction: e.food_introduction || {},
              },
            });
          }),
        );
      }
      return { render: renderFeatures };
    },
  };
})();
