// Shared UI pieces: toast, bottom sheet, timers, sound, icons.

import { esc, fmtDuration } from './util.js';

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

export function sheet({ title, body = '', buttons = [] }) {
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

let wakeLock;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* not supported */ }
}

// ---- full-screen timer -------------------------------------------------------------
// mode 'down': counts down from `seconds`, calls onDone(elapsed) at zero.
// mode 'rest': same, with a +15s button and "Skip".
// Returns nothing; resolves through callbacks.

export function timer({ title, subtitle = '', seconds, mode = 'down', onDone, onCancel }) {
  unlockAudio();
  keepAwake(true);
  const root = document.getElementById('overlay');
  let end = Date.now() + seconds * 1000;
  const start = Date.now();
  let paused = false, pausedLeft = 0, raf, finished = false;

  root.innerHTML = `
    <div class="timer ${mode === 'rest' ? 'rest' : ''}">
      <div class="timer-title">${esc(title)}</div>
      <div class="timer-sub">${esc(subtitle)}</div>
      <div class="timer-clock" aria-live="off"></div>
      <div class="timer-buttons">
        ${mode === 'rest'
          ? `<button class="btn" data-t="add">+15s</button><button class="btn primary" data-t="skip">Skip rest</button>`
          : `<button class="btn" data-t="pause">Pause</button><button class="btn primary" data-t="done">Done</button>`}
      </div>
      <button class="btn ghost" data-t="cancel">${mode === 'rest' ? '' : 'Cancel'}</button>
    </div>`;
  root.classList.add('open');
  const clock = root.querySelector('.timer-clock');
  const left = () => (paused ? pausedLeft : Math.max(0, (end - Date.now()) / 1000));

  const close = () => {
    cancelAnimationFrame(raf);
    root.classList.remove('open');
    root.innerHTML = '';
    keepAwake(false);
  };
  const finish = (cancelled) => {
    if (finished) return;
    finished = true;
    const elapsed = Math.round((Date.now() - start) / 1000);
    close();
    if (cancelled) onCancel?.();
    else onDone?.(Math.min(elapsed, seconds) || seconds);
  };

  const tick = () => {
    const l = left();
    clock.textContent = fmtDuration(Math.ceil(l));
    if (l <= 0 && !paused) {
      beep(mode === 'rest' ? 2 : 3);
      return finish(false);
    }
    raf = requestAnimationFrame(tick);
  };
  tick();

  root.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => {
    unlockAudio();
    const t = b.dataset.t;
    if (t === 'add') end += 15000;
    if (t === 'skip' || t === 'done') finish(false);
    if (t === 'cancel') finish(true);
    if (t === 'pause') {
      if (paused) { end = Date.now() + pausedLeft * 1000; paused = false; b.textContent = 'Pause'; }
      else { pausedLeft = left(); paused = true; b.textContent = 'Resume'; }
    }
  }));
  if (mode === 'rest') root.querySelector('[data-t=cancel]').remove();
}

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
  fire: svg('<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8 0 4 3 7 7 7z"/>'),
};
