import { parse } from "../parse.js";

/**
 * Locks the output to a list of allowed hostnames. If the code runs on any
 * other host it refuses to proceed (spins forever).
 */
export function applyDomainLock(program, opts) {
  if (!Array.isArray(opts.domainLock) || opts.domainLock.length === 0) return program;

  const hosts = JSON.stringify(opts.domainLock);
  const src = `
(function(){
  var _0xhost = "";
  try { _0xhost = location.hostname || ""; } catch(e){}
  var _0xallowed = ${hosts};
  var _0xok = _0xallowed.indexOf(_0xhost) !== -1;
  if (!_0xok){
    try { console.error("veil: locked domain"); } catch(e){}
    while (true) {}
  }
})();
`;

  const ast = parse(src, { target: "script" });
  program.body = [...ast.body, ...program.body];
  return program;
}
