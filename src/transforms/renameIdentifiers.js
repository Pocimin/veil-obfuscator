import * as walk from "acorn-walk";

/**
 * Scope-aware identifier renaming.
 *
 * Renames user-declared bindings (var/let/const, functions + params, arrow
 * params, catch params) to short mangled names, preserving lexical scope.
 * Undeclared globals (document, Storage, console) and non-computed property
 * keys / member properties / labels are left untouched unless
 * `renameGlobals` is true.
 */

let counter = 0;

function newName(mode) {
  if (mode === "mangled") {
    const letters = "abcdefghijklmnopqrstuvwxyz";
    let n = "", c = counter++ % (27 * 27);
    do { n += letters[c % 26]; c = (c / 26) | 0; } while (c > 0);
    return "$_" + n;
  }
  return "_0x" + (((Math.random() * 0x7fffffff) | 0).toString(16)).padStart(6, "0");
}

const SCOPE_NODES = new Set([
  "Program", "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression",
  "BlockStatement", "ForStatement", "ForInStatement", "ForOfStatement",
  "SwitchStatement", "CatchClause",
]);

function isScopeNode(t) { return SCOPE_NODES.has(t); }

// Node shapes whose named child is a non-renamable key/property/label.
// We use these to decide whether an identifier is a "key" position.
function isKeyPosition(parent, node) {
  if (!parent) return false;
  switch (parent.type) {
    case "Property":
      return !parent.computed && parent.key === node;
    case "MemberExpression":
      return !parent.computed && parent.property === node;
    case "MethodDefinition":
      return !parent.computed && parent.key === node;
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return parent.label === node;
    default:
      return false;
  }
}

// Declare a binding at the right scope (var/functions hoist to fn scope).
function declareAt(bindings, scope, name, declNode) {
  let target = scope;
  const fresh = newName(scope.mode);
  bindings.set(scope, bindings.get(scope) || new Map());
  bindings.get(scope).set(name, fresh);
  return fresh;
}

/**
 * Build scope info + a list of declaration sites. `bindings` maps a scope to
 * a {name -> newName}. `declSites` lists {node, newName} for declaration ids.
 */
function buildScopes(program, mode) {
  const scopeOf = new Map();
  const declSites = [];

  function mk(node, parent) {
    const s = {
      node, parent, mode,
      map: new Map(),
    };
    // A function is its own var-hoisting target; blocks/frames inherit it.
    s.fnScope = isFn(node) ? s : (parent ? parent.fnScope : null);
    scopeOf.set(node, s);
    if (parent) { parent.children = parent.children || []; parent.children.push(s); }
    return s;
  }
  function isFn(node) {
    return node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression";
  }

  const root = mk(program, null);
  root.fnScope = root;

  function declare(scope, name, declNode) {
    if (!scope.map.has(name)) scope.map.set(name, newName(mode));
    declSites.push({ node: declNode, newName: scope.map.get(name) });
  }

  // Single recursive pass: create scopes and record declarations.
  function walk(node, scope) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach((c) => walk(c, scope)); return; }
    if (!node.type) return;

    let cur = scope;

    if (isScopeNode(node.type)) {
      cur = mk(node, scope);

      if (isFn(node)) {
        // Function name binds in the enclosing scope; params in the fn scope.
        if (node.id && node.id.type === "Identifier") declare(scope, node.id.name, node.id);
        for (const p of (node.params || [])) {
          if (p.type === "Identifier") declare(cur, p.name, p);
        }
      } else if (node.type === "CatchClause") {
        if (node.param && node.param.type === "Identifier") declare(cur, node.param.name, node.param);
      }
    }

    if (node.type === "VariableDeclaration") {
      for (const d of node.declarations) {
        if (d.id && d.id.type === "Identifier") {
          const target = node.kind === "var" ? (cur.fnScope || cur) : cur;
          if (!target.map.has(d.id.name)) target.map.set(d.id.name, newName(mode));
          declSites.push({ node: d.id, newName: target.map.get(d.id.name) });
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range" || key === "parent") continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (const c of val) if (c && c.type) walk(c, cur);
      } else if (val && val.type) walk(val, cur);
    }
  }

  walk(program, root);
  return { scopeOf, declSites };
}

export function applyRenameIdentifiers(program, opts) {
  const mode = opts.identifierNamesGenerator === "mangled" ? "mangled" : "hexadecimal";
  const renameGlobals = !!opts.renameGlobals;
  if (opts.renameGlobals) {
    throw new Error("veil: renameGlobals is not yet supported; keep it false.");
  }

  const { scopeOf, declSites } = buildScopes(program, mode);

  // Apply declaration-site renames.
  for (const { node, newName } of declSites) node.name = newName;

  // Resolve references via ancestor walk (so we can skip key positions).
  walk.ancestor(program, {
    Identifier(node, ancestors) {
      const parent = ancestors[ancestors.length - 2];
      if (isKeyPosition(parent, node)) return;
      // skip the declaration slots we already renamed — they are identifiers too
      for (const s of ancestors) {
        if (
          s && s.type === "VariableDeclarator" && s.id === node ||
          s && ((s.type === "FunctionDeclaration" || s.type === "FunctionExpression" || s.type === "ArrowFunctionExpression") && s.id === node) ||
          s && (s.type === "CatchClause" && s.param === node) ||
          s && ((s.type === "FunctionDeclaration" || s.type === "FunctionExpression" || s.type === "ArrowFunctionExpression") && (s.params || []).includes(node))
        ) return;
      }
      // Resolve up the scope chain from the nearest enclosing scope node.
      let s = null;
      for (let i = ancestors.length - 1; i >= 0; i--) {
        const sc = scopeOf.get(ancestors[i]);
        if (sc) { s = sc; break; }
      }
      while (s) {
        if (s.map.has(node.name)) { node.name = s.map.get(node.name); break; }
        s = s.parent;
      }
    },
  });

  return program;
}

export default applyRenameIdentifiers;
