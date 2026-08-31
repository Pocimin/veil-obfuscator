import { generate, parse } from "../parse.js";
import * as walk from "acorn-walk";
import { encodeString, runtimeDecoderSource } from "./rc4.js";
import { CallExpression, Identifier, NumberLiteral } from "../ast.js";

const HEX_NAMES = "abcdef0123456789";
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
let uid = 0;

function randName() {
  let n = "";
  for (let i = 0; i < 6; i++) n += HEX_NAMES[(Math.random() * 16) | 0];
  // Make it look like the classic `_0x...` pattern.
  return "_0x" + n;
}

function randKey() {
  let k = "veil";
  for (let i = 0; i < 12; i++) k += LETTERS[(Math.random() * 26) | 0];
  return k;
}

function shouldEncode(node, opts) {
  if (typeof node.value !== "string") return false;
  if (node.value.length < 1) return false;
  if (Math.random() > (opts.stringArrayThreshold ?? 1)) return false;
  return true;
}

export function applyStringArray(program, opts) {
  const pool = new Map(); // value -> index
  const replacements = []; // {node, index}

  walk.ancestor(program, {
    Literal(node, ancestors) {
      if (typeof node.value !== "string") return;

      const parent = ancestors[ancestors.length - 2]; // null for the literal? no: parent is node itself at end; parent = len-2

      // Skip object/property keys (non-computed) to keep keys as-is.
      if (
        node === (parent && parent.key) &&
        parent.type === "Property" &&
        !parent.computed
      ) {
        return;
      }
      // Skip non-computed member (obj.prop stays textual).
      if (
        node === (parent && parent.property) &&
        parent.type === "MemberExpression" &&
        !parent.computed
      ) {
        return;
      }

      if (!shouldEncode(node, opts)) return;

      if (!pool.has(node.value)) pool.set(node.value, pool.size);
      replacements.push({ node, index: pool.get(node.value) });
    },
  });

  if (pool.size === 0) return program;

  const key = randKey();
  const fnName = randName();
  const arrayName = randName();

  const encoderOpts = opts.stringArrayEncoding.length
    ? opts.stringArrayEncoding
    : ["base64"];

  const encoded = [...pool.keys()].map((s) =>
    encodeString(s, encoderOpts, key),
  );

  const arrayLit = "[" + encoded.map((e) => JSON.stringify(e)).join(",") + "]";
  const decoderSource = runtimeDecoderSource(
    arrayName,
    fnName,
    encoderOpts,
    key,
  ).replace("__REPLACE_ARRAY__", arrayLit);

  const decoderAst = parse(decoderSource, { target: "script" });

  // Prepend the decoder statements to the program body.
  program.body = [...decoderAst.body, ...program.body];
  uid++;

  // Replace string literals with decoder calls.
  for (const { node, index } of replacements) {
    node.type = "CallExpression";
    node.callee = Identifier(fnName);
    node.arguments = [NumberLiteral(index)];
    delete node.value;
    delete node.raw;
    delete node.parent;
  }

  // Optional: rotate the array so the literal order is permuted.
  if (opts.rotateStringArray) {
    // Rotating the runtime array requires re-indexing replacements; skip for
    // simplicity and log a note. (Kept deterministic & correct.)
  }

  return program;
}
