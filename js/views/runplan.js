// Run programs: the program editor (#/run-plan/<id>) and the day's run screen
// (shown by the workout route when a session belongs to a run program).

import { get, getState, list, upsert, remove, sessionFor } from '../store.js';
import { esc, dateKey, num, prettyDate } from '../util.js';
import { icons, sheet, toast, confirmSheet, speak, unlockAudio } from '../ui.js';
import { backLink } from './common.js';
import { Draft } from '../drafts.js';
import { runIntervals } from '../intervals.js';
import {
  TEMPLATES, EDITABLE, standardProgram, parsePace, paceText, speedText, paces, describeDay,
  segmentsFor, totalSecs, estimateDistance, dayNumber, dayAt, dateOfDay, segSpeed, speedUnit,
} from '../run.js';

const unitLabel = (u) => (u === 'km' ? 'km' : 'mile');
const autoName = (plan) => `${paceText(plan.pace)} ${plan.paceUnit === 'km' ? 'per km' : 'Mile'} Program`;
const say = (text) => { const st = getState().settings; if (st.voice !== false) speak(text, st); };

export function pacesCard(plan) {
  const p = paces(plan);
  const u = plan.paceUnit || 'mi';
  const row = (label, sec) => `<div class="pace-row"><span>${label}</span><b>${speedText(sec, u)}</b><span class="muted">${paceText(sec)} /${u}</span></div>`;
  return `
    <div class="paces">
      ${row('Target', p.target)}
      ${row('Speed work', p.speed)}
      ${row('Easy', p.easy)}
    </div>`;
}

// ---- program editor ------------------------------------------------------------------------

let draft = null;
const ed = new Draft('runplan');

function newProgram() {
  const st = getState().settings;
  const plan = { id: null, kind: 'run', name: '', pace: 480, paceUnit: st.distUnit || 'mi', active: true,
    startDate: dateKey(), program: standardProgram(), items: [], days: [], ramp: [] };
  plan.name = autoName(plan);
  return plan;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys[keys.length - 1]] = value;
}

function dayRow(day, i) {
  const n = i + 1;
  const date = draft.startDate ? dateOfDay(draft, n) : '';
  const s = draft.id && date ? sessionFor(draft.id, date) : null;
  const done = s?.run?.done;
  const fields = EDITABLE[day.type] || [];
  const t = TEMPLATES[day.type];
  return `
    <div class="run-day ${day.type === 'rest' ? 'rest' : ''}">
      <div class="run-day-head">
        <span><b>Day ${n}</b> <span class="muted small">${date ? esc(prettyDate(date)) : ''}</span></span>
        ${done ? `<span class="ok small">${icons.check} Done${s.run.mileTime ? ` · mile ${paceText(s.run.mileTime)}` : ''}</span>` : ''}
      </div>
      <div class="run-day-fields">
        <select data-bind="program.${i}.type" aria-label="Day ${n} workout">
          ${Object.entries(TEMPLATES).map(([k, v]) => `<option value="${k}" ${k === day.type ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}
        </select>
        ${fields.includes('reps') ? `<label class="mini-field"><input type="number" inputmode="numeric" min="1" max="30" data-bind="program.${i}.reps" value="${day.reps ?? t.reps}" aria-label="Rounds"><span>rounds</span></label>` : ''}
        ${fields.includes('work') ? `<label class="mini-field"><input type="number" inputmode="decimal" min="0.5" step="any" data-bind="program.${i}.workMin" value="${Math.round(((day.work ?? t.work) / 60) * 10) / 10}" aria-label="Minutes"><span>min</span></label>` : ''}
      </div>
    </div>`;
}

export const editView = {
  enter({ id }) {
    const plan = id === 'new' ? newProgram() : get('plans', id);
    draft = plan ? ed.begin(plan.id, structuredClone(plan)) : null;
    if (id === 'new') ed.markUnsaved(); // a full program exists from the start: don't lose it silently
    if (ed.restored) setTimeout(() => toast('Restored your unsaved changes', 3500));
  },

  render() {
    if (!draft) return `${backLink('#/plans', 'Plans')}<p>Program not found.</p>`;
    ed.persist();
    const d = draft;
    const u = d.paceUnit || 'mi';
    const n = dayNumber(d, dateKey());
    return `
      ${backLink('#/plans', 'Plans')}
      <header class="page-head"><h1>${d.id ? 'Run program' : 'New run program'}</h1>
        <p class="muted small">Builds up to your target pace with run/walk intervals, sprints, speed work and tempo runs, ending with a 1-mile time trial.</p></header>

      <section class="card form">
        <div class="field-grid">
          <label class="field"><span>Target pace (min per ${unitLabel(u)})</span>
            <input data-bind="paceText" inputmode="decimal" value="${paceText(d.pace)}" placeholder="8:00" autocomplete="off"></label>
          <label class="field"><span>Units</span>
            <select data-bind="paceUnit">
              <option value="mi" ${u === 'mi' ? 'selected' : ''}>Miles</option>
              <option value="km" ${u === 'km' ? 'selected' : ''}>Kilometers</option>
            </select></label>
        </div>
        ${pacesCard(d)}
        <p class="muted small">Treadmill: set the speed shown. Outdoors: aim for the pace.</p>
        <label class="field"><span>Name</span>
          <input data-bind="name" value="${esc(d.name)}" autocomplete="off"></label>
        <div class="field-grid">
          <label class="field"><span>Start date (day 1)</span>
            <input type="date" data-bind="startDate" value="${esc(d.startDate || '')}"></label>
          <label class="field inline"><span>Active</span>
            <span class="switch"><input type="checkbox" data-bind="active" ${d.active ? 'checked' : ''}><span></span></span></label>
        </div>
      </section>

      <h2 class="section-title">${d.program.length} days${n ? ` · today is day ${n}` : ''}</h2>
      <section class="card run-days">
        ${d.program.map(dayRow).join('')}
        <div class="btn-row">
          <button class="btn small" data-act="runAddDay">${icons.plus} Add a day</button>
          <button class="btn small" data-act="runRemoveDay" ${d.program.length <= 1 ? 'disabled' : ''}>Remove last day</button>
        </div>
        <button class="btn small ghost" data-act="runResetDays">Reset to the standard 18 days</button>
      </section>
      <p class="muted small">Every workout day starts with a 5-minute walking warm-up and ends with a 5-minute cool-down. Listen to your body: repeat a day or take an extra rest day whenever you need to.</p>

      <div class="btn-col">
        <button class="btn primary wide" data-act="saveRunPlan">Save program</button>
        ${d.id ? '<button class="btn ghost danger-text" data-act="deleteRunPlan">Delete program</button>' : ''}
      </div>`;
  },

  onInput(el, type) {
    const bind = el.dataset.bind;
    if (bind === 'paceText') {
      const sec = parsePace(el.value);
      if (sec >= 120 && sec <= 1800) {
        const wasAuto = draft.name === autoName(draft);
        draft.pace = sec;
        if (wasAuto) draft.name = autoName(draft);
      }
      ed.persist();
      return type === 'change'; // redraw speeds once typing is done
    }
    if (bind === 'paceUnit') {
      const wasAuto = draft.name === autoName(draft);
      draft.paceUnit = el.value;
      if (wasAuto) draft.name = autoName(draft);
      ed.persist();
      return true;
    }
    let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? num(el.value) : el.value;
    if (bind.endsWith('.workMin')) {
      setPath(draft, bind.replace('.workMin', '.work'), Math.max(30, Math.round(v * 60)));
    } else {
      if (bind.endsWith('.reps')) v = Math.max(1, Math.round(v));
      setPath(draft, bind, v);
      // A new workout type starts from that type's defaults.
      const m = bind.match(/^program\.(\d+)\.type$/);
      if (m) draft.program[+m[1]] = { type: v };
    }
    ed.persist();
    return type === 'change' && (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date');
  },

  isDirty: () => ed.dirty(),
  discard: () => ed.discard(),
  commit() {
    if (!draft.name.trim()) { toast('Give the program a name'); return false; }
    if (!draft.pace) { toast('Enter a target pace like 8:00'); return false; }
    draft.name = draft.name.trim();
    const saved = upsert('plans', structuredClone(draft));
    draft.id = saved.id;
    draft.updatedAt = saved.updatedAt;
    ed.saved(saved.id);
    toast('Program saved');
    return true;
  },

  actions: {
    runAddDay() { draft.program.push({ type: 'rest' }); },
    runRemoveDay() { if (draft.program.length > 1) draft.program.pop(); },
    async runResetDays() {
      if (await confirmSheet('Reset the days?', 'Replaces the day-by-day schedule with the standard 18 days. Your pace and start date stay.', 'Reset')) {
        draft.program = standardProgram();
      }
    },
    saveRunPlan() { if (editView.commit()) location.hash = '#/plans'; },
    async deleteRunPlan() {
      if (!(await confirmSheet('Delete program?', `"${draft.name}" will be removed. Runs you logged stay in Walks & runs.`, 'Delete', true))) return;
      remove('plans', draft.id);
      ed.discard();
      location.hash = '#/plans';
    },
  },
};

// ---- the day's run screen --------------------------------------------------------------------

function segmentRows(segs, u) {
  const rows = [];
  const fmt = (s) => (s.secs ? `${Math.floor(s.secs / 60)}:${String(s.secs % 60).padStart(2, '0')}` : '');
  const speed = (s) => `${segSpeed(s)} ${speedUnit(u)}`;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.round === 1 && s.rounds > 1) {
      const rest = segs[i + 1]?.round === 1 && segs[i + 1].kind !== s.kind ? segs[i + 1] : null;
      rows.push(`<div class="seg-row"><b>${s.rounds} ×</b><span>${esc(s.label)} ${fmt(s)} · <b>${speed(s)}</b> <span class="muted">(${paceText(s.pace)}/${u})</span>${rest ? `<br>${esc(rest.label)} ${fmt(rest)} · ${speed(rest)}` : ''}</span></div>`);
      while (segs[i + 1]?.round) i++; // skip the rest of the rounds
    } else if (!s.round || s.rounds === 1) {
      const detail = s.kind === 'trial' ? `${esc(s.note)} · <b>${speed(s)}</b>` : s.kind === 'run' ? `<b>${speed(s)}</b> <span class="muted">(${paceText(s.pace)}/${u})</span>` : `${esc(s.note)} · ${speed(s)}`;
      rows.push(`<div class="seg-row"><b>${fmt(s) || '1 mi'}</b><span>${esc(s.label)} · ${detail}</span></div>`);
    }
  }
  return rows.join('');
}

export function renderRunSession(s) {
  const plan = get('plans', s.planId);
  if (!plan) return `${backLink('#/today', 'Today')}<p>This run program was deleted.</p>`;
  const n = runDay(s, plan);
  const day = dayAt(plan, n) || { type: 'rest' };
  const segs = segmentsFor(plan, day);
  const u = plan.paceUnit || 'mi';
  const act = s.run.activityId ? get('activities', s.run.activityId) : null;
  const isToday = s.date === dateKey();
  return `
    ${backLink(isToday ? '#/today' : '#/progress', isToday ? 'Today' : 'Progress')}
    <header class="page-head">
      <p class="muted">${esc(plan.name)} · Day ${n} of ${plan.program.length} · ${esc(prettyDate(s.date))}</p>
      <h1>${esc(describeDay(day))}</h1>
      ${segs.length ? `<p class="muted small">About ${Math.round(totalSecs(segs) / 60)} minutes${day.type === 'trial' ? ' plus your mile' : ''}</p>` : ''}
    </header>

    ${s.run.done ? `
      <section class="card done-card">
        <p class="ok">${icons.check} <b>Done</b></p>
        ${act ? `<p class="small">${act.distance ? `${act.distance} ${u}` : ''}${act.duration ? ` · ${Math.round(act.duration / 60)} min` : ''}</p>` : ''}
        ${s.run.mileTime ? `<p><b>Mile time: ${paceText(s.run.mileTime)}</b> <span class="muted small">(goal ${paceText(Math.round(plan.pace * (u === 'km' ? 1.609 : 1)))})</span></p>` : ''}
      </section>` : ''}

    ${segs.length ? `
      <section class="card">${pacesCard(plan)}</section>
      <h2 class="section-title">Workout</h2>
      <section class="card segs">${segmentRows(segs, u)}</section>
      <div class="btn-col">
        <button class="btn primary wide" data-act="startRun" data-id="${s.id}">${icons.play} ${s.run.done ? 'Do it again' : 'Start guided workout'}</button>
        <button class="btn wide" data-act="logRunManual" data-id="${s.id}">${s.run.done ? 'Edit logged run' : 'I ran it on my own: log it'}</button>
        <button class="btn ghost danger-text" data-act="deleteSession">Delete this workout</button>
      </div>`
    : '<section class="card"><p>Rest day. Recovery is part of getting faster.</p></section>'}`;
}

// Which program day a session is: fixed once done; otherwise follows the program's dates.
const runDay = (s, plan) => (s.run.done ? s.run.day : dayNumber(plan, s.date) || s.run.day);

async function logRunSheet(s, result) {
  const plan = get('plans', s.planId);
  s.run.day = runDay(s, plan);
  const u = plan.paceUnit || 'mi';
  const day = dayAt(plan, s.run.day) || { type: 'rest' };
  const segs = segmentsFor(plan, day);
  const prev = s.run.activityId ? get('activities', s.run.activityId) : null;
  const isTrial = day.type === 'trial';
  const elapsed = result?.elapsed || prev?.duration || totalSecs(segs);
  const est = prev?.distance || estimateDistance(segs, result?.trialSecs || 0, u);
  const mile = result?.trialSecs || s.run.mileTime || 0;
  const { value, form } = await sheet({
    title: result && !result.finished ? 'Log what you did' : 'Log your run',
    body: `
      ${isTrial ? `<label class="field"><span>Mile time (m:ss)</span>
        <input name="mile" inputmode="decimal" value="${mile ? paceText(mile) : ''}" placeholder="8:00" autocomplete="off"></label>` : ''}
      <div class="field-grid">
        <label class="field"><span>Distance (${u})</span>
          <input name="distance" type="number" inputmode="decimal" min="0" step="any" value="${est || ''}"></label>
        <label class="field"><span>Total time (minutes)</span>
          <input name="minutes" type="number" inputmode="decimal" min="0" step="any" value="${Math.round((elapsed / 60) * 10) / 10}"></label>
      </div>
      <p class="muted small">Distance is an estimate. Use the treadmill's display if it shows one.</p>
      <label class="field inline"><span>Count day ${s.run.day} as done</span>
        <span class="switch"><input type="checkbox" name="done" ${!result || result.finished || s.run.done ? 'checked' : ''}><span></span></span></label>`,
    buttons: [{ label: 'Save run', value: 'save', cls: 'primary' }, { label: 'Skip', value: null }],
  });
  if (value !== 'save') return;
  const distance = Math.round(num(form.distance) * 100) / 100;
  const duration = Math.round(num(form.minutes) * 60);
  let activityId = s.run.activityId;
  if (distance || duration) {
    const a = upsert('activities', {
      ...(activityId && get('activities', activityId) ? { id: activityId } : {}),
      type: 'Run', date: s.date, distance, duration, notes: `${plan.name} · Day ${s.run.day}`,
    });
    activityId = a.id;
  }
  const fresh = get('sessions', s.id);
  fresh.run = { ...fresh.run, done: form.done === 'on', activityId, mileTime: isTrial ? parsePace(form.mile) || 0 : 0 };
  upsert('sessions', fresh);
  toast(fresh.run.done ? `Day ${s.run.day} done 🏃` : 'Run saved');
}

export const runActions = {
  startRun({ el }) {
    unlockAudio();
    const s = get('sessions', el.dataset.id);
    const plan = get('plans', s.planId);
    const n = runDay(s, plan);
    const day = dayAt(plan, n);
    runIntervals({
      title: `Day ${n} · ${describeDay(day)}`,
      segments: segmentsFor(plan, day),
      unit: plan.paceUnit || 'mi',
      say,
      onExit: (result) => logRunSheet(get('sessions', s.id), result),
    });
    return false;
  },
  logRunManual({ el }) { return logRunSheet(get('sessions', el.dataset.id), null); },
};

// Today / Plans helpers -----------------------------------------------------------------------

// Where a run program is today: { state: 'before'|'workout'|'rest'|'finished', n, day }
export function programStatus(plan, key = dateKey()) {
  if (!plan.startDate || key < plan.startDate) return { state: 'before', n: 0 };
  const n = dayNumber(plan, key);
  if (!n) return { state: 'finished', n: plan.program.length };
  const day = dayAt(plan, n);
  return { state: day.type === 'rest' ? 'rest' : 'workout', n, day };
}

export function bestMile(plan) {
  const times = list('sessions').filter((s) => s.planId === plan.id && s.run?.mileTime).map((s) => s.run.mileTime);
  return times.length ? Math.min(...times) : 0;
}
