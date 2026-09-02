import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { obfuscate } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const PORT = Number(process.env.PORT) || 3000;

// In-memory session table store for /api/session (server round-trip).
const SESSIONS = new Map();

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
      const result = obfuscate(body.source, opts);
      // Self-contained server round-trip: store the string table here so the
      // returned bundle fetches it per-session (no strings shipped to the client).
      if (opts.serverDecode && result.serverDecode) {
        // Store the string table server-side; do NOT echo it back to the caller.
        SESSIONS.set(result.serverDecode.sid, result.serverDecode.table);
        delete result.serverDecode.table;
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
  if (url.pathname === "/api/session") {
    if (req.method === "POST") {
      const body = await readBody(req);
      // Accept a caller-supplied sid (from obfuscate's serverDecode) so the
      // loader's baked sid matches; otherwise generate one.
      const sid = body.sid || (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
      SESSIONS.set(sid, body.table || []);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sid }));
      return;
    }
    if (req.method === "GET") {
      const sid = url.searchParams.get("sid");
      const table = sid ? SESSIONS.get(sid) : undefined;
      if (table === undefined) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unknown session" }));
        return;
      }
      SESSIONS.delete(sid); // one-shot
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ table }));
      return;
    }
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
