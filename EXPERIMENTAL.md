# VM mode — supported subset & roadmap

The VM core (`src/vm/compile.js`) is intentionally small right now. It compiles
**value-producing programs** only, so the whole thing is a correct, small,
auditable stack machine.

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
5. Bytecode encryption keyed at build time.
