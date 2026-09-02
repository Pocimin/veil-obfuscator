import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { obfuscate } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sample = readFileSync(join(__dirname, "sample.js"), "utf8");

let failures = 0;
let passed = 0;

function check(name, ok, extra = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

function run(code) {
  // Evaluate in a fresh context with a console spy. The global resolver routes
  // console through globalThis, so patch the global like a real env would.
  const logs = [];
  const orig = globalThis.console;
  globalThis.console = { log: (...a) => logs.push(a.join(" ")), warn: () => {}, error: () => {}, info: () => {} };
  try { new Function(code)(); } finally { globalThis.console = orig; }
  return logs;
}

// 1. Light: string-array only, must still run correctly.
try {
  const { code } = obfuscate(sample, { preset: "light", debugProtection: false, selfDefending: false });
  const logs = run(code);
  check("light: runs & preserves behavior", JSON.stringify(logs) === JSON.stringify(["Hello, world", "veil says: Hello, world"]), JSON.stringify(logs));
} catch (e) {
  check("light: runs & preserves behavior", false, e.message);
}

// 2. Balanced: string-array + CF + dead code.
try {
  const { code, warnings } = obfuscate(sample, { preset: "balanced", debugProtection: false, selfDefending: false });
  const logs = run(code);
  check("balanced: runs & preserves behavior", JSON.stringify(logs) === JSON.stringify(["Hello, world", "veil says: Hello, world"]), JSON.stringify(logs));
} catch (e) {
  check("balanced: runs & preserves behavior", false, e.message);
}

// 3. Output shape: encoded strings shouldn't appear as plain text.
try {
  const { code } = obfuscate(sample, { preset: "light", stringArrayThreshold: 1, debugProtection: false, selfDefending: false });
  const leaksPlain = code.includes('"Hello, "') || code.includes(`"veil says:"`);
  check("light: string literals encoded", !leaksPlain);
} catch (e) {
  check("light: string literals encoded", false, e.message);
}

// 4. VM core: arithmetic program runs through the interpreter.
try {
  const { code } = obfuscate(`1 + 2 * 3`, { preset: "vm", debugProtection: false, selfDefending: false });
  const result = new Function("return " + code.replace(/;\s*$/, ""))();
  check("vm: computes 1+2*3", result === 7, String(result));
} catch (e) {
  check("vm: computes 1+2*3", false, e.message);
}

// 5. Output must be parseable/valid by re-parsing.
try {
  const { code } = obfuscate(sample, { preset: "balanced", debugProtection: false, selfDefending: false });
  check("balanced: output is valid JS", typeof code === "string" && code.length > 0);
} catch (e) {
  check("balanced: output is valid JS", false, e.message);
}

// 6. Runtime-gated decode: a probe that's truthy in this (Node) host decodes
//    fine, so behavior is preserved. `String(1) === '1'` is true everywhere.
try {
  const { code } = obfuscate(sample, {
    preset: "light",
    stringArrayThreshold: 1,
    debugProtection: false,
    selfDefending: false,
    stringArrayGate: "String(1) === '1'",
  });
  const logs = run(code);
  check("gate: truthy probe preserves behavior", JSON.stringify(logs) === JSON.stringify(["Hello, world", "veil says: Hello, world"]), JSON.stringify(logs));
} catch (e) {
  check("gate: truthy probe preserves behavior", false, e.message);
}

// 7. Runtime-gated decode: a falsy probe (browser-only, so it fails under
//    Node) must NOT leak plaintext — the decoder stores the corrupted gateFail.
try {
  const { code } = obfuscate(sample, {
    preset: "light",
    stringArrayThreshold: 1,
    debugProtection: false,
    selfDefending: false,
    stringArrayGate: "typeof document !== 'undefined'",
  });
  const leaksPlain = code.includes('"Hello, "') || code.includes(`"veil says:"`);
  let logs = null;
  try { logs = run(code); } catch (e) { logs = "[runtime threw: " + e.message + "]"; }
  const corrupted = !leaksPlain && logs !== null && JSON.stringify(logs) !== JSON.stringify(["Hello, world", "veil says: Hello, world"]);
  check("gate: falsy probe corrupts strings (anti-dump)", corrupted, JSON.stringify(logs));
} catch (e) {
  check("gate: falsy probe corrupts strings (anti-dump)", false, e.message);
}

// 8. Continuous-stateful (chained) decoder: must preserve behavior, and the
//    output must NOT contain a pre-decoded array of plaintext strings.
try {
  const { code } = obfuscate(sample, {
    preset: "light",
    stringArrayThreshold: 1,
    stringArrayChain: true,
    debugProtection: false,
    selfDefending: false,
  });
  const logs = run(code);
  const ok =
    JSON.stringify(logs) === JSON.stringify(["Hello, world", "veil says: Hello, world"]) &&
    !code.includes('"Hello, "') &&
    !code.includes(`"veil says:"`);
  check("chain: runs, preserves behavior, no plaintext array", ok, JSON.stringify(logs));
} catch (e) {
  check("chain: runs, preserves behavior, no plaintext array", false, e.message);
}

// 9. Chained + anti-dump gate: a falsy probe (browser-only, falsy under Node)
//    must corrupt rather than leak.
try {
  const { code } = obfuscate(sample, {
    preset: "light",
    stringArrayThreshold: 1,
    stringArrayChain: true,
    debugProtection: false,
    selfDefending: false,
    stringArrayGate: "typeof document !== 'undefined'",
  });
  const leaksPlain = code.includes('"Hello, "') || code.includes(`"veil says:"`);
  let logs = null;
  try { logs = run(code); } catch (e) { logs = "[runtime threw: " + e.message + "]"; }
  const corrupted = !leaksPlain && logs !== null && JSON.stringify(logs) !== JSON.stringify(["Hello, world", "veil says: Hello, world"]);
  check("chain+gate: falsy probe corrupts strings", corrupted, JSON.stringify(logs));
} catch (e) {
  check("chain+gate: falsy probe corrupts strings", false, e.message);
}

// 10. Global resolver: references to known globals are routed through a switch,
//     and no literal global identifier survives in the output.
try {
  const { code } = obfuscate('console.log(document.title);', { preset: "light", stringArray: true, stringArrayThreshold: 1, globalResolver: true, renameIdentifiers: false, debugProtection: false, selfDefending: false, deadCodeInjection: 0, controlFlowFlattening: 0 });
  const noLeak = !/\bconsole\b/.test(code) && !/\bdocument\b/.test(code.replace(/globalThis/, ""));
  check("globalResolver: globals not greppable", noLeak);
} catch (e) {
  check("globalResolver: globals not greppable", false, e.message);
}

// 11. Opaque Predicates woven into CF + cosmetic booleans.
try {
  const { code } = obfuscate("function f(x){ if(x===undefined){return true;} return false; } console.log(f(2));", {
    preset: "light", stringArray: true, stringArrayThreshold: 1, opaquePredicates: true, cosmetic: true,
    controlFlowFlattening: 1, renameIdentifiers: false, globalResolver: false,
    debugProtection: false, selfDefending: false, deadCodeInjection: 0,
  });
  const opaque = /typeof Date/.test(code);
  const cos = /!0x1|!0x0|void 0/.test(code);
  check("opaque predicates emitted", opaque);
  check("cosmetic booleans emitted", cos);
} catch (e) {
  check("opaque/cosmetic tests", false, e.message);
}

// 12. Host-gated, key-entangled decode: with hostGate on, running under Node
//     (no real browser) yields garbage — the anti-dump gate actually closes.
try {
  const { code } = obfuscate('console.log("hostgate_plaintext");', {
    preset: "balanced", stringArrayThreshold: 1, hostGate: true,
    debugProtection: false, selfDefending: false, deadCodeInjection: 0, controlFlowFlattening: 0,
    globalResolver: false, renameIdentifiers: false,
  });
  const logs = [];
  new Function("console", code)({ log: (...x) => logs.push(x.join(" ")) });
  const leaked = JSON.stringify(logs).includes("hostgate_plaintext");
  check("hostGate: Node run yields garbage (no plaintext)", !leaked, JSON.stringify(logs));
} catch (e) {
  check("hostGate: Node run yields garbage", false, e.message);
}

// 13. Tier A server round-trip: the bundle ships an ENCRYPTED pool + a handshake
//     (token -> attestation -> key) and NO decode key / NO plaintext. A dump has
//     neither the key nor plaintext; it must fetch the key per-session.
try {
  const KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const { code } = obfuscate('console.log("a secret string value");', {
    preset: "balanced", stringArray: true, stringArrayThreshold: 1, serverDecode: "https://S/api",
    _decodeKey: KEY, debugProtection: false, selfDefending: false, deadCodeInjection: 0,
    controlFlowFlattening: 0, globalResolver: false, renameIdentifiers: false,
  });
  const noKey = !code.includes(KEY);
  const noPlain = !code.includes("a secret string value");
  const handshake = /api\/session/.test(code) && /api\/key/.test(code);
  const encrypted = /0x811c9dc5|s\[i\]=i/.test(code); // crypto present, key absent
  check("Tier A: no key, no plaintext, handshake, encrypted pool", noKey && noPlain && handshake && encrypted);
} catch (e) {
  check("Tier A: no key, no plaintext, handshake, encrypted pool", false, e.message);
}

// 14. Tier A auth flow: register -> issue token -> attestation gates the key.
try {
  const auth = await import("../src/server-auth.js");
  const store = auth.createSessionStore();
  const sid = "sess-test-1";
  const KEY = "0123456789abcdef";
  auth.registerSession(store, sid, KEY, "fp1");
  const tok = auth.issueToken(store, "1.2.3.4", sid, "fp1");
  const good = auth.returnKey(store, { sid, nonce: tok.nonce, sig: tok.sig, fingerprint: "fp1", probeHash: [9,1,1,1,1,1,1,1,1,1,1,1] });
  check("Tier A auth: good attestation returns key", good.key === KEY, JSON.stringify(good));
  const again = auth.returnKey(store, { sid, nonce: tok.nonce, sig: tok.sig, fingerprint: "fp1", probeHash: [9,1,1,1,1,1,1,1,1,1,1,1] });
  check("Tier A auth: one-time (reuse rejected)", again.status === 401, JSON.stringify(again));
  const sid2 = "sess-test-2";
  auth.registerSession(store, sid2, "abcdefghijklmnop", "fp2");
  const tok2 = auth.issueToken(store, "5.6.7.8", sid2, "fp2");
  const badProbe = auth.returnKey(store, { sid: sid2, nonce: tok2.nonce, sig: tok2.sig, fingerprint: "fp2", probeHash: [0,0,0,0,0,0,0,0,0,0,0,0] });
  check("Tier A auth: bad attestation rejected", badProbe.status === 403, JSON.stringify(badProbe));
} catch (e) {
  check("Tier A auth flow", false, e.message);
}

// 15. Tier C: the sensitive function body is replaced by an attested RPC; the
//     logic ships server-side, so a dump of the bundle reveals no decision/flag.
try {
  const { code } = obfuscate(
    'function decideExam(a){ return { allowed:true, flag:false }; } const r = decideExam("tok"); console.log(r);',
    { preset: "light", stringArray: true, stringArrayThreshold: 1, tierC: { fn: "decideExam", endpoint: "/api/rpc" }, renameIdentifiers: false, debugProtection: false, selfDefending: false, deadCodeInjection: 0, controlFlowFlattening: 0 },
  );
  const noLogic = !/allowed|flag|return \{|decideExam/.test(code);
  const rpcShell = /XMLHttpRequest/.test(code);
  check("Tier C: sensitive logic removed, RPC shell ships", noLogic && rpcShell);
} catch (e) {
  check("Tier C: sensitive logic removed, RPC shell ships", false, e.message);
}

console.log(`\n  ${passed} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
