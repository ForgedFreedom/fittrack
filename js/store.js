// Local-first data store. Everything lives in localStorage as one JSON blob.
// Records carry `updatedAt`; deletes are tombstones ({deleted: true}) so that
// syncing between devices can merge record-by-record (last write wins).

import { uid, now, dateKey, parseDateKey, daysBetween } from './util.js';
import { seedData, SEED_TIME } from './seed.js';

// Each profile (person) has its own blob: fittrack:data:v1:<profileId>.
const keyFor = (profileId) => `fittrack:data:v1:${profileId}`;
export const COLLECTIONS = ['exercises', 'plans', 'sessions', 'activities', 'weights'];

let state;
let key;
const listeners = new Set();

// Defaults are stamped with an old time so that real edits always win a merge.
export function emptyState() {
  return {
    version: 1,
    settings: { name: '', unit: 'lb', distUnit: 'mi', autoStart: true, grace: 2, updatedAt: SEED_TIME },
    exercises: {},
    plans: {},
    sessions: {},
    activities: {},
    weights: {},
  };
}

export function newState({ seed = true, name = '' } = {}) {
  const st = emptyState();
  if (seed) seedData(st);
  if (name) st.settings = { ...st.settings, name, updatedAt: now() };
  return st;
}

export function writeInitial(profileId, st) {
  localStorage.setItem(keyFor(profileId), JSON.stringify(st));
}

export function load(profileId) {
  key = keyFor(profileId);
  try {
    state = JSON.parse(localStorage.getItem(key));
  } catch {
    state = null;
  }
  if (!state || state.version !== 1) {
    state = newState();
    persist();
  }
  for (const c of COLLECTIONS) state[c] ||= {}; // data saved before a collection existed
  return state;
}

function persist() {
  localStorage.setItem(key, JSON.stringify(state));
  localStorage.setItem('fittrack:dirty', '1');
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed() {
  persist();
  listeners.forEach((fn) => fn());
}

export const getState = () => state;

export function replaceState(next) {
  state = next;
  changed();
}

// ---- generic record access -------------------------------------------------

export function list(coll) {
  return Object.values(state[coll]).filter((r) => !r.deleted);
}

export function get(coll, id) {
  const r = state[coll][id];
  return r && !r.deleted ? r : null;
}

export function upsert(coll, record) {
  if (!record.id) record.id = uid();
  record.updatedAt = now();
  state[coll][record.id] = record;
  changed();
  return record;
}

export function remove(coll, id) {
  state[coll][id] = { id, deleted: true, updatedAt: now() };
  changed();
}

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch, updatedAt: now() };
  changed();
}

// ---- merge (used by sync) ---------------------------------------------------

const newer = (a, b) => ((a?.updatedAt || '') >= (b?.updatedAt || '') ? a : b);

export function mergeStates(local, remote) {
  if (!remote || remote.version !== 1) return local;
  const out = emptyState();
  out.settings = newer(local.settings, remote.settings);
  for (const coll of COLLECTIONS) {
    const ids = new Set([...Object.keys(local[coll] || {}), ...Object.keys(remote[coll] || {})]);
    for (const id of ids) {
      const a = local[coll]?.[id];
      const b = remote[coll]?.[id];
      out[coll][id] = a && b ? newer(a, b) : a || b;
    }
  }
  return out;
}

// ---- plans & schedule -------------------------------------------------------

// plan.days: array of weekday numbers (0=Sun). Empty = every day.
export function isScheduled(plan, key = dateKey()) {
  if (!plan.active) return false;
  if (plan.startDate && key < plan.startDate) return false;
  if (!plan.days?.length) return true;
  return plan.days.includes(parseDateKey(key).getDay());
}

// Week number (1-based) since the plan's start date.
export function planWeek(plan, key = dateKey()) {
  if (!plan.startDate) return 1;
  return Math.max(1, Math.floor(daysBetween(plan.startDate, key) / 7) + 1);
}

// plan.ramp: [{week, pct}] meaning "from this week on, targets are pct% of full".
export function rampPct(plan, key = dateKey()) {
  if (!plan.ramp?.length) return 100;
  const wk = planWeek(plan, key);
  let pct = 100;
  for (const step of [...plan.ramp].sort((a, b) => a.week - b.week)) {
    if (wk >= step.week) pct = step.pct;
  }
  return pct;
}

// Target for one plan item on a given day. The ramp scales reps only, so
// warm-ups, stretches and holds keep their full time.
export function targetFor(item, plan, key = dateKey()) {
  const pct = rampPct(plan, key) / 100;
  return {
    sets: item.sets || 1,
    reps: item.reps ? Math.max(1, Math.round(item.reps * pct)) : 0,
    duration: item.duration || 0,
    weight: item.weight || 0,
    rest: item.rest || 0,
  };
}

// Timer is on unless explicitly turned off (older data has no flag).
export const timerOn = (item) => item.timer !== false;

// ---- sessions -----------------------------------------------------------------

export function sessionFor(planId, key = dateKey()) {
  const matches = list('sessions').filter((s) => s.planId === planId && s.date === key);
  if (!matches.length) return null;
  return matches.sort((a, b) => setCount(b) - setCount(a))[0];
}

const setCount = (s) => s.items.reduce((n, it) => n + it.sets.length, 0);

// Build item list from the plan, keeping any sets already logged.
function buildItems(plan, key, existing = []) {
  const byId = new Map(existing.map((it) => [it.itemId, it]));
  const items = plan.items.map((pi) => {
    const prev = byId.get(pi.id);
    return {
      itemId: pi.id,
      exerciseId: pi.exerciseId,
      name: get('exercises', pi.exerciseId)?.name, // kept in case the exercise is deleted later
      // "Custom…" changes apply to this workout only, so keep them over the plan's values.
      target: prev?.custom ? prev.target : targetFor(pi, plan, key),
      timer: prev?.custom ? prev.timer : timerOn(pi),
      custom: !!prev?.custom,
      sets: prev?.sets || [],
    };
  });
  // Keep removed-from-plan items only if they already have logged work.
  for (const it of existing) {
    if (!plan.items.some((pi) => pi.id === it.itemId) && it.sets.length) items.push(it);
  }
  return items;
}

export function startSession(planId, key = dateKey()) {
  const plan = get('plans', planId);
  const existing = sessionFor(planId, key);
  if (existing) {
    // Refresh targets in case the plan was edited.
    existing.items = buildItems(plan, key, existing.items);
    return upsert('sessions', existing);
  }
  return upsert('sessions', {
    planId,
    date: key,
    startedAt: now(),
    items: buildItems(plan, key),
  });
}

export function itemDone(it) {
  return it.sets.length >= (it.target.sets || 1);
}

export function sessionProgress(s) {
  let need = 0, got = 0;
  for (const it of s.items) {
    const t = it.target.sets || 1;
    need += t;
    got += Math.min(it.sets.length, t);
  }
  return need ? got / need : 0;
}

export const sessionComplete = (s) => s.items.length > 0 && s.items.every(itemDone);

// ---- single exercises (no plan) ----------------------------------------------------
// One "single exercises" session per day; exercises are added to it as you go.

export function defaultItem(exerciseId) {
  const ex = get('exercises', exerciseId);
  const track = ex?.track || { reps: true };
  return {
    id: uid(),
    exerciseId,
    sets: 3,
    reps: track.reps ? 10 : 0,
    duration: track.duration ? 30 : 0,
    weight: 0,
    rest: 45,
    timer: true, // on by default; 0 seconds = stopwatch
  };
}

export const adhocFor = (key = dateKey()) =>
  list('sessions').find((s) => s.adhoc && s.date === key) || null;

export function addAdhocExercise(exerciseId, key = dateKey()) {
  const s = adhocFor(key) || { adhoc: true, planId: null, date: key, startedAt: now(), items: [] };
  const pi = defaultItem(exerciseId);
  s.items.push({
    itemId: pi.id,
    exerciseId,
    name: get('exercises', exerciseId)?.name,
    target: targetFor(pi, { ramp: [] }, key),
    timer: true,
    custom: false,
    sets: [],
  });
  return upsert('sessions', s);
}

// ---- body weight ------------------------------------------------------------------------
// One entry per day, keyed by date so two devices logging the same day don't duplicate.

export function logWeight(date, weight) {
  return upsert('weights', { id: `w-${date}`, date, weight });
}

export const weightsSorted = () => list('weights').sort((a, b) => a.date.localeCompare(b.date));
