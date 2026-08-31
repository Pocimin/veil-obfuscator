export const PRESETS = {
  // Fast, low overhead. String-array encoding + light control-flow.
  light: {
    stringArray: true,
    stringArrayEncoding: ["rc4", "base64"],
    rotateStringArray: true,
    controlFlowFlattening: 0.1,
    deadCodeInjection: 0,
    debugProtection: false,
    selfDefending: false,
    disableConsole: false,
    vm: false,
  },

  // Recommended default. Keeps runtime within a few % of original.
  balanced: {
    stringArray: true,
    stringArrayEncoding: ["rc4"],
    stringArrayThreshold: 0.8,
    rotateStringArray: true,
    shuffleStringArray: true,
    controlFlowFlattening: 0.5,
    deadCodeInjection: 0.3,
    debugProtection: true,
    debugProtectionInterval: 2000,
    selfDefending: true,
    disableConsole: false,
    domainLock: [],
    vm: false,
  },

  // Maximum hardening. Fully self-defending + bytecode VM.
  max: {
    stringArray: true,
    stringArrayEncoding: ["rc4", "base64"],
    stringArrayThreshold: 1,
    rotateStringArray: true,
    shuffleStringArray: true,
    controlFlowFlattening: 1,
    deadCodeInjection: 1,
    debugProtection: true,
    debugProtectionInterval: 0,
    selfDefending: true,
    selfDefendingVerbatim: true,
    disableConsole: true,
    domainLock: [],
    vm: true,
  },

  // VM-only. Most resistant to static/dump analysis, largest payload.
  vm: {
    stringArray: true,
    core: "VM",
    vm: true,
    debugProtection: true,
    selfDefending: true,
  },
};
