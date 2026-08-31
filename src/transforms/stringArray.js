import { parse } from "../parse.js";
import * as walk from "acorn-walk";
import { encodeString, runtimeDecoderSource } from "./rc4.js";
import { encodeStringsChained, chainedLoaderSource, lzwCompress } from "./chainedString.js";
import { Identifier, NumberLiteral } from "../ast.js";

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
  const magic = 3 + ((Math.random() * 0xff) | 0); // 3..257-ish, never 0

  // Baked permutation: box[perm[i]] = decoded(string i). Shuffle on every run
  // so the storage order never matches the logical order.
  const n = pool.size;
  const perm = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }

  const encoderOpts = opts.stringArrayEncoding.length
    ? opts.stringArrayEncoding
    : ["base64"];

  const raw = opts.stringArrayChain
    ? encodeStringsChained([...pool.keys()], encoderOpts, key)
    : [...pool.keys()].map((s) => encodeString(s, encoderOpts, key));

  const decoderSource = opts.stringArrayChain
    ? chainedLoaderSource({
        arrayName,
        fnName,
        encodings: encoderOpts,
        key,
        perm,
        magic,
        raw,
        gate: opts.stringArrayGate,
        gateFail: opts.stringArrayGateFail,
        lzw: opts.stringArrayLzw ? lzwCompress(JSON.stringify(raw)) : null,
      })
    : runtimeDecoderSource({
        arrayName,
        fnName,
        encodings: encoderOpts,
        key,
        perm,
        magic,
        raw,
        gate: opts.stringArrayGate,
      });

  const decoderAst = parse(decoderSource, { target: "script" });

  // Prepend the decoder statements to the program body.
  program.body = [...decoderAst.body, ...program.body];
  uid++;

  // Replace string literals with opaque resolver calls:
  //   fnName(perm[index] ^ magic)
  // The index is not resolvable statically without running the loader.
  for (const { node, index } of replacements) {
    const opaque = perm[index] ^ magic;
    node.type = "CallExpression";
    node.callee = Identifier(fnName);
    node.arguments = [NumberLiteral(opaque)];
    delete node.value;
    delete node.raw;
    delete node.parent;
  }

  return program;
}
