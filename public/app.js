const $ = (id) => document.getElementById(id);

const toBoolean = (el) => el.checked;
const toNumber = (el) => Number(el.value);

function buildOptions() {
  const enc = $("o-stringArrayEncoding").value;
  const opts = {
    preset: $("preset").value,
    stringArray: toBoolean($("o-stringArray")),
    stringArrayEncoding: enc.includes(",") ? enc.split(",") : [enc],
    stringArrayLzw: toBoolean($("o-stringArrayLzw")),
    stringArrayWrappersCount: toNumber($("o-wrappers")),
    hostGate: toBoolean($("o-hostGate")),
    controlFlowFlattening: toBoolean($("o-controlFlow")) ? 0.7 : 0,
    aggressiveCF: toBoolean($("o-aggressiveCF")),
    deadCodeInjection: toBoolean($("o-deadCode")) ? 0.3 : 0,
    debugProtection: toBoolean($("o-debugProtection")),
    debugProtectionInterval: toNumber($("o-debugInterval")),
    selfDefending: toBoolean($("o-selfDefending")),
    renameIdentifiers: toBoolean($("o-renameIdentifiers")),
    globalResolver: toBoolean($("o-globalResolver")),
    opaquePredicates: toBoolean($("o-opaquePredicates")),
    cosmetic: toBoolean($("o-cosmetic")),
    lengthSpoofing: toBoolean($("o-lengthSpoofing")),
    compact: toBoolean($("o-compact")),
    vm: toBoolean($("o-vm")),
    disableConsole: toBoolean($("o-disableConsole")),
    stringArrayThreshold: toNumber($("threshold")),
  };
  if (toBoolean($("o-domainLock")) && $("domain").value.trim()) {
    opts.domainLock = [$("domain").value.trim()];
  }
  if (toBoolean($("o-serverDecode"))) {
    opts.serverDecode = $("serverDecodeUrl").value.trim() || true;
  }
  if (toBoolean($("o-tierC")) && $("tierCFn").value.trim()) {
    opts.tierC = { fn: $("tierCFn").value.trim(), endpoint: $("tierCEndpoint").value.trim() || "/api/rpc" };
  }
  return opts;
}

$("threshold").addEventListener("input", () => {
  $("thresholdVal").textContent = Number($("threshold").value).toFixed(2);
});

// Sync the toggle set to the selected preset so a preset change isn't silently
// overridden by stale checkbox state (e.g. vm preset with "VM mode" unchecked).
$("preset").addEventListener("change", () => {
  const p = $("preset").value;
  const strong = p !== "light";
  const on = (id, v) => { const el = $(id); if (el && el.type === "checkbox") el.checked = v; };
  on("o-vm", p === "vm");
  on("o-stringArray", true);
  on("o-controlFlow", strong);
  on("o-aggressiveCF", strong);
  on("o-deadCode", strong);
  on("o-debugProtection", strong && p !== "vm");
  on("o-selfDefending", strong && p !== "vm");
  on("o-stringArrayLzw", strong);
  on("o-hostGate", p === "max");
  on("o-renameIdentifiers", strong);
  on("o-globalResolver", strong);
  on("o-opaquePredicates", strong);
  on("o-cosmetic", strong);
  on("o-lengthSpoofing", strong);
  on("o-compact", strong);
  // vm preset has no string layer, so string/server opts are irrelevant there.
  ["o-hostGate", "o-stringArrayEncoding", "o-wrappers", "o-serverDecode", "o-tierC", "threshold"].forEach(
    (id) => { const el = $(id); if (el) el.disabled = p === "vm"; },
  );
});

$("copy").addEventListener("click", () => {
  const out = $("output").value;
  if (!out) return;
  navigator.clipboard.writeText(out).then(() => {
    const b = $("copy");
    b.textContent = "copied!";
    setTimeout(() => (b.textContent = "copy"), 1200);
  });
});

$("run").addEventListener("click", async () => {
  const source = $("source").value;
  if (!source.trim()) {
    $("fb").textContent = "paste some code first";
    return;
  }
  const btn = $("run");
  btn.disabled = true;
  btn.textContent = "obfuscating…";
  $("warnings").textContent = "";

  try {
    const res = await fetch("/api/obfuscate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, options: buildOptions() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "obfuscation failed");

    $("output").value = data.code;
    $("stats").textContent = `${data.code.length} bytes`;
    if (data.warnings && data.warnings.length) {
      $("warnings").textContent = data.warnings.join("\n");
    }
    $("fb").textContent = "✓ done";
  } catch (e) {
    // Show the real error rather than swallowing it (e.g. VM rejecting a
    // program that uses host calls the VM does not compile yet).
    $("warnings").textContent = String(e.message || e);
    $("fb").textContent = "✗ error";
    $("stats").textContent = "";
  } finally {
    btn.disabled = false;
    btn.textContent = "Obfuscate";
  }
});

// Let Ctrl/Cmd+Enter in the input run it too.
$("source").addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") $("run").click();
});
