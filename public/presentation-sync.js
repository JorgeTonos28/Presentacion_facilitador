(() => {
  'use strict';

  const style = document.createElement('style');
  style.textContent = `
    #btn-overview,#btn-edit,#btn-help,#btn-prev,#btn-next,#progress-container{display:none!important}
    #hud-timer{pointer-events:none!important;cursor:default!important}
    #hud-timer.over-budget{background:transparent!important;color:inherit!important;border-color:var(--line)!important}
    .theme-dark-active #hud-timer.over-budget{color:#eef6fa!important;border-color:rgba(255,255,255,.23)!important}
  `;
  document.head.appendChild(style);

  let serverState = null;
  let clockOffset = 0;
  let lastSlide = null;

  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    return mm + ':' + ss;
  }

  function elapsedSeconds() {
    if (!serverState) return 0;
    const serverNow = Date.now() + clockOffset;
    const live = serverState.running && serverState.startedAt
      ? Math.max(0, serverNow - serverState.startedAt)
      : 0;
    return (serverState.accumulatedMs + live) / 1000;
  }

  function applyState() {
    if (!serverState) return;

    if (window.Presentation && typeof window.Presentation.goToSlide === 'function') {
      const target = Math.max(1, Number(serverState.slide || 1));
      if (lastSlide !== target) {
        window.Presentation.goToSlide(target - 1);
        lastSlide = target;
      }
      if (typeof window.Presentation.freezeTimer === 'function') {
        window.Presentation.freezeTimer();
      }
    }

    const display = document.getElementById('timer-display');
    if (display) display.textContent = formatTime(elapsedSeconds());

    const timer = document.getElementById('hud-timer');
    if (timer) {
      timer.classList.remove('over-budget');
      timer.classList.toggle('finished', !serverState.running);
      timer.setAttribute('aria-label', 'Cronómetro general de la sesión');
    }
  }

  async function sync() {
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      if (!response.ok) throw new Error('state unavailable');
      const data = await response.json();
      clockOffset = Number(data.serverNow || Date.now()) - Date.now();
      serverState = data.state;
      applyState();
    } catch (_) {
      // Keep the last known slide visible. The presentation remains usable.
    }
  }

  document.addEventListener('keydown', event => {
    const blocked = ['ArrowLeft','ArrowRight','PageUp','PageDown','Home','End',' '];
    if (blocked.includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener('click', event => {
    if (event.target.closest('#hud-timer,#hud-footer,#progress-container')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  setInterval(applyState, 100);
  setInterval(sync, 400);
  sync();
})();
