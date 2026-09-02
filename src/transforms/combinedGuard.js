import { parse } from "../parse.js";

import { freshName } from "./names.js";
function randName() { return freshName(); }

const MARKER = "VEILSELF7F_MARKER";

/**
 * Single randomized anti-tamper + anti-debug guard.
 *
 * Merges the old two-verbatim preludes (toString self-defend + debugger trap)
 * into ONE IIFE with randomized structure, so the output no longer begins with
 * two copy-paste-identical blocks (the strongest generator fingerprint).
 *
 * Layers (all fatal on tamper/hook):
 *   1. self-defend: a probe function's own source must keep a known fingerprint.
 *   2. anti-hook: native methods (Array.prototype.pop / isArray) must not be
 *      wrapped (their toString must contain '[native code]').
 *   3. anti-debug: debugger-timing trap (freezes the tab if a breakpoint pauses).
 */
export function applyCombinedGuard(program, opts, originalSource) {
  if (!opts.debugProtection && !opts.selfDefending) return program;

  const probe = randName();
  const body = randName();
  const spin = randName();
  const hook = randName();
  const clock = randName();
  const t0 = randName();
  const t1 = randName();

  const expected = JSON.stringify(normalize(`function ${probe}(${MARKER}) { return ${MARKER}; }`));

  const src = `
(function(){
  function ${probe}(${MARKER}) { return ${MARKER}; }
  var ${body} = ${probe}.toString().replace(/\\s+/g, " ");
  if (${body}.indexOf(${expected}) === -1) { (function ${spin}(){ while (true) {} ${spin}(); })(); }
  try {
    if (String(Function.prototype.toString.call(Array.prototype.pop)).indexOf('[native code]') < 0) { (function ${spin}(){ while (true) {} ${spin}(); })(); }
    if (String(Array.isArray).indexOf('isArray') < 0) { (function ${spin}(){ while (true) {} ${spin}(); })(); }
  } catch (${clock}) { (function ${spin}(){ while (true) {} ${spin}(); })(); }
  try {
    var ${t0} = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    debugger;
    if ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now() - ${t0} > 100) { (function ${spin}(){ while (true) {} ${spin}(); })(); }
    var ${t1} = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    debugger;
    if ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now() - ${t1} > 100) { (function ${spin}(){ while (true) {} ${spin}(); })(); }
  } catch (${hook}) {}
})();
`;

  const ast = parse(src, { target: "script" });
  program.body = [...ast.body, ...program.body];
  return program;
}

function normalize(s) {
  return s.replace(/\s+/g, " ").trim();
}
