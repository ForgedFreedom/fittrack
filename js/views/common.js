// Formatting helpers shared by several screens.

import { get, getState, list, sessionComplete } from '../store.js';
import { esc, fmtDuration, DAY_NAMES, dateKey, addDays } from '../util.js';

const MISSING = { name: 'Removed exercise', track: { reps: true }, perSide: false, notes: '' };

export const exerciseOf = (id, savedName) =>
  get('exercises', id) || (savedName ? { ...MISSING, name: savedName } : MISSING);
export const unit = () => getState().settings.unit || 'lb';

export function targetText(target, ex) {
  const parts = [];
  const sets = target.sets || 1;
  if (ex.track.reps && target.reps) parts.push(`${sets} × ${target.reps} reps`);
  else if (ex.track.duration && target.duration) parts.push(`${sets} × ${fmtDuration(target.duration)}`);
  else parts.push(`${sets} set${sets === 1 ? '' : 's'}`);
  if (ex.track.reps && ex.track.duration && target.reps && target.duration) parts.push(fmtDuration(target.duration));
  if (ex.perSide) parts.push('each side');
  if (ex.track.weight && target.weight) parts.push(`${target.weight} ${unit()}`);
  if (target.rest) parts.push(`rest ${fmtDuration(target.rest)}`);
  return parts.join(' · ');
}

export function setText(set, ex) {
  const parts = [];
  if (ex.track.reps && set.reps != null) parts.push(`${set.reps}`);
  if (ex.track.weight && set.weight) parts.push(`${set.weight}${unit()}`);
  if (ex.track.duration && set.duration) parts.push(fmtDuration(set.duration));
  return parts.join(' × ') || '✓';
}

export function scheduleText(plan) {
  if (!plan.days?.length || plan.days.length === 7) return 'Every day';
  if (plan.days.join() === '1,2,3,4,5') return 'Weekdays';
  return [...plan.days].sort().map((d) => DAY_NAMES[d]).join(', ');
}

export const progressBar = (frac, label = '') => `
  <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(frac * 100)}" ${label ? `aria-label="${esc(label)}"` : ''}>
    <span style="width:${Math.round(frac * 100)}%"></span>
  </div>`;

export const backLink = (href, label) =>
  `<a class="back" href="${href}">‹ ${esc(label)}</a>`;

// Days (YYYY-MM-DD) on which at least one session was fully completed.
export function completedDays() {
  const days = new Set();
  for (const s of list('sessions')) if (sessionComplete(s)) days.add(s.date);
  return days;
}

// Current streak counts back from today; if today isn't done yet, from yesterday.
export function streaks() {
  const days = completedDays();
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

export const emptyState = (msg, actionHtml = '') =>
  `<div class="empty"><p>${esc(msg)}</p>${actionHtml}</div>`;
