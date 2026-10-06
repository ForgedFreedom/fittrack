import { list, get, getState, isScheduled, sessionComplete, sessionProgress, sessionFor, weightsSorted } from '../store.js';
import { esc, dateKey, addDays, parseDateKey, prettyDate, fmtDuration, daysBetween } from '../util.js';
import { icons } from '../ui.js';
import { weekStart } from '../stats.js';
import { streaks, exerciseOf, progressBar, unit, emptyState } from './common.js';
import { activitySheet, weightSheet, goalSheet, activityText, distUnit, durationText } from './logsheets.js';

let tab = 'workouts';
let pickedExercise = null;
let metric = null;
let range = 30;
let weightRange = 90;

const shortDate = (key) => parseDateKey(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const round1 = (v) => Math.round(v * 10) / 10;

// ---- charts ------------------------------------------------------------------------------

function niceCeil(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// points: [{ value, tip, label }]. Single series, one hue, tap a bar for its tooltip.
function barChart(points, fmt, title, tipId) {
  const W = 340, H = 150, padL = 34, padB = 20, padT = 8;
  const max = Math.max(...points.map((p) => p.value));
  if (!max) return emptyState(`No ${title.toLowerCase()} in this period.`);
  const niceMax = niceCeil(max);
  const n = points.length;
  const slot = (W - padL) / n;
  const bw = Math.max(2, slot - 2); // 2px surface gap between bars
  const y = (v) => padT + (H - padT - padB) * (1 - v / niceMax);
  const r = Math.min(4, bw / 2);
  const bars = points.map((p, i) => {
    const x = padL + i * slot + (slot - bw) / 2;
    const hit = `<rect class="hit" x="${padL + i * slot}" y="0" width="${slot}" height="${H - padB}" data-act="chartTip" data-tip-id="${tipId}" data-label="${esc(p.tip)}"><title>${esc(p.tip)}</title></rect>`;
    if (!p.value) return hit;
    const top = y(p.value), bottom = y(0);
    const rr = Math.min(r, bottom - top);
    const path = `M${x},${bottom}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + bw - rr}Q${x + bw},${top} ${x + bw},${top + rr}V${bottom}Z`;
    return `<path class="bar-mark" d="${path}"/>${hit}`;
  }).join('');
  // Skip the midline when it would land on a fraction (e.g. max of 1).
  const steps = Number.isInteger(niceMax / 2) ? [0, 0.5, 1] : [0, 1];
  const grid = steps.map((f) => {
    const v = niceMax * f;
    return `<line class="grid" x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis" x="${padL - 4}" y="${y(v) + 3}" text-anchor="end">${esc(fmt(v, true))}</text>`;
  }).join('');
  const lbl = (i, anchor) => `<text class="axis" x="${padL + i * slot + slot / 2}" y="${H - 5}" text-anchor="${anchor}">${esc(points[i].label)}</text>`;
  return `
    <div class="chart-tip small" id="${tipId}" aria-live="polite">Tap a bar for details</div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
      ${grid}${bars}${lbl(0, 'start')}${lbl(n - 1, 'end')}
    </svg>
    <details class="small"><summary>Show as table</summary>
      <table class="data-table"><tbody>
        ${points.filter((p) => p.value).reverse().map((p) => `<tr><td>${esc(p.tip)}</td></tr>`).join('')}
      </tbody></table>
    </details>`;
}

// ---- workouts tab --------------------------------------------------------------------------

function itemsByDay() {
  const sets = new Map(), acts = new Map();
  for (const s of list('sessions')) {
    const n = s.items.reduce((a, it) => a + it.sets.length, 0);
    if (n) sets.set(s.date, (sets.get(s.date) || 0) + n);
  }
  for (const a of list('activities')) acts.set(a.date, (acts.get(a.date) || 0) + 1);
  return { sets, acts };
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
    const v = byDay.get(d) || 0;
    out.push({ value: v, tip: `${prettyDate(d)}: ${v ? METRICS[key].fmt(v) : 'none'}`, label: shortDate(d) });
  }
  return out;
}

function records(exId) {
  let maxReps = 0, maxWeight = 0, maxTime = 0, totalReps = 0;
  const daysDone = new Set();
  for (const s of list('sessions')) {
    for (const it of s.items) {
      if (it.exerciseId !== exId) continue;
      for (const set of it.sets) {
        maxReps = Math.max(maxReps, set.reps || 0);
        maxWeight = Math.max(maxWeight, set.weight || 0);
        maxTime = Math.max(maxTime, set.duration || 0);
        totalReps += set.reps || 0;
        daysDone.add(s.date);
      }
    }
  }
  return { maxReps, maxWeight, maxTime, totalReps, days: daysDone.size };
}

// Exercises that have at least one logged set, most recent first.
function loggedExercises() {
  const seen = new Map();
  for (const s of [...list('sessions')].sort((a, b) => b.date.localeCompare(a.date))) {
    for (const it of s.items) if (it.sets.length && !seen.has(it.exerciseId)) seen.set(it.exerciseId, it.name);
  }
  return [...seen].map(([id, name]) => ({ id, ex: exerciseOf(id, name) }));
}

function heatmap() {
  const { sets, acts } = itemsByDay();
  const weeks = 13;
  const today = dateKey();
  const start = addDays(today, -parseDateKey(today).getDay() - (weeks - 1) * 7); // a Sunday
  const score = (d) => (sets.get(d) || 0) + (acts.get(d) || 0) * 5; // a walk/run ≈ 5 sets
  let max = 1;
  for (const d of new Set([...sets.keys(), ...acts.keys()])) max = Math.max(max, score(d));
  const cells = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const key = addDays(start, w * 7 + d);
      if (key > today) continue;
      const n = score(key);
      const lvl = n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4));
      const parts = [];
      if (sets.get(key)) parts.push(`${sets.get(key)} set${sets.get(key) === 1 ? '' : 's'}`);
      if (acts.get(key)) parts.push(`${acts.get(key)} walk/run`);
      const label = `${prettyDate(key)}: ${parts.join(', ') || 'nothing logged'}`;
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
      ${barChart(exerciseSeries(pickedExercise, metric, range), (v) => (metric === 'duration' ? fmtDuration(v) : Number.isInteger(v) ? `${v}` : v.toFixed(1)), M.label, 'ex-tip')}
      <div class="stat-row compact">
        ${ex.track.reps ? `<div class="stat"><span class="stat-num">${rec.maxReps}</span><span class="stat-label">best set (reps)</span></div>
          <div class="stat"><span class="stat-num">${rec.totalReps.toLocaleString()}</span><span class="stat-label">all-time reps</span></div>` : ''}
        ${ex.track.weight ? `<div class="stat"><span class="stat-num">${rec.maxWeight}</span><span class="stat-label">heaviest (${unit()})</span></div>` : ''}
        ${ex.track.duration ? `<div class="stat"><span class="stat-num">${fmtDuration(rec.maxTime)}</span><span class="stat-label">longest hold</span></div>` : ''}
        <div class="stat"><span class="stat-num">${rec.days}</span><span class="stat-label">days done</span></div>
      </div>
    </section>`;
}

function workoutsTab() {
  const { current, best } = streaks();
  const today = dateKey();
  const recent = list('sessions')
    .filter((s) => s.items.some((it) => it.sets.length))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.startedAt || '').localeCompare(a.startedAt || ''));
  const last30 = recent.filter((s) => s.planId && s.date > addDays(today, -30));
  const adh = adherence(30);
  const due = adh.reduce((a, x) => a + x.due, 0);
  const done = adh.reduce((a, x) => a + x.done, 0);

  return `
    <div class="stat-row">
      <div class="stat"><span class="stat-num">${current}</span><span class="stat-label">day streak</span></div>
      <div class="stat"><span class="stat-num">${best}</span><span class="stat-label">best streak</span></div>
      <div class="stat"><span class="stat-num">${last30.length}</span><span class="stat-label">plan workouts (30d)</span></div>
      <div class="stat"><span class="stat-num">${due ? Math.round((done / due) * 100) + '%' : 'n/a'}</span><span class="stat-label">on schedule (30d)</span></div>
    </div>
    <p class="muted small">Streak days: a plan fully completed, or a walk/run logged.</p>

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
        const title = s.adhoc ? 'Single exercises' : get('plans', s.planId)?.name || 'Workout';
        const status = s.adhoc
          ? `<span class="muted small">${s.items.filter((it) => it.sets.length).length} exercise(s)</span>`
          : `<span class="${complete ? 'ok' : 'muted'} small">${complete ? '✓ Complete' : Math.round(sessionProgress(s) * 100) + '%'}</span>`;
        return `<a class="list-row" href="#/workout/${s.id}">
          <span>${esc(title)}<br><span class="muted small">${esc(prettyDate(s.date))}</span></span>${status}
        </a>`;
      }).join('')}
    </div>` : emptyState('No workouts logged yet.')}`;
}

// ---- walks & runs tab ------------------------------------------------------------------------

function walksTab() {
  const today = dateKey();
  const acts = list('activities').sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const du = distUnit();
  const sumDist = (arr) => round1(arr.reduce((n, a) => n + (a.distance || 0), 0));
  const thisWeek = acts.filter((a) => a.date >= weekStart(today));
  const thisMonth = acts.filter((a) => a.date >= today.slice(0, 8) + '01');
  const weekTime = thisWeek.reduce((n, a) => n + (a.duration || 0), 0);

  const weeks = 12;
  const points = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const from = addDays(weekStart(today), -7 * w);
    const to = addDays(from, 6);
    const inWeek = acts.filter((a) => a.date >= from && a.date <= to);
    const d = sumDist(inWeek);
    points.push({ value: d, label: shortDate(from), tip: `Week of ${shortDate(from)}: ${d} ${du} (${inWeek.length} activit${inWeek.length === 1 ? 'y' : 'ies'})` });
  }

  return `
    <button class="btn primary wide" data-act="logActivity">${icons.walk} Log a walk or run</button>
    <div class="stat-row" style="margin-top:12px">
      <div class="stat"><span class="stat-num">${sumDist(thisWeek)}</span><span class="stat-label">${du} this week</span></div>
      <div class="stat"><span class="stat-num">${sumDist(thisMonth)}</span><span class="stat-label">${du} this month</span></div>
      <div class="stat"><span class="stat-num">${thisWeek.length}</span><span class="stat-label">activities this week</span></div>
      <div class="stat"><span class="stat-num">${durationText(weekTime) || '0:00'}</span><span class="stat-label">time this week</span></div>
    </div>

    <h2 class="section-title">Distance per week</h2>
    <section class="card">${barChart(points, (v) => `${round1(v)}`, `Distance (${du}) per week`, 'walk-tip')}</section>

    <h2 class="section-title">Recent</h2>
    ${acts.length ? `<div class="list card">
      ${acts.slice(0, 40).map((a) => `
        <button class="list-row as-button" data-act="editActivity" data-id="${a.id}">
          <span>${esc(a.type)}<br><span class="muted small">${esc(prettyDate(a.date))}${a.notes ? ` · ${esc(a.notes)}` : ''}</span></span>
          <span class="small">${esc(activityText(a))}</span>
        </button>`).join('')}
    </div>` : emptyState('No walks or runs yet.')}`;
}

// ---- body weight tab -------------------------------------------------------------------------------

function avg7(entries, date) {
  const from = addDays(date, -6);
  const win = entries.filter((e) => e.date >= from && e.date <= date);
  return win.length ? round1(win.reduce((n, e) => n + e.weight, 0) / win.length) : null;
}

function weightChart(entries, goal) {
  const today = dateKey();
  const from = addDays(today, -(weightRange - 1));
  const shown = entries.filter((e) => e.date >= from);
  if (!shown.length) return emptyState('No weights in this period.');
  const W = 340, H = 170, padL = 38, padR = 6, padB = 20, padT = 10;
  const avgs = shown.map((e) => ({ date: e.date, v: avg7(entries, e.date) }));
  const vals = [...shown.map((e) => e.weight), ...avgs.map((a) => a.v)];
  if (goal) vals.push(goal);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(1, (hi - lo) * 0.1);
  lo = Math.floor(lo - pad); hi = Math.ceil(hi + pad);
  const x = (d) => padL + (W - padL - padR) * (daysBetween(from, d) / Math.max(1, weightRange - 1));
  const y = (v) => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));
  const grid = [lo, (lo + hi) / 2, hi].map((v) => `
    <line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>
    <text class="axis" x="${padL - 4}" y="${y(v) + 3}" text-anchor="end">${round1(v)}</text>`).join('');
  const line = avgs.map((a, i) => `${i ? 'L' : 'M'}${x(a.date).toFixed(1)},${y(a.v).toFixed(1)}`).join('');
  const dots = shown.map((e) => `<circle class="dot" cx="${x(e.date)}" cy="${y(e.weight)}" r="3"/>`).join('');
  const hits = shown.map((e, i) => {
    const tip = `${prettyDate(e.date)}: ${e.weight} ${unit()} (7-day avg ${avgs[i].v})`;
    return `<rect class="hit" x="${x(e.date) - 6}" y="0" width="12" height="${H - padB}" data-act="chartTip" data-tip-id="weight-tip" data-label="${esc(tip)}"><title>${esc(tip)}</title></rect>`;
  }).join('');
  const goalLine = goal ? `<line class="goal-line" x1="${padL}" x2="${W - padR}" y1="${y(goal)}" y2="${y(goal)}"/>
    <text class="axis goal-label" x="${W - padR}" y="${y(goal) - 4}" text-anchor="end">Goal ${goal}</text>` : '';
  return `
    <div class="legend small">
      <span><i class="lg-dot"></i>Daily</span><span><i class="lg-line"></i>7-day average</span>${goal ? '<span><i class="lg-dash"></i>Goal</span>' : ''}
    </div>
    <div class="chart-tip small" id="weight-tip" aria-live="polite">Tap a point for details</div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Body weight over the last ${weightRange} days">
      ${grid}${goalLine}<path class="avg-line" d="${line}"/>${dots}${hits}
      <text class="axis" x="${padL}" y="${H - 5}" text-anchor="start">${esc(shortDate(from))}</text>
      <text class="axis" x="${W - padR}" y="${H - 5}" text-anchor="end">${esc(shortDate(today))}</text>
    </svg>`;
}

function weightTab() {
  const entries = weightsSorted();
  const st = getState().settings;
  const u = unit();
  const latest = entries.at(-1);
  const goal = st.goalWeight || 0;

  let change30 = null;
  if (latest) {
    const cutoff = addDays(latest.date, -30);
    const base = [...entries].reverse().find((e) => e.date <= cutoff) || entries[0];
    if (base !== latest) change30 = round1(latest.weight - base.weight);
  }

  let goalHtml = '';
  if (goal && latest) {
    const start = st.goalStart || entries.find((e) => e.date >= (st.goalSetOn || '0'))?.weight || latest.weight;
    const need = start - goal;
    const frac = need ? Math.max(0, Math.min(1, (start - latest.weight) / need)) : 1;
    const toGo = round1(Math.abs(latest.weight - goal));
    const reached = need > 0 ? latest.weight <= goal : latest.weight >= goal;
    goalHtml = `
      <section class="card">
        <div class="row-between"><b>Goal: ${goal} ${u}</b><span class="small ${reached ? 'ok' : 'muted'}">${reached ? '✓ Reached!' : `${toGo} ${u} to go`}</span></div>
        ${progressBar(frac, 'Progress toward goal')}
        <p class="muted small">Started at ${start} ${u}${st.goalSetOn ? ` on ${esc(prettyDate(st.goalSetOn))}` : ''}.</p>
      </section>`;
  }

  return `
    <div class="btn-row">
      <button class="btn primary" data-act="logWeight">${icons.scale} Log weight</button>
      <button class="btn" data-act="setGoal">${goal ? 'Edit goal' : 'Set a goal'}</button>
    </div>
    ${latest ? `
      <div class="stat-row" style="margin-top:12px">
        <div class="stat"><span class="stat-num">${latest.weight}</span><span class="stat-label">${u}, latest (${esc(shortDate(latest.date))})</span></div>
        <div class="stat"><span class="stat-num">${avg7(entries, latest.date)}</span><span class="stat-label">7-day average</span></div>
        <div class="stat"><span class="stat-num">${change30 === null ? 'n/a' : `${change30 > 0 ? '+' : ''}${change30}`}</span><span class="stat-label">change, 30 days</span></div>
      </div>
      ${goalHtml}
      <h2 class="section-title">Trend</h2>
      <section class="card">
        <div class="filters"><div class="seg" role="group" aria-label="Range">
          ${[30, 90, 365].map((r) => `<button class="${r === weightRange ? 'on' : ''}" data-act="pickWeightRange" data-r="${r}" aria-pressed="${r === weightRange}">${r === 365 ? '1y' : `${r}d`}</button>`).join('')}
        </div></div>
        ${weightChart(entries, goal)}
      </section>
      <h2 class="section-title">Entries</h2>
      <div class="list card">
        ${[...entries].reverse().slice(0, 14).map((e) => `
          <button class="list-row as-button" data-act="editWeight" data-date="${e.date}">
            <span>${esc(prettyDate(e.date))}</span><span>${e.weight} ${u}</span>
          </button>`).join('')}
      </div>
      <p class="muted small">Only you see your weight. It's not shared with the household.</p>`
    : `<div style="margin-top:12px">${emptyState('Log your weight to start a trend. A few times a week is plenty.')}</div>`}`;
}

// ---- page -------------------------------------------------------------------------------------

const TABS = [['workouts', 'Workouts'], ['walks', 'Walks & runs'], ['weight', 'Weight']];

export function render() {
  return `
    <header class="page-head"><h1>Progress</h1></header>
    <div class="seg wide tabs" role="tablist">
      ${TABS.map(([k, label]) => `<button role="tab" class="${k === tab ? 'on' : ''}" aria-selected="${k === tab}" data-act="pickTab" data-tab="${k}">${label}</button>`).join('')}
    </div>
    ${tab === 'walks' ? walksTab() : tab === 'weight' ? weightTab() : workoutsTab()}
  `;
}

const showTip = (el, id) => {
  document.getElementById(id).textContent = el.dataset.label;
  el.closest('svg, .heatmap')?.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
  el.classList.add('sel');
  return false;
};

export const actions = {
  pickTab({ el }) { tab = el.dataset.tab; scrollTo(0, 0); },
  heatTip: ({ el }) => showTip(el, 'heat-tip'),
  chartTip: ({ el }) => showTip(el, el.dataset.tipId),
  pickExercise({ el }) { pickedExercise = el.value; metric = null; },
  pickMetric({ el }) { metric = el.value; },
  pickRange({ el }) { range = +el.dataset.r; },
  pickWeightRange({ el }) { weightRange = +el.dataset.r; },
  editWeight: ({ el }) => weightSheet(el.dataset.date),
  setGoal: () => goalSheet(),
};
