import { parse } from "../parse.js";

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

  const src = `
(function(){
  var _0xmark = ${interval} ? Date.now() : 0;
  function _0xanti(){
    var _0xt0 = performance.now();
    debugger;
    if (_0xt0 !== _0xt0) { return; }
    if (performance.now() - _0xt0 > 100) {
      // A debugger paused us: freeze the tab.
      (function _0xwig(){ while (true) {} _0xwig(); })();
    }
    _0xmark = _0xt0;
  }
  (function _0xboot(){
    // Re-trigger on microtasks so it is not trivially removed.
    typeof queueMicrotask === 'function' ? queueMicrotask(_0xanti) : _0xanti();
  })();
  setInterval(_0xanti, ${interval});
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
