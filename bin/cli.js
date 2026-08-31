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
    --domain <host>         Lock output to a hostname (repeatable)
    --disable-console       Wipe console methods
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
    case "--disable-console":
      options.disableConsole = true;
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
