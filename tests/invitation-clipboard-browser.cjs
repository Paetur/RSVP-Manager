// Mock the clipboard in an actual browser; never write to the system clipboard.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { createPublicFoodHarness } = require("./helpers/public-browser-site.cjs");
const { server, cleanup } = createPublicFoodHarness("invitation-clipboard");

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(), base = "http://127.0.0.1:" + server.address().port;
  const requests = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => requests.push(request.url()));
  try {
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (url.pathname === "/clipboard-fixture.html")
        return route.fulfill({ contentType: "text/html", body: '<!doctype html><button id="copy">Copy synthetic invitation</button>' });
      if (!["/js/guest-design.js", "/js/invitation-image.js"].includes(url.pathname)) return route.abort();
      return route.continue();
    });
    await page.goto(base + "/clipboard-fixture.html");
    await page.addScriptTag({ url: base + "/js/guest-design.js" });
    await page.addScriptTag({ url: base + "/js/invitation-image.js" });
    await page.evaluate(() => {
      const native = {
        create: Document.prototype.createElement, createURL: URL.createObjectURL.bind(URL),
        revokeURL: URL.revokeObjectURL.bind(URL), decode: HTMLImageElement.prototype.decode,
        toBlob: HTMLCanvasElement.prototype.toBlob, getContext: HTMLCanvasElement.prototype.getContext,
        read: FileReader.prototype.readAsDataURL,
      };
      function jpeg(width, height) {
        const canvas = native.create.call(document, "canvas");
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext("2d");
        context.fillStyle = "rgb(200,40,80)"; context.fillRect(0, 0, width, height);
        const image = canvas.toDataURL("image/jpeg", .9);
        canvas.width = canvas.height = 0;
        return image;
      }
      window.__picture = Object.freeze({ image: jpeg(32, 24), position: "center" });
      window.__oversized = Object.freeze({ image: jpeg(2401, 1) });
      window.__message = 'Synthetic <script>alert("x")</script> & \'caption\'\r\nFull invitation\nhttps://example.invalid/?invite=ABC234&lang=fo\nFøroyar 🎉';
      window.__unhandled = [];
      addEventListener("unhandledrejection", event => window.__unhandled.push(String(event.reason)));
      window.__setup = mode => {
        Document.prototype.createElement = native.create;
        HTMLImageElement.prototype.decode = native.decode;
        HTMLCanvasElement.prototype.toBlob = native.toBlob;
        HTMLCanvasElement.prototype.getContext = native.getContext;
        FileReader.prototype.readAsDataURL = native.read;
        const state = window.__state = {
          mode, writeCalls: 0, committed: 0, created: [], revoked: [], canvases: [], decodeStarted: false,
          activeAtWrite: false, decodedAtWrite: null, formats: [], current: mode !== "stale-initial",
          pictureBefore: JSON.stringify(window.__picture),
        };
        URL.createObjectURL = blob => { const url = native.createURL(blob); state.created.push(url); return url; };
        URL.revokeObjectURL = url => { state.revoked.push(url); return native.revokeURL(url); };
        Document.prototype.createElement = function (name, ...args) {
          const element = native.create.call(this, name, ...args);
          if (name.toLowerCase() === "canvas") state.canvases.push(element);
          return element;
        };
        HTMLImageElement.prototype.decode = async function () {
          state.decodeStarted = true;
          if (mode === "decode-failure") throw new DOMException("Synthetic decode failure", "EncodingError");
          if (mode === "stale-decode") await new Promise(resolve => { window.__releaseDecode = resolve; });
          return native.decode.call(this);
        };
        if (mode === "conversion-failure") HTMLCanvasElement.prototype.toBlob = function (callback) { callback(null); };
        if (mode === "context-failure") HTMLCanvasElement.prototype.getContext = () => null;
        if (mode === "html-failure") FileReader.prototype.readAsDataURL = function () { throw Error("Synthetic read failure"); };
        if (mode === "stale-html") FileReader.prototype.readAsDataURL = function (blob) {
          state.current = false; return native.read.call(this, blob);
        };
        class Item {
          constructor(data) {
            if (mode === "constructor-failure") throw Error("Synthetic unsupported constructor");
            this.data = data;
          }
          static supports(type) { return mode !== "unsupported-type" || type !== "text/html"; }
        }
        if (mode === "no-supports") delete Item.supports;
        window.ClipboardItem = mode === "no-item" ? undefined : Item;
        const clipboard = mode === "no-write" ? {} : {
          write(items) {
            state.writeCalls++;
            state.activeAtWrite = navigator.userActivation.isActive;
            state.decodedAtWrite = state.decodeStarted;
            if (mode === "write-throws") throw new DOMException("Synthetic denied write", "NotAllowedError");
            if (mode === "write-rejects") return Promise.reject(new DOMException("Synthetic denied write", "NotAllowedError"));
            state.itemCount = items.length;
            state.formats = Object.keys(items[0].data);
            // Resolving every representation emulates one atomic clipboard write.
            return Promise.all(state.formats.map(type => Promise.resolve(items[0].data[type]).then(blob => [type, blob])))
              .then(entries => {
                state.blobs = Object.fromEntries(entries);
                state.committed++;
              });
          },
        };
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
        document.getElementById("copy").onclick = () => {
          window.__outcome = null;
          const picture = mode === "malformed" ? { image: "data:image/jpeg;base64,bm90IGEganBlZw==" }
            : mode === "oversized" ? window.__oversized : window.__picture;
          window.RSVP_INVITATION_IMAGE.writeClipboard(picture, window.__message, { isCurrent: () => state.current })
            .then(() => { window.__outcome = { ok: true }; }, error => { window.__outcome = { ok: false, name: error.name }; });
        };
      };
      window.__inspect = async () => {
        const state = window.__state;
        const result = {
          ...window.__outcome, writeCalls: state.writeCalls, committed: state.committed,
          itemCount: state.itemCount, activeAtWrite: state.activeAtWrite, decodedAtWrite: state.decodedAtWrite,
          formats: state.formats, urlsCreated: state.created.length, urlsRevoked: state.revoked.length,
          urlsMatch: JSON.stringify(state.created) === JSON.stringify(state.revoked),
          canvasesReleased: state.canvases.every(canvas => canvas.width === 0 && canvas.height === 0),
          pictureUnchanged: JSON.stringify(window.__picture) === state.pictureBefore,
        };
        if (state.blobs) {
          const blobs = state.blobs, png = blobs["image/png"], bytes = new Uint8Array(await png.arrayBuffer());
          result.blobTypes = state.formats.map(type => blobs[type].type);
          result.plain = await blobs["text/plain"].text();
          result.html = await blobs["text/html"].text();
          const parsed = new DOMParser().parseFromString(result.html, "text/html"), image = parsed.querySelector("img");
          result.embeddedPNG = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image?.getAttribute("src") || "");
          result.imageCount = parsed.querySelectorAll("img").length;
          result.scriptCount = parsed.querySelectorAll("script").length;
          result.caption = parsed.body.lastElementChild.innerHTML.replace(/<br>/g, "\n");
          const caption = parsed.body.lastElementChild;
          for (const br of caption.querySelectorAll("br")) br.replaceWith("\n");
          result.captionText = caption.textContent;
          result.signature = [...bytes.slice(0, 8)];
          const bitmap = await createImageBitmap(png), canvas = native.create.call(document, "canvas");
          canvas.width = bitmap.width; canvas.height = bitmap.height;
          const context = native.getContext.call(canvas, "2d"); context.drawImage(bitmap, 0, 0);
          result.dimensions = [bitmap.width, bitmap.height];
          result.pixel = [...context.getImageData(12, 12, 1, 1).data];
          bitmap.close(); canvas.width = canvas.height = 0;
        }
        return result;
      };
    });
    async function run(mode) {
      await page.evaluate(value => window.__setup(value), mode);
      await page.locator("#copy").click();
      if (mode === "stale-decode") {
        await page.waitForFunction(() => window.__state.decodeStarted && window.__releaseDecode);
        await page.evaluate(() => { window.__state.current = false; window.__releaseDecode(); });
      }
      await page.waitForFunction(() => window.__outcome);
      // Early write/constructor rejections must also consume async preparation.
      await page.waitForFunction(() => window.__state.created.length === window.__state.revoked.length);
      const result = await page.evaluate(() => window.__inspect());
      assert.equal(result.urlsMatch, true, mode + ": temporary picture URLs released");
      assert.equal(result.canvasesReleased, true, mode + ": temporary canvas pixels released");
      assert.equal(result.pictureUnchanged, true, mode + ": original picture unchanged");
      return result;
    }
    for (const mode of ["success", "no-supports"]) {
      const result = await run(mode);
      assert.equal(result.ok, true);
      assert.equal(result.writeCalls, 1);
      assert.equal(result.committed, 1);
      assert.equal(result.itemCount, 1, "one compound item, not separate picture/text clipboard items");
      assert.equal(result.activeAtWrite, true, "write uses the original browser click activation");
      assert.equal(result.decodedAtWrite, false, "write starts before asynchronous pixel conversion");
      assert.deepEqual(result.formats, ["text/html", "image/png", "text/plain"]);
      assert.deepEqual(result.blobTypes, result.formats);
      assert.equal(result.plain, await page.evaluate(() => window.__message));
      assert.equal(result.captionText, result.plain.replace(/\r\n|\r/g, "\n"));
      assert.equal(result.embeddedPNG, true);
      assert.equal(result.imageCount, 1);
      assert.equal(result.scriptCount, 0);
      assert.ok(result.html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;caption&#39;<br>"));
      assert.deepEqual(result.signature, [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.deepEqual(result.dimensions, [32, 24], "picture dimensions preserved without text flattened into pixels");
      assert.ok(Math.abs(result.pixel[0] - 200) < 4 && Math.abs(result.pixel[1] - 40) < 4 && Math.abs(result.pixel[2] - 80) < 4);
      assert.equal(result.pixel[3], 255);
    }
    for (const mode of ["no-write", "no-item", "unsupported-type", "malformed", "stale-initial"]) {
      const result = await run(mode);
      assert.equal(result.ok, false, mode);
      assert.equal(result.writeCalls, 0, mode + ": no clipboard write");
      assert.equal(result.committed, 0);
      assert.equal(result.urlsCreated, 0);
      if (mode === "stale-initial") assert.equal(result.name, "AbortError");
      else if (mode !== "malformed") assert.equal(result.name, "NotSupportedError");
    }
    for (const mode of ["oversized", "decode-failure", "conversion-failure", "context-failure", "html-failure", "stale-decode", "stale-html", "constructor-failure", "write-throws", "write-rejects"]) {
      const result = await run(mode);
      assert.equal(result.ok, false, mode);
      assert.equal(result.committed, 0, mode + ": failed representations never commit clipboard contents");
      if (mode.startsWith("stale-")) assert.equal(result.name, "AbortError");
      if (mode === "oversized") assert.equal(result.urlsCreated, 0, "oversized JPEG rejected before decoding/allocation");
    }
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await page.evaluate(() => window.__unhandled), [], "all abandoned conversion promises handled");
    assert.deepEqual(errors, []);
    assert.equal(requests.every(url => url.startsWith("blob:" + base + "/") || ["/clipboard-fixture.html", "/js/guest-design.js", "/js/invitation-image.js"].includes(new URL(url).pathname)), true, "no RPC, API or external picture requests");
    console.log("PASS invitation clipboard: one HTML/PNG/plain item, exact escaped caption and unchanged picture, original click activation, unsupported/stale/failed writes atomic, and temporary pixels/URLs released; synthetic mocked clipboard only.");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
