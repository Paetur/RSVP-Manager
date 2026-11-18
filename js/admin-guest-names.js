(function () {
  "use strict";
  let cached = null;
  function render({ R, T, getStore, languages, can, saveForm, managementRpc }) {
    const host = R.byId("guestNamesHost"), settings = getStore().settings || {};
    const mode = window.RSVP_GUEST_INTERFACE.selected;
    const oldForm = host.querySelector("form");
    if (cached?.mode === mode && oldForm?.localEditor?.box.classList.contains("local-editor-open") && window.RSVP_I18N.isDirty(oldForm) && can("settings", "edit")) return;
    cached = { mode };
    host.replaceChildren();
    const heading = R.dom("div", { class: "settings-card-heading" });
    heading.append(R.dom("h3", {}, T("Guest titles")));
    const form = R.dom("form", { class: "guest-name-preferences" });
    form.dataset.formKey = "guest-names:" + mode;
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
    group.append(languageChoices, R.dom("p", { class: "micro" }, T("Choose whether titles appear before guest names in each language.")));
    form.append(group);
    const surnameOption = R.dom("div", { class: "guest-name-option" });
    const repeated = tick(T("Show repeated surname beside each guest"), settings.show_repeated_surname !== false, surnameOption);
    surnameOption.append(R.dom("p", { class: "micro" }, T("Hide only when every active guest has the same non-empty surname as the household. Mixed surnames stay visible.")));
    form.append(surnameOption);
    const placement = R.dom("label"); placement.append(R.dom("span", {}, T("Guest name placement")));
    const layout = R.dom("select");
    for (const [value,text] of [["above","Above and centred"],["inline","Left inline"]]) layout.append(R.dom("option", { value }, T(text)));
    layout.value = settings.guest_name_layout; placement.append(layout); form.append(placement);
    const expected = { guest_title_visibility: titles, show_repeated_surname: settings.show_repeated_surname !== false, guest_name_layout: settings.guest_name_layout };
    host.append(heading, saveForm(form, T("Save"), () => managementRpc("admin_save_guest_interface", {
      p_mode: mode,
      p_values: { guest_title_visibility: { ...titles, ...Object.fromEntries(controls.map(([code, input]) => [code, input.checked])) }, show_repeated_surname: repeated.checked, guest_name_layout: layout.value },
      p_expected: expected,
    })));
  }
  window.RSVP_ADMIN_GUEST_NAMES = Object.freeze({ render });
})();
