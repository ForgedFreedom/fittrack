import { list, get, isScheduled, sessionComplete, sessionProgress, sessionFor } from '../store.js';
import { esc, dateKey, addDays, parseDateKey, prettyDate, fmtDuration } from '../util.js';
import { streaks, exerciseOf, progressBar, unit, emptyState } from './common.js';

let pickedExercise = null;
let metric = null;
let range = 30;

// ---- data ------------------------------------------------------------------------

function setsByDay() {
  const m = new Map();
  for (const s of list('sessions')) {
    const n = s.items.reduce((a, it) => a + it.sets.length, 0);
    if (n) m.set(s.date, (m.get(s.date) || 0) + n);
  }
  return m;
}

function adherence(days = 30) {
  const today = dateKey();
  return list('plans').filter((p) => p.active).map((p) => {
    let due = 0, done = 0;
    for (let i = 0; i < days; i++) {
      const d = addDays(today, -i);
      if (!isScheduled(p, d)) continue;
      const s = sessionFor(p.id, d);
      // Today only counts once it's done, so an unfinished morning doesn't drag the rate down.
      if (d === today && !(s && sessionComplete(s))) continue;
      due++;
      if (s && sessionComplete(s)) done++;
    }
    return { plan: p, due, done };
  });
}

const METRICS = {
  reps: { label: 'Total reps', fmt: (v) => `${v}`, agg: (sets) => sets.reduce((a, s) => a + (s.reps || 0), 0), combine: (a, b) => a + b },
  weight: { label: 'Heaviest weight', fmt: (v) => `${v} ${unit()}`, agg: (sets) => Math.max(0, ...sets.map((s) => s.weight || 0)), combine: Math.max },
  duration: { label: 'Total time', fmt: fmtDuration, agg: (sets) => sets.reduce((a, s) => a + (s.duration || 0), 0), combine: (a, b) => a + b },
};

function exerciseSeries(exId, key, days) {
  const today = dateKey();
  const from = addDays(today, -(days - 1));
  const byDay = new Map();
  for (const s of list('sessions')) {
    if (s.date < from) continue;
    for (const it of s.items) {
      if (it.exerciseId !== exId || !it.sets.length) continue;
      const v = METRICS[key].agg(it.sets);
      byDay.set(s.date, byDay.has(s.date) ? METRICS[key].combine(byDay.get(s.date), v) : v);
    }
  }
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    out.push({ date: d, value: byDay.get(d) || 0 });
  }
  return out;
}

function records(exId) {
  let maxReps = 0, maxWeight = 0, maxTime = 0, totalReps = 0, totalSets = 0, daysDone = new Set();
  for (const s of list('sessions')) {
    for (const it of s.items) {
      if (it.exerciseId !== exId) continue;
      for (const set of it.sets) {
        maxReps = Math.max(maxReps, set.reps || 0);
        maxWeight = Math.max(maxWeight, set.weight || 0);
        maxTime = Math.max(maxTime, set.duration || 0);
        totalReps += set.reps || 0;
        totalSets++;
        daysDone.add(s.date);
      }
    }
  }
  return { maxReps, maxWeight, maxTime, totalReps, totalSets, days: daysDone.size };
}

// Exercises that have at least one logged set, most recent first.
function loggedExercises() {
  const seen = new Map();
  for (const s of [...list('sessions')].sort((a, b) => b.date.localeCompare(a.date))) {
    for (const it of s.items) if (it.sets.length && !seen.has(it.exerciseId)) seen.set(it.exerciseId, it.name);
  }
  return [...seen].map(([id, name]) => ({ id, ex: exerciseOf(id, name) }));
}

// ---- rendering ---------------------------------------------------------------------

function heatmap() {
  const counts = setsByDay();
  const weeks = 13;
  const today = dateKey();
  // Start on the Sunday 12 weeks before this week's Sunday.
  const start = addDays(today, -parseDateKey(today).getDay() - (weeks - 1) * 7);
  const max = Math.max(1, ...counts.values());
  const cells = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const key = addDays(start, w * 7 + d);
      if (key > today) continue;
      const n = counts.get(key) || 0;
      const lvl = n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4));
      const label = `${prettyDate(key)}: ${n ? `${n} set${n === 1 ? '' : 's'}` : 'no workout'}`;
      cells.push(`<button class="heat l${lvl}" style="grid-column:${w + 1};grid-row:${d + 1}" data-act="heatTip" data-label="${esc(label)}" aria-label="${esc(label)}"></button>`);
    }
  }
  return `
    <section class="card">
      <div class="heatmap" style="grid-template-columns:repeat(${weeks},1fr)">${cells.join('')}</div>
      <div class="heat-foot">
        <span class="muted small" id="heat-tip">Tap a day for details</span>
        <span class="heat-legend small muted">Less <i class="heat l0"></i><i class="heat l1"></i><i class="heat l2"></i><i class="heat l3"></i><i class="heat l4"></i> More</span>
      </div>
    </section>`;
}

function barChart(series, fmt, title) {
  const W = 340, H = 150, padL = 34, padB = 20, padT = 8;
  const max = Math.max(...series.map((p) => p.value));
  if (!max) return emptyState(`No ${title.toLowerCase()} logged in this period.`);
  const niceMax = niceCeil(max);
  const n = series.length;
  const slot = (W - padL) / n;
  const bw = Math.max(2, slot - 2); // 2px surface gap between bars
  const y = (v) => padT + (H - padT - padB) * (1 - v / niceMax);
  const r = Math.min(4, bw / 2);
  const bars = series.map((p, i) => {
    const x = padL + i * slot + (slot - bw) / 2;
    const tip = `${prettyDate(p.date)}: ${p.value ? fmt(p.value) : 'none'}`;
    const hit = `<rect class="hit" x="${padL + i * slot}" y="0" width="${slot}" height="${H - padB}" data-act="barTip" data-label="${esc(tip)}"><title>${esc(tip)}</title></rect>`;
    if (!p.value) return hit;
    const top = y(p.value), bottom = y(0);
    const h = bottom - top;
    const rr = Math.min(r, h);
    const path = `M${x},${bottom}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + bw - rr}Q${x + bw},${top} ${x + bw},${top + rr}V${bottom}Z`;
    return `<path class="bar-mark" d="${path}"/>${hit}`;
  }).join('');
  // Skip the midline when it would land on a fraction (e.g. max of 1).
  const steps = Number.isInteger(niceMax / 2) ? [0, 0.5, 1] : [0, 1];
  const grid = steps.map((f) => {
    const v = niceMax * f;
    return `<line class="grid" x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis" x="${padL - 4}" y="${y(v) + 3}" text-anchor="end">${esc(shortNum(v, fmt))}</text>`;
  }).join('');
  const lbl = (i, anchor) => `<text class="axis" x="${padL + i * slot + slot / 2}" y="${H - 5}" text-anchor="${anchor}">${esc(shortDate(series[i].date))}</text>`;
  return `
    <div class="chart-tip small" id="bar-tip" aria-live="polite">Tap a bar for details</div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} per day">
      ${grid}${bars}${lbl(0, 'start')}${lbl(n - 1, 'end')}
    </svg>
    <details class="small"><summary>Show as table</summary>
      <table class="data-table"><thead><tr><th>Date</th><th>${esc(title)}</th></tr></thead><tbody>
        ${series.filter((p) => p.value).reverse().map((p) => `<tr><td>${esc(prettyDate(p.date))}</td><td>${esc(fmt(p.value))}</td></tr>`).join('')}
      </tbody></table>
    </details>`;
}

function niceCeil(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const shortNum = (v, fmt) => (fmt === fmtDuration ? fmtDuration(v) : Number.isInteger(v) ? `${v}` : v.toFixed(1));
const shortDate = (key) => parseDateKey(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function exerciseSection() {
  const logged = loggedExercises();
  if (!logged.length) return emptyState('Log a workout to see trends for each exercise.');
  if (!pickedExercise || !logged.some((l) => l.id === pickedExercise)) pickedExercise = logged[0].id;
  const ex = logged.find((l) => l.id === pickedExercise).ex;
  const available = Object.keys(METRICS).filter((k) => ex.track[k]);
  if (!available.length) available.push('reps');
  if (!available.includes(metric)) metric = available[0];
  const M = METRICS[metric];
  const rec = records(pickedExercise);

  return `
    <section class="card">
      <div class="filters">
        <select data-act-change="pickExercise" aria-label="Exercise">
          ${logged.map((l) => `<option value="${l.id}" ${l.id === pickedExercise ? 'selected' : ''}>${esc(l.ex.name)}</option>`).join('')}
        </select>
        ${available.length > 1 ? `<select data-act-change="pickMetric" aria-label="Measure">
          ${available.map((k) => `<option value="${k}" ${k === metric ? 'selected' : ''}>${METRICS[k].label}</option>`).join('')}
        </select>` : ''}
        <div class="seg" role="group" aria-label="Range">
          ${[30, 90].map((r) => `<button class="${r === range ? 'on' : ''}" data-act="pickRange" data-r="${r}" aria-pressed="${r === range}">${r}d</button>`).join('')}
        </div>
      </div>
      <h3 class="chart-title">${esc(M.label)} per day</h3>
      ${barChart(exerciseSeries(pickedExercise, metric, range), M.fmt, M.label)}
      <div class="stat-row compact">
        ${ex.track.reps ? `<div class="stat"><span class="stat-num">${rec.maxReps}</span><span class="stat-label">best set (reps)</span></div>
          <div class="stat"><span class="stat-num">${rec.totalReps.toLocaleString()}</span><span class="stat-label">all-time reps</span></div>` : ''}
        ${ex.track.weight ? `<div class="stat"><span class="stat-num">${rec.maxWeight}</span><span class="stat-label">heaviest (${unit()})</span></div>` : ''}
        ${ex.track.duration ? `<div class="stat"><span class="stat-num">${fmtDuration(rec.maxTime)}</span><span class="stat-label">longest hold</span></div>` : ''}
        <div class="stat"><span class="stat-num">${rec.days}</span><span class="stat-label">days done</span></div>
      </div>
    </section>`;
}

export function render() {
  const { current, best } = streaks();
  const today = dateKey();
  const recent = list('sessions')
    .filter((s) => s.items.some((it) => it.sets.length))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.startedAt || '').localeCompare(a.startedAt || ''));
  const last30 = recent.filter((s) => s.date > addDays(today, -30));
  const adh = adherence(30);
  const due = adh.reduce((a, x) => a + x.due, 0);
  const done = adh.reduce((a, x) => a + x.done, 0);

  return `
    <header class="page-head"><h1>Progress</h1></header>

    <div class="stat-row">
      <div class="stat"><span class="stat-num">${current}</span><span class="stat-label">day streak</span></div>
      <div class="stat"><span class="stat-num">${best}</span><span class="stat-label">best streak</span></div>
      <div class="stat"><span class="stat-num">${last30.length}</span><span class="stat-label">workouts (30d)</span></div>
      <div class="stat"><span class="stat-num">${due ? Math.round((done / due) * 100) + '%' : 'n/a'}</span><span class="stat-label">on schedule (30d)</span></div>
    </div>

    <h2 class="section-title">Last 13 weeks</h2>
    ${heatmap()}

    ${adh.length ? `
      <h2 class="section-title">Plans: last 30 days</h2>
      <section class="card">
        ${adh.map(({ plan, due, done }) => `
          <div class="adh-row">
            <div class="row-between"><span>${esc(plan.name)}</span><span class="muted small">${done} of ${due} scheduled days</span></div>
            ${progressBar(due ? done / due : 0, `${plan.name} completion`)}
          </div>`).join('')}
      </section>` : ''}

    <h2 class="section-title">Exercise trends</h2>
    ${exerciseSection()}

    <h2 class="section-title">History</h2>
    ${recent.length ? `<div class="list card">
      ${recent.slice(0, 30).map((s) => {
        const complete = sessionComplete(s);
        return `<a class="list-row" href="#/workout/${s.id}">
          <span>${esc(get('plans', s.planId)?.name || 'Workout')}<br><span class="muted small">${esc(prettyDate(s.date))}</span></span>
          <span class="${complete ? 'ok' : 'muted'} small">${complete ? '✓ Complete' : Math.round(sessionProgress(s) * 100) + '%'}</span>
        </a>`;
      }).join('')}
    </div>` : emptyState('No workouts logged yet.')}
  `;
}

export const actions = {
  heatTip({ el }) {
    document.getElementById('heat-tip').textContent = el.dataset.label;
    document.querySelectorAll('.heat.sel').forEach((x) => x.classList.remove('sel'));
    el.classList.add('sel');
    return false;
  },
  barTip({ el }) {
    document.getElementById('bar-tip').textContent = el.dataset.label;
    document.querySelectorAll('.hit.sel').forEach((x) => x.classList.remove('sel'));
    el.classList.add('sel');
    return false;
  },
  pickExercise({ el }) { pickedExercise = el.value; metric = null; },
  pickMetric({ el }) { metric = el.value; },
  pickRange({ el }) { range = +el.dataset.r; },
};
