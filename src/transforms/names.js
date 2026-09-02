// Per-run identifier name generator for injected runtime code.
//
// Deliberately avoids a fixed convention so a signature model can't anchor on
// "this is the _0x obfuscator style". Each run picks a random style:
//   - classic     _0x<hex>
//   - mixedCase   aB3cD9eF  (uppercase/lowercase/digits)
//   - dollar      $Yx<hex>
//   - camel       appX<random>
// Reference counts stay globally unique per process.

let seq = 0;
const HEX = "0123456789abcdef";

function hex(n) {
  let s = "";
  for (let i = 0; i < n; i++) s += HEX[Math.floor(Math.random() * 16)];
  return s;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const MIXED = LETTERS + "0123456789";

function letters(n) {
  let s = "";
  for (let i = 0; i < n; i++) s += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return s;
}
function mixed(n) {
  let s = "";
  for (let i = 0; i < n; i++) s += MIXED[Math.floor(Math.random() * MIXED.length)];
  return s;
}

export function freshName() {
  seq = (seq + 1) >>> 0;
  const style = Math.floor(Math.random() * 3);
  const core = seq.toString(16);
  switch (style) {
    case 0: return letters(1).toUpperCase() + mixed(5); // mixedCase e.g. AB3xK9
    case 1: return "$" + letters(1) + hex(3) + core;    // dollar
    default: return "v" + hex(2) + mixed(2) + core.slice(-3); // camel-ish
  }
}
