// Numbers shared by the screens and by the household summary that syncs to Drive.

import { list, getState, isScheduled, sessionFor, sessionComplete, sessionProgress } from './store.js';
import { dateKey, addDays, parseDateKey, now } from './util.js';

// A day counts toward the streak if a plan was fully completed or a walk/run was logged.
// Single exercises (no plan) don't count.
export function activeDays() {
  const days = new Set();
  for (const s of list('sessions')) if (s.planId && sessionComplete(s)) days.add(s.date);
  for (const a of list('activities')) days.add(a.date);
  return days;
}

// Current streak counts back from today; if today isn't done yet, from yesterday.
export function streaks() {
  const days = activeDays();
  let current = 0;
  let d = dateKey();
  if (!days.has(d)) d = addDays(d, -1);
  while (days.has(d)) { current++; d = addDays(d, -1); }

  let best = 0, run = 0, prev = null;
  for (const day of [...days].sort()) {
    run = prev && addDays(prev, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  return { current, best };
}

// Weeks start on Monday.
export const weekStart = (key = dateKey()) => addDays(key, -((parseDateKey(key).getDay() + 6) % 7));

export function weekStats(key = dateKey()) {
  const from = weekStart(key);
  const workouts = list('sessions').filter((s) => s.planId && s.date >= from && s.date <= key && sessionComplete(s)).length;
  const acts = list('activities').filter((a) => a.date >= from && a.date <= key);
  const distance = acts.reduce((n, a) => n + (a.distance || 0), 0);
  return { workouts, activities: acts.length, distance: Math.round(distance * 10) / 10 };
}

// Plans due (or started) today, with how far along each is.
export function todayPlans(key = dateKey()) {
  return list('plans')
    .filter((p) => isScheduled(p, key) || sessionFor(p.id, key))
    .map((p) => {
      const s = sessionFor(p.id, key);
      return { name: p.name, done: !!s && sessionComplete(s), pct: s ? Math.round(sessionProgress(s) * 100) : 0 };
    });
}

// The small, shareable summary other household profiles see (no body weight).
export function summary(profile) {
  const st = getState().settings;
  const { current, best } = streaks();
  return {
    id: profile.id,
    name: st.name || profile.name,
    updatedAt: now(),
    date: dateKey(),
    streak: current,
    best,
    week: weekStats(),
    distUnit: st.distUnit || 'mi',
    today: todayPlans(),
  };
}
