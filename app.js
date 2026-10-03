'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const FACILITATOR_PIN = String(process.env.FACILITATOR_PIN || '4827');
const TOTAL_SLIDES = 75;

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

const guidePartDir = path.join(__dirname, 'data', 'guide-parts');
const guideSlides = fs.readdirSync(guidePartDir)
  .filter(name => /^guide-\d+\.json$/.test(name))
  .sort()
  .flatMap(name => require(path.join(guidePartDir, name)));
const guide = { totalDurationSec: 2700, slides: guideSlides };

const deckPartDir = path.join(__dirname, 'data', 'deck-parts');
const deckHtml = fs.readdirSync(deckPartDir)
  .filter(name => /^deck-\d+\.part$/.test(name))
  .sort()
  .map(name => fs.readFileSync(path.join(deckPartDir, name), 'utf8'))
  .join('');

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

function snapshotTimer(target = state, at = now()) {
  const live = target.running && target.startedAt ? Math.max(0, at - target.startedAt) : 0;
  const slideLive = target.running && target.slideStartedAt ? Math.max(0, at - target.slideStartedAt) : 0;
  return {
    elapsedMs: target.accumulatedMs + live,
    slideElapsedMs: target.slideAccumulatedMs + slideLive
  };
}

function touch() {
  state.revision += 1;
  state.updatedAt = now();
}

function pauseClock() {
  if (!state.running) return;
  const at = now();
  const snap = snapshotTimer(state, at);
  state.accumulatedMs = snap.elapsedMs;
  state.slideAccumulatedMs = snap.slideElapsedMs;
  state.startedAt = null;
  state.slideStartedAt = null;
  state.running = false;
  touch();
}

function startClock() {
  if (state.running) return;
  const at = now();
  state.startedAt = at;
  state.slideStartedAt = at;
  state.running = true;
  touch();
}

function setSlide(slide) {
  const next = Math.max(1, Math.min(TOTAL_SLIDES, Number(slide) || 1));
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
app.get('/presentacion', (_req, res) => res.type('html').send(deckHtml));
app.get('/health', (_req, res) => res.json({ ok: true, node: process.version, uptime: process.uptime() }));

app.get('/api/state', (_req, res) => {
  res.json({
    ok: true,
    serverNow: now(),
    totalSlides: TOTAL_SLIDES,
    totalDurationSec: guide.totalDurationSec,
    state
  });
});

app.get('/api/guide', requirePin, (_req, res) => {
  res.json({ ok: true, guide });
});

app.post('/api/control', requirePin, (req, res) => {
  const action = String(req.body?.action || '');
  const value = req.body?.value;

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

app.use('/facilitador', express.static(path.join(__dirname, 'public', 'facilitador'), { index: 'index.html', maxAge: 0 }));

app.use((_req, res) => res.status(404).send('No encontrado'));

app.listen(PORT, () => {
  console.log(`Presentación lista en puerto ${PORT}`);
});
