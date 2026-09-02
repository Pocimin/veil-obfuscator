import * as walk from "acorn-walk";
import { parse } from "../parse.js";
import { Identifier, NumberLiteral } from "../ast.js";
import { freshName } from "./names.js";

// Globals we resolve at runtime. Only these are routed; anything declared
// locally, or any property/member/label identifier, is left untouched.
const GLOBALS = new Set([
  "console", "window", "document", "globalThis", "process", "Buffer", "require",
  "sessionStorage", "localStorage", "Storage", "performance", "navigator",
  "location", "location", "alert", "setTimeout", "setInterval", "queueMicrotask",
  "Math", "JSON", "Object", "Array", "String", "Number", "Boolean", "Date",
  "RegExp", "Promise", "Symbol", "Error", "Map", "Set", "WeakMap", "WeakSet",
  "parseInt", "parseFloat", "isNaN", "isFinite", "decodeURIComponent",
  "encodeURIComponent", "decodeURI", "encodeURI", "setImmediate", "clearTimeout",
  "clearInterval", "Function", "eval", "Proxy", "Reflect", "WeakRef",
]);

let addr = 0;

function randName() {
  return freshName();
}

/**
 * Rewrite free references to known globals into calls through a numeric-address
 * resolver. The resolver returns the global from `globalThis["name"]` (the
 * "name" strings are re-encoded by the later string-array pass, so no literal
 * identifier like `console` survives for a grep).
 */
export function applyGlobalResolver(program, opts) {
  if (!opts.globalResolver) return program;

  // 1. Collect every declared local name so we never route a shadowed global.
  const declared = new Set();
  walk.full(program, (node) => {
    if (node.type === "VariableDeclarator" && node.id && node.id.type === "Identifier") declared.add(node.id.name);
    else if ((node.type === "FunctionDeclaration" || node.type === "FunctionExpression") && node.id) declared.add(node.id.name);
    else if (node.type === "CatchClause" && node.param && node.param.type === "Identifier") declared.add(node.param.name);
    else if ((node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") && node.params) {
      for (const p of node.params) if (p.type === "Identifier") declared.add(p.name);
    }
  });

  // 2. Find the globals actually referenced + their reference nodes.
  const used = new Map(); // name -> addr
  const refs = [];

  walk.ancestor(program, {
    Identifier(node, ancestors) {
      const parent = ancestors[ancestors.length - 2];
      // skip keys / member props / labels / declaration slots
      if (parent) {
        if (parent.type === "Property" && !parent.computed && parent.key === node) return;
        if (parent.type === "MemberExpression" && !parent.computed && parent.property === node) return;
        if (parent.type === "MethodDefinition" && !parent.computed && parent.key === node) return;
        if ((parent.type === "LabeledStatement" || parent.type === "BreakStatement" || parent.type === "ContinueStatement") && parent.label === node) return;
        if (parent.type === "VariableDeclarator" && parent.id === node) return;
        if ((parent.type === "FunctionDeclaration" || parent.type === "FunctionExpression") && parent.id === node) return;
        if ((parent.type === "FunctionDeclaration" || parent.type === "FunctionExpression" || parent.type === "ArrowFunctionExpression") && (parent.params || []).includes(node)) return;
        if (parent.type === "CatchClause" && parent.param === node) return;
      }
      if (!GLOBALS.has(node.name)) return;
      if (declared.has(node.name)) return;
      if (!used.has(node.name)) used.set(node.name, used.size);
      refs.push({ node, name: node.name });
    },
  });

  if (used.size === 0) return program;

  const resolver = randName();
  const root = randName();

  // Build the resolver switch. Keys are string literals so the string-array
  // pass encodes them; there is no literal global identifier in the output.
  const cases = [...used.entries()]
    .map(([name, i]) => `      case 0x${i.toString(16)}: return ${root}[${JSON.stringify(name)}];`)
    .join("\n");

  // Rest-args + .length spoofing on the resolver itself: tooling that keys off
  // Function.length or arity heuristics gets a deliberately wrong value, and the
  // params are hidden behind a rest/arguments indirection.
  const sig = opts.lengthSpoofing ? "(..._a)" : "(_a)";
  const addr = opts.lengthSpoofing ? "_a[0]" : "_a";
  const lengthSpoof = opts.lengthSpoofing
    ? `
Object.defineProperty(${resolver}, "length", { value: 0x${((Math.random() * 0x1f) | 0 + 1).toString(16)}, writable: false, configurable: true });
`
    : "";

  const resolverSource = `
function ${resolver}${sig}{
  var ${root} = globalThis;
  switch (${addr}){
${cases}
    default: return void 0;
  }
}
${lengthSpoof}`;

  const ast = parse(resolverSource, { target: "script" });
  program.body = [...ast.body, ...program.body];

  // Replace each reference Identifier node with `resolver(addr)`.
  for (const { node, name } of refs) {
    const a = used.get(name);
    node.type = "CallExpression";
    node.callee = Identifier(resolver);
    node.arguments = [NumberLiteral(a)];
    delete node.name;
  }

  return program;
}
