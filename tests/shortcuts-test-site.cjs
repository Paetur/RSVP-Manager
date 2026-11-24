// Offline by default. --loopback additionally exercises only 127.0.0.1 listeners.
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"),
  path = require("node:path"), cp = require("node:child_process"), net = require("node:net"),
  http = require("node:http"), https = require("node:https");
const tool = require("../tools/shortcuts-test-site.cjs");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-test-site-check-"));
const connection = { supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co", supabaseKey: "sb_publishable_synthetic" };
const pilotScripts = ["js/shortcut-device-runner.js", "js/shortcuts-test-installer.js", "js/shortcuts-test-page.js"];
const put = (root, name, value) => {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
};
function fixture(name) {
  const source = path.join(temporary, name);
  for (const file of ["index.html", "setup.html", "setup-automatic.html", "admin/index.html", "INSTALL.md", "supabase/install.sql", "supabase/install-manifest.json"])
    put(source, file, "synthetic public " + file);
  for (const file of ["js/core.js", "css/app.css", "locales/en/interface.json", "docs/Guide.md", "docs/Guide.html", "docs/Guide.js", "supabase/studio/guest.ts"])
    put(source, file, "synthetic selected file");
  for (const file of pilotScripts)
    put(source, file, "synthetic pilot script");
  // Even a contaminated source connection must never become preview configuration.
  put(source, "js/config.js", "sb_secret_" + "never_copy_this_configuration");
  put(source, "js/config.production.js", "sb_secret_" + "never_copy_production_configuration");
  for (const file of ["AGENTS.md", "internal/private.md", ".git/config", "docs/.private.html", "js/runtime.key", "supabase/functions/.env.local", "tests/fixture.js", "tools/private.js"])
    put(source, file, "PRIVATE_MARKER");
  put(source, "supabase/upgrades/legacy.sql", "retired downloadable SQL");
  put(source, "VERSION", "0.9.0-alpha.7\n");
  put(source, "tools/shortcuts-test-page.html", "<title>Synthetic Shortcuts helper</title>");
  return source;
}
function response(handler, method, url) {
  const result = {};
  handler({ method, url }, { writeHead(status, headers) { result.status = status; result.headers = headers; }, end(body) { result.body = body; } });
  return result;
}
async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function request(protocol, options) {
  return new Promise((resolve, reject) => {
    const request = protocol.get({ host: "127.0.0.1", agent: false, ...options }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks) }));
    });
    request.on("error", reject);
    request.setTimeout(3000, () => request.destroy(Error("Loopback request timed out")));
  });
}
(async () => {
  let runningRuntime;
  try {
    assert.deepEqual(tool.validateConnection(connection), connection);
    const anon = "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url") + ".signature";
    assert.equal(tool.validateConnection({ ...connection, supabaseKey: anon }).supabaseKey, anon);
    for (const value of [{ ...connection, extra: "unexpected" }, { ...connection, supabaseUrl: "http://example.invalid" },
      { ...connection, supabaseKey: "sb_secret_rejected" }, { ...connection, supabaseKey: "eyJhbGciOiJIUzI1NiJ9." + Buffer.from('{"role":"service_role"}').toString("base64url") + ".signature" }])
      assert.throws(() => tool.validateConnection(value));
    for (const value of [{ hostname: "test.local; include /private" }, { hostname: "test.local\n" }, { port: 443 }, { port: 8094 }, { bind: "test.local" }])
      assert.throws(() => tool.settings(value));
    assert.throws(() => tool.parse(["run", "--runtime-dir", "/tmp/test", "--hostname", "test.local"]));
    assert.throws(() => tool.parse(["prepare", "--runtime-dir", "/tmp/a", "--runtime-dir", "/tmp/b"]));
    const source = fixture("source"), runtime = path.join(temporary, "runtime"), connectionFile = path.join(temporary, "connection.json");
    fs.writeFileSync(connectionFile, JSON.stringify(connection), { mode: 0o600 });
    const live = process.argv.includes("--loopback"), port = live ? await availablePort() : 8443;
    let bootstrapPort = live ? await availablePort() : 8094;
    while (port === bootstrapPort) bootstrapPort = await availablePort();
    const options = { source, runtimeDir: runtime, connection: connectionFile, hostname: "synthetic-test.local", bind: "127.0.0.1", port, bootstrapPort };
    const prepared = tool.prepare(options);
    assert.equal(prepared.running, false);
    assert.equal(prepared.origin, "https://synthetic-test.local:" + port);
    assert.match(prepared.caSha256, /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/);
    assert.equal(fs.statSync(runtime).mode & 0o777, 0o700);
    for (const file of ["ca.key.pem", "server.key.pem", "state.json", "nginx.conf", "ca.cer"])
      assert.equal(fs.statSync(path.join(runtime, "private", file)).mode & 0o777, 0o600);
    const site = path.join(runtime, "site");
    for (const file of ["AGENTS.md", "internal/private.md", ".git/config", "docs/.private.html", "js/runtime.key", "supabase/functions/.env.local", "tests/fixture.js", "tools/private.js", "tools/shortcuts-test-page.html", "ca.cer", "private/ca.key.pem"])
      assert.equal(fs.existsSync(path.join(site, file)), false, file);
    for (const file of ["index.html", "admin/index.html", "docs/Guide.md", "supabase/install.sql", "supabase/studio/guest.ts"])
      assert.equal(fs.existsSync(path.join(site, file)), true, file);
    for (const file of pilotScripts)
      assert.equal(fs.readFileSync(path.join(site, file), "utf8"), "synthetic pilot script", file);
    assert.equal(fs.existsSync(path.join(site, "supabase/upgrades")), false);
    assert.equal(fs.readFileSync(path.join(site, "shortcuts-test.html"), "utf8"), "<title>Synthetic Shortcuts helper</title>");
    assert.match(fs.readFileSync(path.join(site, "js/config.js"), "utf8"), /sb_publishable_synthetic/);
    assert.equal(fs.readFileSync(path.join(site, "js/config.production.js"), "utf8").includes("sb_secret"), false);
    const { state } = tool.loadRuntime(runtime);
    tool.verifyWebsite(runtime, state);
    const config = fs.readFileSync(path.join(runtime, "private/nginx.conf"), "utf8");
    assert.match(config, /access_log off;/);
    assert.match(config, /error_log \/dev\/null crit;/);
    assert.ok(config.includes("listen 127.0.0.1:" + port + " ssl;"));
    assert.equal(config.includes("/var/www/"), false);
    assert.equal(config.includes("/var/lib/"), false);
    assert.equal(config.includes("include /etc/nginx/sites"), false);
    if (fs.existsSync("/usr/sbin/nginx"))
      cp.execFileSync("/usr/sbin/nginx", ["-t", "-e", "/dev/null", "-p", runtime + "/", "-c", path.join(runtime, "private/nginx.conf")], { stdio: "pipe" });
    const local = name => path.join(runtime, "private", name);
    cp.execFileSync("openssl", ["verify", "-CAfile", local("ca.crt.pem"), "-verify_hostname", "synthetic-test.local", local("server.crt.pem")], { stdio: "pipe" });
    const leaf = cp.execFileSync("openssl", ["x509", "-in", local("server.crt.pem"), "-noout", "-ext", "subjectAltName,extendedKeyUsage"], { encoding: "utf8" });
    assert.match(leaf, /DNS:synthetic-test\.local/);
    assert.match(leaf, /TLS Web Server Authentication/);
    const certificate = fs.readFileSync(local("ca.cer")), handler = tool.bootstrapHandler(state, certificate);
    const download = response(handler, "GET", "/ca.cer");
    assert.equal(download.status, 200);
    assert.deepEqual(download.body, certificate);
    assert.equal(download.headers["Cache-Control"], "no-store");
    assert.equal(response(handler, "HEAD", "/ca.cer").body, undefined);
    assert.match(response(handler, "GET", "/").body.toString(), new RegExp(state.fingerprint));
    for (const [method, url] of [["GET", "/private/ca.key.pem"], ["GET", "/site/index.html"], ["GET", "/ca.cer?x=1"], ["GET", "/%2e%2e/private/ca.key.pem"], ["POST", "/ca.cer"]]) {
      const result = response(handler, method, url);
      assert.equal(result.status, 404);
      assert.equal(result.body.includes("PRIVATE KEY"), false);
    }
    assert.equal(tool.status({ runtimeDir: runtime }).nginxRunning, false);
    assert.equal(tool.status({ runtimeDir: runtime }).bootstrapRunning, false);
    if (live) {
      runningRuntime = runtime;
      const started = await tool.run({ runtimeDir: runtime });
      assert.equal(started.nginxRunning, true);
      assert.equal(started.bootstrapRunning, true);
      assert.equal(tool.status({ runtimeDir: runtime }).nginxRunning, true);
      await assert.rejects(tool.run({ runtimeDir: runtime }), /Existing process metadata/);
      const tls = { port, servername: "synthetic-test.local", ca: fs.readFileSync(local("ca.crt.pem")) };
      const homepage = await request(https, { ...tls, path: "/" });
      assert.equal(homepage.status, 200);
      assert.equal(homepage.body.toString(), "synthetic public index.html");
      for (const pathname of ["/private/ca.key.pem", "/AGENTS.md", "/internal/private.md", "/.git/config"])
        assert.ok([403, 404].includes((await request(https, { ...tls, path: pathname })).status));
      const download = await request(http, { port: bootstrapPort, path: "/ca.cer" });
      assert.deepEqual(download.body, certificate);
      assert.equal((await request(http, { port: bootstrapPort, path: "/private/ca.key.pem" })).status, 404);
      assert.deepEqual(await tool.stop({ runtimeDir: runtime }), { stopped: true });
      runningRuntime = null;
      assert.equal(tool.status({ runtimeDir: runtime }).nginxRunning, false);
      assert.equal(tool.status({ runtimeDir: runtime }).bootstrapRunning, false);
    }
    const original = fs.readFileSync(path.join(site, "index.html"));
    fs.writeFileSync(path.join(site, "index.html"), "changed after review");
    assert.throws(() => tool.verifyWebsite(runtime, state), /changed after preparation/);
    fs.writeFileSync(path.join(site, "index.html"), original);
    fs.symlinkSync(local("ca.key.pem"), path.join(site, "escape.html"));
    assert.throws(() => tool.verifyWebsite(runtime, state), /symlinks/);
    fs.unlinkSync(path.join(site, "escape.html"));
    assert.throws(() => tool.prepare(options), /fresh runtime/);
    assert.throws(() => tool.prepare({ ...options, runtimeDir: path.join(source, "runtime") }), /outside source/);
    const secretSource = fixture("secret-source");
    put(secretSource, "docs/leak.js", "-----BEGIN " + "PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----");
    const rejectedRuntime = path.join(temporary, "rejected-runtime");
    assert.throws(() => tool.prepare({ ...options, source: secretSource, runtimeDir: rejectedRuntime }), /Secret material/);
    assert.equal(fs.existsSync(rejectedRuntime), false);
    const symlinkSource = fixture("symlink-source");
    fs.symlinkSync(path.join(source, "index.html"), path.join(symlinkSource, "docs/escape.html"));
    assert.throws(() => tool.prepare({ ...options, source: symlinkSource, runtimeDir: rejectedRuntime }), /symlinks/);
    const recordSource = fixture("record-source");
    put(recordSource, "docs/AGENTS.md", "private instruction record");
    assert.throws(() => tool.prepare({ ...options, source: recordSource, runtimeDir: rejectedRuntime }), /Private record path/);
    const ancestorSource = fixture("ancestor-source");
    fs.rmSync(path.join(ancestorSource, "admin"), { recursive: true });
    fs.symlinkSync(path.join(source, "admin"), path.join(ancestorSource, "admin"));
    assert.throws(() => tool.prepare({ ...options, source: ancestorSource, runtimeDir: rejectedRuntime }), /symlinks/);
    const current = tool.processIdentity(process.pid);
    assert.equal(current.pid, process.pid);
    assert.equal(tool.ownedProcess({ ...current, start: "reused-pid" }, "nginx", runtime), false);
    fs.writeFileSync(local("processes.json"), JSON.stringify({ nginx: current }), { mode: 0o600 });
    await assert.rejects(tool.stop({ runtimeDir: runtime }), /Refusing to signal/);
    assert.ok(tool.processIdentity(process.pid));
    fs.unlinkSync(local("processes.json"));
    assert.deepEqual(await tool.stop({ runtimeDir: runtime }), { stopped: true });
    const unsafeConfig = path.join(temporary, "invalid-connection.json");
    fs.writeFileSync(unsafeConfig, "sb_secret_" + "should_not_appear_in_error_output");
    const cli = cp.spawnSync(process.execPath, [path.resolve(__dirname, "../tools/shortcuts-test-site.cjs"), "prepare", "--runtime-dir", rejectedRuntime, "--source", source, "--connection", unsafeConfig], { encoding: "utf8" });
    assert.notEqual(cli.status, 0);
    assert.equal((cli.stdout + cli.stderr).includes("sb_secret"), false);
    console.log("PASS isolated local test site: public-only export, rejected secrets/symlinks/tampering, private CA/SAN TLS, bootstrap route isolation, no secret diagnostics and PID reuse protection. " +
      (live ? "Loopback-only Nginx/HTTP start, HTTPS validation and verified stop pass." : "No listeners started."));
  } finally {
    if (runningRuntime) await tool.stop({ runtimeDir: runningRuntime });
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
