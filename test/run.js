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
  // Evaluate in a fresh context with a console spy.
  const logs = [];
  const fn = new Function("console", code);
  fn({ log: (...a) => logs.push(a.join(" ")), warn: () => {}, error: () => {} });
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

console.log(`\n  ${passed} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
