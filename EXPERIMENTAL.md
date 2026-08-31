# VM mode — hardening, supported subset & roadmap

The VM core (`src/vm/compile.js`) compiles **value-producing programs** into an
instruction stream run by a stack-machine interpreter, then layers hardening on
top. Everything behind a `vm*` option.

## VM hardening (all implemented)

| Option                | What it does                                                        |
|-----------------------|---------------------------------------------------------------------|
| `vmBytecodeEncoding`  | The instruction stream ships as an encrypted blob; decrypted at load via a `String.fromCharCode` key-getter (JSON + XOR + base64). No literal code array in the source. |
| `vmStatefulOpcodes`   | Opcodes are masked with a position-dependent key (`keyAt(pc)`), so the same number means different things at different program points. |
| `vmMacroOps`          | Common instruction triplets are fused into a single macro (e.g. `PUSH a, PUSH b, ADD` → `MACRO_PUSH_ADD a b`), shrinking the dispatch surface. |
| `vmDecoyOpcodes`      | Injects fake opcode handlers into the switch that never run legitimately, misleading a reader about the real opcode set. |
| `vmDebugProtection`   | Multi-layered anti-debug / anti-analysis: `debugger` timing traps (x2) plus a DevTools-open size heuristic. Browser layers are gated so output still exits cleanly under Node. |
| `vmSelfDefending`     | Multi-layered tamper detection: runtime FNV-1a checksums of the decrypted bytecode and the string table, plus anti-hooking of `Array.prototype.pop` / `Array.isArray`. Any tampered bytecode spins forever. |

Enable individually or via the `vm` / `max` presets. CLI flags: `--vm-bytecode-encoding`, `--vm-stateful-opcodes`, `--vm-macro-ops`, `--vm-decoy-opcodes`, `--vm-debug-protection`, `--vm-self-defending`.

Tamper behavior (verified):
- Edit the encrypted blob → the load crashes (invalid JSON) or the checksum spins.
- Edit a decrypted/valid operand → `vmSelfDefending` detects the FNV mismatch and spins.

## Supported subset

The VM still compiles **value-producing programs** only:

## Supported today

- Literal numbers, booleans, and strings (strings go through the VM string table).
- `BinaryExpression`: `+ - * / % === < > & | << >>`
- `LogicalExpression`: `&& ||`
- `UnaryExpression`: `!`
- `Identifier` (register load), simple non-computed `MemberExpression` get.
- `VariableDeclaration` (`var`) + `ReturnStatement`.
- A top-level `ExpressionStatement` whose result is the program's output.

## Not supported yet

- Function calls (host/global calls like `console.log`, `alert`).
- `if`/loops/`switch` inside the compiled region.
- Closures, `this`, `new`, template literals, destructuring.
- Object/array literals.

Current behavior on unsupported input: **throws a clear compile-time error**
(`veil-vm: unsupported ...`) rather than silently generating wrong code.

## Roadmap

1. Host-method table: map host call names to indices, resolved from the global
   scope so `console.log()` etc. work.
2. Control flow ops: `JP`, `JPZ`, loop/if lowering.
3. String-array reuse: the VM string table should flow through the same
   rc4/base64 encoding as `stringArray` instead of plaintext.
4. Register spilling + shared-array cache to shrink bytecode.
5. Instruction reordering / `vmJumpsEncoding` (runtime-computed jump targets).
6. `vmRenameGlobals` / property mangling inside the VM (currently the VM
   preserves original identifier names in register slots).
