'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const FACILITATOR_PIN = String(process.env.FACILITATOR_PIN || '4827');
const TOTAL_SLIDES = 75;
const TOTAL_DURATION_SEC = 2700;

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

const guideDir = path.join(__dirname, 'data', 'guide-parts');
const guideSlides = fs.readdirSync(guideDir)
  .filter(name => /^guide-\d+\.json$/.test(name))
  .sort()
  .flatMap(name => JSON.parse(fs.readFileSync(path.join(guideDir, name), 'utf8')));
const guide = { totalDurationSec: TOTAL_DURATION_SEC, slides: guideSlides };

const deckPath = path.join(__dirname, 'public', 'presentacion', 'deck.html');

let state = freshState();

function freshState() {
  return {
    slide: 1,
    running: false,
    accumulatedMs: 0,
    startedAt: null,
    slideAccumulatedMs: 0,
    slideStartedAt: null,
    revision: 1,
    updatedAt: Date.now()
  };
}

function now() { return Date.now(); }
function touch() { state.revision += 1; state.updatedAt = now(); }

function snapshot(at = now()) {
  const live = state.running && state.startedAt ? Math.max(0, at - state.startedAt) : 0;
  const slideLive = state.running && state.slideStartedAt ? Math.max(0, at - state.slideStartedAt) : 0;
  return {
    elapsedMs: state.accumulatedMs + live,
    slideElapsedMs: state.slideAccumulatedMs + slideLive
  };
}

function startClock() {
  if (state.running) return;
  const at = now();
  state.running = true;
  state.startedAt = at;
  state.slideStartedAt = at;
  touch();
}

function pauseClock() {
  if (!state.running) return;
  const snap = snapshot();
  state.accumulatedMs = snap.elapsedMs;
  state.slideAccumulatedMs = snap.slideElapsedMs;
  state.running = false;
  state.startedAt = null;
  state.slideStartedAt = null;
  touch();
}

function setSlide(value) {
  const next = Math.max(1, Math.min(TOTAL_SLIDES, Number(value) || 1));
  if (next === state.slide) return;
  state.slide = next;
  state.slideAccumulatedMs = 0;
  state.slideStartedAt = state.running ? now() : null;
  touch();
}

function authorized(req) {
  return String(req.get('x-facilitator-pin') || '') === FACILITATOR_PIN;
}

function requirePin(req, res, next) {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'PIN incorrecto' });
  next();
}

app.get('/', (_req, res) => res.redirect('/presentacion'));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    node: process.version,
    uptime: process.uptime(),
    deckReady: fs.existsSync(deckPath),
    slidesInGuide: guideSlides.length
  });
});

app.get('/presentacion', (_req, res) => {
  if (!fs.existsSync(deckPath)) {
    return res.status(503).type('html').send(
      '<h1>Falta public/presentacion/deck.html</h1>' +
      '<p>Sube el HTML final de la presentación con ese nombre y reinicia la aplicación.</p>'
    );
  }
  let html = fs.readFileSync(deckPath, 'utf8');
  const tag = '<script src="/presentation-sync.js"></script>';
  if (!html.includes('/presentation-sync.js')) {
    html = html.includes('</body>') ? html.replace('</body>', tag + '</body>') : html + tag;
  }
  res.type('html').send(html);
});

app.get('/presentation-sync.js', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'presentation-sync.js'));
});

app.get('/api/state', (_req, res) => {
  res.json({
    ok: true,
    serverNow: now(),
    totalSlides: TOTAL_SLIDES,
    totalDurationSec: TOTAL_DURATION_SEC,
    state
  });
});

app.get('/api/guide', requirePin, (_req, res) => {
  res.json({ ok: true, guide });
});

app.post('/api/control', requirePin, (req, res) => {
  const action = String((req.body && req.body.action) || '');
  const value = req.body && req.body.value;

  switch (action) {
    case 'next': setSlide(state.slide + 1); break;
    case 'prev': setSlide(state.slide - 1); break;
    case 'goto': setSlide(value); break;
    case 'start': startClock(); break;
    case 'pause': pauseClock(); break;
    case 'toggleTimer': state.running ? pauseClock() : startClock(); break;
    case 'resetTimer':
      state.accumulatedMs = 0;
      state.slideAccumulatedMs = 0;
      state.startedAt = state.running ? now() : null;
      state.slideStartedAt = state.running ? now() : null;
      touch();
      break;
    case 'resetAll':
      state = freshState();
      break;
    default:
      return res.status(400).json({ ok: false, error: 'Acción no reconocida' });
  }

  res.json({ ok: true, serverNow: now(), state });
});

app.use('/facilitador', express.static(path.join(__dirname, 'public', 'facilitador'), {
  index: 'index.html',
  maxAge: 0
}));

app.use((_req, res) => res.status(404).send('No encontrado'));

app.listen(PORT, () => {
  console.log('Presentación lista en puerto ' + PORT);
});
