import * as walk from "acorn-walk";
import { UnaryExpression } from "../ast.js";

/**
 * Cosmetic hardening (#8, safe subset):
 *   - `undefined` -> `void 0`
 *   - boolean literals -> `!0x1` / `!0x0`
 * These hide boolean constants and the `undefined` token behind arithmetic
 * that naive dumpers/evaluators still fold but which is no longer greppable.
 */
export function applyCosmetic(program, opts) {
  if (!opts.cosmetic) return program;

  walk.full(program, (node) => {
    if (node.type === "Identifier" && node.name === "undefined") {
      // Replace the identifier node in place with `void 0`.
      node.type = "UnaryExpression";
      node.operator = "void";
      node.prefix = true;
      node.argument = { type: "Literal", value: 0, raw: "0x0" };
      delete node.name;
    } else if (node.type === "Literal" && typeof node.value === "boolean") {
      // true -> !0x1 ; false -> !0x0
      const inner = node.value ? 1 : 0;
      node.type = "UnaryExpression";
      node.operator = "!";
      node.prefix = true;
      node.argument = { type: "Literal", value: inner, raw: "0x" + inner.toString(16) };
      delete node.value;
      delete node.raw;
    }
  });

  return program;
}
