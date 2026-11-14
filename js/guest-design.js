(function () {
  "use strict";
  const defaults = {
    dark: { box: "#143021", text: "#eef1e7", button: "#3d806b" },
    light: { box: "#f5f8ef", text: "#203c32", button: "#286e56" },
    opacity: 82,
    darken: 38,
    position: "center",
  };
  function valid(design) {
    return (
      !!design &&
      ["dark", "light"].every((mode) =>
        ["box", "text", "button"].every((k) =>
          /^#[a-f0-9]{6}$/i.test(design[mode]?.[k] || ""),
        ),
      ) &&
      Number.isInteger(design.opacity) &&
      design.opacity >= 35 &&
      design.opacity <= 100 &&
      Number.isInteger(design.darken) &&
      design.darken >= 0 &&
      design.darken <= 70 &&
      ["top", "center", "bottom"].includes(design.position)
    );
  }
  function cropURL(background) {
    const c = background?.crop;
    if (
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(
        background?.image || "",
      ) ||
      !c ||
      !["x", "y", "width", "height", "sourceWidth", "sourceHeight"].every(
        (k) => Number.isInteger(c[k]) && c[k] >= 0,
      ) ||
      !c.width ||
      !c.height ||
      c.x + c.width > c.sourceWidth ||
      c.y + c.height > c.sourceHeight
    )
      return null;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      c.width +
      '" height="' +
      c.height +
      '" viewBox="' +
      [c.x, c.y, c.width, c.height].join(" ") +
      '"><image width="' +
      c.sourceWidth +
      '" height="' +
      c.sourceHeight +
      '" href="' +
      background.image +
      '"/></svg>';
    return "data:image/svg+xml;base64," + btoa(svg);
  }
  function colors(host, design, theme) {
    const palette = design[theme === "light" ? "light" : "dark"];
    for (const k of ["box", "text", "button"])
      host.style.setProperty("--guest-" + k, palette[k]);
    host.style.setProperty("--guest-opacity", design.opacity / 100);
    host.style.setProperty("--guest-darken", design.darken / 100);
    host.style.setProperty("--guest-position", design.position);
  }
  function apply(design) {
    const body = document.body;
    body.classList.toggle("guest-customized", valid(design));
    if (valid(design))
      colors(body, design, document.documentElement.dataset.theme);
    else
      for (const k of [
        "box",
        "text",
        "button",
        "opacity",
        "darken",
        "position",
      ])
        body.style.removeProperty("--guest-" + k);
  }
  let current = null;
  function configure(design) {
    current = valid(design) ? design : null;
    apply(current);
  }
  if (document.documentElement.hasAttribute("data-guest-page"))
    new MutationObserver(() => apply(current)).observe(
      document.documentElement,
      { attributes: true, attributeFilter: ["data-theme"] },
    );
  function jpegDimensions(buffer) {
    const a = new Uint8Array(buffer);
    if (
      a.length < 12 ||
      a[0] !== 255 ||
      a[1] !== 216 ||
      a[a.length - 2] !== 255 ||
      a[a.length - 1] !== 217
    )
      throw Error("Invalid JPEG image.");
    let p = 2;
    while (p < a.length - 3) {
      if (a[p++] !== 255) break;
      while (a[p] === 255) p++;
      const marker = a[p++];
      if ([217, 218].includes(marker)) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const len = a[p] * 256 + a[p + 1];
      if (len < 2 || p + len > a.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      ) {
        const h = a[p + 3] * 256 + a[p + 4],
          w = a[p + 5] * 256 + a[p + 6];
        if (!w || !h || w > 12000 || h > 12000 || w * h > 40000000)
          throw Error("JPEG dimensions are too large or invalid.");
        return { width: w, height: h };
      }
      p += len;
    }
    throw Error("Invalid JPEG image.");
  }
  async function prepareJPEG(file) {
    if (file.type !== "image/jpeg" || file.size > 1400000)
      throw Error("Choose a JPEG under 1.4 MB.");
    jpegDimensions(await file.arrayBuffer());
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const scale = Math.min(
          1,
          2400 / Math.max(img.naturalWidth, img.naturalHeight),
        ),
        canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw Error("Could not prepare this photo.");
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      let image = canvas.toDataURL("image/jpeg", 0.9);
      if ((image.length - image.indexOf(",") - 1) * 0.75 > 1400000)
        image = canvas.toDataURL("image/jpeg", 0.75);
      if ((image.length - image.indexOf(",") - 1) * 0.75 > 1400000)
        throw Error("Choose a JPEG under 1.4 MB.");
      return {
        image,
        name: file.name.slice(0, 180),
        crop: {
          x: 0,
          y: 0,
          width: canvas.width,
          height: canvas.height,
          sourceWidth: canvas.width,
          sourceHeight: canvas.height,
        },
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  window.RSVP_GUEST_DESIGN = {
    defaults,
    valid,
    cropURL,
    colors,
    configure,
    jpegDimensions,
    prepareJPEG,
  };
})();
