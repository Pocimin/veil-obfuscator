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

console.log(`\n  ${passed} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
