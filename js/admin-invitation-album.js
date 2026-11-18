// Album records are independent of retained template/delivery image snapshots.
(function () {
  "use strict";
  function create({
    R,
    T,
    getStore,
    can,
    managementForm,
    field,
    saveForm,
    managementRpc,
    show,
  }) {
    const pictures = () => getStore().settings?.invitation_picture_album || [];
    const revision = () =>
      getStore().settings?.invitation_album_revision || null;
    function choose(selected, onChoose, trigger, host) {
      if (!can("settings")) return;
      const previousFocus = trigger || document.activeElement;
      const dialog = R.inlinePanel({ class: "invitation-album-dialog" }, previousFocus, host),
        grid = R.dom("div", { class: "invitation-album-grid" });
      dialog.setAttribute("aria-label", T("Choose from album"));
      dialog.append(R.dom("h2", {}, T("Choose from album")), grid);
      const finish = (picture) => {
        if (can("settings", "edit")) onChoose(picture);
        dialog.close();
      };
      for (const record of pictures()) {
        const button = R.dom("button", {
          type: "button",
          class: "invitation-album-tile",
        });
        button.setAttribute("aria-label", record.name);
        button.setAttribute(
          "aria-pressed",
          String(record.picture.image === selected?.image),
        );
        window.RSVP_INVITATION_IMAGE.preview(button, record.picture, { R, T });
        button.append(R.dom("span", {}, record.name));
        button.addEventListener("click", () => finish(record.picture));
        grid.append(button);
      }
      if (!pictures().length)
        grid.append(
          R.dom("p", { class: "micro" }, T("Add pictures to the album first.")),
        );
      const none = R.dom(
          "button",
          { type: "button", class: "btn secondary" },
          T("No picture"),
        ),
        close = R.dom(
          "button",
          { type: "button", class: "btn secondary" },
          T("Cancel"),
        );
      none.addEventListener("click", () => finish(null));
      close.addEventListener("click", () => dialog.close());
      dialog.append(none, close);
      dialog.addEventListener("close", () => {
        dialog.remove();
        if (previousFocus?.isConnected && previousFocus.getClientRects().length) previousFocus.focus({ preventScroll: true });
      });
      dialog.openInline();
      dialog.scrollIntoView({ block: "nearest", behavior: "instant" });
      close.focus({ preventScroll: true });
      return dialog;
    }
    function editor(form, initial) {
      const host = R.dom("div", { class: "span-2 invitation-picture-editor" }),
        value = R.dom("input", { type: "hidden" }),
        display = R.dom("div"),
        button = R.dom(
          "button",
          { type: "button", class: "btn secondary" },
          T("Choose from album"),
        );
      value.value = JSON.stringify(initial || null);
      value.dataset.invitationPicture = "true";
      let picker = null;
      button.setAttribute("aria-expanded", "false");
      const current = () => JSON.parse(value.value);
      const render = () => {
        display.replaceChildren();
        window.RSVP_INVITATION_IMAGE.preview(display, current(), { R, T });
      };
      value.addEventListener("change", render);
      button.addEventListener("click", () => {
        if (!can("settings", "edit") || host.closest("form")?.getAttribute("aria-busy") === "true") return;
        if (picker?.isConnected) { picker.close(); return; }
        picker = choose(current(), (picture) => {
          if (host.closest("form")?.getAttribute("aria-busy") === "true") return;
          value.value = JSON.stringify(picture);
          value.dispatchEvent(new Event("input", { bubbles: true }));
          render();
        }, button, host);
        button.setAttribute("aria-expanded", String(!!picker));
        picker?.addEventListener("close", () => { picker = null; button.setAttribute("aria-expanded", "false"); });
      });
      host.append(value, display, button);
      form.append(host);
      render();
      return { get: current, read: async () => current(), close: () => picker?.close() };
    }
    function render(host) {
      if (!can("settings")) return;
      const card = R.dom("section", {
          class: "panel invitation-album",
        }),
        heading = R.dom("div", { class: "settings-card-heading" }),
        grid = R.dom("div", { class: "invitation-album-grid" });
      card.dataset.settingsCard = "invitation-album";
      heading.append(R.dom("h2", {}, T("Picture album")));
      card.append(
        heading,
        R.dom(
          "p",
          { class: "micro" },
          T("Shared across invitation templates and services."),
        ),
        grid,
      );
      for (const record of pictures()) {
        const tile = R.dom("div", { class: "invitation-album-tile" });
        window.RSVP_INVITATION_IMAGE.preview(tile, record.picture, { R, T });
        tile.append(R.dom("strong", {}, record.name));
        if (can("settings", "edit")) {
          const remove = R.dom(
            "button",
            { type: "button", class: "small-tool" },
            T("Remove"),
          );
          remove.setAttribute("aria-label", T("Remove") + " · " + record.name);
          remove.addEventListener("click", async () => {
            if (
              !can("settings", "edit") ||
              !await window.RSVP_INLINE.confirm(T(
                  "Remove this album picture? Saved templates and messages keep their pictures.",
                ), { action: "Remove picture" })
            )
              return;
            remove.disabled = true;
            try {
              await managementRpc("admin_save_invitation_picture", {
                p_id: record.id,
                p_name: record.name,
                p_image: null,
                p_expected: revision(),
              });
            } catch (error) {
              remove.disabled = false;
              show(R.safeError(error), "error");
            }
          });
          tile.append(remove);
        }
        grid.append(tile);
      }
      if (!pictures().length)
        grid.append(
          R.dom("p", { class: "micro" }, T("Add pictures to the album first.")),
        );
      if (can("settings", "edit")) {
        const form = managementForm();
        form.dataset.formKey = "invitation-album-add";
        form.dataset.headerEditor = "true";
        form.dataset.editorAction = "Add picture";
        const name = field(
            form,
            T("Picture name"),
            "",
            null,
            "text",
            true,
            100,
          ),
          picture = window.RSVP_INVITATION_IMAGE.editor(form, null, { R, T });
        const expected = revision();
        card.insertBefore(
          saveForm(form, T("Add picture"), async () => {
            const image = await picture.read();
            if (!image) throw Error(T("Choose JPEG"));
            await managementRpc("admin_save_invitation_picture", {
              p_id: null,
              p_name: name.value.trim(),
              p_image: image,
              p_expected: expected,
            });
          }), grid,
        );
      }
      host.append(card);
    }
    return { render, editor };
  }
  window.RSVP_ADMIN_INVITATION_ALBUM = Object.freeze({ create });
})();
