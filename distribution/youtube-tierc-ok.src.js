(function () {
  async function main() {
    var verdict = await decideExam("exam-token-123");
    var msg = (verdict && verdict.allowed) ? "VEIL TIER C OK" : "VEIL TIER C DENIED";
    document.title = msg;
    var note = document.createElement('div');
    note.textContent = msg;
    note.style.cssText = 'position:fixed;z-index:9999999;top:8px;left:8px;padding:10px 16px;background:#0a0;color:#fff;font:16px/1.4 sans-serif;font-weight:bold;border-radius:8px';
    (document.body || document.documentElement).appendChild(note);
  }
  main();
})();
function decideExam(t) { return { allowed: (t && t.length >= 4), flag: false }; }
