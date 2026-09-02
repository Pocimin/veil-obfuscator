export const DEFAULT_OPTIONS = {
  preset: "balanced",

  stringArray: true,
  stringArrayThreshold: 1,
  stringArrayEncoding: ["rc4"],
  rotateStringArray: true,
  shuffleStringArray: true,
  stringArrayGate: false,
  stringArrayLzw: true,
  stringArrayWrappersCount: 3,
  hostGate: false,
  serverDecode: null,
  tierC: null,
  globalResolver: true,
  lengthSpoofing: true,
  opaquePredicates: true,
  cosmetic: true,
  aggressiveCF: true,

  // Anti-dump: only decode when a runtime probe passes. Off by default.
  // stringArrayGate: JS expression evaluated at load in the target host. If it
  //   is falsy, the loader stores `stringArrayGateFail` (default "\u0000") for
  //   every entry — a dump/run in the wrong host yields garbage, not plaintext.
  //   Use e.g. `typeof document !== 'undefined'` for a browser target.
  //   NOTE: presets keep this off so the Node test harness still self-hosts.
  stringArrayGate: undefined,
  stringArrayGateFail: undefined,

  // Continuous-stateful decode. When true, the string array is emitted with the
  // chained loader: entries are lazy/order-coupled, so there is no pre-decoded
  // array to dump and no single round function to reverse. Off by default (the
  // classic loader is faster and the Node test harness still self-hosts).
  stringArrayChain: true,

  controlFlowFlattening: 0.7,
  controlFlowFlatteningThreshold: 0.75,

  deadCodeInjection: 0.3,
  deadCodeInjectionThreshold: 0.4,

  debugProtection: true,
  debugProtectionInterval: 2000,

  selfDefending: true,

  disableConsole: false,

  domainLock: [],

  vm: false,

  target: "browser",
  comment: false,
  identifierNamesGenerator: "hexadecimal",
  renameIdentifiers: true,
  renameProperties: false,
  renameGlobals: false,
  sourceMap: false,
};

// Encodings are applied in the order listed (each wraps the previous).
export const KNOWN_ENCODINGS = new Set(["rc4", "base64", "none"]);

export function mergeOptions(user, warnings = []) {
  const out = { ...DEFAULT_OPTIONS, ...user };

  if (out.controlFlowFlattening < 0 || out.controlFlowFlattening > 1) {
    warnings.push("controlFlowFlattening must be 0..1; clamped.");
    out.controlFlowFlattening = Math.max(0, Math.min(1, out.controlFlowFlattening));
  }

  if (!Array.isArray(out.stringArrayEncoding)) {
    out.stringArrayEncoding = [out.stringArrayEncoding];
    warnings.push("stringArrayEncoding coerced into an array.");
  }
  out.stringArrayEncoding = out.stringArrayEncoding.filter((e) =>
    KNOWN_ENCODINGS.has(e),
  );
  if (out.stringArray && out.stringArrayEncoding.length === 0) {
    warnings.push("stringArrayEncoding emptied; falling back to base64.");
    out.stringArrayEncoding = ["base64"];
  }

  return out;
}
