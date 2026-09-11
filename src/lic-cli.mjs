#!/usr/bin/env node
/**
 * veil-lic · Mac-side admin CLI — manages keys over the network (no SSH).
 *
 *   node lic-cli.mjs issue --hours 24 [--key CUSTOM]
 *   node lic-cli.mjs list
 *   node lic-cli.mjs reset --key KEY
 *
 * Requires the admin token (LIC_ADMIN_TOKEN) set on the server and provided here.
 * Server: http://20.188.120.231:8095
 */
const SVR = process.env.LIC_SVR || "http://20.188.120.231:8095";
const ADMIN = process.env.LIC_ADMIN || ""; // the server's LIC_ADMIN_TOKEN

const [, , action, ...rest] = process.argv;
const arg = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : null; };

async function call(body) {
  if (!ADMIN) throw new Error("set LIC_ADMIN to the server admin token (e.g. LIC_ADMIN=xyz node lic-cli.mjs ...)");
  const r = await fetch(`${SVR}/api/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, admin: ADMIN }),
  });
  return r.json();
}

(async () => {
  try {
    if (action === "issue") {
      const hours = Number(arg("--hours") || 24);
      const key = arg("--key");
      const r = await call({ action: "issue", hours, key });
      if (r.ok) console.log(`[+] issued ${r.key}  (${r.hours}h, single HWID from first run)`);
      else console.log("[✗]", r.reason || "failed");
    } else if (action === "list") {
      const r = await call({ action: "list" });
      if (r.ok) for (const k of r.keys) console.log(`  ${k.key}  hwid=${k.hwid || "unbound"}  expires=${k.expiresAt ? new Date(k.expiresAt).toISOString() : "—"}  hours=${k.hours}`);
      else console.log("[✗]", r.reason || "failed");
    } else if (action === "reset") {
      const key = arg("--key");
      if (!key) return console.log("usage: reset --key <key>");
      const r = await call({ action: "reset", key });
      if (r.ok) console.log(`[+] reset ${key} (can re-bind)`);
      else console.log("[✗]", r.reason || "failed");
    } else {
      console.log("usage: node lic-cli.mjs issue --hours <N> [--key CUSTOM] | list | reset --key KEY");
      console.log("env: LIC_SVR (default http://20.188.120.231:8095), LIC_ADMIN (required)");
    }
  } catch (e) {
    console.error("error:", e.message);
  }
})();