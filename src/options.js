export const DEFAULT_OPTIONS = {
  preset: "balanced",

  stringArray: true,
  stringArrayThreshold: 0.8,
  stringArrayEncoding: ["rc4"],
  rotateStringArray: true,
  shuffleStringArray: true,

  controlFlowFlattening: 0.5,
  controlFlowFlatteningThreshold: 0.75,

  deadCodeInjection: 0.3,
  deadCodeInjectionThreshold: 0.4,

  debugProtection: false,
  debugProtectionInterval: 2000,

  selfDefending: false,

  disableConsole: false,

  domainLock: [],

  vm: false,

  target: "node",
  comment: false,
  identifierNamesGenerator: "hexadecimal",
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
