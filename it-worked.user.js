// ==UserScript==
// @name         It Worked
// @namespace    veil.test
// @version      1.0
// @description  Prints "It worked" on YouTube.
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  console.log('It worked');

  // Make it visible in the page too (optional), so you can see it without devtools.
  const note = document.createElement('div');
  note.textContent = 'It worked';
  note.style.cssText =
    'position:fixed;z-index:99999;top:12px;right:12px;padding:8px 12px;' +
    'background:#0a0;color:#fff;font:15px/1 sans-serif;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.4)';
  document.body && document.body.appendChild(note);
})();
