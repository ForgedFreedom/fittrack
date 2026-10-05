import { get, upsert, remove, sessionProgress, sessionComplete, itemDone, rampPct, planWeek } from '../store.js';
import { esc, now, prettyDate, dateKey, num, fmtDuration } from '../util.js';
import { icons, sheet, timer, toast, confirmSheet, unlockAudio } from '../ui.js';
import { exerciseOf, targetText, setText, progressBar, backLink, unit } from './common.js';
import { syncNow } from '../sync.js';

let sessionId = null;
const session = () => get('sessions', sessionId);

function itemCard(it, i, s) {
  const ex = exerciseOf(it.exerciseId, it.name);
  const done = itemDone(it);
  const t = it.target;
  const next = nextValues(it, ex);
  // Once the target sets are done, the main button steps back to an "extra set" option.
  const cls = done ? 'btn' : 'btn primary';
  const primary = ex.track.duration && t.duration
    ? `<button class="${cls}" data-act="timedSet" data-i="${i}">${icons.play} ${done ? 'Extra' : 'Start'} ${esc(fmtDuration(next.duration))}</button>`
    : `<button class="${cls}" data-act="quickSet" data-i="${i}">${done ? icons.plus : icons.check} ${done ? 'Extra set' : 'Log set'}${next.reps ? ` (${next.reps}${next.weight ? ` × ${next.weight}${unit()}` : ''})` : ''}</button>`;
  return `
    <section class="card item ${done ? 'done' : ''}" id="item-${i}">
      <div class="card-head">
        <h3>${done ? `<span class="ok">${icons.check}</span>` : ''}${esc(ex.name)}</h3>
        <span class="badge">${it.sets.length}/${t.sets || 1}</span>
      </div>
      <p class="target">${esc(targetText(t, ex))}</p>
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

// Prefill: repeat the last set logged for this item, otherwise use the target.
function nextValues(it, ex) {
  const last = it.sets[it.sets.length - 1];
  const t = it.target;
  return {
    reps: ex.track.reps ? (last?.reps ?? t.reps) : undefined,
    weight: ex.track.weight ? (last?.weight ?? t.weight) : undefined,
    duration: ex.track.duration ? (t.duration || last?.duration) : undefined,
  };
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

  return `
    ${backLink(isToday ? '#/today' : '#/progress', isToday ? 'Today' : 'Progress')}
    <header class="page-head">
      <p class="muted">${esc(prettyDate(s.date))}${pct < 100 ? ` · Week ${planWeek(plan, s.date)} · ${pct}% volume` : ''}</p>
      <h1>${esc(plan?.name || 'Workout')}</h1>
      ${progressBar(frac, 'Workout progress')}
    </header>
    ${plan?.description ? `<details class="howto card"><summary>About this plan</summary><p>${esc(plan.description)}</p></details>` : ''}

    ${s.items.map((it, i) => itemCard(it, i, s)).join('')}

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

function logSet(i, set) {
  const s = session();
  const it = s.items[i];
  it.sets.push({ ...set, at: now() });
  save(s);

  if (sessionComplete(s)) {
    toast('Workout complete! 🎉');
    return;
  }
  const rest = it.target.rest;
  if (rest > 0) {
    const nextIt = itemDone(it) ? s.items.find((x) => !itemDone(x)) : it;
    const nextEx = nextIt ? exerciseOf(nextIt.exerciseId, nextIt.name) : null;
    timer({
      title: 'Rest',
      subtitle: nextEx ? `Next: ${nextEx.name}` : '',
      seconds: rest,
      mode: 'rest',
      onDone: () => scrollToNext(),
    });
  } else {
    scrollToNext();
  }
}

function scrollToNext() {
  const s = session();
  const i = s.items.findIndex((x) => !itemDone(x));
  if (i >= 0) document.getElementById(`item-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function setForm(ex, values) {
  const u = unit();
  const f = (name, label, val, attrs) => `
    <label class="field"><span>${label}</span>
      <input name="${name}" type="number" ${attrs} value="${val ?? ''}">
    </label>`;
  return `
    <div class="field-grid">
      ${ex.track.reps ? f('reps', `Reps${ex.perSide ? ' (each side)' : ''}`, values.reps, 'inputmode="numeric" min="0" step="1"') : ''}
      ${ex.track.weight ? f('weight', `Weight (${u})`, values.weight, 'inputmode="decimal" min="0" step="any"') : ''}
      ${ex.track.duration ? f('duration', 'Time (seconds)', values.duration, 'inputmode="numeric" min="0" step="1"') : ''}
    </div>
    ${!ex.track.reps && !ex.track.weight && !ex.track.duration ? '<p class="muted">This exercise doesn\'t track numbers. Saving marks one set done.</p>' : ''}`;
}

const readForm = (ex, form) => {
  const set = {};
  if (ex.track.reps) set.reps = Math.round(num(form.reps));
  if (ex.track.weight) set.weight = num(form.weight);
  if (ex.track.duration) set.duration = Math.round(num(form.duration));
  return set;
};

export const actions = {
  quickSet({ el }) {
    unlockAudio();
    const i = +el.dataset.i;
    const it = session().items[i];
    const ex = exerciseOf(it.exerciseId, it.name);
    const v = nextValues(it, ex);
    const set = {};
    if (v.reps !== undefined) set.reps = v.reps;
    if (v.weight !== undefined) set.weight = v.weight;
    if (v.duration !== undefined) set.duration = v.duration;
    logSet(i, set);
  },

  timedSet({ el }) {
    const i = +el.dataset.i;
    const it = session().items[i];
    const ex = exerciseOf(it.exerciseId, it.name);
    const v = nextValues(it, ex);
    timer({
      title: ex.name,
      subtitle: `Set ${it.sets.length + 1} of ${it.target.sets || 1}${ex.perSide ? ' · each side' : ''}`,
      seconds: v.duration || 30,
      onDone: (elapsed) => {
        const set = { duration: elapsed };
        if (ex.track.reps) set.reps = v.reps;
        if (ex.track.weight) set.weight = v.weight;
        logSet(i, set);
      },
    });
  },

  async customSet({ el }) {
    unlockAudio();
    const i = +el.dataset.i;
    const it = session().items[i];
    const ex = exerciseOf(it.exerciseId, it.name);
    const { value, form } = await sheet({
      title: `${ex.name}: set ${it.sets.length + 1}`,
      body: setForm(ex, nextValues(it, ex)),
      buttons: [{ label: 'Log set', value: 'save', cls: 'primary' }, { label: 'Cancel', value: null }],
    });
    if (value === 'save') logSet(i, readForm(ex, form));
  },

  async editSet({ el }) {
    const i = +el.dataset.i, k = +el.dataset.k;
    const s = session();
    const it = s.items[i];
    const ex = exerciseOf(it.exerciseId, it.name);
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

  async deleteSession() {
    if (!(await confirmSheet('Delete workout?', 'All sets logged in this workout will be removed.', 'Delete', true))) return;
    remove('sessions', sessionId);
    location.hash = '#/today';
  },
};
