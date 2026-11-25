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
  function clipboardCurrent(isCurrent) {
    if (!isCurrent()) throw new DOMException("Invitation changed.", "AbortError");
  }
  async function clipboardPNG(source, isCurrent) {
    const dimensions = window.RSVP_GUEST_DESIGN.jpegDimensions(await source.arrayBuffer());
    // Stored invitation pictures are already bounded by the editor. Reject an
    // oversized snapshot before decoding rather than allocate a large bitmap.
    if (Math.max(dimensions.width, dimensions.height) > 2400)
      throw Error("Clipboard picture dimensions are too large.");
    clipboardCurrent(isCurrent);
    const url = URL.createObjectURL(source), image = new Image();
    let canvas;
    try {
      image.src = url;
      await image.decode();
      clipboardCurrent(isCurrent);
      if (image.naturalWidth !== dimensions.width || image.naturalHeight !== dimensions.height)
        throw Error("Invalid JPEG image.");
      canvas = document.createElement("canvas");
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext("2d");
      if (!context) throw Error("Could not prepare clipboard picture.");
      context.drawImage(image, 0, 0);
      const png = await new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(Error("Could not prepare clipboard picture.")), "image/png");
      });
      clipboardCurrent(isCurrent);
      if (png.type !== "image/png" || png.size > 24000000)
        throw Error("Could not prepare clipboard picture.");
      return png;
    } finally {
      URL.revokeObjectURL(url);
      image.removeAttribute("src");
      if (canvas) canvas.width = canvas.height = 0;
    }
  }
  function clipboardHTML(png, message, isCurrent) {
    return new Promise((resolve, reject) => {
      clipboardCurrent(isCurrent);
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || Error("Could not prepare clipboard picture."));
      reader.onload = () => {
        try {
          clipboardCurrent(isCurrent);
          const data = reader.result;
          if (typeof data !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data))
            throw Error("Could not prepare clipboard picture.");
          const escaped = message.replace(/[&<>"']/g, character => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
          })[character]).replace(/\r\n|\r|\n/g, "<br>");
          resolve(new Blob(['<div><img src="' + data + '" alt=""></div><div>' + escaped + "</div>"], { type: "text/html" }));
        } catch (error) { reject(error); }
      };
      reader.readAsDataURL(png);
    });
  }
  function writeClipboard(picture, message, { isCurrent = () => true } = {}) {
    let active = true;
    const current = () => active && isCurrent();
    try {
      clipboardCurrent(current);
      if (typeof message !== "string" || !message.length) throw Error("Invitation text is required.");
      const types = ["text/html", "image/png", "text/plain"], Item = window.ClipboardItem;
      if (typeof navigator.clipboard?.write !== "function" || typeof Item !== "function" ||
          typeof Item.supports === "function" && types.some(type => !Item.supports(type)))
        throw new DOMException("Picture copying is not supported.", "NotSupportedError");
      const source = file(picture), png = clipboardPNG(source, current);
      const html = png.then(blob => clipboardHTML(blob, message, current));
      // A constructor or write rejection can occur before an asynchronous
      // representation is consumed. Keep those branches handled as well.
      png.catch(() => {});
      html.catch(() => {});
      const item = new Item({
        "text/html": html,
        "image/png": png,
        "text/plain": new Blob([message], { type: "text/plain" }),
      });
      // WebKit needs this call in the original click activation. Conversion
      // promises are passed to ClipboardItem, never awaited before write().
      return Promise.resolve(navigator.clipboard.write([item])).finally(() => { active = false; });
    } catch (error) {
      active = false;
      return Promise.reject(error);
    }
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
  window.RSVP_INVITATION_IMAGE = Object.freeze({ preview, file, editor, writeClipboard });
})();
