import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Installation, installationAssets, steps } from "./installation.ts";
import { SetupError } from "./management.ts";

type Session = {
  csrf: string;
  touched: number;
  installation: Installation | null;
};
export function createSetupServer(
  root: string,
  options: { fetcher?: typeof fetch; sessionMs?: number } = {},
) {
  const assets = installationAssets(root),
    sessions = new Map<string, Session>();
  let origin = "";
  const expires = options.sessionMs ?? 30 * 60_000;
  const clear = (id: string) => {
    sessions.get(id)?.installation?.forget();
    sessions.delete(id);
  };
  const timer = setInterval(() => {
    for (const [id, session] of sessions)
      if (Date.now() - session.touched > expires) clear(id);
  }, 30_000);
  timer.unref();
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    const send = (status: number, value: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(value));
    };
    try {
      if (!origin)
        origin = "http://127.0.0.1:" + (server.address() as any).port;
      if (req.headers.host !== new URL(origin).host)
        throw new SetupError(
          "host",
          "Use the local setup companion address.",
          403,
        );
      const path = new URL(req.url || "/", origin).pathname;
      if (path.startsWith("/setup-api/")) {
        if (
          (req.headers.origin && req.headers.origin !== origin) ||
          req.headers["sec-fetch-site"] === "cross-site"
        )
          throw new SetupError(
            "origin",
            "Setup requests must come from this local companion.",
            403,
          );
        const cookie = String(req.headers.cookie || "").match(
          /(?:^|;\s*)rsvp-setup=([a-f0-9]{64})(?:;|$)/,
        )?.[1];
        if (
          cookie &&
          sessions.has(cookie) &&
          Date.now() - sessions.get(cookie)!.touched > expires
        )
          clear(cookie);
        if (req.method === "GET" && path === "/setup-api/session") {
          let id = cookie && sessions.has(cookie) ? cookie : null;
          if (!id) {
            if (sessions.size >= 8)
              throw new SetupError(
                "busy",
                "Close another setup session or restart the local companion.",
                429,
              );
            id = randomBytes(32).toString("hex");
            sessions.set(id, {
              csrf: randomBytes(32).toString("hex"),
              touched: Date.now(),
              installation: null,
            });
            res.setHeader(
              "Set-Cookie",
              "rsvp-setup=" + id + "; HttpOnly; SameSite=Strict; Path=/",
            );
          }
          const session = sessions.get(id)!;
          session.touched = Date.now();
          return send(200, {
            csrf: session.csrf,
            state: session.installation?.publicState() || null,
            companion: true,
          });
        }
        if (req.method !== "POST")
          throw new SetupError("method", "Use a supported setup action.", 405);
        const session = cookie ? sessions.get(cookie) : null;
        const csrf = String(req.headers["x-setup-csrf"] || "");
        if (
          !session ||
          !/^[a-f0-9]{64}$/.test(csrf) ||
          csrf.length !== session.csrf.length ||
          !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf)) ||
          req.headers.origin !== origin
        )
          throw new SetupError(
            "session",
            "The setup session expired or is invalid. Reconnect; project progress is preserved.",
            401,
          );
        if (!(req.headers["content-type"] || "").startsWith("application/json"))
          throw new SetupError("content", "Use a JSON setup request.", 415);
        if (Number(req.headers["content-length"] || 0) > 65_536)
          throw new SetupError("size", "Setup request is too large.", 413);
        let bytes = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 65_536)
            throw new SetupError("size", "Setup request is too large.", 413);
          chunks.push(chunk);
        }
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(Buffer.concat(chunks).toString());
          if (!input || Array.isArray(input) || typeof input !== "object")
            throw Error();
        } catch {
          throw new SetupError("json", "The setup request is invalid.");
        }
        session.touched = Date.now();
        if (path === "/setup-api/disconnect") {
          clear(cookie!);
          return send(200, { disconnected: true });
        }
        if (path === "/setup-api/connect") {
          if (session.installation?.busy)
            throw new SetupError(
              "busy",
              "Wait for the running step before reconnecting.",
              409,
            );
          session.installation?.forget();
          session.installation = null;
          const candidate = new Installation(input, assets, options.fetcher);
          try {
            const state = await candidate.connect();
            session.installation?.forget();
            session.installation = candidate;
            if (candidate.initialized) candidate.forget();
            return send(200, state);
          } catch (error) {
            candidate.forget();
            throw error;
          }
        }
        const action = path.slice("/setup-api/".length);
        if (!steps.includes(action as any))
          throw new SetupError("route", "Unknown setup action.", 404);
        if (!session.installation)
          throw new SetupError(
            "connection",
            "Connect the Supabase project first.",
            409,
          );
        const state = await session.installation.run(action as any, input);
        if (state.initialized) session.installation.forget();
        return send(200, state);
      }
      if (req.method !== "GET" && req.method !== "HEAD")
        throw new SetupError("method", "Method not allowed.", 405);
      const name = path === "/" ? "setup-automatic.html" : path.slice(1);
      // Never serve the checkout, server code, configuration, backups or internal documents.
      const allowed = [
        "setup-automatic.html",
        "js/setup-automatic.js",
        "js/i18n.js",
        "js/translations.js",
        "css/app.css",
      ];
      if (
        !allowed.includes(name) &&
        !/^locales\/(en|de|fo)\/(interface|food|types)\.json$/.test(name)
      )
        throw new SetupError("not_found", "Not found.", 404);
      const file = resolve(root, name);
      if (!file.startsWith(resolve(root) + "/"))
        throw new SetupError("path", "Not found.", 404);
      const types: Record<string, string> = {
        html: "text/html",
        js: "text/javascript",
        css: "text/css",
        json: "application/json",
      };
      res.setHeader(
        "Content-Type",
        types[name.split(".").pop()!] + "; charset=utf-8",
      );
      const content = await readFile(file);
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (error) {
      // Do not serialize SDK/provider errors, input, SQL, credentials or stack traces.
      if (error instanceof SetupError)
        send(error.status, { error: error.message, code: error.code });
      else
        send(500, {
          error:
            "This setup step could not be completed. Retry it; saved project progress is preserved.",
          code: "setup_failed",
        });
    }
  });
  server.requestTimeout = 20_000;
  server.on("close", () => {
    clearInterval(timer);
    for (const id of sessions.keys()) clear(id);
  });
  return server;
}
