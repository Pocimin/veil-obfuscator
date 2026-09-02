import * as walk from "acorn-walk";
import { parse } from "../parse.js";
import { Identifier, StringLiteral, ArrayExpression } from "../ast.js";

let rpcSeq = 0;

/**
 * Tier C: the server owns the actual logic. Any top-level call to the function
 * named by `opts.tierC.fn` is replaced with an attested RPC to the server
 * (`POST <endpoint> { fn, args, probeHash, fingerprint }`), and the function's
 * own body/logic is NOT shipped. A dump of the bundle reveals only the RPC shell
 * + a browser probe — never the decision, flag, or secret.
 */
export function applyTierC(program, opts) {
  const { fn, endpoint } = opts.tierC;
  const rpcName = "_vxrpc" + ((Math.random() * 0xffffff) | 0).toString(16) + (rpcSeq++);

  // Replace `fn(...)` calls with `rpcName("fn", [ ...args ])`.
  walk.ancestor(program, {
    CallExpression(node) {
      if (node.callee?.type === "Identifier" && node.callee.name === fn) {
        const args = node.arguments;
        node.callee = Identifier(rpcName);
        node.arguments = [StringLiteral(fn), ArrayExpression(args.map((a) => a))];
      }
    },
  });

  // Remove the sensitive definition entirely — its logic must NOT ship. The
  // server (RPC[fn]) is the only place that logic exists now.
  const toRemove = new Set();
  walk.ancestor(program, {
    FunctionDeclaration(node, ancestors) {
      if (node.id?.name === fn) {
        const parent = ancestors[ancestors.length - 2];
        if (parent && Array.isArray(parent.body)) toRemove.add(node);
      }
    },
    VariableDeclaration(node, ancestors) {
      const hits = node.declarations.filter(
        (d) => d.id?.name === fn && d.init && (d.init.type === "FunctionExpression" || d.init.type === "ArrowFunctionExpression"),
      );
      if (hits.length === node.declarations.length) {
        const parent = ancestors[ancestors.length - 2];
        if (parent && Array.isArray(parent.body)) toRemove.add(node);
      }
    },
  });
  for (const node of toRemove) {
    const parent = program.body.includes(node) ? program : node.parent;
    if (parent && Array.isArray(parent.body)) parent.body = parent.body.filter((s) => s !== node);
  }

  // Attested RPC runtime: build a real-browser probe, POST it with the call, and
  // use the server's decision. This whole shell is OBFUSCATED like the rest of
  // the bundle, but contains no sensitive logic.
  const cc = (s) => JSON.stringify(s).replace(/"/g, "");
  const probeSrc = buildProbeSource();
  const runtime = `
function ${rpcName}(_fn, _a){
  var out;
  try {
    var F = ${probeSrc};
    var X = new XMLHttpRequest();
    X.open("POST", ${JSON.stringify(endpoint)}, false);
    X.setRequestHeader("Content-Type","application/json");
    X.send(JSON.stringify({ fn: _fn, args: _a, probeHash: F, fingerprint: "" }));
    out = JSON.parse(X.responseText).result;
  } catch (e) { out = null; }
  return out;
}
`;

  const ast = parse(runtime, { target: "script" });
  program.body = [...ast.body, ...program.body];
  return program;
}

// Reuse the hidden char-code browser probe used by the loaders. Every string is
// built from a char-code array (__p(...)) so no literal host/typeof token ships.
function buildProbeSource() {
  const cc = (s) => "[" + [...s].map((c) => c.charCodeAt(0)).join(",") + "]";
  const F = (s) => `__p(${cc(s)})`;
  return `(function(){var G=globalThis;function H(a){return G[String.fromCharCode.apply(null,a)];}function __p(x){return String.fromCharCode.apply(null,x);}return [
    (function(){try{return (H(${cc("document")})||({})).nodeType&0xff}catch(e){return 0}})(),
    (function(){try{return (H(${cc("document")}).documentElement&&H(${cc("document")}).documentElement.nodeType)&0xff}catch(e){return 0}})(),
    (function(){try{return (typeof H(${cc("MutationObserver")})===${F("function")}&&typeof H(${cc("IntersectionObserver")})===${F("function")})?1:0}catch(e){return 0}})(),
    (function(){try{return (typeof H(${cc("window")})!==${F("undefined")}&&H(${cc("window")}).self===H(${cc("window")}))?1:0}catch(e){return 0}})(),
    (function(){try{return H(${cc("document")}).createElement&&H(${cc("document")}).createElement(${F("div")}).nodeType&0xff}catch(e){return 0}})(),
    (function(){try{return (typeof H(${cc("document")}).getElementById===${F("function")})?1:0}catch(e){return 0}})(),
    (function(){try{return (H(${cc("document")}).documentElement&&H(${cc("document")}).documentElement.tagName===${F("HTML")})?1:0}catch(e){return 0}})(),
    (function(){try{return (typeof H(${cc("navigator")})===${F("object")}&&typeof H(${cc("navigator")}).userAgent===${F("string")})?1:0}catch(e){return 0}})(),
    (function(){try{return (H(${cc("document")}).createElement&&H(${cc("document")}).createElement(${F("canvas")}).getContext&&typeof H(${cc("WebGLRenderingContext")})===${F("function")})?1:0}catch(e){return 0}})(),
    (function(){try{return (typeof H(${cc("window")}).devicePixelRatio===${F("number")}&&H(${cc("window")}).devicePixelRatio>0)?1:0}catch(e){return 0}})(),
    (function(){try{return (typeof H(${cc("screen")})===${F("object")}&&H(${cc("screen")})!==null)?1:0}catch(e){return 0}})(),
    (function(){try{return (typeof H(${cc("document")}).querySelector===${F("function")})?1:0}catch(e){return 0}})()
  ];})()`;
}
