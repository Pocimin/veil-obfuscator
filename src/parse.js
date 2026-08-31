import * as acorn from "acorn";
import * as walk from "acorn-walk";
import { generate as astringGenerate } from "astring";

/** Parse source into a Program AST with source locations stripped for output. */
export function parse(source, opts = {}) {
  return acorn.parse(source, {
    ecmaVersion: "latest",
    sourceType: opts.target === "node" ? "script" : "module",
    allowHashBang: true,
    locations: false,
  });
}

/** AST -> source string. */
export function generate(ast, opts = {}) {
  return astringGenerate(ast, {
    comments: true,
    ...opts,
  });
}

/** The getter for `astring` sees a tree of plain objects; we wrap Program. */
export { walk };

/** Build a fresh, detached AST node factory using acorn's stdlib. */
export function node(type, ...extra) {
  throw new Error(
    "Use acorn nodes directly; see src/ast.js for the zero-dependency builder.",
  );
}
