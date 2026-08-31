const $ = (id) => document.getElementById(id);

const toBoolean = (el) => el.checked;
const toNumber = (el) => Number(el.value);

function buildOptions() {
  const opts = {
    preset: $("preset").value,
    stringArray: toBoolean($("o-stringArray")),
    controlFlowFlattening: toBoolean($("o-controlFlow")) ? 0.6 : 0,
    deadCodeInjection: toBoolean($("o-deadCode")) ? 0.4 : 0,
    debugProtection: toBoolean($("o-debugProtection")),
    selfDefending: toBoolean($("o-selfDefending")),
    vm: toBoolean($("o-vm")),
    disableConsole: toBoolean($("o-disableConsole")),
    stringArrayThreshold: toNumber($("threshold")),
  };
  if (toBoolean($("o-domainLock")) && $("domain").value.trim()) {
    opts.domainLock = [$("domain").value.trim()];
  }
  return opts;
}

$("threshold").addEventListener("input", () => {
  $("thresholdVal").textContent = Number($("threshold").value).toFixed(2);
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
  } finally {
    btn.disabled = false;
    btn.textContent = "Obfuscate";
  }
});

// Let Ctrl/Cmd+Enter in the input run it too.
$("source").addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") $("run").click();
});
