(function () {
  "use strict";
  let draft = null,
    ctx = null;
  const I = window.RSVP_I18N,
    T = (s, p) => I.t(s, p),
    D = window.RSVP_GUEST_DESIGN;
  function render(options) {
    ctx = options;
    const { R } = ctx,
      host = R.byId("guestAppearanceHost");
    if (!host) return;
    host.replaceChildren();
    if (!ctx.can("settings")) return;
    const original = ctx.getStore().settings || {},
      revision = original.guest_customization_revision || null;
    if (!draft || draft.revision !== revision)
      draft = {
        revision,
        design: structuredClone(original.guest_design || D.defaults),
        designChanged: false,
        background: original.guest_background || null,
        backgroundMode: "keep",
        toggle: original.guest_theme_toggle !== false,
        theme: original.guest_theme_default || "dark",
        palette: original.guest_theme_default === "light" ? "light" : "dark",
        wide: false,
      };
    const working = draft;
    let busy = false,
      uploadVersion = 0;
    const heading = R.dom("div", { class: "settings-card-heading" });
    heading.append(R.dom("h3", {}, T("Guest invitation")));
    host.append(
      heading,
      R.dom(
        "p",
        { class: "muted" },
        T("Customize the invitation without publishing the event."),
      ),
    );
    const layout = R.dom("div", { class: "customization-layout" }),
      form = R.dom("form", { class: "customization-form" });
    form.dataset.formKey = "guest-customization";
    form.dataset.customization = "true";
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
    themeLabel.append(theme);
    themeSection.append(themeLabel);
    const toggleLabel = make("label", { class: "checkbox-label" }),
      toggle = make("input", { type: "checkbox" });
    toggle.checked = working.toggle;
    toggleLabel.append(
      toggle,
      document.createTextNode(T("Show light/dark toggle on the guest page")),
    );
    themeSection.append(toggleLabel);
    controls.push(theme, toggle);
    theme.addEventListener("change", () => {
      working.theme = theme.value;
      working.palette =
        theme.value === "system"
          ? matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : theme.value;
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
    previewHost.append(previewHeader);
    layout.append(previewHost);
    const sample = make("div", { class: "customization-sample" }),
      backdrop = make("div", { class: "customization-sample-backdrop" }),
      shade = make("div", { class: "customization-sample-shade" });
    sample.append(backdrop, shade);
    sample.append(make("header", {}, original.event_name || T("Your event")));
    const welcome = make("section", { class: "customization-sample-box" });
    welcome.append(
      make("h4", {}, T("Sample household")),
      make("p", {}, T("We look forward to celebrating our day with you.")),
    );
    sample.append(welcome);
    const session = make("section", { class: "customization-sample-box" });
    session.append(
      make(
        "h4",
        {},
        ctx.getStore().sessions.find((s) => s.is_active)?.name || T("Sessions"),
      ),
      make("p", {}, T("Please let us know who will attend.")),
    );
    const choices = make("div", { class: "rsvp-inline customization-sample-choices" }),
      person = make("div", { class: "rsvp-person-row" }),
      sampleOptions = make("div", { class: "response-options" });
    person.append(make("span", { class: "rsvp-person-name" }, T("Guest")), sampleOptions);
    for (const [index, caption] of ["Attending", "Not attending"].entries()) {
      const label = make("label", { class: "radio-pill" }),
        radio = make("input", { type: "radio", name: "appearance-preview-attendance", value: String(index) });
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
    const save = make("button", { type: "submit", class: "btn" }, T("Save")),
      cancel = button("Cancel", () => {
        if (busy) return;
        window.RSVP_LOCAL_EDITORS?.cancel(form);
        uploadVersion++;
        draft = null;
        render(ctx);
      }),
      reset = button("Reset appearance", () => {
        working.design = structuredClone(D.defaults);
        working.designChanged = false;
        working.resetDesign = true;
        working.theme = "dark";
        working.toggle = true;
        render(ctx);
      });
    const actions = make("div", {
      class: "form-actions customization-actions",
    });
    reset.classList.add("customization-reset");
    actions.append(save, cancel, reset);
    form.append(actions, status);
    controls.push(save, cancel, reset);
    function dirty() {
      return (
        working.backgroundMode !== "keep" ||
        working.designChanged ||
        working.resetDesign ||
        working.toggle !== (original.guest_theme_toggle !== false) ||
        working.theme !== (original.guest_theme_default || "dark")
      );
    }
    function update() {
      if (busy) form.setAttribute("aria-busy", "true");
      else form.removeAttribute("aria-busy");
      if (!form.isConnected) return;
      D.colors(sample, working.design, working.palette);
      sample.dataset.previewTheme = working.palette;
      sample.style.maxWidth = working.wide ? "100%" : "340px";
      phone.setAttribute("aria-pressed", String(!working.wide));
      wide.setAttribute("aria-pressed", String(working.wide));
      const url = D.cropURL(working.background);
      backdrop.style.backgroundImage = url ? 'url("' + url + '")' : "none";
      backdrop.style.backgroundPosition = working.design.position;
      shade.hidden = !url;
      for (const control of controls)
        control.disabled =
          busy || !ctx.isEditing() || !ctx.can("settings", "edit");
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
        if (version !== uploadVersion || !form.isConnected) return;
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
      if (save.disabled || !form.reportValidity()) return;
      busy = true;
      status.textContent = T("Saving…");
      update();
      try {
        const { error } = await R.adminRpc("admin_save_guest_customization", {
          p_design:
            working.resetDesign && !working.designChanged
              ? null
              : working.designChanged
                ? working.design
                : original.guest_design || null,
          p_background_mode: working.backgroundMode,
          p_background:
            working.backgroundMode === "replace" ? working.background : null,
          p_show_toggle: working.toggle,
          p_default_theme: working.theme,
          p_expected_revision: revision,
        });
        if (error) throw error;
        draft = null;
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
    form.cleanSaveUpdate = update;
    sync();
  }
  window.RSVP_CUSTOMIZATION = {
    render,
    hasUnsaved: () =>
      !!document.querySelector('#guestAppearanceHost form[data-dirty="true"]'),
  };
})();
