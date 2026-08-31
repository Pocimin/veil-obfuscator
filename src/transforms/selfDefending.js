import { parse, generate } from "../parse.js";
import * as walk from "acorn-walk";

const MARKER_FN = "_0xa";

/**
 * Self-defending. A guard function fingerprints its own source. At runtime we
 * normalize whitespace and check it matches what we embedded. Beautifiers that
 * rename identifiers or reorder/reshape the function break the match and we
 * spin forever — but pure whitespace changes survive (so it never false-trips
 * on normal runs of the untouched output).
 */
export function applySelfDefending(program, opts) {
  const src = `
(function(){
  function ${MARKER_FN}(_0xb) { return _0xb; }
  var _0xbody = ${MARKER_FN}.toString().replace(/\\s+/g, " ");
  if (_0xbody.indexOf(${expectedSnippet()}) === -1) {
    (function _0xspin(){ while (true) {} _0xspin(); })();
  }
})();
`;

  const ast = parse(src, { target: "script" });
  program.body = [...ast.body, ...program.body];
  return program;
}

// The exact normalized source of the guard as astring will emit it.
function expectedSnippet() {
  const src = `\n  function ${MARKER_FN}(_0xb) { return _0xb; }\n`;
  const ast = parse(src, { target: "script" });
  let guard = null;
  walk.simple(ast, {
    FunctionDeclaration(node) {
      if (node.id && node.id.name === MARKER_FN) guard = node;
    },
  });
  const rendered = normalize(generate(guard));
  return JSON.stringify(rendered);
}

function normalize(s) {
  return s.replace(/\s+/g, " ").trim();
}
