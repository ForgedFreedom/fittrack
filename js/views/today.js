import { list, isScheduled, sessionFor, sessionProgress, sessionComplete, startSession, getState, rampPct, planWeek } from '../store.js';
import { esc, dateKey, prettyDate } from '../util.js';
import { icons } from '../ui.js';
import * as sync from '../sync.js';
import { progressBar, scheduleText, streaks, emptyState } from './common.js';

function planCard(plan, today, scheduled) {
  const s = sessionFor(plan.id, today);
  const frac = s ? sessionProgress(s) : 0;
  const done = s && sessionComplete(s);
  const pct = rampPct(plan, today);
  const btn = done
    ? `<button class="btn" data-act="openPlanToday" data-plan="${plan.id}">${icons.check} Done. View</button>`
    : `<button class="btn primary" data-act="openPlanToday" data-plan="${plan.id}">${icons.play} ${s ? 'Continue' : scheduled ? 'Start' : 'Do it anyway'}</button>`;
  return `
    <section class="card plan-card ${done ? 'done' : ''}">
      <div class="card-head">
        <h3>${esc(plan.name)}</h3>
        <span class="muted small">${plan.items.length} exercises</span>
      </div>
      <p class="muted small">${esc(scheduleText(plan))}${pct < 100 ? ` · Week ${planWeek(plan, today)}: ${pct}% volume` : ''}</p>
      ${s ? progressBar(frac, `${plan.name} progress`) : ''}
      ${btn}
    </section>`;
}

export function render() {
  const today = dateKey();
  const name = getState().settings.name;
  const active = list('plans').filter((p) => p.active);
  const due = active.filter((p) => isScheduled(p, today));
  const other = active.filter((p) => !isScheduled(p, today));
  const { current, best } = streaks();

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return `
    <header class="page-head">
      <p class="muted">${esc(prettyDate(today))}</p>
      <h1>${greet}${name ? `, ${esc(name)}` : ''}</h1>
    </header>

    ${sync.isConnected() && sync.isDirty() ? `
      <button class="btn small sync-nudge" data-act="syncNow">${icons.sync} Back up to Google Drive</button>` : ''}

    <div class="stat-row">
      <div class="stat"><span class="stat-num">${icons.fire}${current}</span><span class="stat-label">day streak</span></div>
      <div class="stat"><span class="stat-num">${best}</span><span class="stat-label">best streak</span></div>
    </div>

    <h2 class="section-title">Today</h2>
    ${due.length
      ? due.map((p) => planCard(p, today, true)).join('')
      : active.length
        ? emptyState('Nothing scheduled today. Enjoy the rest day, or pick one below.')
        : emptyState('No active plans yet.', `<a class="btn primary" href="#/plans">Choose a plan</a>`)}

    ${other.length ? `
      <h2 class="section-title">Other active plans</h2>
      ${other.map((p) => planCard(p, today, false)).join('')}` : ''}
  `;
}

export const actions = {
  openPlanToday({ el }) {
    const s = startSession(el.dataset.plan, dateKey());
    location.hash = `#/workout/${s.id}`;
  },
};
