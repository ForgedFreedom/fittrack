// Formatting helpers shared by several screens.

import { get, getState } from '../store.js';
import { esc, fmtDuration, DAY_NAMES } from '../util.js';

const MISSING = { name: 'Removed exercise', track: { reps: true }, perSide: false, notes: '' };

export const exerciseOf = (id, savedName) =>
  get('exercises', id) || (savedName ? { ...MISSING, name: savedName } : MISSING);
export const unit = () => getState().settings.unit || 'lb';

// `timer` is whether this item uses the on-screen timer (countdown, or stopwatch at 0s).
export function targetText(target, ex, timer = false) {
  const parts = [];
  const sets = target.sets || 1;
  if (ex.track.reps && target.reps) parts.push(`${sets} × ${target.reps} reps`);
  else if (ex.track.duration && target.duration) parts.push(`${sets} × ${fmtDuration(target.duration)}`);
  else parts.push(`${sets} set${sets === 1 ? '' : 's'}`);
  const timeShown = !(ex.track.reps && target.reps) && ex.track.duration && target.duration;
  if (timer) parts.push(target.duration ? `${timeShown ? '' : fmtDuration(target.duration) + ' '}timer`.trim() : 'stopwatch');
  else if (!timeShown && target.duration && ex.track.duration) parts.push(fmtDuration(target.duration));
  if (ex.perSide) parts.push('each side');
  if (ex.track.weight && target.weight) parts.push(`${target.weight} ${unit()}`);
  if (target.rest) parts.push(`rest ${fmtDuration(target.rest)}`);
  return parts.join(' · ');
}

// Sets timed with the stopwatch/timer show their time too, e.g. "13 · 0:42".
export function setText(set, ex) {
  const main = [];
  if (ex.track.reps && set.reps != null) main.push(`${set.reps}`);
  if (ex.track.weight && set.weight) main.push(`${set.weight}${unit()}`);
  const head = main.join(' × ');
  if (set.duration) return head ? `${head} · ${fmtDuration(set.duration)}` : fmtDuration(set.duration);
  return head || '✓';
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

export { streaks } from '../stats.js';

export const emptyState = (msg, actionHtml = '') =>
  `<div class="empty"><p>${esc(msg)}</p>${actionHtml}</div>`;
