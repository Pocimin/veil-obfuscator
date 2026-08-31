# veil — JavaScript Obfuscator

Configurable JS obfuscator with a focus on **dump protection** (anti-debugging,
self-defending) and an optional **bytecode VM** mode.

> Built as a from-scratch learning project after deobfuscating a lightly-obfuscated
> script (a hex-indexed string-array + rotation). This one ups the difficulty.

---

## Features

- **String-array encoding** — strings are hoisted into an encoded array and
  decoded at runtime via a self-referencing decoder. Supports `rc4` + `base64`
  layering and array rotation/shuffle.
  - **Anti-dump gate** — `stringArrayGate` (opt-in): the decoder only runs a
    host probe; running the output in the wrong host (e.g. `node`-running a
    browser-targeted build) yields garbage instead of plaintext. Can be a boolean
    (default browser fingerprint) or a custom probe expression. The accessor mask
    is derived at runtime (`_0xM = magic ^ _hostoff()`), so there is no static
    `arr[ i ^ CONST ]` to read the mapping off.
  - *Anti-dump gate* (`stringArrayGate`): opt-in runtime host probe. The loader
    only decrypts when the probe is truthy in the target host; otherwise every
    entry becomes `stringArrayGateFail` (default a NUL byte). A dump/run in the
    wrong host yields garbage instead of plaintext. Off by default so the Node
    test harness still self-hosts.
- **Control-flow flattening** — linear function bodies are rewritten into a
  jump-table dispatcher (semantics-preserving sub-set).
- **Dead-code injection** — sprinkles never-executed guard blocks that look real.
- **Dump protection**
  - *Debugger trap*: a `debugger` probe that measures re-entry time and freezes
    the tab if a devtools pause is detected.
  - *Self-defending*: a guard function fingerprints its own source; re-formatters
    that rename/shape it trip an infinite-loop break.
  - *Domain lock* (optional): output only runs on whitelisted hostnames.
  - *Console wipe* (optional).
- **VM mode (experimental)** — compiles a value-producing program into bytecode
  interpreted by a stack machine, so static dumps show only the interpreter,
  not your logic. VM hardening: `vmBytecodeEncoding` (encrypted blob + key-getter),
  `vmStatefulOpcodes` (position-dependent opcode mapping), `vmMacroOps` (fused
  instructions), `vmDecoyOpcodes` (fake opcode handlers), `vmDebugProtection`
  (multi-layered anti-debug) and `vmSelfDefending` (bytecode/table checksums +
  anti-hook — tampering spins forever). See `EXPERIMENTAL.md`.

---

## Install / use

```bash
npm install
node bin/cli.js ./your-file.js -o ./out.js -p balanced
# then run the result wherever it was targeted
```

### CLI

```
Usage: veil <input.js> [-o | --output <out.js>] [options]

  -o, --output <file>   Write to a file (defaults to stdout).
  -p, --preset <name>   light | balanced | max | vm
  --no-string-array
  --no-control-flow
  --no-dead-code
  --no-debug-protection
  --no-self-defending
  --string-array-gate <expr>
                        Only decode strings when <expr> is truthy at load in
                        the target host (anti-dump). For a browser target use
                        e.g. 'typeof document !== "undefined"'.
  --string-array-gate-fail <str>
                        Value stored instead of decoded strings when the gate
                        is falsy (default: a NUL byte).
  --domain <host>       Lock output to a hostname (repeatable).
  --disable-console
  --help
```

### Library

```js
import { obfuscate } from "./src/index.js";

const { code, warnings } = obfuscate(`console.log("hi")`, {
  preset: "balanced",          // light | balanced | max | vm
  stringArrayThreshold: 1,
  controlFlowFlattening: 0.8,
  debugProtection: true,
  selfDefending: true,
});
console.log(code);
```

---

## Presets

| Preset    | Strings | CF  | Dead code | Dump protection | VM  |
|-----------|:-------:|:---:|:---------:|:---------------:|:---:|
| `light`   | rc4+b64 | 0.1 | no        | no              | no  |
| `balanced`| rc4     | 0.5 | 0.3       | yes (trap+self) | no  |
| `max`     | rc4+b64 | 1.0 | 1.0       | yes (+console)  | yes |
| `vm`      | —       | —   | —         | yes             | yes |

Runtime overhead and payload size grow left→right.

---

## Dump protection details

**Debugger trap** (`debugProtection`): a `setInterval` probe calls a function
that records `performance.now()`, hits a `debugger;` statement, then re-checks
the clock. When a devtools breakpoint pauses execution the delta is large, and
we `while(true){}` to wedge the tab. Takes ~2s to stand up by default; use
`debugProtectionInterval: 0` to make it hot.

**Self-defending** (`selfDefending`): a guard function's `toString()` is
whitespace-normalized and compared to an embedded fingerprint. Renaming the
guard, changing its shape, or inlining it changes the fingerprint → infinite
loop. Pure reformatting/whitespace survives, so the untouched output never
false-trips.

> **Note:** the debugger trap uses `setInterval`, so a Node process won't exit
> while it runs (this is intentional for browser targets). Use
> `--no-debug-protection` when you need a clean exit under Node.

---

## VM mode (experimental)

`vm: true` compiles a value-producing program (literals, arithmetic, logical
operators, simple registers, variable declarations) into a flat opcode array
interpreted by a stack machine. Host/global function calls are **not yet
supported** (see `EXPERIMENTAL.md`). The compiled program only ever pulls from
`_0xstr` (the string table) byte-by-byte, so a dump of the file shows a data
array + interpreter rather than your code.

---

## Project layout

```
veil/
  bin/cli.js              CLI entry
  public/                 web UI (index.html, app.js, styles.css)
  src/
    index.js              orchestrator (pipeline order)
    options.js            defaults + validation
    presets.js            light / balanced / max / vm
    parse.js              acorn parse + astring generate
    ast.js                zero-dependency AST builders
    server.js             dependency-free HTTP server + /api/obfuscate
    transforms/
      stringArray.js      string hoisting + rc4/base64 encoding
      rc4.js              build-time crypto + runtime decoder generator
      controlFlow.js      jump-table flattening
      deadCode.js         dead-code injection
      debugProtection.js  devtools trap
      selfDefending.js    source-fingerprint guard
      domainLock.js       hostname lock
    vm/compile.js         AST -> bytecode + stack-machine wrapper
  test/run.js             no-harness test runner
```

---

## Web UI (website-ready)

A dependency-free Node server with a browser UI so anyone can obfuscate code
without the CLI. Built for hosting on a VPS.

```bash
npm run serve           # http://localhost:3000
PORT=8080 npm run serve # custom port
```

- `GET /` → the UI.
- `POST /api/obfuscate` `{ "source": "...", "options": {...} }` → `{ "code", "warnings" }`.

The UI lets you pick a preset and toggle every transform, shows warnings and
byte count, and copies the result. The server runs the obfuscator server-side,
so no compute is done in the visitor's browser.

---

## Run tests

```bash
npm test
```

---

## License

MIT — see [LICENSE](./LICENSE).
