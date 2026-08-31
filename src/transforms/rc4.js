// Build-time RC4 + base64 helpers that mirror the runtime decoder source
// emitted by the string-array transform. Everything here runs in Node only.

export function rc4Encrypt(data, key) {
  const state = [];
  for (let i = 0; i < 256; i++) state[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i] + key.charCodeAt(i % key.length)) % 256;
    const t = state[i];
    state[i] = state[j];
    state[j] = t;
  }
  let out = "";
  let a = 0;
  let b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) % 256;
    b = (b + state[a]) % 256;
    const t = state[a];
    state[a] = state[b];
    state[b] = t;
    out += String.fromCharCode(data.charCodeAt(k) ^ state[(state[a] + state[b]) % 256]);
  }
  return out;
}

const B64_STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64Encode(str) {
  // Safe for Unicode by encoding to UTF-8 bytes first.
  const bytes = utf8Encode(str);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_STD[b0 >> 2];
    out += B64_STD[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    if (b1 === undefined) {
      out += "==";
      break;
    }
    out += B64_STD[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    if (b2 === undefined) out += "=";
    else out += B64_STD[b2 & 63];
  }
  return out;
}

export function utf8Encode(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const hi = c;
      const lo = str.charCodeAt(++i);
      c = 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00);
      bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return bytes;
}

// Wraps a string so it is stored as an escaped, obfuscated literal in the array.
export function encodeString(str, encodings, key) {
  let out = str;
  for (const enc of encodings) {
    if (enc === "base64") out = base64Encode(out);
    else if (enc === "rc4") out = rc4Encrypt(out, key);
  }
  return out;
}

/** Decode a stored value, walking the encoding list in reverse. */
export function decodeString(stored, encodings, key) {
  let out = stored;
  for (let i = encodings.length - 1; i >= 0; i--) {
    const enc = encodings[i];
    if (enc === "base64") out = base64Decode(out);
    else if (enc === "rc4") out = rc4Encrypt(out, key); // rc4 is symmetric
  }
  return out;
}

function base64Decode(str) {
  const clean = str.replace(/=+$/, "");
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64_STD.indexOf(ch);
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  return utf8Decode(bytes);
}

/**
 * Emit the hardened runtime loader as a source string (later parsed & injected).
 *
 * `ctx` fields:
 *   arrayName   — the getter's backing box variable
 *   fnName      — the accessor function `fnName(opaqueIndex) -> string`
 *   encodings   — ["rc4","base64"] applied in order at encode time
 *   key         — the rc4 key (transformed into char-codes at runtime)
 *   perm        — baked permutation: box[perm[i]] holds decoded string i
 *   magic       — xor mask applied to the opaque index in `fnName`
 *   raw         — ciphertext array (logical order)
 *
 * Every string in `raw` is only recoverable by executing the (function(){})(),
 * and the key travels as char-codes, not a literal sitting next to the cipher.
 * Index recovery requires both `perm` and `magic` and is deferred to runtime.
 */
export function runtimeDecoderSource(ctx) {
  const { arrayName, fnName, encodings, key, perm, magic, raw } = ctx;

  const steps = [];
  for (const enc of [...encodings].reverse()) {
    if (enc === "base64") steps.push("v=_bx64(v);");
    else if (enc === "rc4") steps.push("v=_bxrc(v,_KEY);");
  }
  const chain = steps.length ? steps.join("\n          ") : "";

  const keyCodes = [...key].map((c) => c.charCodeAt(0)).join(",");
  const permJson = JSON.stringify(perm);
  const rawJson = JSON.stringify(raw);

  return `
var ${arrayName} = (function(){
  var _KEY = String.fromCharCode(${keyCodes});
  var _POOL = ${rawJson};
  var _PERM = ${permJson};
  function _bxrc(d, k){
    var s=[], j=0, a=0, b=0, o='';
    for(var i=0;i<256;i++) s[i]=i;
    for(i=0;i<256;i++){ j=(j+s[i]+k.charCodeAt(i%k.length))%256; var t=s[i]; s[i]=s[j]; s[j]=t; }
    for(i=0;i<d.length;i++){ a=(a+1)%256; b=(b+s[a])%256; var t2=s[a]; s[a]=s[b]; s[b]=t2;
      o+=String.fromCharCode(d.charCodeAt(i)^s[(s[a]+s[b])%256]); }
    return o;
  }
  function _bx64(str){
    var C='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', b=0, bs=0, out=[];
    var clean=str.replace(/=+$/,'');
    for(var i=0;i<clean.length;i++){ var v=C.indexOf(clean[i]); if(v<0) continue;
      b=(b<<6)|v; bs+=6; if(bs>=8){ bs-=8; out.push((b>>bs)&255); } }
    return decodeURIComponent(escape(String.fromCharCode.apply(null,out)));
  }
  var _B = [];
  for (var _i=0;_i<_POOL.length;_i++){
    var v = _POOL[_i];
          ${chain}
    _B[_PERM[_i]] = v;
  }
  return _B;
})();
function ${fnName}(_i){ return ${arrayName}[ _i ^ ${magic} ]; }
`;
}

function utf8Decode(bytes) {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++];
    if (b0 < 0x80) out += String.fromCharCode(b0);
    else if (b0 < 0xe0) out += String.fromCharCode(((b0 & 31) << 6) | (bytes[i++] & 63));
    else if (b0 < 0xf0) {
      out += String.fromCharCode(
        ((b0 & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63),
      );
    } else {
      const cp =
        ((b0 & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}
