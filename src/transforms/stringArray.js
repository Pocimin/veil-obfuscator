import { parse } from "../parse.js";
import * as walk from "acorn-walk";
import { encodeString, runtimeDecoderSource, base64Encode } from "./rc4.js";
import {
  encodeStringsChained,
  chainedLoaderSource,
  serverDecodeLoaderSource,
  lzwCompress,
  rotationFor,
  deriveKey,
  obfuscateIndex,
} from "./chainedString.js";
import { Identifier } from "../ast.js";
import { freshName } from "./names.js";

const HEX_NAMES = "abcdef0123456789";
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
let uid = 0;

function randName() { return freshName(); }

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

  const n = pool.size;
  const fnName = randName();
  const arrayName = randName();
  const encoderOpts = opts.stringArrayEncoding.length
    ? opts.stringArrayEncoding
    : ["base64"];

  const useChain = !!opts.stringArrayChain;

  // Runtime-rotation + pool-derived key. Both loader and (for chain mode) the
  // encoder share the same deterministic derivation, so no key literal ships.
  const R = rotationFor(n);
  const key = deriveKey(n, R);

  const raw = useChain
    ? encodeStringsChained([...pool.keys()], encoderOpts, key)
    : [...pool.keys()].map((s) => encodeString(s, encoderOpts, key));

  const decoderSource = opts.serverDecode
    ? serverDecodeLoaderSource({
        arrayName,
        fnName,
        url: opts.serverDecode,
        wrappers: opts.stringArrayWrappersCount ?? 3,
      })
    : useChain
    ? chainedLoaderSource({
        arrayName,
        fnName,
        encodings: encoderOpts,
        raw,
        gate: opts.stringArrayGate,
        gateFail: opts.stringArrayGateFail,
        lzw: opts.stringArrayLzw ? base64Encode(lzwCompress(JSON.stringify(raw))) : null,
        wrappers: opts.stringArrayWrappersCount ?? 3,
        hostGate: opts.hostGate,
      })
    : runtimeDecoderSource({
        arrayName,
        fnName,
        encodings: encoderOpts,
        key,
        perm: [...Array(n).keys()],
        magic: 0,
        raw,
        gate: opts.stringArrayGate,
      });

  const decoderAst = parse(decoderSource, { target: "script" });

  // Prepend the decoder statements to the program body.
  program.body = [...decoderAst.body, ...program.body];
  uid++;

  // Replace string literals with resolver calls passing an OBFUSCATED index
  // expression (evaluates to the logical index; not a bare literal).
  for (const { node, index } of replacements) {
    node.type = "CallExpression";
    node.callee = Identifier(fnName);
    node.arguments = [parse(obfuscateIndex(index), { target: "script" }).body[0].expression];
    delete node.value;
    delete node.raw;
    delete node.parent;
  }

  return program;
}
