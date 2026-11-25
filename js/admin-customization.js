(function () {
  "use strict";
  const drafts = new Map();
  let generation = 0;
  const I = window.RSVP_I18N,
    T = (s, p) => I.t(s, p),
    D = window.RSVP_GUEST_DESIGN;
  const previewPalette = (theme) => theme === "system"
    ? matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    : theme === "light" ? "light" : "dark";
  function render(options, preserveDraft = false, resetBaseline = null) {
    const ctx = options, { R } = ctx, host = ctx.host || R.byId("guestAppearanceHost");
    const mode = ctx.mode || window.RSVP_GUEST_INTERFACE.selected;
    let draft = drafts.get(mode);
    if (!host) return;
    const previous = host.customizationController;
    if (ctx.can("settings") && preserveDraft && previous?.preserve()) {
      // Rebind only live integration callbacks. The retained controller keeps
      // its original optimistic baseline, invalid fields and failure feedback.
      Object.assign(previous.context, options);
      options.mountPreview?.(previous.preview);
      previous.update();
      return;
    }
    host.replaceChildren();
    delete host.customizationController;
    if (!ctx.can("settings")) return;
    const original = resetBaseline || ctx.getStore().settings || {},
      originalTitles = original.guest_title_visibility || {},
      savedShowTitles = original.guest_interface_modes?.[mode]?.guest_show_titles ?? null,
      originalShowTitles = original.guest_show_titles ?? ctx.languages().some(([code]) => originalTitles[code] !== false),
      revision = JSON.stringify([mode, original.guest_design, original.guest_background, original.guest_theme_toggle, original.guest_theme_default, original.guest_title_visibility, originalShowTitles, original.show_repeated_surname, original.guest_name_layout]);
    if (!draft || draft.revision !== revision)
      draft = {
        revision,
        design: structuredClone(original.guest_design || D.defaults),
        designChanged: false,
        background: original.guest_background || null,
        backgroundMode: "keep",
        toggle: original.guest_theme_toggle !== false,
        theme: original.guest_theme_default || "dark",
        palette: previewPalette(original.guest_theme_default),
        wide: mode === "wide",
        titles: { ...originalTitles },
        showTitles: originalShowTitles,
        surname: original.show_repeated_surname !== false,
        nameLayout: original.guest_name_layout,
      };
    drafts.set(mode, draft);
    const working = draft;
    const ticket = generation;
    let busy = false, committed = false,
      uploadVersion = 0;
    const heading = R.dom("div", { class: "settings-card-heading" });
    heading.append(R.dom("h3", {}, T(mode === "phone" ? "Phone" : "Wide")));
    host.append(heading);
    const layout = R.dom("div", { class: "customization-layout" }),
      form = R.dom("form", { class: "customization-form" });
    form.dataset.formKey = "guest-customization:" + mode;
    form.dataset.customization = "true";
    form.dataset.headerEditor = "true";
    const controls = [];
    layout.append(form);
    host.append(layout);
    const status = R.dom("p", {
      class: "micro customization-status",
      role: "status",
    });
    status.setAttribute("aria-live", "polite");
    const make = (tag, attrs, text) => R.dom(tag, attrs, text);
    function button(label, fn, extra = "secondary") {
      const b = make(
        "button",
        { type: "button", class: "btn " + extra },
        T(label),
      );
      b.addEventListener("click", fn);
      return b;
    }
    function field(parent, text, type, value) {
      const label = make("label", {}, T(text)),
        input = make("input", { type });
      input.setAttribute("aria-label", T(text));
      input.value = value ?? "";
      label.append(input);
      parent.append(label);
      controls.push(input);
      return input;
    }
    function section(title) {
      const el = make("section", { class: "customization-section" });
      el.append(make("h4", {}, T(title)));
      form.append(el);
      return el;
    }
    const photoSection = section("Background photo"),
      photoActions = make("div", { class: "form-actions" }),
      uploadLabel = make("label", {}, T("Choose JPEG")),
      file = make("input", { type: "file" });
    file.accept = "image/jpeg";
    file.setAttribute("aria-label", T("Choose JPEG"));
    uploadLabel.append(file);
    uploadLabel.classList.add("hidden");
    photoSection.append(photoActions, uploadLabel);
    controls.push(file);
    const replace = button("Replace JPEG", () =>
        uploadLabel.classList.toggle("hidden"),
      ),
      remove = button("Remove photo", () => {
        if (busy) return;
        working.backgroundMode = working.background ? "remove" : "keep";
        working.background = working.background
          ? null
          : original.guest_background;
        sync();
      });
    photoActions.append(replace, remove);
    controls.push(replace, remove);
    const meta = make("div", { class: "customization-photo-meta" });
    photoSection.append(
      meta,
      make(
        "p",
        { class: "micro" },
        T("Stored privately with the event. No public image link."),
      ),
      make(
        "p",
        { class: "micro" },
        T(
          "JPEG up to 1.4 MB. Images are resized to 2400 px and metadata is removed before saving.",
        ),
      ),
    );
    const cropDetails = make("details", { class: "customization-crop" });
    cropDetails.append(make("summary", {}, T("Crop photo")));
    const cropFields = make("div", { class: "form-grid" }),
      cropInputs = {};
    for (const [key, text] of [
      ["x", "Left"],
      ["y", "Top"],
      ["width", "Width"],
      ["height", "Height"],
    ]) {
      const input = field(
        cropFields,
        text,
        "number",
        working.background?.crop?.[key] || 0,
      );
      input.min = key === "width" || key === "height" ? "1" : "0";
      input.step = "1";
      cropInputs[key] = input;
      input.addEventListener("input", () => {
        if (!working.background) return;
        const crop = {
          ...working.background.crop,
          ...Object.fromEntries(
            Object.entries(cropInputs).map(([k, v]) => [k, Number(v.value)]),
          ),
        };
        if (
          Object.values(crop).every(Number.isInteger) &&
          crop.width > 0 &&
          crop.height > 0 &&
          crop.x >= 0 &&
          crop.y >= 0 &&
          crop.x + crop.width <= crop.sourceWidth &&
          crop.y + crop.height <= crop.sourceHeight
        ) {
          working.background = { ...working.background, crop };
          working.backgroundMode = "replace";
          for (const field of Object.values(cropInputs))
            field.setCustomValidity("");
        } else input.setCustomValidity(T("Invalid photo crop."));
        update();
      });
    }
    cropDetails.append(cropFields);
    photoSection.append(cropDetails);
    const positionLabel = make("label", {}, T("Photo position")),
      position = make("select");
    position.setAttribute("aria-label", T("Photo position"));
    for (const key of ["top", "center", "bottom"])
      position.append(
        make(
          "option",
          { value: key },
          T({ top: "Top", center: "Center", bottom: "Bottom" }[key]),
        ),
      );
    position.value = working.design.position;
    positionLabel.append(position);
    photoSection.append(positionLabel);
    controls.push(position);
    position.addEventListener("change", () => {
      working.design.position = position.value;
      working.designChanged = true;
      update();
    });
    function range(parent, text, key, min, max) {
      const label = make("label", {}, T(text) + " "),
        output = make("output"),
        input = make("input", {
          type: "range",
          min,
          max,
          value: working.design[key],
        });
      input.setAttribute("aria-label", T(text));
      label.append(output, input);
      parent.append(label);
      controls.push(input);
      input.addEventListener("input", () => {
        working.design[key] = Number(input.value);
        working.designChanged = true;
        output.textContent = input.value + "%";
        update();
      });
      output.textContent = input.value + "%";
      return input;
    }
    range(photoSection, "Darken photo", "darken", 0, 70);
    const colorSection = section("Colors & boxes"),
      paletteActions = make("div", { class: "customization-palette" }),
      dark = button("Dark", () => {
        working.palette = "dark";
        sync();
      }),
      light = button("Light", () => {
        working.palette = "light";
        sync();
      });
    paletteActions.append(dark, light);
    colorSection.append(paletteActions);
    const colors = make("div", { class: "customization-colors" }),
      colorInputs = {};
    for (const [key, label] of [
      ["box", "Boxes / page"],
      ["text", "Text"],
      ["button", "Buttons"],
    ]) {
      const input = field(
        colors,
        label,
        "color",
        working.design[working.palette][key],
      );
      input.addEventListener("input", () => {
        working.design[working.palette][key] = input.value;
        working.designChanged = true;
        update();
      });
      colorInputs[key] = input;
    }
    colorSection.append(colors);
    range(colorSection, "Box opacity", "opacity", 35, 100);
    const themeSection = section("Guest appearance"),
      themeLabel = make("label", {}, T("Guest default appearance")),
      theme = make("select");
    theme.setAttribute("aria-label", T("Guest default appearance"));
    for (const [key, label] of [
      ["dark", "Dark"],
      ["light", "Light"],
      ["system", "System default"],
    ])
      theme.append(make("option", { value: key }, T(label)));
    theme.value = working.theme;
    theme.hidden = true; themeLabel.hidden = true; themeLabel.append(theme); themeSection.append(themeLabel);
    const themeChoices = make("fieldset", { class: "guest-default-choices" });
    themeChoices.append(make("legend", {}, T("Guest default appearance")));
    const themeChecks = [];
    for (const [key, text] of [["system", "Default"], ["light", "Light"], ["dark", "Dark"]]) {
      const label = make("label", { class: "checkbox-label" }), input = make("input", { type: "checkbox", value: key });
      input.checked = working.theme === key; label.append(input, document.createTextNode(T(text))); themeChoices.append(label); controls.push(input); themeChecks.push(input);
      input.addEventListener("change", () => { theme.value = key; theme.dispatchEvent(new Event("change", { bubbles: true })); });
    } themeSection.append(themeChoices);
    const names = make("div", { class: "guest-name-options" }), repeatedLabel = make("label", { class: "checkbox-label" }), repeated = make("input", { type: "checkbox" });
    repeated.checked = working.surname; repeatedLabel.append(repeated, document.createTextNode(T("Show repeated surname beside each guest"))); names.append(repeatedLabel);
    const titlesLabel = make("label", { class: "checkbox-label" }),
      showTitles = make("input", { type: "checkbox", id: "guest-show-titles-" + mode }),
      titleChoices = make("div", { class: "guest-name-languages guest-title-languages", id: "guest-title-languages-" + mode });
    showTitles.checked = working.showTitles;
    showTitles.dataset.requiresLanguageEdit = "true";
    showTitles.setAttribute("aria-controls", titleChoices.id);
    showTitles.addEventListener("change", () => {
      working.showTitles = showTitles.checked;
      update();
    });
    titlesLabel.append(showTitles, document.createTextNode(T("Show titles")));
    titleChoices.setAttribute("role", "group");
    titleChoices.setAttribute("aria-label", T("Languages"));
    for (const [code, label] of ctx.languages()) {
      const wrap = make("label", { class: "checkbox-label" }), input = make("input", { type: "checkbox" });
      input.checked = working.titles[code] !== false;
      input.dataset.requiresLanguageEdit = "true";
      input.setAttribute("aria-label", T(mode === "phone" ? "Phone" : "Wide") + " · " + label);
      input.addEventListener("change", () => { working.titles[code] = input.checked; update(); });
      wrap.append(input, document.createTextNode(label)); titleChoices.append(wrap); controls.push(input);
    }
    names.append(titlesLabel, titleChoices);
    controls.push(showTitles);
    const namePlacement = make("label", {}, T("Guest name placement")), nameLayout = make("select");
    for (const [key, text] of [["above", "Above and centred"], ["inline", "Left inline"]]) nameLayout.append(make("option", { value: key }, T(text)));
    nameLayout.setAttribute("aria-label", T("Guest name placement")); nameLayout.value = working.nameLayout; namePlacement.append(nameLayout); names.append(namePlacement); controls.push(repeated, nameLayout);
    repeated.addEventListener("change", () => { working.surname = repeated.checked; update(); });
    nameLayout.addEventListener("change", () => { working.nameLayout = nameLayout.value; update(); });
    const toggleLabel = make("label", { class: "checkbox-label" }),
      toggle = make("input", { type: "checkbox" });
    toggle.checked = working.toggle;
    toggleLabel.append(
      toggle,
      document.createTextNode(T("Show light/dark toggle on the guest page")),
    );
    themeSection.append(toggleLabel, names);
    controls.push(theme, toggle);
    theme.addEventListener("change", () => {
      working.theme = theme.value;
      working.palette = previewPalette(theme.value);
      sync();
    });
    toggle.addEventListener("change", () => {
      working.toggle = toggle.checked;
      update();
    });
    const previewHost = make("section", { class: "customization-preview" }),
      previewHeader = make("div", { class: "customization-preview-header" });
    previewHeader.append(make("h4", {}, T("Live preview")));
    const widthActions = make("div", { class: "form-actions" }),
      phone = button("Phone", () => {
        working.wide = false;
        update();
      }),
      wide = button("Wide", () => {
        working.wide = true;
        update();
      });
    widthActions.append(phone, wide);
    previewHeader.append(widthActions);
    if (!ctx.sharedPreview) previewHost.append(previewHeader);
    if (!ctx.mountPreview) layout.append(previewHost);
    const sample = make("div", { class: "customization-sample" }),
      backdrop = make("div", { class: "customization-sample-backdrop" }),
      shade = make("div", { class: "customization-sample-shade" }),
      sampleEventName = make("header"), sampleSessionName = make("h4");
    sample.append(backdrop, shade);
    sample.append(sampleEventName);
    const welcome = make("section", { class: "customization-sample-box" });
    welcome.append(
      make("h4", {}, T("Sample household")),
      make("p", {}, T("We look forward to celebrating our day with you.")),
    );
    sample.append(welcome);
    const session = make("section", { class: "customization-sample-box" });
    session.append(
      sampleSessionName,
      make("p", {}, T("Please let us know who will attend.")),
    );
    const choices = make("div", { class: "rsvp-inline customization-sample-choices" }),
      person = make("div", { class: "rsvp-person-row" }),
      sampleOptions = make("div", { class: "response-options" });
    const sampleName = make("span", { class: "rsvp-person-name" }),
      sampleGuest = { first_name: T("Guest"), last_name: T("Sample household") },
      sampleInvitation = { household: { last_name: sampleGuest.last_name }, guests: [sampleGuest] };
    person.append(sampleName, sampleOptions);
    for (const [index, caption] of ["Attending", "Not attending"].entries()) {
      const label = make("label", { class: "radio-pill" }),
        radio = make("input", { type: "radio", name: "appearance-preview-attendance:" + mode, value: String(index) });
      radio.checked = index === 0;
      label.append(radio, make("span", {}, T(caption)));
      sampleOptions.append(label);
    }
    choices.append(person);
    session.append(choices);
    const sampleButton = button("Review RSVP", () => {}, "");
    sampleButton.disabled = true;
    session.append(sampleButton);
    sample.append(
      session,
      make(
        "footer",
        {},
        T("Private invitations · Please do not share your invitation link."),
      ),
    );
    previewHost.append(sample);
    ctx.mountPreview?.(previewHost);
    const save = make("button", { type: "submit", class: "btn" }, T("Save")),
      cancel = button("Cancel", () => {
        if (busy) return;
        window.RSVP_LOCAL_EDITORS?.cancel(form);
        uploadVersion++;
        drafts.delete(mode);
        render(ctx);
        ctx.refreshEditors?.();
        host.querySelector("form")?.localEditor?.button.focus({ preventScroll: true });
      }),
      reset = button("Reset appearance", () => {
        working.design = structuredClone(D.defaults);
        working.designChanged = false;
        working.resetDesign = true;
        working.theme = "dark";
        working.palette = "dark";
        working.toggle = true;
        // Reset appearance keeps the rest of this draft and its optimistic
        // baseline, even when an unrelated refresh found a newer server value.
        render(ctx, false, original);
        ctx.refreshEditors?.();
        host.querySelector(".customization-reset")?.focus({ preventScroll: true });
      });
    const actions = make("div", {
      class: "form-actions customization-actions",
    });
    reset.classList.add("customization-reset");
    actions.append(save, cancel, reset);
    form.append(actions, status);
    controls.push(save, cancel, reset);
    const titlesChanged = () => JSON.stringify(working.titles) !== JSON.stringify(originalTitles);
    function dirty() {
      return (
        working.backgroundMode !== "keep" ||
        working.designChanged ||
        working.resetDesign ||
        working.toggle !== (original.guest_theme_toggle !== false) ||
        working.theme !== (original.guest_theme_default || "dark") ||
        working.showTitles !== originalShowTitles || titlesChanged() ||
        working.surname !== (original.show_repeated_surname !== false) || working.nameLayout !== original.guest_name_layout
      );
    }
    function update() {
      if (busy) form.setAttribute("aria-busy", "true");
      else form.removeAttribute("aria-busy");
      if (!form.isConnected || ticket !== generation) return;
      D.colors(sample, working.design, working.palette);
      sampleEventName.textContent = ctx.getStore().settings?.event_name || T("Your event");
      sampleSessionName.textContent = ctx.getStore().sessions.find((s) => s.is_active)?.name || T("Sessions");
      sample.dataset.previewTheme = working.palette;
      sample.dataset.guestNameLayout = working.nameLayout;
      sampleName.replaceChildren();
      titleChoices.hidden = !working.showTitles;
      if (working.showTitles && working.titles[I.language] !== false)
        sampleName.append(make("span", { class: "guest-courtesy-title" }, T("Son") + " "));
      sampleName.append(document.createTextNode([
        sampleGuest.first_name,
        window.RSVP_GUEST_NAMES.lastName(sampleGuest, sampleInvitation, { show_repeated_surname: working.surname }),
      ].filter(Boolean).join(" ")));
      sample.style.maxWidth = working.wide ? "100%" : "340px";
      phone.setAttribute("aria-pressed", String(!working.wide));
      wide.setAttribute("aria-pressed", String(working.wide));
      const url = D.cropURL(working.background);
      backdrop.style.backgroundImage = url ? 'url("' + url + '")' : "none";
      backdrop.style.backgroundPosition = working.design.position;
      shade.hidden = !url;
      for (const control of controls)
        control.disabled =
          busy || !ctx.isEditing() || !ctx.can("settings", "edit") || (control.dataset.requiresLanguageEdit === "true" && !ctx.can("languages", "edit"));
      for (const input of Object.values(cropInputs))
        input.disabled = input.disabled || !working.background;
      save.disabled =
        busy || !ctx.isEditing() || !ctx.can("settings", "edit") || !dirty();
      remove.disabled =
        remove.disabled || (!working.background && !original.guest_background);
      reset.disabled = busy || !ctx.isEditing() || !ctx.can("settings", "edit");
      dark.setAttribute("aria-pressed", String(working.palette === "dark"));
      light.setAttribute("aria-pressed", String(working.palette === "light"));
      form.dataset.dirty = String(dirty());
      ctx.onUpdate?.();
    }
    function sync() {
      meta.replaceChildren();
      const bg = working.background;
      if (bg) {
        const payload = bg.image.split(",")[1] || "",
          bytes =
            Math.floor((payload.length * 3) / 4) -
            (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
        meta.append(
          make("strong", {}, bg.name || T("Current private photo")),
          make(
            "span",
            {},
            "JPEG · " +
              bg.crop.sourceWidth +
              " × " +
              bg.crop.sourceHeight +
              " px · " +
              bytes.toLocaleString() +
              " " +
              T("bytes") +
              " (" +
              (bytes / 1024).toFixed(1) +
              " KiB)",
          ),
          make(
            "span",
            {},
            T("Visible crop") +
              ": " +
              bg.crop.width +
              " × " +
              bg.crop.height +
              " px",
          ),
        );
        for (const key of Object.keys(cropInputs)) {
          cropInputs[key].value = bg.crop[key];
          cropInputs[key].setCustomValidity("");
        }
      } else meta.append(make("span", {}, T("No background photo")));
      remove.textContent = T(bg ? "Remove photo" : "Restore photo");
      remove.disabled = !bg && !original.guest_background;
      cropDetails.classList.toggle("hidden", !bg);
      for (const key of Object.keys(colorInputs))
        colorInputs[key].value = working.design[working.palette][key];
      theme.value = working.theme;
      for (const input of themeChecks) input.checked = input.value === working.theme;
      toggle.checked = working.toggle;
      update();
    }
    file.addEventListener("change", async () => {
      if (!file.files[0] || busy) return;
      const version = ++uploadVersion;
      busy = true;
      status.textContent = T("Preparing photo…");
      update();
      try {
        const photo = await D.prepareJPEG(file.files[0]);
        if (version !== uploadVersion || !form.isConnected || ticket !== generation) return;
        working.background = photo;
        working.backgroundMode = "replace";
        status.textContent = T("Photo prepared. Save to keep it privately.");
        sync();
      } catch (error) {
        status.textContent = T(error.message);
        file.value = "";
      } finally {
        busy = false;
        update();
      }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (save.disabled || ticket !== generation || !form.reportValidity()) return;
      busy = true;
      status.textContent = T("Saving…");
      update();
      try {
        const values = {
          guest_design: working.resetDesign && !working.designChanged ? null : working.designChanged ? working.design : original.guest_design || null,
          guest_theme_toggle: working.toggle,
          guest_theme_default: working.theme,
          guest_title_visibility: working.titles, show_repeated_surname: working.surname, guest_name_layout: working.nameLayout,
          ...(working.showTitles !== originalShowTitles || titlesChanged() ? { guest_show_titles: working.showTitles } : {}),
          ...(working.backgroundMode === "keep" ? {} : { guest_background: working.backgroundMode === "replace" ? working.background : null }),
        };
        const { error } = await R.adminRpc("admin_save_guest_interface", {
          p_mode: mode, p_values: values,
          p_expected: Object.fromEntries(Object.keys(values).map(key => [
            key, key === "guest_show_titles" ? savedShowTitles : original[key] ?? null,
          ])),
        });
        if (error) throw error;
        if (ticket !== generation) return;
        committed = true;
        drafts.delete(mode);
        I.markClean(form);
        window.RSVP_LOCAL_EDITORS?.saved(form);
        await ctx.reload();
        ctx.show(T("Guest appearance saved."), "success");
      } catch (error) {
        status.textContent = R.safeError(error);
      } finally {
        busy = false;
        update();
      }
    });
    form.renderReadSummary = summary => {
      const list = make("dl", { class: "appearance-compact-summary" });
      const row = (label, ...nodes) => {
        const item = make("div"), value = make("dd");
        value.append(...nodes); item.append(make("dt", {}, T(label)), value); list.append(item);
        return value;
      };
      const text = value => document.createTextNode(value), separator = () => {
        const node = make("span", { class: "appearance-summary-separator" }, " · ");
        node.setAttribute("aria-hidden", "true"); return node;
      };
      const photo = row("Photo", text(T(working.background ? "Private JPEG" : "No background photo")));
      if (working.background) {
        photo.append(separator(), text(T({ top: "Top", center: "Center", bottom: "Bottom" }[working.design.position])));
        const details = make("details", { class: "appearance-photo-details" });
        details.append(make("summary", {}, T("Details")), meta.cloneNode(true)); photo.append(details);
      }
      const swatches = make("span", { class: "appearance-summary-swatches" });
      swatches.setAttribute("aria-hidden", "true");
      for (const key of ["box", "button", "text"]) {
        const color = make("i"); color.style.backgroundColor = working.design[working.palette][key]; swatches.append(color);
      }
      row("Colours", swatches, text(T(working.designChanged || original.guest_design && !working.resetDesign ? "Custom" : "Default")));
      const titles = working.showTitles ? ctx.languages().filter(([code]) => working.titles[code] !== false) : [],
        titleValue = row("Titles");
      if (!titles.length) titleValue.append(text(T("Hidden")));
      for (const [code, label] of titles) titleValue.append(make("span", { class: "appearance-summary-language", title: label }, code.toUpperCase()));
      row("Names", text(T(working.nameLayout === "above" ? "Above and centred" : "Left inline")), separator(),
        text(T(working.surname ? "Surname repeated" : "Surname once")));
      row("Appearance", text(T({ dark: "Dark", light: "Light", system: "Default" }[working.theme])), separator(),
        text(T(working.toggle ? "Toggle shown" : "Toggle hidden")));
      summary.append(list);
    };
    form.cleanSaveUpdate = update;
    host.customizationController = {
      context: ctx, preview: previewHost, update,
      preserve: () => ticket === generation && !committed && (busy || dirty() || !!status.textContent ||
        !!form.querySelector(":invalid") || form.localEditor?.box.classList.contains("local-editor-open")),
    };
    sync();
  }
  window.RSVP_CUSTOMIZATION = {
    render,
    clear() { generation++; drafts.clear(); },
    hasUnsaved: () =>
      !!document.querySelector('#guestAppearanceHost form[data-dirty="true"]'),
  };
})();
