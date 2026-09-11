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
const KEYED_SCRIPT_PATH = join(DB_DIR, "patch.seb.run"); // gated, obfuscated runtime blob
const BOOT_SCRIPT_PATH = join(DB_DIR, "patch.boot");    // ungated prompt+verify launcher
const ADMIN_TOKEN = process.env.LIC_ADMIN_TOKEN || "";  // set me! master key for issuing
const requireKey = (t) => (ADMIN_TOKEN && t === ADMIN_TOKEN);

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

  // Boot launcher (UNgated): only the tiny prompt+verify shim — no bypass logic,
// so anyone can fetch it; the real code comes from /api/fetch-code with a valid key.
  if (req.method === "GET" && url.pathname === "/api/fetch") {
    try {
      res.writeHead(200, { "Content-Type": "text/x-shellscript", "Cache-Control": "no-store" });
      res.end(readFileSync(BOOT_SCRIPT_PATH, "utf8"));
    } catch {
      json(res, 500, { ok: false, reason: "boot not configured" });
    }
    return;
  }

  // Gated runtime: only a valid, HWID-matching, non-expired key may fetch it.
  if (req.method === "GET" && url.pathname === "/api/fetch-code") {
    const key = url.searchParams.get("key");
    const hwid = url.searchParams.get("hwid");
    if (!key) return json(res, 403, { ok: false, reason: "missing key" });
    const rec = load()[h(key)];
    if (!rec || (rec.expiresAt && now() > rec.expiresAt)) return json(res, 403, { ok: false, reason: "invalid or expired key" });
    if (rec.hwid && (!hwid || rec.hwid !== hwid)) return json(res, 403, { ok: false, reason: "hwid mismatch" });
    if (!rec.hwid && hwid) { rec.hwid = hwid; rec.expiresAt = now() + rec.hours * 3600 * 1000; rec.activatedAt = now(); save(load()); }
    try {
      res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      res.end(readFileSync(KEYED_SCRIPT_PATH, "utf8")); // base64 blob of runtime
    } catch {
      json(res, 500, { ok: false, reason: "runtime not configured" });
    }
    return;
  }

  // Admin: issue / reset / list keys from anywhere (macOS CLI).
  if (req.method === "POST" && url.pathname === "/api/issue") {
    const b = await readBody(req);
    if (!requireKey(b.admin)) return json(res, 403, { ok: false, reason: "bad admin token" });
    const db = load();
    if (b.action === "list") {
      const out = Object.entries(db).map(([kh, r]) => ({ key: r.key, hwid: r.hwid ? r.hwid.slice(0, 12) : null, expiresAt: r.expiresAt, hours: r.hours }));
      return json(res, 200, { ok: true, keys: out });
    }
    if (b.action === "reset" && b.key) { const r = db[h(b.key)]; if (r) { r.hwid = null; r.expiresAt = null; r.activatedAt = null; save(db); } return json(res, 200, { ok: true }); }
    if (b.action === "delete" && b.key) { delete db[h(b.key)]; save(db); return json(res, 200, { ok: true, deleted: b.key }); }
    if (b.action === "issue") {
      const key = b.key || genKey();
      const hours = Number(b.hours || 24);
      db[h(key)] = { key, hours, hwid: null, expiresAt: null, activatedAt: null, issuedAt: now() };
      save(db);
      return json(res, 200, { ok: true, key, hours });
    }
    return json(res, 400, { ok: false, reason: "bad action" });
  }

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
function genKey() {
  const cs = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const p = () => { let s = ""; for (let j = 0; j < 4; j++) s += cs[Math.floor(Math.random() * cs.length)]; return s; };
  return p() + "-" + p() + "-" + p() + "-" + p();
}
if (cmd) admin();