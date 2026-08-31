import * as walk from "acorn-walk";
import { parse } from "../parse.js";
import { StringLiteral, Identifier, VariableDeclaration, VariableDeclarator, IfStatement, BinaryExpression, ExpressionStatement } from "../ast.js";

let uid = 0;

function randName() {
  return "_0xdead" + ((Math.random() * 0xffffff) | 0).toString(16);
}

function lit(n) {
  return { type: "Literal", value: n, raw: String(n) };
}

// Opaque predicates that a naive `if (literal === literal)` pruner can't strip,
// but which are guaranteed truthy at runtime in Node *and* browsers, so the
// enclosed block always executes harmlessly. A strong decompiler can still fold
// them — that's the accepted ceiling for this class of tool.
//
// IMPORTANT: parsed FRESH on every call. The string-array pass rewrites the
// string literals inside these predicate nodes in place (to resolver calls), so
// a module-level cached AST would be mutated across obfuscate() calls and leak
// stale resolver names (undefined _0x... references) into later outputs.
const OPAQUE_PREDICATES = () => [
  "typeof Date.now === 'function'",
  "typeof Math.max === 'function'",
  "(Array.isArray([])===true && typeof []==='object')",
  "void 0 === void 0",
  "typeof parseInt === 'function' && parseInt('0x10',16)===16",
].map((s) => parse(s, { target: "script" }).body[0].expression);

function deadStatement() {
  const probe = randName();
  const preds = OPAQUE_PREDICATES();
  const pred = preds[(Math.random() * preds.length) | 0];
  return {
    type: "BlockStatement",
    body: [
      IfStatement(pred, {
        type: "BlockStatement",
        body: [
          VariableDeclaration("var", [
            VariableDeclarator(Identifier(probe), StringLiteral("veil-" + Math.random().toString(36).slice(2))),
          ]),
          ExpressionStatement(
            BinaryExpression(
              "+",
              Identifier(probe),
              { type: "Literal", value: "", raw: "''" },
            ),
          ),
        ],
      }),
    ],
  };
}

function injectInto(body, opts) {
  const out = [];
  for (const stmt of body) {
    out.push(stmt);
    if (Math.random() < (opts.deadCodeInjection ?? 0)) {
      const n = 1 + ((Math.random() * 2) | 0);
      for (let i = 0; i < n; i++) out.push(deadStatement());
    }
  }
  return out;
}

export function applyDeadCode(program, opts) {
  walk.ancestor(program, {
    BlockStatement(node) {
      if (Math.random() > (opts.deadCodeInjection ?? 1)) return;
      // Avoid double-processing function-expression bodies unless simple.
      if (node.body.length === 0) return;
      node.body = injectInto(node.body, opts);
    },
  });
  return program;
}
