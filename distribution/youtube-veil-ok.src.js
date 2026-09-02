(function () {
  'use strict';
  var msg = 'VEIL OK';
  document.title = msg;
  var note = document.createElement('div');
  note.id = 'veil-ok-note';
  note.textContent = msg;
  note.style.cssText = 'position:fixed;z-index:9999999;top:8px;left:8px;padding:10px 16px;background:#0a0;color:#fff;font:16px/1.4 sans-serif;font-weight:bold;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.5)';
  (document.body || document.documentElement).appendChild(note);
  setTimeout(function () {
    try { window.top.console.log('[VEIL] server-side decode works on ' + location.hostname); }
    catch (e) { console.log('[VEIL] works on ' + location.hostname); }
  }, 400);
})();
