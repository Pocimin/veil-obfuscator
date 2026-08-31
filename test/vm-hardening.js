import { obfuscate } from "../src/index.js";

let failures = 0;
let passed = 0;

function check(name, ok, extra = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
}

function runExpr(code) {
  // The IIFE is an expression; return its value. Strip trailing ';'.
  return new Function("return " + code.replace(/;\s*$/, ""))();
}

// 1. Full hardened VM still computes correctly and exits (Node-safe).
try {
  const { code } = obfuscate("(2 + 3) * 4 - 1", { preset: "vm" });
  check("vm hardened: computes (2+3)*4-1", runExpr(code) === 19, String(runExpr(code)));
} catch (e) {
  check("vm hardened: computes", false, e.message);
}

// 2. Self-defending: editing an operand in the bytecode must hang (spin).
try {
  const fs = await import("node:fs");
  const { code } = obfuscate("1 + 2 * 3", { preset: "vm", vmBytecodeEncoding: false, vmStatefulOpcodes: false, vmMacroOps: false, vmSelfDefending: true });
  const file = "/tmp/vm_sd_t.js";
  fs.writeFileSync(file, code);
  const m = code.match(/var _0xcode = (\[[^\]]*\]);/);
  const arr = JSON.parse(m[1]);
  arr[1] = 42;
  fs.writeFileSync(file, code.replace(m[1], JSON.stringify(arr)));
  const child = (await import("node:child_process")).spawn("node", [file]);
  let hanged = false;
  await new Promise((res) => {
    const timer = setTimeout(() => { hanged = true; child.kill("SIGKILL"); res(); }, 1500);
    child.on("exit", () => { clearTimeout(timer); res(); });
  });
  check("vmSelfDefending: tampered bytecode hangs", hanged);
} catch (e) {
  check("vmSelfDefending: tampered bytecode hangs", false, e.message);
}

// 3. Stateful opcodes are position-dependent (mask function present).
try {
  const { code } = obfuscate("1+1", { preset: "vm", vmStatefulOpcodes: true });
  check("vmStatefulOpcodes: keyAt emitted", /function keyAt\(/.test(code));
} catch (e) {
  check("vmStatefulOpcodes: keyAt emitted", false, e.message);
}

// 4. Decoy fake handlers present in the dispatch.
try {
  const { code } = obfuscate("1+1", { preset: "vm", vmDecoyOpcodes: true });
  check("vmDecoyOpcodes: fake handlers", /case 87:/.test(code) || /case 176:/.test(code));
} catch (e) {
  check("vmDecoyOpcodes: fake handlers", false, e.message);
}

// 5. Bytecode is encrypted (no plain literal code array).
try {
  const { code } = obfuscate("1+1", { preset: "vm", vmBytecodeEncoding: true });
  check("vmBytecodeEncoding: blob instead of literal", /_0xdec\(/.test(code) && !/var _0xcode = \[[1-9]/.test(code));
} catch (e) {
  check("vmBytecodeEncoding: blob instead of literal", false, e.message);
}

// 6. Anti-LLM/debug layers present.
try {
  const { code } = obfuscate("1+1", { preset: "vm", vmDebugProtection: true, vmSelfDefending: true });
  check("vmDebugProtection: debugger trap", /debugger/.test(code));
  check("vmSelfDefending: fnv checksum", /function fnv/.test(code));
} catch (e) {
  check("vm debug/self-def markers", false, e.message);
}

console.log(`\n  ${passed} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
