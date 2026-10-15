// Run programs: build up to a target pace (e.g. an 8:00 mile) over a day-by-day schedule.
// Pure logic (no screen code): paces, treadmill speeds, workout templates, segments.

import { daysBetween, addDays } from './util.js';

// Paces are seconds per unit (mile or km). Speed work is relative to the target:
// for an 8:00 target it's 6:30 (390/480), and it scales for other targets.
const SPEED_RATIO = 390 / 480;
const EASY_RATIO = 1.2;          // easy runs: about 20% slower than target
const WALK_SPEED = { mi: 3.5, km: 5.6 };     // brisk walk, mph / km/h
const COOL_SPEED = { mi: 3.0, km: 4.8 };

export const paces = (plan) => ({
  target: plan.pace,
  speed: Math.round(plan.pace * SPEED_RATIO),
  easy: Math.round(plan.pace * EASY_RATIO),
});

// "8:00" -> 480. Accepts "8", "8:00", "8.5" (minutes). Returns 0 if not understood.
export function parsePace(text) {
  const t = String(text || '').trim();
  let m;
  if ((m = t.match(/^(\d{1,2}):(\d{1,2})$/))) return +m[1] * 60 + +m[2];
  if ((m = t.match(/^\d{1,2}(\.\d+)?$/))) return Math.round(parseFloat(t) * 60);
  return 0;
}

export const paceText = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
export const speedOf = (sec) => Math.round((3600 / sec) * 10) / 10;            // pace -> mph or km/h
export const speedUnit = (unit) => (unit === 'km' ? 'km/h' : 'mph');
export const speedText = (sec, unit) => `${speedOf(sec)} ${speedUnit(unit)}`;

// ---- workout templates ----------------------------------------------------------------
// work/rest are seconds; reps is how many work+rest rounds.

export const TEMPLATES = {
  runwalk: { name: 'Run/walk 60/120', short: 'Run/walk', work: 60, rest: 120, reps: 8, workKind: 'run', restKind: 'walk', pace: 'target' },
  sprint: { name: 'Sprints 30/60', short: 'Sprints', work: 30, rest: 60, reps: 8, workKind: 'sprint', restKind: 'recover', pace: 'speed' },
  speed: { name: 'Speed work', short: 'Speed', work: 90, rest: 150, reps: 4, workKind: 'run', restKind: 'walk', pace: 'speed' },
  tempo: { name: 'Tempo', short: 'Tempo', work: 240, rest: 120, reps: 3, workKind: 'run', restKind: 'walk', pace: 'target' },
  easy: { name: 'Easy run', short: 'Easy', work: 900, rest: 0, reps: 1, workKind: 'run', restKind: 'walk', pace: 'easy' },
  trial: { name: '1-mile time trial', short: 'Time trial', reps: 1, pace: 'target' },
  rest: { name: 'Rest day', short: 'Rest' },
};

// Which template fields a day can change.
export const EDITABLE = {
  runwalk: ['reps'], sprint: ['reps'], speed: ['reps'], tempo: ['reps', 'work'], easy: ['work'], trial: [], rest: [],
};

const d = (type, reps, work) => ({ type, ...(reps ? { reps } : {}), ...(work ? { work } : {}) });

// The standard 18 days: run/walk building up, sprints, speed work at speed pace,
// tempo at target pace, rest every third day, ending with a 1-mile time trial.
export const standardProgram = () => [
  d('runwalk', 6), d('rest'), d('sprint', 6),
  d('runwalk', 8), d('rest'), d('tempo', 3, 180),
  d('speed', 4), d('rest'), d('runwalk', 10),
  d('sprint', 8), d('rest'), d('tempo', 3, 300),
  d('speed', 6), d('rest'), d('tempo', 2, 480),
  d('easy', 0, 900), d('rest'), d('trial'),
];

// ---- days & schedule --------------------------------------------------------------------

// 1-based day number for a date, or 0 before the start / beyond the end.
export function dayNumber(plan, key) {
  if (!plan.startDate || key < plan.startDate) return 0;
  const n = daysBetween(plan.startDate, key) + 1;
  return n <= plan.program.length ? n : 0;
}

export const dayAt = (plan, n) => (n ? plan.program[n - 1] : null);
export const isFinished = (plan, key) => !!plan.startDate && daysBetween(plan.startDate, key) >= plan.program.length;
export const dateOfDay = (plan, n) => addDays(plan.startDate, n - 1);

// Next non-rest day after day n (for "Next:" hints on rest days).
export function nextWorkoutDay(plan, n) {
  for (let k = n + 1; k <= plan.program.length; k++) if (plan.program[k - 1].type !== 'rest') return k;
  return 0;
}

const fmtMin = (secs) => (secs % 60 ? paceText(secs) : `${secs / 60} min`);
const fmtSec = (secs) => (secs < 60 ? `${secs}s` : secs % 60 ? paceText(secs) : `${secs / 60} min`);

export function describeDay(day) {
  const t = TEMPLATES[day.type];
  const reps = day.reps ?? t.reps;
  const work = day.work ?? t.work;
  switch (day.type) {
    case 'rest': return 'Rest day';
    case 'trial': return '1-mile time trial';
    case 'easy': return `Easy run ${fmtMin(work)}`;
    case 'tempo': return `Tempo ${reps} × ${fmtMin(work)}`;
    case 'speed': return `Speed ${reps} × ${fmtSec(work)}`;
    default: return `${t.name} × ${reps}`;
  }
}

// ---- segments -----------------------------------------------------------------------------
// A segment is one stretch of the session: { kind, label, secs (0 = until you tap Done), pace, cue }.

export function segmentsFor(plan, day) {
  if (!day || day.type === 'rest') return [];
  const t = TEMPLATES[day.type];
  const p = paces(plan);
  const u = plan.paceUnit || 'mi';
  const walk = { mi: 1029, km: 643 }[u];   // brisk walk pace (3.5 mph / 5.6 km/h), for distance estimates
  const segs = [{ kind: 'warmup', label: 'Warm-up', secs: 300, speed: WALK_SPEED[u], note: 'Brisk walk', pace: walk }];

  if (day.type === 'trial') {
    const goal = Math.round(p.target * (u === 'km' ? 1.609 : 1)); // target time for the mile
    segs.push({ kind: 'trial', label: `1 ${u === 'km' ? 'mile (1.61 km)' : 'mile'} for time`, secs: 0, pace: p.target, goal,
      note: `Goal ${paceText(goal)} for the mile` });
  } else {
    const reps = day.reps ?? t.reps;
    const work = day.work ?? t.work;
    const rest = day.rest ?? t.rest;
    const workPace = p[t.pace];
    for (let r = 1; r <= reps; r++) {
      segs.push({ kind: t.workKind, label: t.workKind === 'sprint' ? 'All-out' : 'Run', secs: work, pace: workPace, round: r, rounds: reps,
        note: t.workKind === 'sprint' ? `≈ ${speedText(workPace, u)} or faster` : '' });
      if (rest && r < reps) {
        segs.push({ kind: t.restKind, label: t.restKind === 'recover' ? 'Recover' : 'Walk', secs: rest, pace: walk, speed: WALK_SPEED[u], round: r, rounds: reps,
          note: t.restKind === 'recover' ? 'Walk or easy jog' : 'Walk' });
      }
    }
  }
  segs.push({ kind: 'cooldown', label: 'Cool-down', secs: 300, speed: COOL_SPEED[u], note: 'Easy walk', pace: walk * 1.15 });
  return segs;
}

export const totalSecs = (segs) => segs.reduce((n, s) => n + (s.secs || 0), 0);

// Rough distance covered, for prefilling the log (treadmill display is better if you have it).
export function estimateDistance(segs, trialSecs = 0, unit = 'mi') {
  let dist = 0;
  for (const s of segs) {
    const secs = s.kind === 'trial' ? trialSecs : s.secs;
    if (s.kind === 'trial') dist += unit === 'km' ? 1.61 : 1;   // a time trial is one mile
    else if (s.pace && secs) dist += secs / s.pace;
  }
  return Math.round(dist * 100) / 100;
}

// Display speed for a segment: walking speeds are fixed, running speeds come from the pace.
export const segSpeed = (seg) => seg.speed ?? speedOf(seg.pace);
