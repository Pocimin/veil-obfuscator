// LZW payload encoding. The string store ships as ONE compressed blob (not an
// array); the runtime must run a textbook LZW decompressor to materialize it.
//
import { freshName } from "./names.js";

// Classic LZW over an 8-bit input alphabet, dictionary seeded 0..255, codes
// from 256 up. Codes are packed as 16-bit-ish char codes (< 65536). The
// decompressor mirrors the compressor's dictionary exactly, so the payload is
// only readable by executing it.

// Build-time compress (Node). Returns a string of char codes.
export function lzwCompress(input) {
  const dict = new Map();
  for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i);

  const out = [];
  let w = "";
  let next = 256;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const wc = w + ch;
    if (dict.has(wc)) {
      w = wc;
    } else {
      out.push(dict.get(w));
      if (next < 65536) dict.set(wc, next++);
      w = ch;
    }
  }
  if (w) out.push(dict.get(w));

  // Pack each code as one char (0..65535). JSON.stringify in the loader will
  // escape control chars, so the payload round-trips through a JS string.
  return out.map((c) => String.fromCharCode(c)).join("");
}

// The runtime textbook LZW decompressor source, emitted into the loader.
export function lzwDecompressSource(fnName) {
  return `
function ${fnName}(data){
  var dict = {};
  for (var i=0;i<256;i++) dict[i] = String.fromCharCode(i);
  var next = 256, w = "", result = [];
  if (data.length === 0) return "";
  var cur = data.charCodeAt(0);
  w = dict[cur];
  result.push(w);
  for (var k=1;k<data.length;k++){
    var c = data.charCodeAt(k);
    var entry;
    if (dict[c] !== undefined) entry = dict[c];
    else if (c === next) entry = w + w.charAt(0);
    else entry = "";
    result.push(entry);
    dict[next++] = w + entry.charAt(0);
    w = entry;
  }
  return result.join('');
}
`;
}

let uid = 0;
export function lzwFnName() {
  return freshName();
}
