// Fast, read-only checks. No dependency installation, browsers or databases.
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  cp = require("node:child_process");
const root = path.resolve(__dirname, "..");
function plan(files, all = false) {
  const changed = (pattern) => all || files.some((name) => pattern.test(name));
  const commands = [];
  if (changed(/^(styles\/|css\/|tools\/build-css\.cjs)/))
    commands.push(["node", "tools/build-css.cjs", "--check"]);
  if (
    changed(/^(locales\/|js\/|tools\/(validate-locales|locale-contract)\.cjs)/)
  )
    commands.push(["node", "tools/validate-locales.cjs"]);
  if (
    changed(
      /^(supabase\/(migrations\/|install\.)|tools\/build-install-sql\.cjs|VERSION$)/,
    )
  )
    commands.push(["node", "tools/build-install-sql.cjs", "--check"]);
  if (
    changed(
      /^(supabase\/(functions\/|studio\/)|tools\/build-studio-functions\.cjs|VERSION$)/,
    )
  )
    commands.push(["node", "tools/build-studio-functions.cjs", "--check"]);
  if (
    changed(
      /^(js\/(backup-crypto|backup-kdf-worker|vendor\/)|tools\/build-backup-crypto|package(-lock)?\.json)/,
    )
  )
    commands.push(["node", "tools/build-backup-crypto.cjs", "--check-static"]);
  for (const [pattern, test] of [
    [
      /^(js\/admin-(overview|statistics)|tests\/admin-overview)/,
      "tests/admin-overview.cjs",
    ],
    [/food-interest-reply/, "tests/food-interest-reply.cjs"],
    [/invitation-templates/, "tests/invitation-templates.cjs"],
    [/backup-files/, "tests/backup-files.cjs"],
  ])
    if (changed(pattern)) commands.push(["node", test]);
  const needsFocusedTests = files.some(
    (name) =>
      /^(supabase\/|setup-service\/|tools\/setup-companion|js\/(setup|core|admin-auth|admin-access|backup-files)|deployment\/)/.test(
        name,
      ) && /\.(sql|js|cjs|mjs|ts|py|json|toml)$/.test(name),
  );
  return { commands, needsFocusedTests };
}
function run(args = process.argv.slice(2)) {
  if (args.some((arg) => !["--all", "--plan"].includes(arg)))
    throw Error("Usage: node tools/quick-check.cjs [--all] [--plan]");
  const all = args.includes("--all"),
    planning = args.includes("--plan");
  const git = (args) =>
    cp.execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const files = [
    ...new Set(
      (all
        ? git(["ls-files", "-co", "--exclude-standard", "-z"])
        : git(["diff", "--name-only", "-z", "HEAD"]) +
          "\0" +
          git(["ls-files", "--others", "--exclude-standard", "-z"])
      )
        .split("\0")
        .filter(Boolean),
    ),
  ];
  const selected = plan(files, all);
  if (planning) {
    console.log(JSON.stringify({ files, ...selected }, null, 2));
    return;
  }
  const started = Date.now();
  const execute = (command) =>
    cp.execFileSync(
      command[0] === "node" ? process.execPath : command[0],
      command.slice(1),
      { cwd: root, stdio: "inherit" },
    );
  execute(["git", "diff", "--check"]);
  let syntax = 0,
    json = 0;
  for (const name of files) {
    const full = path.resolve(root, name);
    if (
      !full.startsWith(root + path.sep) ||
      !fs.existsSync(full) ||
      !fs.statSync(full).isFile()
    )
      continue;
    if (/\.(js|cjs)$/.test(name)) {
      new vm.Script(fs.readFileSync(full, "utf8"), { filename: name });
      syntax++;
    } else if (/^setup-service\/.*\.ts$/.test(name)) {
      execute(["node", "--experimental-strip-types", "--check", name]);
      syntax++;
    } else if (/\.mjs$/.test(name)) {
      execute(["node", "--check", name]);
      syntax++;
    } else if (/\.json$/.test(name)) {
      JSON.parse(fs.readFileSync(full, "utf8"));
      json++;
    }
  }
  for (const command of selected.commands) execute(command);
  console.log(
    `PASS quick checks: ${syntax} JavaScript files, ${json} JSON files, ${selected.commands.length} focused checks; ${((Date.now() - started) / 1000).toFixed(1)}s.`,
  );
  if (selected.needsFocusedTests)
    console.log(
      "Database/auth/backup/deployment changes also need the relevant feature tests before VM use. Full CI remains a release/hosted-deployment gate.",
    );
}
if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { plan };
