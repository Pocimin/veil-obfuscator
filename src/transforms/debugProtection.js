import { parse } from "../parse.js";

function randName() {
  return "_0x" + (((Math.random() * 0x7fffffff) | 0).toString(16).padStart(6, "0"));
}

/**
 * Injects an anti-debug freezer: a `debugger` trap that measures how long it
 * takes to step past the statement. If a debugger is attached the delta is
 * large, and we spin forever (which wedges the devtools tab).
 */
export function applyDebugProtection(program, opts, originalSource) {
  const interval =
    typeof opts.debugProtectionInterval === "number" && opts.debugProtectionInterval >= 0
      ? opts.debugProtectionInterval
      : 2000;

  const anti = randName();
  const boot = randName();
  const wig = randName();
  const mark = randName();

  const src = `
(function(){
  var _${mark} = ${interval} ? Date.now() : 0;
  function ${anti}(){
    var _t0 = performance.now();
    debugger;
    if (_t0 !== _t0) { return; }
    if (performance.now() - _t0 > 100) {
      (function ${wig}(){ while (true) {} ${wig}(); })();
    }
    _${mark} = _t0;
  }
  (function ${boot}(){
    typeof queueMicrotask === 'function' ? queueMicrotask(${anti}) : ${anti}();
  })();
  setInterval(${anti}, ${interval});
})();
`;

  const ast = parse(src, { target: "script" });

  if (opts.disableConsole) {
    program.body.unshift({
      type: "ExpressionStatement",
      expression: {
        type: "AssignmentExpression",
        operator: "=",
        left: {
          type: "MemberExpression",
          object: { type: "MemberExpression", object: { type: "Identifier", name: "console" }, property: { type: "Identifier", name: "constructor" }, computed: false },
          property: { type: "Identifier", name: "_0xwipe" },
          computed: false,
        },
        right: { type: "CallExpression", callee: { type: "Identifier", name: "Function" }, arguments: [] },
      },
    });
  }

  program.body = [...ast.body, ...program.body];
  return program;
}
