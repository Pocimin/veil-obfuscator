// Continuous-stateful ("chained") string-array encoding.
//
// This file is intentionally self-contained and does NOT modify rc4.js (the
// runtime loader there is managed separately). It reuses only the existing,
// stable build-time primitives (rc4Encrypt / base64Encode) and re-implements
// its own incremental keystream so the emitted loader is independent.
//
// Why chained:
//   - Nothing is decoded up front. The box starts empty and each entry is
//     resolved lazily on first access.
//   - Every decode consumes a running keystream (`chain`) and folds the
//     *ciphertext* back into it. Entry k therefore cannot be recovered without
//     walking 0..k in order, and dropping/reordering an entry corrupts every
//     later one.
//   - There is no single "round function" to reverse: recovery requires
//     executing the whole ordered chain, not reading a pre-decoded array.

import { rc4Encrypt, base64Encode } from "./rc4.js";
import { lzwCompress, lzwDecompressSource } from "./lzw.js";

export { lzwCompress };

const FNV_OFFSET = 0x811c9dc5;

function fnv1a(str) {
  let h = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function prgBytes(seed, len) {
  let s = (seed >>> 0) || 1;
  const out = [];
  for (let i = 0; i < len; i++) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    out.push(s & 255);
  }
  return out;
}

function xorString(str, bytes) {
  let o = "";
  for (let i = 0; i < str.length; i++) {
    o += String.fromCharCode(str.charCodeAt(i) ^ bytes[i]);
  }
  return o;
}

/**
 * Encode a list of plaintexts (logical order) into a chained, masked array.
 * Returns the stored strings in logical order; index recovery is deferred to
 * the runtime loader which owns the permutation + inverse mapping.
 */
export function encodeStringsChained(strings, encodings, key) {
  let chain = FNV_OFFSET;
  const out = [];
  for (const s of strings) {
    let C = s;
    for (const enc of encodings) {
      if (enc === "base64") C = base64Encode(C);
      else if (enc === "rc4") C = rc4Encrypt(C, key);
    }
    const kb = prgBytes(chain, C.length);
    out.push(xorString(C, kb));
    chain = (chain ^ fnv1a(C)) >>> 0;
  }
  return out;
}

/**
 * Emit the runtime loader for a chained array. `ctx` fields mirror those of
 * rc4.js's runtimeDecoderSource: arrayName, fnName, encodings, key, perm,
 * magic, raw, gate, gateFail. `raw` must be the output of encodeStringsChained
 * (masked ciphertext, logical order); `perm` is the baked storage permutation.
 */
export function chainedLoaderSource(ctx) {
  const {
    arrayName,
    fnName,
    encodings,
    key,
    perm,
    magic,
    raw,
    gate,
    gateFail,
  } = ctx;

  const keyCodes = [...key].map((c) => c.charCodeAt(0)).join(",");
  const rawJson = JSON.stringify(raw);
  const permJson = JSON.stringify(perm);
  const lzwDecName = ctx.lzw ? "_0x" + ((Math.random() * 0xffffff) | 0).toString(16) : "";

  // Decode steps applied to an individual element once unmasked. Built in
  // reverse of the encode order (base64/rc4 are each invertible).
  const rc = "_0x" + ((Math.random() * 0xffffff) | 0).toString(16);
  const b64 = "_0x" + ((Math.random() * 0xffffff) | 0).toString(16);
  const fnv = "_0x" + ((Math.random() * 0xffffff) | 0).toString(16);
  const prg = "_0x" + ((Math.random() * 0xffffff) | 0).toString(16);
  const keyV = "_0x" + ((Math.random() * 0xffffff) | 0).toString(16);
  const poolV = "_0x" + ((Math.random() * 0xffffff) | 0).toString(16);
  const permV = "_0x" + ((Math.random() * 0xffffff) | 0).toString(16);
  const invV = "_0x" + ((Math.random() * 0xffffff) | 0).toString(16);
  const chainV = "_0x" + ((Math.random() * 0xffffff) | 0).toString(16);
  const boxV = "_0x" + ((Math.random() * 0xffffff) | 0).toString(16);
  const gateV = "_0x" + ((Math.random() * 0xffffff) | 0).toString(16);

  const steps = [];
  for (const enc of [...encodings].reverse()) {
    if (enc === "base64") steps.push(`          w=${b64}(w);`);
    else if (enc === "rc4") steps.push(`          w=${rc}(w,${keyV});`);
  }
  const decodeSteps = steps.length ? steps.join("\n") : "";

  const prims = `
  function ${rc}(d, k){
    var s=[], j=0, a=0, b=0, o='';
    for(var i=0;i<256;i++) s[i]=i;
    for(i=0;i<256;i++){ j=(j+s[i]+k.charCodeAt(i%k.length))%256; var t=s[i]; s[i]=s[j]; s[j]=t; }
    for(i=0;i<d.length;i++){ a=(a+1)%256; b=(b+s[a])%256; var t2=s[a]; s[a]=s[b]; s[b]=t2;
      o+=String.fromCharCode(d.charCodeAt(i)^s[(s[a]+s[b])%256]); }
    return o;
  }
  function ${b64}(str){
    var C='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', b=0, bs=0, out=[];
    var clean=str.replace(/=+$/,'');
    for(var i=0;i<clean.length;i++){ var v=C.indexOf(clean[i]); if(v<0) continue;
      b=(b<<6)|v; bs+=6; if(bs>=8){ bs-=8; out.push((b>>bs)&255); } }
    return decodeURIComponent(escape(String.fromCharCode.apply(null,out)));
  }`;

  const gateDef = gate
    ? `  var ${gateV} = (function(){ return (${gate}); })();`
    : `  var ${gateV} = 1;`;

  const poolDef = ctx.lzw
    ? `${lzwDecompressSource(lzwDecName)}
  var ${poolV} = JSON.parse(${lzwDecName}(${JSON.stringify(ctx.lzw)}));`
    : `  var ${poolV} = ${rawJson};`;

  return `
var ${arrayName} = (function(){
  var ${keyV} = String.fromCharCode(${keyCodes});
${poolDef}
  var ${permV} = ${permJson};
${prims}
  function ${fnv}(s){ var h=0x811c9dc5; for(var i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193)>>>0; } return h>>>0; }
  function ${prg}(seed,len){ var s=seed>>>0||1; var o=[]; for(var i=0;i<len;i++){ s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;o.push(s&255); } return o; }
  var ${chainV} = 0x811c9dc5;
  var ${boxV} = [];
  var ${invV} = new Array(${permV}.length);
  for (var u=0;u<${permV}.length;u++) ${invV}[${permV}[u]] = u;
${gateDef}
  function dx(i){
    if (${boxV}[i] !== undefined) return ${boxV}[i];
    for (var k=0;k<=i;k++){
      if (${boxV}[k] !== undefined) continue;
      var w = ${poolV}[k];
      var kb = ${prg}(${chainV}, w.length);
      var t=''; for(var m=0;m<w.length;m++) t+=String.fromCharCode(w.charCodeAt(m)^kb[m]);
      w=t;
      var c = w;
${decodeSteps}
      ${boxV}[k] = w;
      ${chainV} = ${chainV} ^ ${fnv}(c);
    }
    return ${boxV}[i];
  }
  if (!${gateV}) { for (var q=0;q<${permV}.length;q++) ${boxV}[q] = ${JSON.stringify(gateFail ?? "\u0000")}; }
  return function(_i){
    if (!${gateV}) return ${boxV}[0];
    return dx(${invV}[_i ^ ${magic}]);
  };
})();
function ${fnName}(_i){ return ${arrayName}(_i); }
`;
}
