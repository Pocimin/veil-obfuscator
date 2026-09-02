import { rc4Encrypt, base64Encode } from "./rc4.js";
import { lzwCompress, lzwDecompressSource } from "./lzw.js";

export { lzwCompress };

/* ------------------------------------------------------------------ */
/* Build-time derived key (mirror of the runtime derivation).          */
/* The RC4 key is computed from the pool length and the rotation       */
/* amount — there is NO literal key shipped next to the cipher.        */
/* ------------------------------------------------------------------ */
const K_A = 31337, K_B = 9176, K_C = 4099, K_D = 0x5bd1e995;

export function rotationFor(n) {
  return (n * 0x9e37 + 0x123) % Math.max(1, n);
}

export function deriveKey(n, r) {
  const chars = [];
  for (let i = 0; i < 16; i++) chars.push((n * K_A + r * K_B + i * K_C + K_D) & 0xff);
  return String.fromCharCode(...chars);
}

const FNV_OFFSET = 0x811c9dc5;
function fnv1a(str) {
  let h = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function prgBytes(seed, len) {
  let s = (seed >>> 0) || 1;
  const out = [];
  for (let i = 0; i < len; i++) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; out.push(s & 255); }
  return out;
}
function xorString(str, bytes) {
  let o = "";
  for (let i = 0; i < str.length; i++) o += String.fromCharCode(str.charCodeAt(i) ^ bytes[i]);
  return o;
}

export function encodeStringsChained(strings, encodings, key) {
  let chain = FNV_OFFSET;
  const out = [];
  for (const s of strings) {
    let C = s;
    for (const enc of encodings) { if (enc === "base64") C = base64Encode(C); else if (enc === "rc4") C = rc4Encrypt(C, key); }
    const kb = prgBytes(chain, C.length);
    out.push(xorString(C, kb));
    chain = (chain ^ fnv1a(C)) >>> 0;
  }
  return out;
}

import { freshName } from "./names.js";
function nm(p) { return freshName(); }

/**
 * Emit the runtime loader for a chained array with:
 *   - runtime rotation (no static perm), pool-derived key, wrapper indirection.
 * `ctx`: arrayName, fnName, encodings, raw, gate, gateFail, lzw, wrappers.
 */
export function chainedLoaderSource(ctx) {
  const { arrayName, fnName, encodings, raw, gate, gateFail, lzw, wrappers, hostGate } = ctx;
  const N = raw.length;
  const R = rotationFor(N);

  const keyV = nm(1), poolV = nm(2), chainV = nm(3), boxV = nm(4), gateV = nm(5);
  const rotV = nm(6), fx = nm(7), probeV = nm(8);
  const rc = nm(9), b64 = nm(10), fnv = nm(11), prg = nm(12), lzwName = lzw ? nm(13) : "";

  // Host-gated, key-entangled decode. A `probe()` returns authentic browser
  // bytes (invariant across real browsers, absent in Node/emulators). The probe
  // is folded into the KEY bytes, not a boolean: `key[ i ] = base + (probe[i] ^
  // EXPECTED[i])`. In a real browser probe==EXPECTED so the key is correct; in
  // Node an LLM-emulator or a shim the XOR is non-zero -> wrong key -> garbage,
  // even if the shim makes every 'typeof' check "pass".
  // Deepened probe: beyond boolean typeof checks, sample invariants a shim
  // rarely fakes well — canvas/WebGL API presence, devicePixelRatio, screen,
  // querySelector. All are deterministic in a real browser, absent in Node.
  const EXPECTED = [9, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const expectedJson = JSON.stringify(EXPECTED);

  const probeSrc = hostGate
    ? `
  function ${probeV}(){
    var b = [0,0,0,0,0,0,0,0,0,0,0,0];
    try{ b[0] = document.nodeType & 0xff; }catch(e){}
    try{ b[1] = (document.documentElement && document.documentElement.nodeType) & 0xff; }catch(e){}
    try{ b[2] = (typeof MutationObserver === 'function' && typeof IntersectionObserver === 'function') ? 1 : 0; }catch(e){}
    try{ b[3] = (typeof window !== 'undefined' && window.self === window) ? 1 : 0; }catch(e){}
    try{ b[4] = document.createElement('div').nodeType & 0xff; }catch(e){}
    try{ b[5] = (typeof document.getElementById === 'function') ? 1 : 0; }catch(e){}
    try{ b[6] = (document.documentElement && document.documentElement.tagName === 'HTML') ? 1 : 0; }catch(e){}
    try{ b[7] = (typeof navigator === 'object' && typeof navigator.userAgent === 'string') ? 1 : 0; }catch(e){}
    try{ b[8] = (document.createElement('canvas').getContext && typeof WebGLRenderingContext === 'function') ? 1 : 0; }catch(e){}
    try{ b[9] = (typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0) ? 1 : 0; }catch(e){}
    try{ b[10] = (typeof screen === 'object' && screen !== null) ? 1 : 0; }catch(e){}
    try{ b[11] = (typeof document.querySelector === 'function') ? 1 : 0; }catch(e){}
    return b;
  }
  var ${probeV}E = ${expectedJson};
  var ${probeV}P = ${probeV}();`
    : "";

  const keyTerm = (i) =>
    hostGate && i < EXPECTED.length
      ? `(${poolV}.length * ${K_A} + ${rotV} * ${K_B} + ${i} * ${K_C} + ${K_D} + (${probeV}P[${i}] ^ ${probeV}E[${i}])) & 0xff`
      : `(${poolV}.length * ${K_A} + ${rotV} * ${K_B} + ${i} * ${K_C} + ${K_D}) & 0xff`;

  const rotDef = `
  var ${rotV} = (${poolV}.length * 0x9e37 + 0x123) % ${Math.max(1, N)};
  for (var r_ = 0; r_ < ${rotV}; r_++) ${poolV}.push(${poolV}.shift());
${probeSrc}`;

  const keySource = (() => {
    const parts = [];
    for (let i = 0; i < 16; i++) parts.push(keyTerm(i));
    return `
  var ${keyV} = String.fromCharCode(${parts.join(",")});`;
  })();

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

  const poolDef = lzw
    ? `${lzwDecompressSource(lzwName)}
  var ${poolV} = JSON.parse(${lzwName}(${b64}(${JSON.stringify(lzw)})));`
    : `  var ${poolV} = ${JSON.stringify(raw)};`;

  const gateDef = gate ? `  var ${gateV} = (function(){ return (${gate}); })();` : `  var ${gateV} = 1;`;

  // dx(i): logical index i, fetched through the rotated pool. Chain coupling is
  // by logical order, so pool[(k - R + N) % N] yields logical entry k.
  const dx = `
  function ${fx}(i){
    if (${boxV}[i] !== undefined) return ${boxV}[i];
    for (var k=0;k<=i;k++){
      if (${boxV}[k] !== undefined) continue;
      var w = ${poolV}[(k - ${rotV} + ${N}) % ${N}];
      var kb = ${prg}(${chainV}, w.length);
      var t=''; for(var m=0;m<w.length;m++) t+=String.fromCharCode(w.charCodeAt(m)^kb[m]);
      w=t;
      var c = w;
${decodeSteps}
      ${boxV}[k] = w;
      ${chainV} = ${chainV} ^ ${fnv}(c);
    }
    return ${boxV}[i];
  }`;

  const gatePrelude = gate
    ? `  if (!${gateV}) { for (var q=0;q<${N};q++) ${boxV}[q] = ${JSON.stringify(gateFail ?? "\u0000")}; }`
    : "";

  // The IIFE returns the real accessor; the wrappers + public accessor live
  // OUTSIDE the closure and call `arrayName(i)` (indirection so the getter
  // isn't one clean call into the loader).
  const wrapN = Math.max(1, wrappers || 3);
  const wrappersSrc = [];
  let inner = `${arrayName}(_i)`;
  for (let i = 0; i < wrapN - 1; i++) {
    const wn = nm(20 + i);
    wrappersSrc.push(`function ${wn}(_i){ return ${inner}; }`);
    inner = `${wn}(_i)`;
  }
  const accessor = `function ${fnName}(_i){ return ${inner}; }`;

  return `
var ${arrayName} = (function(){
${prims}
${poolDef}
${rotDef}
${keySource}
  function ${fnv}(s){ var h=0x811c9dc5; for(var i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193)>>>0; } return h>>>0; }
  function ${prg}(seed,len){ var s=seed>>>0||1; var o=[]; for(var i=0;i<len;i++){ s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;o.push(s&255); } return o; }
  var ${chainV} = 0x811c9dc5;
  var ${boxV} = [];
${gateDef}
${dx}
${gatePrelude}
  return function(_i){ ${gate ? `if (!${gateV}) return ${boxV}[0];` : ""} return ${fx}(_i); };
})();
${wrappersSrc.join("\n")}
${accessor}
`;
}

/**
 * Build an obfuscated index expression that evaluates to `i` but doesn't look
 * like a bare integer (jsfuscator-style `fn(0x1a & 0x1e)`).
 */
export function obfuscateIndex(i) {
  // Evaluates to `i`: (X ^ 0x5a) where X = i ^ 0x5a.
  const x = ((i ^ 0x5a) & 0xff).toString(16).padStart(2, "0");
  return `(0x${x} ^ 0x5a)`;
}

/**
 * Server round-trip loader. The bundle ships NO string pool and NO decoder —
 * the strings are fetched per-session from `url` and resolved at runtime. A
 * dump therefore has neither plaintext nor a working decoder; only the fetch
 * URL sits in the bundle. The server must gate/return the table per session.
 */
export function serverDecodeLoaderSource(ctx) {
  const { arrayName, fnName, url, wrappers } = ctx;
  const tv = nm(50), rv = nm(51);
  const wrapN = Math.max(1, wrappers || 3);

  const poolFetch = `
var ${arrayName} = (function(){
  var ${tv} = null;
  try {
    var ${rv} = new XMLHttpRequest();
    ${rv}.open("GET", ${JSON.stringify(url)} + "?sid=" + Math.random().toString(36).slice(2), false);
    ${rv}.send();
    ${tv} = JSON.parse(${rv}.responseText).table;
  } catch (e) { ${tv} = { table: [] }; }
  return function(_i){ return ${tv} ? ${tv}[_i] : ""; };
})();
`;
  let inner = `${arrayName}(_i)`;
  const wrappersSrc = [];
  for (let i = 0; i < wrapN - 1; i++) {
    const wn = nm(52 + i);
    wrappersSrc.push(`function ${wn}(_i){ return ${inner}; }`);
    inner = `${wn}(_i)`;
  }
  return `${poolFetch}\n${wrappersSrc.join("\n")}\nfunction ${fnName}(_i){ return ${inner}; }\n`;
}
