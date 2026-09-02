import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { obfuscate } from "./index.js";
import { createSessionStore, issueToken, returnKey, registerSession } from "./server-auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const PORT = Number(process.env.PORT) || 3000;

// In-memory session table store for the server round-trip / Tier-A key flow.
const SESSIONS = new Map();
const AUTH = createSessionStore();

function clientIp(req) {
  return (req.socket?.remoteAddress || req.headers["x-forwarded-for"] || "0.0.0.0").split(",")[0].trim();
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

function serveStatic(pathname, res) {
  const file = join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  if (!existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  const ext = file.slice(file.lastIndexOf("."));
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
  });
  res.end(readFileSync(file));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CLI-style API: POST /api/obfuscate { source, options }
  if (req.method === "POST" && url.pathname === "/api/obfuscate") {
    try {
      const body = await readBody(req);
      if (typeof body.source !== "string") throw new Error("body.source is required");
      const opts = body.options || {};
      // Tier A: build with an explicit random decode key, register it server-side
      // under the baked sid, and return a bundle the loader keys off the server.
      if (opts.serverDecode) {
        const { randomBytes } = await import("node:crypto");
        const K = randomBytes(16).toString("hex");
        opts._decodeKey = K;
      }
      const result = obfuscate(body.source, opts);
      if (opts.serverDecode && result.serverDecode) {
        registerSession(AUTH, result.serverDecode.sid, opts._decodeKey, body.fingerprint);
        delete result.serverDecode.table;
        delete result.serverDecode.key;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Session string table for serverDecode mode (the server-round-trip):
  //   POST /api/session { table:[...] } -> { sid }   (register a table)
  //   GET  /api/session?sid=...          -> { table } (fetch, one-shot delete)
  // The obfuscator's serverDecode loader fetches the table by sid at runtime,
  // so the client bundle ships NO pool and NO decoder. Gate `sid` per session in
  // production (token/host); here it is an unguessable random id.
  // Tier A: issue an HMAC, nonce-bound, one-time, expiring session token.
  if (req.method === "POST" && url.pathname === "/api/session") {
    const body = await readBody(req);
    const r = issueToken(AUTH, clientIp(req), body.sid, body.fingerprint);
    const status = r.status || 200;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(r));
    return;
  }

  // Tier A: after the server-side attestation gate, deliver the decode key once.
  if (req.method === "POST" && url.pathname === "/api/key") {
    const body = await readBody(req);
    const r = returnKey(AUTH, body);
    const status = r.status || 200;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(r));
    return;
  }

  // Legacy: register a table by sid (older round-trip mode).
  if (url.pathname === "/api/session" && req.method === "GET") {
    const sid = url.searchParams.get("sid");
    const table = sid ? SESSIONS.get(sid) : undefined;
    if (table === undefined) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unknown session" }));
      return;
    }
    SESSIONS.delete(sid);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ table }));
    return;
  }

  if (req.method === "GET") {
    serveStatic(url.pathname, res);
    return;
  }

  res.writeHead(405, { "Content-Type": "text/plain" });
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`\n  vein · veil obfuscator — http://localhost:${PORT}\n`);
});
