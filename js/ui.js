// Shared UI pieces: toast, bottom sheet, timers, sound, icons.

import { esc } from './util.js';

// ---- toast -------------------------------------------------------------------

let toastTimer;
export function toast(msg, ms = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---- bottom sheet (modal) ------------------------------------------------------
// sheet({title, body, buttons:[{label, value, cls}]}) -> Promise<{value, form}>
// `form` is a plain object of the sheet's named inputs.

// `onOpen(form)` runs once the sheet is in the page, for live tweaks to its fields.
export function sheet({ title, body = '', buttons = [], onOpen }) {
  return new Promise((resolve) => {
    const root = document.getElementById('overlay');
    root.innerHTML = `
      <div class="backdrop" data-sheet-close></div>
      <form class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h2>${esc(title)}</h2>
        <div class="sheet-body">${body}</div>
        <div class="sheet-buttons">
          ${buttons.map((b, i) => `<button type="${i === 0 ? 'submit' : 'button'}" class="btn ${b.cls || ''}" data-sheet-btn="${i}">${esc(b.label)}</button>`).join('')}
        </div>
      </form>`;
    root.classList.add('open');
    const form = root.querySelector('form');
    const first = form.querySelector('input:not([type=hidden]), select, textarea');
    // Don't auto-focus on touch devices; it pops the keyboard over the sheet.
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
    onOpen?.(form);

    const done = (value) => {
      const data = Object.fromEntries(new FormData(form).entries());
      root.classList.remove('open');
      root.innerHTML = '';
      resolve({ value, form: data });
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); done(buttons[0]?.value); });
    root.querySelectorAll('[data-sheet-btn]').forEach((b) => {
      if (b.type === 'button') b.addEventListener('click', () => done(buttons[+b.dataset.sheetBtn].value));
    });
    root.querySelector('[data-sheet-close]').addEventListener('click', () => done(null));
  });
}

export async function confirmSheet(title, message, okLabel = 'OK', danger = false) {
  const { value } = await sheet({
    title,
    body: `<p>${esc(message)}</p>`,
    buttons: [
      { label: okLabel, value: true, cls: danger ? 'danger' : 'primary' },
      { label: 'Cancel', value: false },
    ],
  });
  return value === true;
}

// ---- sound ---------------------------------------------------------------------
// iOS only allows audio after a tap, so call unlockAudio() inside tap handlers.

let audioCtx;
export function unlockAudio() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* no audio */ }
  // iOS also only lets a page talk after it has spoken once from a tap.
  if (!speechPrimed && window.speechSynthesis) {
    speechPrimed = true;
    try { speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch { /* no speech */ }
  }
}

// ---- spoken cues ----------------------------------------------------------------------

let speechPrimed = false;

// Speak a short phrase with the phone's built-in voice, cutting off anything still talking.
export function speak(text) {
  if (!text || !window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = navigator.language || 'en-US';
    u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch { /* no speech */ }
}

export function beep(times = 1) {
  if (!audioCtx) return;
  for (let i = 0; i < times; i++) {
    const t = audioCtx.currentTime + i * 0.25;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  }
  navigator.vibrate?.(200);
}

// ---- wake lock: keep the screen on during timers -----------------------------------

let wakeLock, timerOpen = false;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    if (!on && wakeLock) { const w = wakeLock; wakeLock = null; await w.release(); }
  } catch { /* not supported */ }
}

// ---- full-screen timer -------------------------------------------------------------
// Modes:
//   'down'  : work countdown from `seconds` (Pause / Done / Cancel)
//   'up'    : stopwatch counting up, ends when the user taps Done
//   'rest'  : rest countdown (+15s / Skip). `stopLabel` adds a button that calls onCancel.
//   'ready' : short "get ready" countdown before an auto-started set (Start now / Cancel)
// onDone(elapsedSeconds) when finished (or skipped); onCancel() when cancelled.

const BEEPS = { down: 3, rest: 2, ready: 1 };

// `cues`: { secondsLeft: fn } runs once when a countdown reaches that many seconds left.
export function timer({ title, subtitle = '', seconds = 0, mode = 'down', stopLabel, cues = {}, onDone, onCancel }) {
  const fired = new Set();
  unlockAudio();
  keepAwake(true);
  timerOpen = true;
  const root = document.getElementById('overlay');
  let total = seconds;
  let accumulated = 0, runningSince = Date.now(), paused = false, raf, finished = false;
  const elapsed = () => (accumulated + (paused ? 0 : Date.now() - runningSince)) / 1000;

  const buttons = {
    down: `<button class="btn" data-t="pause">Pause</button><button class="btn primary" data-t="done">Done</button>`,
    up: `<button class="btn" data-t="pause">Pause</button><button class="btn primary" data-t="done">Done</button>`,
    rest: `<button class="btn" data-t="add">+15s</button><button class="btn primary" data-t="done">Skip rest</button>`,
    ready: `<button class="btn primary" data-t="done">Start now</button>`,
  }[mode];
  const cancelLabel = mode === 'rest' ? stopLabel : 'Cancel';

  root.innerHTML = `
    <div class="timer ${mode}">
      <div class="timer-title">${esc(title)}</div>
      <div class="timer-sub">${esc(subtitle)}</div>
      ${mode === 'up' ? '<div class="timer-mode">Stopwatch</div>' : ''}
      <div class="timer-clock" aria-live="off"></div>
      <div class="timer-buttons">${buttons}</div>
      ${cancelLabel ? `<button class="btn ghost" data-t="cancel">${esc(cancelLabel)}</button>` : ''}
    </div>`;
  root.classList.add('open');
  const clock = root.querySelector('.timer-clock');

  const finish = (cancelled) => {
    if (finished) return;
    finished = true;
    const secs = Math.max(1, Math.round(elapsed()));
    cancelAnimationFrame(raf);
    root.classList.remove('open');
    root.innerHTML = '';
    timerOpen = false;
    // Release the wake lock only if no other timer follows straight after.
    setTimeout(() => { if (!timerOpen) keepAwake(false); }, 1500);
    if (cancelled) onCancel?.();
    else onDone?.(mode === 'down' ? Math.min(secs, total) : secs);
  };

  const tick = () => {
    if (mode === 'up') {
      clock.textContent = fmtClock(Math.floor(elapsed()));
    } else {
      const left = Math.max(0, total - elapsed());
      const whole = Math.ceil(left);
      clock.textContent = fmtClock(whole);
      if (left <= 0) { beep(BEEPS[mode]); return finish(false); }
      // Only cue on the way down (not right at the start of a short countdown).
      if (cues[whole] && !fired.has(whole) && whole < total) { fired.add(whole); cues[whole](); }
    }
    raf = requestAnimationFrame(tick);
  };
  tick();

  root.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => {
    unlockAudio();
    const t = b.dataset.t;
    if (t === 'add') total += 15;
    if (t === 'done') finish(false);
    if (t === 'cancel') finish(true);
    if (t === 'pause') {
      if (paused) { runningSince = Date.now(); paused = false; b.textContent = 'Pause'; }
      else { accumulated += Date.now() - runningSince; paused = true; b.textContent = 'Resume'; }
    }
  }));
}

// Always m:ss on the big clock so the digits don't jump around.
const fmtClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// ---- icons (inline SVG, inherit currentColor) ---------------------------------------

const svg = (d) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const icons = {
  today: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  plans: svg('<path d="M9 5h11M9 12h11M9 19h11"/><path d="M4 5l1 1 2-2M4 12l1 1 2-2M4 19l1 1 2-2"/>'),
  exercises: svg('<path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12"/>'),
  progress: svg('<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  check: svg('<path d="M5 12l5 5L20 7"/>'),
  play: svg('<path d="M7 4l13 8-13 8z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  up: svg('<path d="M6 15l6-6 6 6"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>'),
  back: svg('<path d="M15 6l-6 6 6 6"/>'),
  sync: svg('<path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>'),
  sound: svg('<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  share: svg('<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>'),
  walk: svg('<circle cx="13" cy="4" r="2"/><path d="M9 21l3-7 3 3v5M7 12l3-4 4 1 3 4M12 14l-1-5"/>'),
  scale: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 9a4 4 0 0 1 8 0zM12 9l1.5-2"/>'),
  fire: svg('<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8 0 4 3 7 7 7z"/>'),
};
