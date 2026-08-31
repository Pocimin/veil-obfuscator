import { obfuscate } from "../src/index.js";

let failures = 0, passed = 0;
function check(name, ok, extra = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
}
function run(code) {
  const logs = [];
  new Function("console", code)({ log: (...a) => logs.push(a.join(" ")), warn(){}, error(){} });
  return logs;
}

const SCRIPTS = [
  { name: "shadowing + closure", src: `(function(){
    let x = 1;
    function f(){ let x = 2; return x + 1; }
    return f(); })()` },
  { name: "params + hoisting", src: `(function(){
    console.log(y); var y = 3;
    function add(a,b){ return a+b; }
    console.log(add(1,2)); })()` },
  { name: "module-style", src: `function main(){ const name='x'; return name; } console.log(main());` },
];

for (const t of SCRIPTS) {
  try {
    const { code } = obfuscate(t.src, { preset: "light", stringArray: false, renameIdentifiers: true, debugProtection: false, selfDefending: false, deadCodeInjection: 0, controlFlowFlattening: 0 });
    const logs = run(code);
    const expected = run(t.src);
    check(`rename: preserves behavior (${t.name})`, JSON.stringify(logs) === JSON.stringify(expected), JSON.stringify(logs));
    // names should be mangled
    const mangled = /_0x[a-f0-9]{6}/.test(code);
    check(`rename: identifiers mangled (${t.name})`, mangled);
  } catch (e) {
    check(`rename: ${t.name}`, false, e.message);
  }
}

console.log(`\n  ${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
