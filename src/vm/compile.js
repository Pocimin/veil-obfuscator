import * as walk from "acorn-walk";

/**
 * Bytecode VM core with hardening passes.
 *
 * The VM compiles a value-producing program into an instruction stream run by
 * a stack machine. Hardening (each behind its own option):
 *
 *   vmBytecodeEncoding   — the instruction stream ships as an encrypted blob;
 *                          decrypted at load via a key-getter (JSON+XOR+base64).
 *   vmStatefulOpcodes    — opcodes are masked by a position-dependent key, so
 *                          the same number means different things at different
 *                          program points.
 *   vmMacroOps           — common instruction pairs are fused into macros.
 *   vmDecoyOpcodes       — fake opcode handlers + decoy operators that never
 *                          run legitimately.
 *   vmDebugProtection    — multi-layered anti-debug / anti-hook (gated so it is
 *                          Node-safe and does not keep the process alive).
 *   vmSelfDefending      — runtime checksums of the bytecode + string table;
 *                          tampering spins forever, anti-hooking a probe fn.
 */

const OP = {
  PUSH_NUM: 1,
  PUSH_BOOL: 2,
  PUSH_STRARRAY: 3,
  PUSH_STR: 4,
  ADD: 5,
  SUB: 6,
  MUL: 7,
  DIV: 8,
  MOD: 9,
  EQ_STRICT: 10,
  LT: 11,
  GT: 12,
  LAND: 13,
  LOR: 14,
  NOT: 15,
  BIT_AND: 16,
  BIT_OR: 17,
  SHL: 18,
  SHR: 19,
  LOAD: 20,
  STORE: 21,
  GET: 22,
  RETURN: 23,
};

// Fused macros (values must not collide with real opcodes).
const MACRO = {
  PUSH_ADD: 100,
  PUSH_SUB: 101,
  PUSH_MUL: 102,
};

const OPERAND_COUNT = {
  1: 1, 2: 1, 3: 1, 4: 1,
  5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0, 14: 0, 15: 0,
  16: 0, 17: 0, 18: 0, 19: 0, 20: 1, 21: 1, 22: 1, 23: 0,
  100: 2, 101: 2, 102: 2, // fused macros: op + 2 operands
};

const BINMAP = {
  "+": OP.ADD, "-": OP.SUB, "*": OP.MUL, "/": OP.DIV, "%": OP.MOD,
  "===": OP.EQ_STRICT, "<": OP.LT, ">": OP.GT,
  "&": OP.BIT_AND, "|": OP.BIT_OR, "<<": OP.SHL, ">>": OP.SHR,
};

export function vmize(program, opts) {
  const strings = new Map();
  const c = new Compiler(strings);

  walk.full(program, (node) => {
    if (node.type === "Literal" && typeof node.value === "string") {
      if (!strings.has(node.value)) strings.set(node.value, strings.size);
    }
  });

  c.stringTable = [...strings.keys()];
  c.compileStatements(program.body);

  return wrapVM(c, opts);
}

class Compiler {
  constructor(strings) {
    this.code = [];
    this.strings = strings;
    this.slotOf = new Map();
    this.slotCount = 0;
    this.stringTable = [];
  }

  slot(name) {
    if (this.slotOf.has(name)) return this.slotOf.get(name);
    const s = this.slotCount++;
    this.slotOf.set(name, s);
    return s;
  }

  push(...args) {
    this.code.push(args);
  }

  compileExpression(node) {
    if (!node) return;
    switch (node.type) {
      case "Literal":
        if (typeof node.value === "number") this.push(OP.PUSH_NUM, node.value);
        else if (typeof node.value === "boolean") this.push(OP.PUSH_BOOL, node.value ? 1 : 0);
        else if (typeof node.value === "string") {
          if (this.strings.has(node.value)) this.push(OP.PUSH_STRARRAY, this.strings.get(node.value));
          else this.push(OP.PUSH_STR, node.value);
        }
        break;
      case "BinaryExpression":
        this.compileExpression(node.left);
        this.compileExpression(node.right);
        this.push(BINMAP[node.operator] ?? unsupported(`operator "${node.operator}"`));
        break;
      case "LogicalExpression":
        this.compileExpression(node.left);
        this.compileExpression(node.right);
        this.push(node.operator === "&&" ? OP.LAND : OP.LOR);
        break;
      case "UnaryExpression":
        if (node.operator === "!") {
          this.compileExpression(node.argument);
          this.push(OP.NOT);
        }
        break;
      case "Identifier":
        this.push(OP.LOAD, this.slot(node.name));
        break;
      case "MemberExpression": {
        if (!node.computed && node.property.type === "Identifier") {
          this.compileExpression(node.object);
          this.push(OP.GET, node.property.name);
        } else unsupported("computed member");
        break;
      }
      case "CallExpression":
        unsupported("function calls");
        break;
      default:
        unsupported(`expression ${node.type}`);
    }
  }

  compileStatements(body) {
    for (const stmt of body) {
      switch (stmt.type) {
        case "ExpressionStatement":
          this.compileExpression(stmt.expression);
          this.push(OP.RETURN);
          return;
        case "VariableDeclaration":
          for (const d of stmt.declarations) {
            this.compileExpression(d.init);
            this.push(OP.STORE, this.slot(d.id.name));
          }
          break;
        case "ReturnStatement":
          this.compileExpression(stmt.argument);
          this.push(OP.RETURN);
          return;
        default:
          unsupported(`statement ${stmt.type}`);
      }
    }
    this.push(OP.PUSH_NUM, undefined);
    this.push(OP.RETURN);
  }
}

function unsupported(msg) {
  throw new Error(`veil-vm: unsupported ${msg}.`);
}

/* ------------------------------------------------------------------ */
/* Build-side passes                                                   */
/* ------------------------------------------------------------------ */

// Position-dependent opcode key: identical between builder and runtime.
function keyAt(i) {
  const k = Math.imul(i | 0, 2654435761) >>> 0;
  return ((k ^ (k >>> 16)) & 255) >>> 0;
}

function toFlat(instrs) {
  const flat = [];
  for (const ins of instrs) {
    for (const v of ins) flat.push(v);
  }
  return flat;
}

function fuseMacros(flat) {
  const out = [];
  for (let i = 0; i < flat.length; ) {
    // Pattern: PUSH_NUM a, PUSH_NUM b, BINOP  -> MACRO_PUSH_OP a b
    const isPushNum = (p) => flat[p] === OP.PUSH_NUM;
    const isBin = (v) => v === OP.ADD || v === OP.SUB || v === OP.MUL;
    if (
      isPushNum(i) && isPushNum(i + 2) && isBin(flat[i + 4])
    ) {
      const a = flat[i + 1];
      const b = flat[i + 3];
      const bin = flat[i + 4];
      const macro = bin === OP.ADD ? MACRO.PUSH_ADD : bin === OP.SUB ? MACRO.PUSH_SUB : MACRO.PUSH_MUL;
      out.push(macro, a, b);
      i += 5;
    } else {
      out.push(flat[i]);
      i++;
    }
  }
  return out;
}

function maskOps(flat) {
  const out = [];
  let idx = 0;
  while (idx < flat.length) {
    const raw = flat[idx];
    const masked = (raw ^ keyAt(idx)) >>> 0;
    out.push(masked);
    idx++;
    const count = OPERAND_COUNT[raw];
    for (let k = 0; k < (count || 0); k++) out.push(flat[idx++]);
  }
  return out;
}

function fnv(arr) {
  let h = 0x811c9dc5;
  for (let i = 0; i < arr.length; i++) {
    h = (h ^ arr[i]) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ */
/* Bytecode encryption (build-side)                                    */
/* ------------------------------------------------------------------ */

const B64_STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function b64FromBytes(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64_STD[b0 >> 2];
    out += B64_STD[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    if (b1 === undefined) { out += "=="; break; }
    out += B64_STD[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    if (b2 === undefined) out += "="; else out += B64_STD[b2 & 63];
  }
  return out;
}

function xorCipher(str, key) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return bytes;
}

function randKey() {
  let k = "veilVM";
  for (let i = 0; i < 14; i++) k += "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)];
  return k;
}

function randName() {
  return "x" + ((Math.random() * 0x7fffffff) | 0).toString(16).padStart(6, "0");
}

/* ------------------------------------------------------------------ */
/* Emit                                                               */
/* ------------------------------------------------------------------ */

function wrapVM(c, opts) {
  if (!opts) opts = {};

  let flat = toFlat(c.code);

  const useMacro = !!opts.vmMacroOps;
  if (useMacro) flat = fuseMacros(flat);

  const useStateful = !!opts.vmStatefulOpcodes;
  const masked = useStateful ? maskOps(flat) : flat;

  const useEncrypt = !!opts.vmBytecodeEncoding;
  const key = randKey();
  const keyGetter = `String.fromCharCode(${[...key].map((ch) => ch.charCodeAt(0)).join(",")})`;

  // Serialize the final (masked) stream. If encrypted, ship a base64 blob.
  const serial = JSON.stringify(masked);
  let codeExpr;
  if (useEncrypt) {
    const blob = b64FromBytes(xorCipher(serial, key));
    codeExpr = `JSON.parse(xdec("${blob}", xkey))`;
  } else {
    codeExpr = JSON.stringify(masked);
  }

  const table = JSON.stringify(c.stringTable);
  const slots = c.slotCount;

  // Build the switch cases (standard + macro + decoy).
  const cases = [];
  const add = (num, body) => cases.push(`case ${num}: ${body} break;`);
  add(OP.PUSH_NUM, "xS.push(xcode[pc++]);");
  add(OP.PUSH_BOOL, "xS.push(!!xcode[pc++]);");
  add(OP.PUSH_STRARRAY, "xS.push(xstr[xcode[pc++]]);");
  add(OP.PUSH_STR, "xS.push(xcode[pc++]);");
  add(OP.ADD, "b=xS.pop();a=xS.pop();xS.push(a+b);");
  add(OP.SUB, "b=xS.pop();a=xS.pop();xS.push(a-b);");
  add(OP.MUL, "b=xS.pop();a=xS.pop();xS.push(a*b);");
  add(OP.DIV, "b=xS.pop();a=xS.pop();xS.push(a/b);");
  add(OP.MOD, "b=xS.pop();a=xS.pop();xS.push(a%b);");
  add(OP.EQ_STRICT, "b=xS.pop();a=xS.pop();xS.push(a===b);");
  add(OP.LT, "b=xS.pop();a=xS.pop();xS.push(a<b);");
  add(OP.GT, "b=xS.pop();a=xS.pop();xS.push(a>b);");
  add(OP.LAND, "b=xS.pop();a=xS.pop();xS.push(a&&b);");
  add(OP.LOR, "b=xS.pop();a=xS.pop();xS.push(a||b);");
  add(OP.NOT, "a=xS.pop();xS.push(!a);");
  add(OP.BIT_AND, "b=xS.pop();a=xS.pop();xS.push(a&b);");
  add(OP.BIT_OR, "b=xS.pop();a=xS.pop();xS.push(a|b);");
  add(OP.SHL, "b=xS.pop();a=xS.pop();xS.push(a<<b);");
  add(OP.SHR, "b=xS.pop();a=xS.pop();xS.push(a>>b);");
  add(OP.LOAD, "xS.push(xR[xcode[pc++]]);");
  add(OP.STORE, "xR[xcode[pc++]]=xS.pop();");
  add(OP.GET, "a=xS.pop();xS.push(a[xcode[pc++]]);");

  if (useMacro) {
    add(MACRO.PUSH_ADD, "xS.push(xcode[pc++]+xcode[pc++]);");
    add(MACRO.PUSH_SUB, "xS.push(xcode[pc++]-xcode[pc++]);");
    add(MACRO.PUSH_MUL, "xS.push(xcode[pc++]*xcode[pc++]);");
  }

  // Decoy opcodes: fake handlers that never legitimately run.
  if (opts.vmDecoyOpcodes) {
    const decoys = [87, 176, 209, 250, 38, 145];
    for (let i = 0; i < decoys.length; i++) {
      const n = decoys[i];
      add(n, `xS.push(0x${(0xdead00 + i).toString(16)});`); // garbage pushed (unreachable)
    }
  }

  const readOp = useStateful
    ? `var xi = pc; op = ((xcode[xi] ^ keyAt(xi)) >>> 0); pc++;`
    : `op = xcode[pc++];`;

  const codeChecksum = fnv(masked);
  const tableChecksum = fnvStr(c.stringTable.join(""));

  const selfDef = opts.vmSelfDefending
    ? `
  if (fnv(xcode) !== ${codeChecksum}) return xspin();
  if (fnvs(xstr.join("")) !== ${tableChecksum}) return xspin();
  try {
    if (String(Function.prototype.toString.call(Array.prototype.pop)).indexOf('[native code]') < 0) return xspin();
    if (String(Array.isArray).indexOf('isArray') < 0) return xspin();
  } catch (xe) {}
`
    : "";

  // Multi-layered anti-debug / anti-analysis. Layers gated so the output still
  // exits cleanly under Node (tests) yet trips in a browser with devtools open.
  const debugDef = opts.vmDebugProtection
    ? `
  try {
    var xclk = (typeof performance !== 'undefined' && performance.now) ? {now:function(){return performance.now();}} : {now:function(){return Date.now();}};
    var xt0 = xclk.now();
    debugger;
    if (xclk.now() - xt0 > 100) return xspin();
    var xt1 = xclk.now();
    debugger;
    if (xclk.now() - xt1 > 100) return xspin();
  } catch (xe) {}
  if (typeof window !== 'undefined') {
    var xw = window.outerWidth - window.innerWidth;
    if (xw > 160 || (window.outerHeight - window.innerHeight) > 160) return xspin();
  }
`
    : "";

  const spinFn = `
  function xspin(){ while (true) {} }
`;

  const b64src = `
  function xdec(str,k){
    var C='${B64_STD}',b=0,bs=0,out=[];
    var clean=str.replace(/=+$/,'');
    for(var i=0;i<clean.length;i++){ var v=C.indexOf(clean[i]); if(v<0) continue;
      b=(b<<6)|v; bs+=6; if(bs>=8){ bs-=8; out.push((b>>bs)&255); } }
    for(i=0;i<out.length;i++){ out[i]=String.fromCharCode(out[i]^k.charCodeAt(i%k.length)); }
    return out.join('');
  }
`;

  const keyAtSrc = `
  function keyAt(i){ var k=Math.imul(i|0,2654435761)>>>0; return ((k^(k>>>16))&255)>>>0; }
`;

  const fnvSrc = `
  function fnv(arr){ var h=0x811c9dc5; for(var i=0;i<arr.length;i++){ h=(h^arr[i])>>>0; h=Math.imul(h,0x01000193)>>>0; } return h>>>0; }
  function fnvs(s){ var h=0x811c9dc5; for(var i=0;i<s.length;i++){ h=(h^s.charCodeAt(i))>>>0; h=Math.imul(h,0x01000193)>>>0; } return h>>>0; }
`;

function fnvStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

  const tableDecode = useEncrypt
    ? `var xkey = ${keyGetter};\n${b64src}`
    : "";

  return `(function(){
${tableDecode}
${keyAtSrc}
${fnvSrc}
${spinFn}
var xcode = ${codeExpr};
var xstr = ${table};
var xR = new Array(${slots});
var xS = [];
var pc = 0, op, a, b;
${debugDef}
${selfDef}
while (pc < xcode.length){
  ${readOp}
  switch (op){
${cases.join("\n")}
    default: return xS.pop();
  }
}
return xS.pop();
})();`.trim();
}
