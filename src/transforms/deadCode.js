import * as walk from "acorn-walk";
import { parse } from "../parse.js";
import {
  StringLiteral,
  Identifier,
  NumberLiteral,
  VariableDeclaration,
  VariableDeclarator,
  IfStatement,
  BinaryExpression,
  ExpressionStatement,
  ForStatement,
  BlockStatement,
  AssignmentExpression,
} from "../ast.js";

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
// The mix deliberately includes self-referential / Function-built / array-join
// identities that a constant-folder that only folds literal arithmetic misses,
// plus a few that a `parseInt('0xFFFF',16)`-style folder DOES get (cheap
// decoys). Every literal is re-encoded by the string-array pass afterwards, so
// the predicates become part of the decode graph, not standalone strings.
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
  "(function(){ return 1; })() === 1",
  "Function('return true')() === true",
  "['v','e','i','l'].join('') === 'veil'",
  "(1).constructor === Number && (true).constructor === Boolean",
  "parseInt('0xFFFF',16) === 65535",
  "String(123) === '123' && Number('42') === 42",
  "isNaN(NaN) === true && isFinite(1) === true",
  "Math.floor(4.9) + Math.ceil(4.1) === 9",
].map((s) => parse(s, { target: "script" }).body[0].expression);

function deadStatement() {
  const probe = randName();
  const ctrl = randName();
  const preds = OPAQUE_PREDICATES();
  const pred = preds[(Math.random() * preds.length) | 0];
  // A single-iteration `for (c=0; c===0; c=1){ if(pred){ ...no-op... } }`. The
  // loop shape (rather than a bare `if(const)`) defeats the most common
  // pattern-match that removes dead `if` blocks, while staying side-effect free.
  return BlockStatement([
    ForStatement(
      VariableDeclaration("var", [VariableDeclarator(Identifier(ctrl), NumberLiteral(0))]),
      BinaryExpression("===", Identifier(ctrl), NumberLiteral(0)),
      AssignmentExpression("=", Identifier(ctrl), NumberLiteral(1)),
      BlockStatement([
        IfStatement(pred, BlockStatement([
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
        ])),
      ]),
    ),
  ]);
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
