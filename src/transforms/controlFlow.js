import * as walk from "acorn-walk";
import { NumberLiteral, Identifier, VariableDeclaration, VariableDeclarator, BreakStatement } from "../ast.js";

// Statement types that can be safely moved into a switch-case dispatcher
// without changing scope or control flow.
const SAFE_TYPES = new Set([
  "ExpressionStatement",
  "ReturnStatement",
  "ThrowStatement",
  "EmptyStatement",
  "DebuggerStatement",
  "BlockStatement",
  "IfStatement",
  "SwitchStatement",
  "ForStatement",
  "WhileStatement",
  "DoWhileStatement",
  "TryStatement",
]);

let uid = 0;

function randName() {
  return "_0x" + ((Math.random() * 0xffffff) | 0).toString(16);
}

function isLinear(body) {
  if (!body || body.length < 2) return false;
  for (const stmt of body) {
    if (!SAFE_TYPES.has(stmt.type)) return false;
    if (stmt.type === "VariableDeclaration" && stmt.kind !== "var") return false;
  }
  return true;
}

function number(n) {
  return NumberLiteral(n);
}

const OPAQUE_SEED = 0xdead;

// A runtime-true opaque predicate shared by every flattened dispatcher in a
// program. It must stay truthy; folding it to false sends every case to the
// default break (wrong result), so a deobfuscator must *understand* it rather
// than delete it.
let opqName = null;
function opaquePredicateNode() {
  return {
    type: "CallExpression",
    callee: Identifier(opqName),
    arguments: [],
    optional: false,
  };
}

function injectOpaquePredicate(program) {
  if (!opqName) opqName = randName();
  // typeof is a unary operator: build typeof Date === 'function'.
  const typeofCheck = {
    type: "BinaryExpression",
    operator: "===",
    left: {
      type: "UnaryExpression",
      operator: "typeof",
      prefix: true,
      argument: Identifier("Date"),
    },
    right: { type: "Literal", value: "function", raw: "'function'" },
  };
  const decl = {
    type: "FunctionDeclaration",
    id: Identifier(opqName),
    params: [],
    body: {
      type: "BlockStatement",
      body: [
        { type: "ReturnStatement", argument: {
          type: "ConditionalExpression",
          test: typeofCheck,
          consequent: { type: "Literal", value: 1, raw: "0x1" },
          alternate: { type: "Literal", value: 1, raw: "0x1" },
        } },
      ],
    },
    generator: false,
    async: false,
  };
  program.body.unshift(decl);
}

/**
 * Flatten linear function bodies into a jump-table dispatcher.
 * Only rewrites functions with a flat body to guarantee identical behavior.
 */
export function applyControlFlow(program, opts) {
  if (opts.opaquePredicates) injectOpaquePredicate(program);
  walk.ancestor(program, {
    FunctionDeclaration(node) {
      flattenIfNeeded(node, opts);
    },
    FunctionExpression(node) {
      flattenIfNeeded(node, opts);
    },
    ArrowFunctionExpression(node) {
      flattenIfNeeded(node, opts);
    },
  });
  return program;
}

function flattenIfNeeded(fn, opts) {
  if (fn.body.type !== "BlockStatement") return;
  if (Math.random() > (opts.controlFlowFlattening ?? 1)) return;
  if (!isLinear(fn.body.body)) return;

  const body = fn.body.body;
  const dispatch = randName();
  const label = randName();
  const useOpaque = !!opts.opaquePredicates;

  const nextState = (n) =>
    useOpaque
      ? {
          type: "BinaryExpression",
          operator: "^",
          left: number(n),
          right: {
            type: "ConditionalExpression",
            test: opaquePredicateNode(),
            consequent: { type: "Literal", value: 0, raw: "0x0" },
            alternate: { type: "Literal", value: OPAQUE_SEED, raw: "0xdead" },
          },
        }
      : number(n);

  const cases = body.map((stmt, i) => ({
    type: "SwitchCase",
    test: number(i),
    consequent: [
      stmt,
      {
        type: "ExpressionStatement",
        expression: {
          type: "AssignmentExpression",
          operator: "=",
          left: Identifier(dispatch),
          right: nextState(i + 1),
        },
      },
      BreakStatement(),
    ],
  }));

  // Exit case: when the dispatch reaches the final index we break the loop.
  cases.push({
    type: "SwitchCase",
    test: number(body.length),
    consequent: [BreakStatement(label)],
  });
  cases.push({ type: "SwitchCase", test: null, consequent: [BreakStatement(label)] });

  const switchNode = {
    type: "SwitchStatement",
    discriminant: Identifier(dispatch),
    cases,
  };

  const forNode = {
    type: "ForStatement",
    init: VariableDeclaration("var", [
      VariableDeclarator(Identifier(dispatch), number(0)),
    ]),
    test: null,
    update: null,
    body: switchNode,
  };

  const labeled = {
    type: "LabeledStatement",
    label: Identifier(label),
    body: forNode,
  };

  fn.body = { type: "BlockStatement", body: [labeled] };
}
