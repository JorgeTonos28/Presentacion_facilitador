(() => {
  'use strict';

  const style = document.createElement('style');
  style.textContent = `
    #btn-overview,#btn-edit,#btn-help,#btn-prev,#btn-next,#progress-container{display:none!important}

    /* The original deck keeps its own internal timer alive. Hide only its
       changing text and render the server clock in an independent span so
       both timers can never fight over the same DOM node. */
    #timer-display{display:none!important}
    #public-timer-display{display:inline!important;font-variant-numeric:tabular-nums}

    #hud-timer{
      pointer-events:none!important;
      cursor:default!important;
      animation:none!important;
      box-shadow:none!important;
    }
    #hud-timer.over-budget{
      animation:none!important;
      background:transparent!important;
      color:inherit!important;
      border-color:var(--line)!important;
      box-shadow:none!important;
    }
    #hud-timer.over-budget .timer-pulse-dot{
      background:var(--teal)!important;
      box-shadow:none!important;
    }
    .theme-dark-active #hud-timer.over-budget{
      color:#eef6fa!important;
      border-color:rgba(255,255,255,.23)!important;
    }
  `;
  document.head.appendChild(style);

  let serverState = null;
  let clockOffset = 0;
  let lastSlide = null;
  let publicDisplay = null;

  function ensurePublicTimer() {
    if (publicDisplay && publicDisplay.isConnected) return publicDisplay;

    const original = document.getElementById('timer-display');
    const timer = document.getElementById('hud-timer');
    if (!timer) return null;

    publicDisplay = document.getElementById('public-timer-display');
    if (!publicDisplay) {
      publicDisplay = document.createElement('span');
      publicDisplay.id = 'public-timer-display';
      publicDisplay.textContent = '00:00';
      if (original) original.insertAdjacentElement('afterend', publicDisplay);
      else timer.appendChild(publicDisplay);
    }
    return publicDisplay;
  }

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

      /* Freeze the deck's private clock. Its display is hidden anyway; this
         also prevents its late-state animation from affecting the public HUD. */
      if (typeof window.Presentation.freezeTimer === 'function') {
        window.Presentation.freezeTimer();
      }
    }

    const display = ensurePublicTimer();
    if (display) display.textContent = formatTime(elapsedSeconds());

    const timer = document.getElementById('hud-timer');
    if (timer) {
      timer.classList.remove('over-budget');
      timer.classList.toggle('finished', !serverState.running);
      timer.setAttribute('aria-label', 'Cronómetro general de la sesión');
      timer.setAttribute('aria-pressed', String(!serverState.running));
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
      /* Keep the last known slide and time visible. */
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

  ensurePublicTimer();
  setInterval(applyState, 100);
  setInterval(sync, 400);
  sync();
})();
