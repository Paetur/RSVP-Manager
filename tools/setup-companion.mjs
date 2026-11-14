#!/usr/bin/env node
// Run only on the installer's computer; this is never a public HTTP setup endpoint.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createSetupServer } from "../setup-service/server.ts";
const args = process.argv.slice(2);
if (
  args.length &&
  (args.length !== 2 ||
    args[0] !== "--port" ||
    !/^\d+$/.test(args[1]) ||
    Number(args[1]) < 1024 ||
    Number(args[1]) > 65535)
) {
  console.error(
    "Usage: node --experimental-strip-types tools/setup-companion.mjs [--port 8090]",
  );
  process.exit(1);
}
try {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    server = createSetupServer(root);
  server.on("error", () => {
    console.error(
      "The local setup companion could not start. Check the selected port and setup assets.",
    );
    process.exitCode = 1;
  });
  server.listen(Number(args[1] || 8090), "127.0.0.1", () =>
    console.log(
      "Open http://127.0.0.1:" +
        server.address().port +
        "/ on this computer. Credentials stay in the temporary local setup process. Stop it after installation.",
    ),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      server.close();
      server.closeIdleConnections();
    });
} catch {
  console.error(
    "Setup assets are not ready. Run the installer and Studio bundle build checks before starting the companion.",
  );
  process.exitCode = 1;
}
