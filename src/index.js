import { parse, generate } from "./parse.js";
import { applyStringArray } from "./transforms/stringArray.js";
import { applyControlFlow } from "./transforms/controlFlow.js";
import { applyDeadCode } from "./transforms/deadCode.js";
import { applyCombinedGuard } from "./transforms/combinedGuard.js";
import { applyDomainLock } from "./transforms/domainLock.js";
import { applyRenameIdentifiers } from "./transforms/renameIdentifiers.js";
import { applyGlobalResolver } from "./transforms/globalResolver.js";
import { applyCosmetic } from "./transforms/cosmetic.js";
import { applyTierC } from "./transforms/tierC.js";
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

  // Tier C must run BEFORE renaming so the sensitive fn name still matches.
  if (opts.tierC && opts.tierC.fn) {
    ast = applyTierC(ast, opts);
  }

  if (opts.renameIdentifiers) {
    ast = applyRenameIdentifiers(ast, opts);
  }

  if (opts.vm) {
    // VM mode subsumes the other transforms: the program becomes bytecode.
    return { code: vmize(ast, opts), warnings };
  }

  if (opts.globalResolver) {
    ast = applyGlobalResolver(ast, opts);
  }

  if (opts.deadCodeInjection > 0) {
    ast = applyDeadCode(ast, opts);
  }

  if (opts.controlFlowFlattening > 0) {
    ast = applyControlFlow(ast, opts);
  }

  if (opts.cosmetic) {
    ast = applyCosmetic(ast, opts);
  }

  if (opts.stringArray) {
    const sdOut = {};
    if (opts.serverDecode) opts._serverDecodeOut = sdOut;
    ast = applyStringArray(ast, opts);
    if (opts.serverDecode) {
      // Gate the user program behind the async key fetch: the loader emits
      // `__veilFetch`, so wrap the user statements in __veilUser and call it only
      // once the key is delivered. This is what makes it CSP-bypassing (async
      // GM_xmlhttpRequest) and runnable on strict-CSP pages like YouTube.
      const loaderLen = opts._serverLoaderLen || 0;
      const userStmts = ast.body.slice(loaderLen);
      ast.body = ast.body.slice(0, loaderLen);
      const userName = "__veilUser";
      ast.body.push({
        type: "FunctionDeclaration",
        id: { type: "Identifier", name: userName },
        params: [],
        body: { type: "BlockStatement", body: userStmts },
        generator: false,
        async: false,
      });
      ast.body.push({
        type: "ExpressionStatement",
        expression: {
          type: "CallExpression",
          callee: { type: "Identifier", name: "__veilFetch" },
          arguments: [{ type: "Identifier", name: userName }],
          optional: false,
        },
      });
      // Return the extracted sid + decode key so the caller/server can register
      // it. The bundle ships NO key / NO plaintext.
      const gOpts = opts.compact ? { indent: "", lineEnd: "" } : {};
      return { code: generate(ast, gOpts), warnings, serverDecode: sdOut };
    }
  }

  if (opts.domainLock && opts.domainLock.length > 0) {
    ast = applyDomainLock(ast, opts);
  }

  if (opts.debugProtection || opts.selfDefending) {
    ast = applyCombinedGuard(ast, opts, source);
  }

  const genOpts = opts.compact ? { indent: "", lineEnd: "" } : {};
  return { code: generate(ast, genOpts), warnings };
}

export default obfuscate;
