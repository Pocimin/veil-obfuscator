#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { obfuscate } from "../src/index.js";
import { PRESETS } from "../src/presets.js";
import { DEFAULT_OPTIONS } from "../src/options.js";

const args = process.argv.slice(2);

function usage() {
  console.log(`
veil - JavaScript obfuscator

Usage:
  veil <input.js> [-o | --output <out.js>] [options]

Options:
  -o, --output <file>     Write to file (defaults to stdout).
  -p, --preset <name>     light | balanced | max | vm
  --no-string-array       Disable string-array encoding
  --no-control-flow       Disable control-flow flattening
  --no-dead-code          Disable dead-code injection
  --no-debug-protection   Disable debugger trap
  --no-self-defending     Disable self-defending
    --string-array-gate <expr>
                          Only decode strings when <expr> is truthy at load
                          in the target host (anti-dump). Use e.g.
                          'typeof document !== "undefined"' for a browser.
    --string-array-gate-fail <str>
                          Value stored instead of decoded strings when the
                          gate is falsy (default: a NUL byte).
    --disable-console       Wipe console methods
    --runtime-gate          Gate string decoding behind a host fingerprint (anti-dump)
    --rename-identifiers    Mangle local variable/function/param names
    --compact               Minify output to a single line (unpretty)
    --opaque-predicates     Weave always-true predicates into the dispatcher
    --cosmetic              Cosmetic hardening (!0x1 / void 0)
    --aggressive-cf         Heavy 3-register state-machine dispatcher
    --length-spoofing       Spoof .length on runtime helpers (rest-args)
    --host-gate             Bake a browser host probe into the decode key (anti-dump)
    --server-decode <url>   Fetch strings per-session from a server (no decoder shipped)
    --vm-bytecode-encoding  Encrypt the VM bytecode blob
    --vm-stateful-opcodes   Position-dependent opcode mapping
    --vm-macro-ops          Fuse repeated instruction pairs into macros
    --vm-decoy-opcodes      Inject fake opcode handlers
    --vm-debug-protection   Multi-layered anti-debug (VM)
    --vm-self-defending     Multi-layered tamper detection (VM)
    -h, --help              Show this help
`);
}

const options = {};
let input = null;
let output = null;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  switch (a) {
    case "-o":
    case "--output":
      output = args[++i];
      break;
    case "-p":
    case "--preset":
      options.preset = args[++i];
      break;
    case "--no-string-array":
      options.stringArray = false;
      break;
    case "--no-control-flow":
      options.controlFlowFlattening = 0;
      break;
    case "--no-dead-code":
      options.deadCodeInjection = 0;
      break;
    case "--no-debug-protection":
      options.debugProtection = false;
      break;
    case "--no-self-defending":
      options.selfDefending = false;
      break;
    case "--string-array-gate":
      options.stringArrayGate = args[++i];
      break;
    case "--string-array-gate-fail":
      options.stringArrayGateFail = args[++i];
      break;
    case "--disable-console":
      options.disableConsole = true;
      break;
    case "--runtime-gate":
      options.stringArrayGate = true;
      break;
    case "--rename-identifiers":
      options.renameIdentifiers = true;
      break;
    case "--compact":
      options.compact = true;
      break;
    case "--opaque-predicates":
      options.opaquePredicates = true;
      break;
    case "--cosmetic":
      options.cosmetic = true;
      break;
    case "--aggressive-cf":
      options.aggressiveCF = true;
      break;
    case "--length-spoofing":
      options.lengthSpoofing = true;
      break;
    case "--host-gate":
      options.hostGate = true;
      break;
    case "--server-decode":
      // Bare flag => same-origin (/api); with a value => absolute URL.
      options.serverDecode = args[i + 1] && !args[i + 1].startsWith("-") ? args[++i] : true;
      break;
    case "--vm-bytecode-encoding":
      options.vmBytecodeEncoding = true;
      break;
    case "--vm-stateful-opcodes":
      options.vmStatefulOpcodes = true;
      break;
    case "--vm-macro-ops":
      options.vmMacroOps = true;
      break;
    case "--vm-decoy-opcodes":
      options.vmDecoyOpcodes = true;
      break;
    case "--vm-debug-protection":
      options.vmDebugProtection = true;
      break;
    case "--vm-self-defending":
      options.vmSelfDefending = true;
      break;
    case "--domain":
      (options.domainLock ??= []).push(args[++i]);
      break;
    case "-h":
    case "--help":
      usage();
      process.exit(0);
      break;
    default:
      if (a.startsWith("-")) {
        console.error(`  unknown option: ${a}`);
        usage();
        process.exit(1);
      }
      input = a;
  }
}

if (!input) {
  usage();
  process.exit(1);
}

let source;
try {
  source = readFileSync(input, "utf8");
} catch (e) {
  console.error(`  [!] cannot read ${input}: ${e.message}`);
  process.exit(1);
}

try {
  const { code, warnings } = obfuscate(source, options);
  for (const w of warnings) console.warn(`  [!] ${w}`);
  if (output) {
    writeFileSync(output, code);
    console.log(`  [✓] wrote ${output} (${code.length} bytes)`);
  } else {
    process.stdout.write(code);
  }
} catch (e) {
  console.error(`  [✗] ${e.message}`);
  process.exit(1);
}
