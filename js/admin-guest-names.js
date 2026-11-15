(function () {
  "use strict";
  function render({ R, T, getStore, languages, can, saveForm, managementRpc }) {
    const host = R.byId("guestNamesHost"), settings = getStore().settings || {};
    host.replaceChildren();
    const heading = R.dom("div", { class: "settings-card-heading" });
    heading.append(R.dom("h3", {}, T("Guest titles")));
    const form = R.dom("form", { class: "guest-name-preferences" });
    form.dataset.formKey = "guest-names";
    function tick(label, checked, parent = form) {
      const wrap = R.dom("label", { class: "checkbox-label" }), input = R.dom("input", { type: "checkbox" });
      input.checked = checked;
      wrap.append(input, document.createTextNode(label));
      parent.append(wrap);
      return input;
    }
    const titles = settings.guest_title_visibility || {}, controls = [];
    const group = R.dom("fieldset", { class: "guest-name-option" });
    const languageChoices = R.dom("div", { class: "guest-name-languages" });
    group.append(R.dom("legend", {}, T("Show titles")));
    for (const [code, label] of languages()) {
      const input = tick(label, titles[code] !== false, languageChoices);
      input.disabled = !can("languages", "edit");
      controls.push([code, input]);
    }
    group.append(languageChoices, R.dom("p", { class: "micro" }, T("Choose whether titles appear before guest names in each language. Titles are always hidden on small screens.")));
    form.append(group);
    const surnameOption = R.dom("div", { class: "guest-name-option" });
    const repeated = tick(T("Show repeated surname beside each guest"), settings.show_repeated_surname !== false, surnameOption);
    surnameOption.append(R.dom("p", { class: "micro" }, T("Hide only when every active guest has the same non-empty surname as the household. Mixed surnames stay visible.")));
    form.append(surnameOption);
    host.append(heading, saveForm(form, T("Save"), () => managementRpc("admin_save_guest_name_preferences", {
      p_titles: { ...titles, ...Object.fromEntries(controls.map(([code, input]) => [code, input.checked])) },
      p_show_repeated_surname: repeated.checked,
      p_expected: { titles, show_repeated_surname: settings.show_repeated_surname !== false },
    })));
  }
  window.RSVP_ADMIN_GUEST_NAMES = Object.freeze({ render });
})();
