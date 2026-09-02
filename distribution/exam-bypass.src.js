(function () {
  'use strict';

  // ok so THIS is the switch. if exam_security_active never exists in
  // sessionStorage, the tab-switch logout / key blocking / copy-cut lock never
  // fire. so we just make getItem always return null for it. ez.
  const FLAG = 'exam_security_active';
  const real = Storage.prototype.getItem;
  const realSet = Storage.prototype.setItem;

  Storage.prototype.getItem = function (key) {
    if (key === FLAG) return null;   // never "on" lol
    return real.call(this, key);     // everything else passes through
  };
  Storage.prototype.setItem = function (key, value) {
    if (key === FLAG) return;        // never store it either
    return realSet.call(this, key, value);
  };

  // this ones the gui killer. deletes the 'Mode Ujian Terkunci' overlay and any
  // inline script that re-creates it.
  const scrub = () => {
    const overlay = document.getElementById('quiz-lock-overlay');
    if (overlay) overlay.remove();   // bye bye fullscreen lock screen

    // re-enable text select (they just set user-select:none lol)
    document.querySelectorAll('.path-mod-quiz .que').forEach(el => {
      el.style.webkitUserSelect = 'text';
      el.style.mozUserSelect = 'text';
      el.style.msUserSelect = 'text';
      el.style.userSelect = 'text';
    });

    // strip the inline anti-cheat script. sometimes it already ran, but that's
    // fine since step 1 already disarmed it.
    document.querySelectorAll('script').forEach(s => {
      if (s.textContent && s.textContent.includes('quiz-lock-overlay')) s.remove();
    });
  };

  // run scrub when the page is ready, or now if it already is.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scrub);
  } else {
    scrub();
  }
})();
