#!/usr/bin/env node
/**
 * veil-lic · license auth server
 *
 * Endpoints:
 *   POST /api/activate  { key, hwid }  -> binds key to ONE hwid, checks expiry,
 *                                        returns { ok, expiresAt } or denied.
 *   GET  /api/ping                     -> { ok:true } (up-time check)
 *
 * Admin CLI (run on the VPS):
 *   node license-server.js issue --key ABCD-1234 --hours 24
 *     -> creates a key valid for 24h from first activation, single HWID.
 *   node license-server.js reset --key ABCD-1234
 *     -> clears the HWID/expiry (re-bind allowed).
 *   node license-server.js list
 *     -> shows all keys.
 *
 * DB: JSON file (default /root/license/db.json), keys stored SHA-256 hashed.
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const PORT = Number(process.env.LIC_PORT) || 8095;
const DB_DIR = process.env.LIC_DIR || "/root/license";
const DB_FILE = join(DB_DIR, "db.json");

function load() {
  try { return existsSync(DB_FILE) ? JSON.parse(readFileSync(DB_FILE, "utf8")) : {}; }
  catch { return {}; }
}
function save(db) {
  mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
const h = (s) => createHash("sha256").update(String(s)).digest("hex");
const now = () => Date.now();

function readBody(req) {
  return new Promise((res) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => { try { res(JSON.parse(d || "{}")); } catch { res({}); } });
  });
}
function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" });
  res.end(JSON.stringify(obj));
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/api/activate") {
    const { key, hwid } = await readBody(req);
    if (!key || !hwid) return json(res, 400, { ok: false, reason: "missing key or hwid" });
    const kh = h(key);
    const db = load();
    const rec = db[kh];
    if (!rec) return json(res, 403, { ok: false, reason: "invalid key" });

    // First activation: bind to the single HWID + stamp expiry.
    if (!rec.hwid) {
      rec.hwid = hwid;
      rec.expiresAt = now() + rec.hours * 3600 * 1000;
      rec.activatedAt = now();
      save(db);
      return json(res, 200, { ok: true, expiresAt: rec.expiresAt, expiresInMs: rec.expiresAt - now() });
    }

    // Already bound: this key works on exactly ONE machine.
    if (rec.hwid !== hwid) return json(res, 403, { ok: false, reason: "hwid mismatch" });

    // Time check (authoritative).
    if (now() > rec.expiresAt) return json(res, 403, { ok: false, reason: "license expired", expiresAt: rec.expiresAt });
    return json(res, 200, { ok: true, expiresAt: rec.expiresAt, expiresInMs: rec.expiresAt - now() });
  }

  if (req.method === "GET" && url.pathname === "/api/ping") return json(res, 200, { ok: true });

  json(res, 404, { ok: false, reason: "not found" });
});
server.listen(PORT, () => console.log(`veil-lic listening on :${PORT}`));

// ── Admin CLI ───────────────────────────────────────────────────────────────
const [, , cmd, ...rest] = process.argv;
const arg = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : null; };

function admin() {
  const db = load();
  if (cmd === "issue") {
    const key = arg("--key") || require_crypto();
    const hours = Number(arg("--hours") || 24);
    db[h(key)] = { key: key, hours, hwid: null, expiresAt: null, activatedAt: null, issuedAt: now() };
    save(db);
    console.log(`[+] issued key ${key} (${hours}h, single HWID, from first activation)`);
  } else if (cmd === "reset") {
    const key = arg("--key");
    if (!key) return console.log("usage: reset --key <key>");
    const r = db[h(key)];
    if (!r) return console.log("key not found");
    r.hwid = null; r.expiresAt = null; r.activatedAt = null;
    save(db);
    console.log(`[+] reset ${key} (can re-bind)`);
  } else if (cmd === "list") {
    for (const [kh, r] of Object.entries(db)) {
      const bound = r.hwid ? `${r.hwid.slice(0, 12)}…` : "unbound";
      const exp = r.expiresAt ? new Date(r.expiresAt).toISOString() : "—";
      console.log(`  ${r.key}  hwid=${bound}  expires=${exp}  hours=${r.hours}`);
    }
  } else {
    console.log("admin cmds: issue --key --hours | reset --key | list");
  }
  process.exit(0);
}
function require_crypto() {
  const random = [];
  const cs = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let i = 0; i < 4; i++) { let s = ""; for (let j = 0; j < 4; j++) s += cs[Math.floor(Math.random() * cs.length)]; random.push(s); }
  return random.join("-");
}
if (cmd) admin();