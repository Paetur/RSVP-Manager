// Private invitation attachments reuse the existing bounded JPEG preparation.
(function () {
  "use strict";
  function preview(host, picture, { R, T }) {
    if (typeof picture?.image !== "string" ||
        !picture.image.startsWith("data:image/jpeg;base64,")) return;
    const image = R.dom("img", { class: "invitation-picture" });
    image.src = picture.image;
    image.alt = T("interface.messages.invitation_picture");
    host.append(image);
  }
  function file(picture) {
    if (
      typeof picture?.image !== "string" ||
      picture.image.length > 1900000 ||
      !picture.image.match(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/)
    )
      throw Error("Invalid JPEG image.");
    const bytes = Uint8Array.from(atob(picture.image.split(",")[1]), (c) =>
      c.charCodeAt(0),
    );
    if (bytes.length > 1400000) throw Error("Choose a JPEG under 1.4 MB.");
    window.RSVP_GUEST_DESIGN.jpegDimensions(bytes.buffer);
    // Never reuse an untrusted filename or embed a household's invitation code.
    return new File([bytes], "invitation.jpg", { type: "image/jpeg" });
  }
  function editor(form, initial, { R, T }) {
    const host = R.dom("div", { class: "span-2 invitation-picture-editor" }),
      label = R.dom("label", {}, T("interface.messages.invitation_picture")),
      upload = R.dom("input", { type: "file" }),
      value = R.dom("input", { type: "hidden" }),
      display = R.dom("div"),
      status = R.dom("p", { class: "micro" }),
      remove = R.dom(
        "button",
        { type: "button", class: "btn secondary" },
        T("interface.messages.remove_invitation_picture"),
      );
    upload.accept = "image/jpeg";
    status.setAttribute("role", "status");
    let generation = 0,
      failure = null,
      pending = Promise.resolve();
    value.value = JSON.stringify(initial || null);
    value.dataset.invitationPicture = "true";
    label.append(upload);
    host.append(
      label, value, display, remove, status,
      R.dom("p", { class: "micro" }, T("interface.messages.invitation_picture_help")),
    );
    form.append(host);
    const current = () => JSON.parse(value.value);
    function render() {
      display.replaceChildren();
      preview(display, current(), { R, T });
      remove.hidden = !current();
    }
    function set(picture) {
      value.value = JSON.stringify(picture || null);
      value.dispatchEvent(new Event("input", { bubbles: true }));
      render();
    }
    // Shared Cancel restores this control and emits change, including during preparation.
    value.addEventListener("change", () => {
      generation++;
      failure = null;
      upload.value = "";
      upload.setCustomValidity("");
      status.textContent = "";
      render();
    });
    upload.addEventListener("change", () => {
      const selected = upload.files[0],
        token = ++generation;
      failure = null;
      upload.setCustomValidity("");
      if (!selected) {
        status.textContent = "";
        return;
      }
      status.textContent = T("Preparing photo…");
      pending = window.RSVP_GUEST_DESIGN.prepareJPEG(selected)
        .then((picture) => {
          if (token !== generation) return;
          set(picture);
          upload.value = "";
          status.textContent = "";
        })
        .catch((error) => {
          if (token !== generation) return;
          failure = error;
          upload.value = "";
          status.textContent = T(error.message);
        });
    });
    remove.addEventListener("click", () => {
      generation++;
      failure = null;
      upload.value = "";
      status.textContent = "";
      set(null);
    });
    render();
    return {
      async read() {
        await pending;
        if (failure) throw failure;
        return current();
      },
      get: current,
      set,
    };
  }
  window.RSVP_INVITATION_IMAGE = Object.freeze({ preview, file, editor });
})();
