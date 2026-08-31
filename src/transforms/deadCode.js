import * as walk from "acorn-walk";
import { StringLiteral, Identifier, VariableDeclaration, VariableDeclarator, IfStatement, BinaryExpression, ExpressionStatement, CallExpression } from "../ast.js";

let uid = 0;

function randName() {
  return "_0xdead" + ((Math.random() * 0xffffff) | 0).toString(16);
}

function lit(n) {
  return { type: "Literal", value: n, raw: String(n) };
}

// A self-contained block that never executes: declares a guard var, then an
// impossible `if` whose body would throw (but never runs). Safe by construction.
function deadStatement() {
  const name = randName();
  const fresh = randName();
  const guard = "veil-" + Math.random().toString(36).slice(2);
  return {
    type: "BlockStatement",
    body: [
      VariableDeclaration("var", [
        VariableDeclarator(Identifier(name), StringLiteral(guard)),
      ]),
      IfStatement(
        BinaryExpression("===", Identifier(name), StringLiteral(randName() + randName())),
        {
          type: "BlockStatement",
          body: [ExpressionStatement(CallExpression(Identifier(fresh), []))],
        },
      ),
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
