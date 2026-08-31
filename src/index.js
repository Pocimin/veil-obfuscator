import { parse, generate } from "./parse.js";
import { applyStringArray } from "./transforms/stringArray.js";
import { applyControlFlow } from "./transforms/controlFlow.js";
import { applyDeadCode } from "./transforms/deadCode.js";
import { applyDebugProtection } from "./transforms/debugProtection.js";
import { applySelfDefending } from "./transforms/selfDefending.js";
import { applyDomainLock } from "./transforms/domainLock.js";
import { applyRenameIdentifiers } from "./transforms/renameIdentifiers.js";
import { vmize } from "./vm/compile.js";
import { PRESETS } from "./presets.js";
import { mergeOptions } from "./options.js";

/**
 * Obfuscate JavaScript source.
 *
 * @param {string} source          input JS source
 * @param {object} [userOptions]   see src/options.js for every known key
 * @returns {{ code: string, warnings: string[] }}
 */
export function obfuscate(source, userOptions = {}) {
  const warnings = [];
  const preset = userOptions.preset || "balanced";
  const opts = mergeOptions({ ...PRESETS[preset], ...userOptions }, warnings);

  if (typeof source !== "string" || source.trim() === "") {
    throw new Error("veil: source must be a non-empty string.");
  }

  let ast = parse(source, opts);

  if (opts.renameIdentifiers) {
    ast = applyRenameIdentifiers(ast, opts);
  }

  if (opts.vm) {
    // VM mode subsumes the other transforms: the program becomes bytecode.
    return { code: vmize(ast, opts), warnings };
  }

  if (opts.deadCodeInjection > 0) {
    ast = applyDeadCode(ast, opts);
  }

  if (opts.controlFlowFlattening > 0) {
    ast = applyControlFlow(ast, opts);
  }

  if (opts.stringArray) {
    ast = applyStringArray(ast, opts);
  }

  if (opts.domainLock && opts.domainLock.length > 0) {
    ast = applyDomainLock(ast, opts);
  }

  if (opts.debugProtection) {
    ast = applyDebugProtection(ast, opts, source);
  }

  if (opts.selfDefending) {
    ast = applySelfDefending(ast, opts, source);
  }

  return { code: generate(ast), warnings };
}

export default obfuscate;
