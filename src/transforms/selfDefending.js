import { parse, generate } from "../parse.js";
import * as walk from "acorn-walk";

function randName() {
  return "_0x" + (((Math.random() * 0x7fffffff) | 0).toString(16).padStart(6, "0"));
}

/**
 * Self-defending. A guard function fingerprints its own source. At runtime we
 * normalize whitespace and check it matches what we embedded. Beautifiers that
 * rename identifiers or reorder/reshape the function break the match and we
 * spin forever — but pure whitespace changes survive (so it never false-trips
 * on normal runs of the untouched output).
 */
export function applySelfDefending(program, opts) {
  const markerFn = randName();
  const param = randName();
  const bodyVar = randName();
  const spin = randName();

  const src = `
(function(){
  function ${markerFn}(${param}) { return ${param}; }
  var ${bodyVar} = ${markerFn}.toString().replace(/\\s+/g, " ");
  if (${bodyVar}.indexOf(${JSON.stringify(normalize(`function ${markerFn}(${param}) { return ${param}; }`))}) === -1) {
    (function ${spin}(){ while (true) {} ${spin}(); })();
  }
})();
`;

  const ast = parse(src, { target: "script" });
  program.body = [...ast.body, ...program.body];
  return program;
}

// The exact normalized source of the guard as astring will emit it.
function normalize(s) {
  return s.replace(/\s+/g, " ").trim();
}
