// Full-screen guided intervals for run programs: walks through each segment
// (warm-up, run/walk or sprint/recover rounds, time trial, cool-down) with a
// countdown, treadmill speed, spoken cues and a "3, 2, 1" before each change.
// Timing uses the clock, so if the phone sleeps briefly it catches up on wake.

import { esc } from './util.js';
import { beep, unlockAudio, keepAwake } from './ui.js';
import { paceText, speedUnit, segSpeed, totalSecs } from './run.js';

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const spokenTime = (sec) => {
  const m = Math.floor(sec / 60), s = sec % 60;
  const part = (n, word) => (n ? `${n} ${word}${n === 1 ? '' : 's'}` : '');
  return [part(m, 'minute'), part(s, 'second')].filter(Boolean).join(' ');
};
const spokenPace = (sec) => (sec % 60 ? `${Math.floor(sec / 60)} ${String(sec % 60).padStart(2, '0')}` : `${sec / 60} minute`);

// What to say when a segment starts.
function cue(seg, unit) {
  const speed = `${segSpeed(seg)} ${unit === 'km' ? 'kilometers' : 'miles'} per hour`;
  const round = seg.round && (seg.kind === 'run' || seg.kind === 'sprint') ? `Round ${seg.round} of ${seg.rounds}. ` : '';
  switch (seg.kind) {
    case 'warmup': return `Warm up. Brisk walk, ${spokenTime(seg.secs)}, ${speed}.`;
    case 'run': return `${round}Run, ${spokenTime(seg.secs)}. ${speed}, ${spokenPace(seg.pace)} pace.`;
    case 'sprint': return `${round}All out! ${spokenTime(seg.secs)}.`;
    case 'walk': return `Walk, ${spokenTime(seg.secs)}.`;
    case 'recover': return `Recover, ${spokenTime(seg.secs)}.`;
    case 'trial': return `Time trial. Run one mile as fast as you can. Goal ${spokenTime(seg.goal)}, ${speed}. Go!`;
    case 'cooldown': return `Cool down. Easy walk, ${spokenTime(seg.secs)}.`;
    default: return seg.label;
  }
}

const nextText = (seg, unit) =>
  seg ? `Next: ${seg.label}${seg.secs ? ` ${clock(seg.secs)}` : ''} · ${segSpeed(seg)} ${speedUnit(unit)}` : 'Last one!';

/**
 * runIntervals({ title, segments, unit, say, onExit })
 * onExit({ finished, elapsed, trialSecs }) when the session ends (finished, or ended early).
 */
export function runIntervals({ title, segments, unit = 'mi', say, onExit }) {
  unlockAudio();
  keepAwake(true);
  const root = document.getElementById('overlay');
  const total = totalSecs(segments);
  const spent = segments.map(() => 0);   // seconds spent in each segment
  let idx = 0;
  let segStart = Date.now();
  let pausedAt = 0;
  let raf = 0;
  let ended = false;
  let endArmed = 0;
  const cued = new Set();

  root.innerHTML = `
    <div class="run-timer">
      <div class="rt-top"><span>${esc(title)}</span><span data-r="round"></span></div>
      <div class="rt-label" data-r="label"></div>
      <div class="rt-speed"><span data-r="speed"></span> <small>${speedUnit(unit)}</small></div>
      <div class="rt-pace" data-r="pace"></div>
      <div class="rt-clock" data-r="clock"></div>
      <div class="rt-next" data-r="next"></div>
      <div class="bar rt-bar"><span data-r="bar"></span></div>
      <div class="timer-buttons">
        <button class="btn" data-r="pause">Pause</button>
        <button class="btn primary" data-r="skip">Skip ⏭</button>
      </div>
      <button class="btn ghost" data-r="end">End workout</button>
    </div>`;
  root.classList.add('open');
  const $ = (r) => root.querySelector(`[data-r="${r}"]`);
  const box = root.querySelector('.run-timer');

  const segElapsed = () => ((pausedAt || Date.now()) - segStart) / 1000;

  function showSegment() {
    const seg = segments[idx];
    box.className = `run-timer kind-${seg.kind}`;
    $('label').textContent = seg.label.toUpperCase();
    $('speed').textContent = segSpeed(seg);
    const pace = seg.kind === 'warmup' || seg.kind === 'cooldown' || seg.kind === 'walk' || seg.kind === 'recover'
      ? seg.note
      : `${paceText(seg.pace)} /${unit}${seg.note ? ` · ${seg.note}` : ''}`;
    $('pace').textContent = pace;
    $('round').textContent = seg.round ? `Round ${seg.round} of ${seg.rounds}` : '';
    $('next').textContent = nextText(segments[idx + 1], unit);
    $('skip').textContent = seg.secs ? 'Skip ⏭' : 'Finished mile ✓';
    say(cue(seg, unit));
  }

  function advance(silent = false) {
    spent[idx] = segments[idx].secs ? Math.min(segElapsed(), segments[idx].secs) : segElapsed();
    idx++;
    segStart = Date.now();
    if (pausedAt) pausedAt = segStart;
    if (idx >= segments.length) return finish(true);
    if (!silent) beep(2);
    showSegment();
  }

  function finish(finished) {
    if (ended) return;
    ended = true;
    if (!finished && idx < segments.length) spent[idx] = segElapsed();
    cancelAnimationFrame(raf);
    root.classList.remove('open');
    root.innerHTML = '';
    keepAwake(false);
    if (finished) { beep(3); say('Workout complete. Great job!'); }
    const trialIdx = segments.findIndex((s) => s.kind === 'trial');
    onExit?.({
      finished,
      elapsed: Math.round(spent.reduce((a, b) => a + b, 0)),
      trialSecs: trialIdx >= 0 ? Math.round(spent[trialIdx]) : 0,
    });
  }

  function tick() {
    if (ended) return;
    let seg = segments[idx];
    // Catch up if timed segments ran out while the screen wasn't updating.
    let skipped = 0;
    while (!pausedAt && seg?.secs && segElapsed() >= seg.secs) {
      const over = segElapsed() - seg.secs;
      spent[idx] = seg.secs;
      idx++;
      segStart = Date.now() - over * 1000;
      skipped++;
      if (idx >= segments.length) return finish(true);
      seg = segments[idx];
    }
    if (skipped) { beep(2); showSegment(); }

    const el = segElapsed();
    if (seg.secs) {
      const left = Math.max(0, seg.secs - el);
      const whole = Math.ceil(left);
      $('clock').textContent = clock(whole);
      // "3, 2, 1" before the switch, and "Halfway" in long stretches.
      if (!pausedAt && seg.secs >= 10 && whole >= 1 && whole <= 3 && !cued.has(`${idx}:${whole}`)) {
        cued.add(`${idx}:${whole}`);
        say(String(whole));
      }
      if (!pausedAt && seg.secs >= 240 && el >= seg.secs / 2 && !cued.has(`${idx}:half`)) {
        cued.add(`${idx}:half`);
        say('Halfway');
      }
    } else {
      $('clock').textContent = clock(el); // time trial: stopwatch
    }
    const done = spent.slice(0, idx).reduce((a, b) => a + b, 0) + Math.min(el, seg.secs || el);
    $('bar').style.width = `${total ? Math.min(100, (done / total) * 100) : 0}%`;
    raf = requestAnimationFrame(tick);
  }

  $('pause').addEventListener('click', () => {
    unlockAudio();
    if (pausedAt) { segStart += Date.now() - pausedAt; pausedAt = 0; $('pause').textContent = 'Pause'; say('Go'); }
    else { pausedAt = Date.now(); $('pause').textContent = 'Resume'; say('Paused'); }
  });
  $('skip').addEventListener('click', () => { unlockAudio(); advance(); });
  // Ending needs a second tap, so a stray touch doesn't stop the workout.
  $('end').addEventListener('click', () => {
    if (Date.now() - endArmed < 3000) return finish(false);
    endArmed = Date.now();
    $('end').textContent = 'Tap again to end';
    setTimeout(() => { if (!ended) $('end').textContent = 'End workout'; }, 3000);
  });

  showSegment();
  tick();
}
