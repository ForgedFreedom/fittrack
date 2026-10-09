import { get, getState, upsert, remove, sessionProgress, sessionComplete, itemDone, rampPct, planWeek, timerOn, addAdhocExercise } from '../store.js';
import { esc, now, prettyDate, dateKey, num, fmtDuration } from '../util.js';
import { icons, sheet, timer, toast, confirmSheet, unlockAudio, speak } from '../ui.js';
import { exerciseOf, targetText, setText, progressBar, backLink, unit } from './common.js';
import { syncNow } from '../sync.js';
import { exerciseOptions } from './plans.js';

let sessionId = null;
const session = () => get('sessions', sessionId);
const exOf = (it) => exerciseOf(it.exerciseId, it.name);

function itemCard(it, i) {
  const ex = exOf(it);
  const done = itemDone(it);
  const t = it.target;
  const v = setValues(it, ex);
  const repsHint = v.reps ? ` (${v.reps}${v.weight ? ` × ${v.weight}${unit()}` : ''})` : '';
  // Once the target sets are done, the main button steps back to an "extra set" option.
  const cls = done ? 'btn' : 'btn primary';
  const primary = timerOn(it)
    ? `<button class="${cls}" data-act="timedSet" data-i="${i}">${icons.play} ${done ? 'Extra' : 'Start'} ${t.duration ? esc(fmtDuration(t.duration)) : 'stopwatch'}</button>`
    : `<button class="${cls}" data-act="quickSet" data-i="${i}">${done ? icons.plus : icons.check} ${done ? 'Extra set' : 'Log set'}${repsHint}</button>`;
  return `
    <section class="card item ${done ? 'done' : ''}" id="item-${i}">
      <div class="card-head">
        <h3>${done ? `<span class="ok">${icons.check}</span>` : ''}${esc(ex.name)}</h3>
        <span class="icon-group">
          <span class="badge">${it.sets.length}/${t.sets || 1}</span>
          ${session().adhoc ? `<button class="icon-btn" data-act="removeAdhocItem" data-i="${i}" aria-label="Remove ${esc(ex.name)}">${icons.trash}</button>` : ''}
        </span>
      </div>
      <p class="target">${esc(targetText(t, ex, timerOn(it)))}${it.custom ? ' <span class="tag">custom today</span>' : ''}</p>
      ${ex.notes || ex.link ? `
        <details class="howto"><summary>How to</summary>
          ${ex.notes ? `<p>${esc(ex.notes)}</p>` : ''}
          ${ex.link ? `<p><a href="${esc(ex.link)}" target="_blank" rel="noopener">Watch / read more ↗</a></p>` : ''}
        </details>` : ''}
      ${it.sets.length ? `<div class="chips">${it.sets.map((set, k) =>
        `<button class="chip" data-act="editSet" data-i="${i}" data-k="${k}" aria-label="Set ${k + 1}: ${esc(setText(set, ex))}. Tap to edit">${esc(setText(set, ex))}</button>`).join('')}</div>` : ''}
      <div class="btn-row">
        ${primary}
        <button class="btn" data-act="customSet" data-i="${i}">Custom…</button>
      </div>
    </section>`;
}

// Values a set is logged with: the item's target for this workout.
function setValues(it, ex) {
  const t = it.target;
  const v = {};
  if (ex.track.reps) v.reps = t.reps;
  if (ex.track.weight) v.weight = t.weight;
  if (ex.track.duration && t.duration) v.duration = t.duration;
  return v;
}

export function enter({ id }) { sessionId = id; }

export function render() {
  const s = session();
  if (!s) return `${backLink('#/today', 'Today')}<p>Workout not found.</p>`;
  const plan = get('plans', s.planId);
  const frac = sessionProgress(s);
  const complete = sessionComplete(s);
  const pct = plan ? rampPct(plan, s.date) : 100;
  const isToday = s.date === dateKey();

  if (s.adhoc) {
    return `
      ${backLink(isToday ? '#/today' : '#/progress', isToday ? 'Today' : 'Progress')}
      <header class="page-head">
        <p class="muted">${esc(prettyDate(s.date))}</p>
        <h1>Single exercises</h1>
        <p class="muted small">Saved to your history. These don't count toward your streak.</p>
      </header>
      ${s.items.map((it, i) => itemCard(it, i)).join('')}
      <section class="card form">
        <label class="field"><span>Add an exercise</span>
          <select data-act-change="adhocAdd"><option value="">Choose from library…</option>${exerciseOptions()}</select></label>
      </section>
      <div class="btn-col">
        <button class="btn primary wide" data-act="finish">Done</button>
        <button class="btn ghost danger-text" data-act="deleteSession">Delete all of today's single exercises</button>
      </div>`;
  }

  return `
    ${backLink(isToday ? '#/today' : '#/progress', isToday ? 'Today' : 'Progress')}
    <header class="page-head">
      <p class="muted">${esc(prettyDate(s.date))}${pct < 100 ? ` · Week ${planWeek(plan, s.date)} · ${pct}% volume` : ''}</p>
      <h1>${esc(plan?.name || 'Workout')}</h1>
      ${progressBar(frac, 'Workout progress')}
    </header>
    ${plan?.description ? `<details class="howto card"><summary>About this plan</summary><p>${esc(plan.description)}</p></details>` : ''}

    ${s.items.map((it, i) => itemCard(it, i)).join('')}

    ${complete ? `<div class="celebrate">🎉 All done. Nice work!</div>` : ''}
    <div class="btn-col">
      <button class="btn ${complete ? 'primary' : ''} wide" data-act="finish">${s.finishedAt ? 'Save & close' : 'Finish workout'}</button>
      <button class="btn ghost danger-text" data-act="deleteSession">Delete this workout</button>
    </div>
  `;
}

function save(s) {
  upsert('sessions', s);
}

const setLabel = (it, ex) =>
  `Set ${it.sets.length + 1} of ${it.target.sets || 1}${ex.perSide ? ' · each side' : ''}${ex.track.reps && it.target.reps ? ` · ${it.target.reps} reps` : ''}`;

// ---- spoken cues (Settings → Workout timers → Read exercises aloud) ----

const say = (text) => { if (getState().settings.voice !== false) speak(text); };

const spokenTime = (sec) => {
  const m = Math.floor(sec / 60), s = sec % 60;
  const part = (n, word) => (n ? `${n} ${word}${n === 1 ? '' : 's'}` : '');
  return [part(m, 'minute'), part(s, 'second')].filter(Boolean).join(' ');
};

// e.g. "Bodyweight squats, set 2 of 4, 13 reps, each side, 15 pounds"
function spokenSet(it) {
  const ex = exOf(it);
  const t = it.target;
  const parts = [ex.name, `set ${it.sets.length + 1} of ${t.sets || 1}`];
  if (ex.track.reps && t.reps) parts.push(`${t.reps} reps`);
  else if (t.duration && (ex.track.duration || timerOn(it))) parts.push(spokenTime(t.duration));
  if (ex.perSide) parts.push('each side');
  if (ex.track.weight && t.weight) parts.push(`${t.weight} ${unit() === 'kg' ? 'kilograms' : 'pounds'}`);
  return parts.join(', ');
}

// Run the on-screen timer for item i: countdown if it has seconds, otherwise a stopwatch.
function runSet(i) {
  const it = session().items[i];
  const ex = exOf(it);
  const secs = it.target.duration || 0;
  say('Go');
  timer({
    title: ex.name,
    subtitle: setLabel(it, ex),
    seconds: secs,
    mode: secs ? 'down' : 'up',
    cues: secs >= 20 ? { 10: () => say('10 seconds') } : {},
    onDone: (elapsed) => logSet(i, { ...setValues(it, ex), duration: elapsed }),
  });
}

// Next item to work on after item i: same item until its sets are done, then the
// first unfinished item after it (wrapping around).
function nextIndex(s, i) {
  if (!itemDone(s.items[i])) return i;
  const n = s.items.length;
  for (let k = 1; k <= n; k++) if (!itemDone(s.items[(i + k) % n])) return (i + k) % n;
  return -1;
}

function logSet(i, set) {
  const s = session();
  const it = s.items[i];
  it.sets.push({ ...set, at: now() });
  save(s);

  if (sessionComplete(s)) {
    toast('Workout complete! 🎉');
    say('Workout complete. Nice work!');
    return;
  }
  const next = nextIndex(s, i);
  const nextIt = next >= 0 ? s.items[next] : null;
  const auto = getState().settings.autoStart !== false && nextIt && timerOn(nextIt);

  const afterRest = () => {
    if (auto) return getReady(next);
    if (nextIt) say(`Next: ${spokenSet(nextIt)}`);
    scrollTo(next);
  };
  const rest = it.target.rest;
  if (rest > 0) {
    say(`Rest, ${spokenTime(rest)}.${nextIt ? ` Next: ${spokenSet(nextIt)}.` : ''}`);
    timer({
      title: 'Rest',
      subtitle: nextIt ? `Next: ${exOf(nextIt).name}${auto ? ' (starts automatically)' : ''}` : '',
      seconds: rest,
      mode: 'rest',
      stopLabel: auto ? "Don't auto-start" : '',
      cues: rest >= 10 ? { 5: () => say('5 seconds') } : {},
      onDone: afterRest,
      onCancel: () => scrollTo(next),
    });
  } else {
    afterRest();
  }
}

// Short "get ready" countdown before an auto-started set.
function getReady(i) {
  const grace = getState().settings.grace ?? 2;
  if (grace <= 0) return runSet(i);
  const it = session().items[i];
  const ex = exOf(it);
  scrollTo(i);
  say(`Get ready: ${ex.name}`);
  timer({
    title: 'Get ready',
    subtitle: `${ex.name} · ${setLabel(it, ex)}`,
    seconds: grace,
    mode: 'ready',
    onDone: () => runSet(i),
    onCancel: () => {},
  });
}

function scrollTo(i) {
  if (i >= 0) document.getElementById(`item-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

const numField = (name, label, val, attrs) => `
  <label class="field"><span>${label}</span>
    <input name="${name}" type="number" ${attrs} value="${val ?? ''}">
  </label>`;
const WHOLE = 'inputmode="numeric" min="0" step="1"';
const DECIMAL = 'inputmode="decimal" min="0" step="any"';

// Editing an already-logged set.
function setForm(ex, values) {
  const showTime = ex.track.duration || values.duration;
  return `
    <div class="field-grid">
      ${ex.track.reps ? numField('reps', `Reps${ex.perSide ? ' (each side)' : ''}`, values.reps, WHOLE) : ''}
      ${ex.track.weight ? numField('weight', `Weight (${unit()})`, values.weight, DECIMAL) : ''}
      ${showTime ? numField('duration', 'Time (seconds)', values.duration, WHOLE) : ''}
    </div>
    ${!ex.track.reps && !ex.track.weight && !showTime ? '<p class="muted">This exercise doesn\'t track numbers.</p>' : ''}`;
}

const readForm = (ex, form) => {
  const set = {};
  if (ex.track.reps) set.reps = Math.round(num(form.reps));
  if (ex.track.weight) set.weight = num(form.weight);
  if (form.duration !== undefined) set.duration = Math.round(num(form.duration));
  return set;
};

// "Custom…": adjust this exercise for this workout only (timer, seconds, reps, weight).
function customForm(it, ex) {
  const t = it.target;
  return `
    <div class="field-grid">
      ${ex.track.reps ? numField('reps', `Reps${ex.perSide ? ' (each side)' : ''}`, t.reps, WHOLE) : ''}
      ${ex.track.weight ? numField('weight', `Weight (${unit()})`, t.weight, DECIMAL) : ''}
    </div>
    <label class="field inline"><span>Use timer</span>
      <span class="switch"><input type="checkbox" name="timer" ${timerOn(it) ? 'checked' : ''}><span></span></span></label>
    <div data-seconds>
      ${numField('duration', 'Seconds', t.duration || 0, WHOLE)}
      <p class="muted small" data-hint></p>
    </div>
    <p class="muted small">Changes apply to this workout only. Edit the plan to change it for good.</p>`;
}

// Keep the sheet's main button and hint in step with the timer switch.
function wireCustomForm(form, ex) {
  const sw = form.querySelector('[name=timer]');
  const secs = form.querySelector('[name=duration]');
  const box = form.querySelector('[data-seconds]');
  const hint = form.querySelector('[data-hint]');
  const btn = form.querySelector('[data-sheet-btn="0"]');
  const update = () => {
    const on = sw.checked, s = Math.round(num(secs.value));
    box.hidden = !on && !ex.track.duration;
    hint.textContent = on ? (s ? `Counts down from ${fmtDuration(s)}.` : '0 = stopwatch: counts up until you tap Done.') : '';
    btn.textContent = on ? (s ? `Start ${fmtDuration(s)} timer` : 'Start stopwatch') : 'Log set';
  };
  sw.addEventListener('change', update);
  secs.addEventListener('input', update);
  update();
}

export const actions = {
  quickSet({ el }) {
    unlockAudio();
    const i = +el.dataset.i;
    const it = session().items[i];
    logSet(i, setValues(it, exOf(it)));
  },

  timedSet({ el }) {
    unlockAudio(); // lets iOS play the beeps and the spoken "Go"
    runSet(+el.dataset.i);
  },

  async customSet({ el, rerender }) {
    unlockAudio();
    const i = +el.dataset.i;
    const s = session();
    const it = s.items[i];
    const ex = exOf(it);
    const { value, form } = await sheet({
      title: `${ex.name}: this workout`,
      body: customForm(it, ex),
      buttons: [
        { label: 'Start', value: 'go', cls: 'primary' },
        { label: 'Save without starting', value: 'save' },
        { label: 'Cancel', value: null },
      ],
      onOpen: (f) => wireCustomForm(f, ex),
    });
    if (!value) return;
    if (ex.track.reps) it.target.reps = Math.round(num(form.reps));
    if (ex.track.weight) it.target.weight = num(form.weight);
    it.target.duration = Math.round(num(form.duration));
    it.timer = form.timer === 'on';
    it.custom = true;
    save(s);
    rerender();
    if (value === 'go') {
      if (it.timer) runSet(i);
      else logSet(i, setValues(it, ex));
    }
  },

  async editSet({ el }) {
    const i = +el.dataset.i, k = +el.dataset.k;
    const s = session();
    const it = s.items[i];
    const ex = exOf(it);
    const { value, form } = await sheet({
      title: `${ex.name}: set ${k + 1}`,
      body: setForm(ex, it.sets[k]),
      buttons: [
        { label: 'Save', value: 'save', cls: 'primary' },
        { label: 'Delete set', value: 'delete', cls: 'danger' },
        { label: 'Cancel', value: null },
      ],
    });
    if (value === 'save') it.sets[k] = { ...it.sets[k], ...readForm(ex, form) };
    else if (value === 'delete') it.sets.splice(k, 1);
    else return;
    save(s);
  },

  finish() {
    const s = session();
    if (!s.finishedAt) { s.finishedAt = now(); save(s); }
    syncNow(false).catch(() => {});
    toast(sessionComplete(s) ? 'Workout saved. Great job! 💪' : 'Saved. Partial workouts count too.');
    location.hash = s.date === dateKey() ? '#/today' : '#/progress';
  },

  adhocAdd({ el }) {
    if (!el.value) return;
    const s = addAdhocExercise(el.value, session().date);
    requestAnimationFrame(() => document.getElementById(`item-${s.items.length - 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  },

  async removeAdhocItem({ el }) {
    const s = session();
    const i = +el.dataset.i;
    const it = s.items[i];
    if (it.sets.length && !(await confirmSheet(`Remove ${it.name}?`, `Its ${it.sets.length} logged set(s) will be deleted.`, 'Remove', true))) return;
    s.items.splice(i, 1);
    save(s);
  },

  async deleteSession() {
    if (!(await confirmSheet('Delete workout?', 'All sets logged in this workout will be removed.', 'Delete', true))) return;
    remove('sessions', sessionId);
    location.hash = '#/today';
  },
};
