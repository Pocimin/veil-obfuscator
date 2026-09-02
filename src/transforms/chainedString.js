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

  // Host identifiers are hidden behind char-code globalThis lookups (no literal
  // document/window/navigator) and the probe is INLINED (a small helper `H` +
  // one guarded accessor `G`), so there is no recognizable `function(){ try{
  // document.nodeType } }` probe routine to spot.
  const H = nm(40);       // host lookup: H([char codes]) -> global, via G
  const G = nm(41);       // globalThis root
  const cc = (s) => "[" + [...s].map((c) => c.charCodeAt(0)).join(",") + "]";
  const host = (name) => `${H}(${cc(name)})`;

  const probeSrc = hostGate
    ? `
  var ${G} = globalThis;
  function ${H}(a){ return ${G}[String.fromCharCode.apply(null, a)]; }
  function __s(a){ return String.fromCharCode.apply(null, a); }
  var ${probeV} = [
    (function(){try{return (${host("document")}||{}).nodeType&0xff}catch(e){return 0}})(),
    (function(){try{return (${host("document")}.documentElement&&${host("document")}.documentElement.nodeType)&0xff}catch(e){return 0}})(),
    (function(){try{return (typeof ${host("MutationObserver")}===__s(102,117,110,99,116,105,111,110)&&typeof ${host("IntersectionObserver")}===__s(102,117,110,99,116,105,111,110))?1:0}catch(e){return 0}})(),
    (function(){try{return (typeof ${host("window")}!=='undefined'&&${host("window")}.self===${host("window")})?1:0}catch(e){return 0}})(),
    (function(){try{return ${host("document")}.createElement&&${host("document")}.createElement(__s(100,105,118)).nodeType&0xff}catch(e){return 0}})(),
    (function(){try{return (typeof ${host("document")}.getElementById===__s(102,117,110,99,116,105,111,110))?1:0}catch(e){return 0}})(),
    (function(){try{return (${host("document")}.documentElement&&${host("document")}.documentElement.tagName===__s(72,84,77,76))?1:0}catch(e){return 0}})(),
    (function(){try{return (typeof ${host("navigator")}===__s(111,98,106,101,99,116)&&typeof ${host("navigator")}.userAgent===__s(115,116,114,105,110,103))?1:0}catch(e){return 0}})(),
    (function(){try{return (${host("document")}.createElement&&${host("document")}.createElement(__s(99,97,110,118,97,115)).getContext&&typeof ${host("WebGLRenderingContext")}===__s(102,117,110,99,116,105,111,110))?1:0}catch(e){return 0}})(),
    (function(){try{return (typeof ${host("window")}.devicePixelRatio===__s(110,117,109,98,101,114)&&${host("window")}.devicePixelRatio>0)?1:0}catch(e){return 0}})(),
    (function(){try{return (typeof ${host("screen")}===__s(111,98,106,101,99,116)&&${host("screen")}!==null)?1:0}catch(e){return 0}})(),
    (function(){try{return (typeof ${host("document")}.querySelector===__s(102,117,110,99,116,105,111,110))?1:0}catch(e){return 0}})()
  ];
  var ${probeV}E = ${expectedJson};`
    : "";

  const keyTerm = (i) =>
    hostGate && i < EXPECTED.length
      ? `(${poolV}.length * ${K_A} + ${rotV} * ${K_B} + ${i} * ${K_C} + ${K_D} + (${probeV}[${i}] ^ ${probeV}E[${i}])) & 0xff`
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
  const { arrayName, fnName, url, wrappers, sid } = ctx;
  const tv = nm(50), rv = nm(51);
  const wrapN = Math.max(1, wrappers || 3);

  const poolFetch = `
var ${arrayName} = (function(){
  var ${tv} = null;
  try {
    var ${rv} = new XMLHttpRequest();
    ${rv}.open("GET", ${JSON.stringify(url)} + "?sid=" + ${JSON.stringify(sid)}, false);
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

/**
 * Tier A: ship the ENCRYPTED pool + a loader that fetches the decode KEY from
 * the server out-of-band. The bundle contains NO key and NO plaintext; the key
 * is only delivered after a server-validated one-time session (HMAC token +
 * server-side attestation). A static dump or shimmed browser gets nothing.
 */
export function serverKeyLoaderSource(ctx) {
  const { arrayName, fnName, encodings, raw, url, sid, wrappers, fingerprint } = ctx;
  const N = raw.length;
  const keyV = nm(1), poolV = nm(2), chainV = nm(3), boxV = nm(4);
  const fx = nm(5), rc = nm(6), b64 = nm(7), fnv = nm(8), prg = nm(9);
  const X = nm(10), T = nm(11), K = nm(12), F = nm(13), FP = nm(14), R = nm(15);

  const steps = [];
  for (const enc of [...encodings].reverse()) {
    if (enc === "base64") steps.push(`w=${b64}(w);`);
    else if (enc === "rc4") steps.push(`w=${rc}(w,${keyV});`);
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

  // Inline real-browser probe (hidden host lookups) to report for attestation.
  const cc = (s) => "[" + [...s].map((c) => c.charCodeAt(0)).join(",") + "]";
  const H = nm(16), G = nm(17);
  const h = (s) => `${H}(${cc(s)})`;
  const probeArr = `
  var ${G} = globalThis;
  function ${H}(a){ return ${G}[String.fromCharCode.apply(null,a)]; }
  function __s(a){ return String.fromCharCode.apply(null,a); }
  var ${F} = [
    (function(){try{return ((${h("document")}||{}).nodeType)&0xff}catch(e){return 0}})(),
    (function(){try{return ((${h("document")}.documentElement&&${h("document")}.documentElement.nodeType))&0xff}catch(e){return 0}})(),
    (function(){try{return (typeof ${h("MutationObserver")}===__s(102,117,110,99,116,105,111,110))?1:0}catch(e){return 0}})(),
    (function(){try{return (typeof ${h("window")}!=='undefined'&&${h("window")}.self===${h("window")})?1:0}catch(e){return 0}})(),
    (function(){try{return ${h("document")}.createElement&&${h("document")}.createElement(__s(100,105,118)).nodeType&0xff}catch(e){return 0}})(),
    (function(){try{return (typeof ${h("document")}.getElementById===__s(102,117,110,99,116,105,111,110))?1:0}catch(e){return 0}})(),
    (function(){try{return (${h("document")}.documentElement&&${h("document")}.documentElement.tagName===__s(72,84,77,76))?1:0}catch(e){return 0}})(),
    (function(){try{return (typeof ${h("navigator")}===__s(111,98,106,101,99,116)&&typeof ${h("navigator")}.userAgent===__s(115,116,114,105,110,103))?1:0}catch(e){return 0}})(),
    (function(){try{return (${h("document")}.createElement&&${h("document")}.createElement(__s(99,97,110,118,97,115)).getContext&&typeof ${h("WebGLRenderingContext")}===__s(102,117,110,99,116,105,111,110))?1:0}catch(e){return 0}})(),
    (function(){try{return (typeof ${h("window")}.devicePixelRatio===__s(110,117,109,98,101,114)&&${h("window")}.devicePixelRatio>0)?1:0}catch(e){return 0}})(),
    (function(){try{return (typeof ${h("screen")}===__s(111,98,106,101,99,116)&&${h("screen")}!==null)?1:0}catch(e){return 0}})(),
    (function(){try{return (typeof ${h("document")}.querySelector===__s(102,117,110,99,116,105,111,110))?1:0}catch(e){return 0}})()
  ];`;

  // Handshake: register the session, get a token, attest, receive the key once.
  const handshake = `
  var ${K} = null;
  try {
    var ${FP} = ${JSON.stringify(fingerprint || "veil-" + sid.slice(0, 6))};
    var ${X} = new XMLHttpRequest();
    ${X}.open("POST", ${JSON.stringify(url)} + "/api/session", false); ${X}.setRequestHeader("Content-Type","application/json");
    ${X}.send(JSON.stringify({ sid: ${JSON.stringify(sid)}, fingerprint: ${FP} }));
    var ${T} = JSON.parse(${X}.responseText);
    var ${X} = new XMLHttpRequest();
    ${X}.open("POST", ${JSON.stringify(url)} + "/api/key", false); ${X}.setRequestHeader("Content-Type","application/json");
    ${X}.send(JSON.stringify({ sid: ${T}.sid, nonce: ${T}.nonce, sig: ${T}.sig, fingerprint: ${FP}, probeHash: ${F} }));
    var ${R} = JSON.parse(${X}.responseText);
    ${K} = ${R}.key;
  } catch (e) { ${K} = ""; }`;

  const poolDef = `  var ${poolV} = ${JSON.stringify(raw)};`;

  const dy = `
  function ${fx}(i){
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
  }`;

  const wrapN = Math.max(1, wrappers || 3);
  const wrappersSrc = [];
  let inner = `${arrayName}(_i)`;
  for (let i = 0; i < wrapN - 1; i++) { const wn = nm(20 + i); wrappersSrc.push(`function ${wn}(_i){ return ${inner}; }`); inner = `${wn}(_i)`; }

  return `
var ${arrayName} = (function(){
${prims}
${probeArr}
${handshake}
${poolDef}
${dy}
  var ${keyV} = ${K};
  var ${chainV} = 0x811c9dc5;
  var ${boxV} = [];
  return function(_i){ return ${fx}(_i); };
})();
${wrappersSrc.join("\n")}
function ${fnName}(_i){ return ${inner}; }
`;
}
