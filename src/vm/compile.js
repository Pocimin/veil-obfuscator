import * as walk from "acorn-walk";

/**
 * Experimental bytecode VM core.
 *
 * The VM compiles a *value-producing program* (top-level expression
 * statements / simple var arithmetic + string-array lookups) into a packed
 * instruction stream and interprets it with a stack machine. Because the
 * real logic lives in a data array + interpreter, static dump-and-beautify
 * produces only the interpreter, not your code.
 *
 * Supported subset:
 *   - Literal numbers / booleans / strings
 *   - BinaryExpression: + - * / % === < > & | << >>
 *   - LogicalExpression: && || ; UnaryExpression: !
 *   - Identifier (as a register), simple MemberExpression get
 *   - VariableDeclaration (var) + ReturnStatement
 *
 * Anything else is rejected with a clear error. Host (browser/global) calls
 * are intentionally NOT supported yet — see EXPERIMENTAL.md.
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

const BINMAP = {
  "+": OP.ADD,
  "-": OP.SUB,
  "*": OP.MUL,
  "/": OP.DIV,
  "%": OP.MOD,
  "===": OP.EQ_STRICT,
  "<": OP.LT,
  ">": OP.GT,
  "&": OP.BIT_AND,
  "|": OP.BIT_OR,
  "<<": OP.SHL,
  ">>": OP.SHR,
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
  return wrapVM(c);
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

function wrapVM(c) {
  // Flatten [op, operand?, op, operand?, ...] so the interpreter can consume
  // operands sequentially via pc++.
  const code = JSON.stringify(c.code.flat());
  const table = JSON.stringify(c.stringTable);
  const slots = c.slotCount;

  return `
(function(){
  var _0xcode = ${code};
  var _0xstr = ${table};
  var _0xR = new Array(${slots});
  var _0xS = [];
  var pc = 0, op, a, b;
  while (pc < _0xcode.length){
    op = _0xcode[pc++];
    switch (op){
      case 1: _0xS.push(_0xcode[pc++]); break;
      case 2: _0xS.push(!!_0xcode[pc++]); break;
      case 3: _0xS.push(_0xstr[_0xcode[pc++]]); break;
      case 4: _0xS.push(_0xcode[pc++]); break;
      case 5: b=_0xS.pop();a=_0xS.pop();_0xS.push(a+b);break;
      case 6: b=_0xS.pop();a=_0xS.pop();_0xS.push(a-b);break;
      case 7: b=_0xS.pop();a=_0xS.pop();_0xS.push(a*b);break;
      case 8: b=_0xS.pop();a=_0xS.pop();_0xS.push(a/b);break;
      case 9: b=_0xS.pop();a=_0xS.pop();_0xS.push(a%b);break;
      case 10: b=_0xS.pop();a=_0xS.pop();_0xS.push(a===b);break;
      case 11: b=_0xS.pop();a=_0xS.pop();_0xS.push(a<b);break;
      case 12: b=_0xS.pop();a=_0xS.pop();_0xS.push(a>b);break;
      case 13: b=_0xS.pop();a=_0xS.pop();_0xS.push(a&&b);break;
      case 14: b=_0xS.pop();a=_0xS.pop();_0xS.push(a||b);break;
      case 15: a=_0xS.pop();_0xS.push(!a);break;
      case 16: b=_0xS.pop();a=_0xS.pop();_0xS.push(a&b);break;
      case 17: b=_0xS.pop();a=_0xS.pop();_0xS.push(a|b);break;
      case 18: b=_0xS.pop();a=_0xS.pop();_0xS.push(a<<b);break;
      case 19: b=_0xS.pop();a=_0xS.pop();_0xS.push(a>>b);break;
      case 20: _0xS.push(_0xR[_0xcode[pc++]]); break;
      case 21: _0xR[_0xcode[pc++]] = _0xS.pop(); break;
      case 22: a=_0xS.pop(); _0xS.push(a[_0xcode[pc++]]); break;
      case 23: return _0xS.pop();
      default: return _0xS.pop();
    }
  }
  return _0xS.pop();
})();
`.trim();
}
