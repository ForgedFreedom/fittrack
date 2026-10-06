import { list, isScheduled, sessionFor, sessionProgress, sessionComplete, startSession, getState, rampPct, planWeek, adhocFor, addAdhocExercise } from '../store.js';
import { esc, dateKey, prettyDate } from '../util.js';
import { icons, sheet, toast } from '../ui.js';
import { inbox, accept, dismiss } from '../share.js';
import * as sync from '../sync.js';
import { current as currentProfile } from '../profiles.js';
import { summary } from '../stats.js';
import { progressBar, scheduleText, streaks, emptyState } from './common.js';
import { exerciseOptions } from './plans.js';
import { activitySheet, weightSheet, activityText } from './logsheets.js';

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

const ago = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function memberCard(m, isMe) {
  const fresh = m.date === dateKey();
  const week = [`${m.week.workouts} workout${m.week.workouts === 1 ? '' : 's'}`];
  if (m.week.distance) week.push(`${m.week.distance} ${m.distUnit}`);
  return `
    <div class="member">
      <div class="row-between">
        <b>${esc(isMe ? `${m.name} (you)` : m.name)}</b>
        <span class="streak">${icons.fire}${m.streak}</span>
      </div>
      <p class="muted small">This week: ${esc(week.join(' · '))}</p>
      ${fresh
        ? (m.today.length
          ? `<div class="mini-plans">${m.today.map((p) => `<span class="mini ${p.done ? 'done' : ''}">${p.done ? '✓' : `${p.pct}%`} ${esc(p.name)}</span>`).join('')}</div>`
          : '<p class="muted small">Rest day</p>')
        : '<p class="muted small">Not updated today</p>'}
      ${isMe ? '' : `<p class="muted tiny">Updated ${esc(ago(m.updatedAt))}</p>`}
    </div>`;
}

function householdSection() {
  const others = sync.isConnected() ? sync.household() : [];
  if (!others.length) return '';
  const me = summary(currentProfile());
  return `
    <div class="row-between section-title-row">
      <h2 class="section-title">Household</h2>
      <button class="btn ghost small" data-act="syncNow" aria-label="Refresh household">${icons.sync}</button>
    </div>
    <div class="household">
      ${memberCard(me, true)}
      ${others.map((m) => memberCard(m, false)).join('')}
    </div>`;
}

export function render() {
  const today = dateKey();
  const name = getState().settings.name;
  const active = list('plans').filter((p) => p.active);
  const due = active.filter((p) => isScheduled(p, today));
  const other = active.filter((p) => !isScheduled(p, today));
  const adhoc = adhocFor(today);
  const acts = list('activities').filter((a) => a.date === today);
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

    ${inbox().map((s) => `
      <section class="card share-card">
        <p>${icons.share} <b>${esc(s.from.name)}</b> shared a plan with you</p>
        <h3>${esc(s.plan.name)}</h3>
        <p class="muted small">${s.plan.items.length} exercises · ${esc(scheduleText(s.plan))}</p>
        <div class="btn-row">
          <button class="btn primary" data-act="acceptShare" data-id="${s.inboxId}">Add plan</button>
          <button class="btn" data-act="dismissShare" data-id="${s.inboxId}">Dismiss</button>
        </div>
      </section>`).join('')}

    <div class="stat-row">
      <div class="stat"><span class="stat-num">${icons.fire}${current}</span><span class="stat-label">day streak</span></div>
      <div class="stat"><span class="stat-num">${best}</span><span class="stat-label">best streak</span></div>
    </div>

    <div class="quick-add" role="group" aria-label="Quick add">
      <button class="btn" data-act="logSingleExercise">${icons.exercises}<span>Exercise</span></button>
      <button class="btn" data-act="logActivity">${icons.walk}<span>Walk / run</span></button>
      <button class="btn" data-act="logWeight">${icons.scale}<span>Weight</span></button>
    </div>

    ${householdSection()}

    <h2 class="section-title">Today</h2>
    ${due.length
      ? due.map((p) => planCard(p, today, true)).join('')
      : active.length
        ? emptyState('No plans scheduled today. Enjoy the rest day, or pick one below.')
        : emptyState('No active plans yet.', `<a class="btn primary" href="#/plans">Choose a plan</a>`)}

    ${adhoc?.items.length ? `
      <section class="card">
        <div class="card-head"><h3>Single exercises</h3><span class="muted small">${adhoc.items.length} logged today</span></div>
        <p class="muted small">${esc(adhoc.items.map((it) => it.name).join(', '))}</p>
        <a class="btn" href="#/workout/${adhoc.id}">Open</a>
      </section>` : ''}

    ${acts.length ? `
      <div class="list card">
        ${acts.map((a) => `
          <button class="list-row as-button" data-act="editActivity" data-id="${a.id}">
            <span>${icons.walk} ${esc(a.type)}</span><span class="muted small">${esc(activityText(a))}</span>
          </button>`).join('')}
      </div>` : ''}

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

  async logSingleExercise() {
    const { value, form } = await sheet({
      title: 'Log a single exercise',
      body: `
        <label class="field"><span>Exercise</span>
          <select name="exercise">${exerciseOptions()}</select></label>
        <p class="muted small">Single exercises are saved to your history but don't count toward your streak. Not in the list? Add it under Exercises first.</p>`,
      buttons: [{ label: 'Go', value: 'go', cls: 'primary' }, { label: 'Cancel', value: null }],
    });
    if (value !== 'go' || !form.exercise) return;
    const s = addAdhocExercise(form.exercise);
    location.hash = `#/workout/${s.id}`;
  },

  acceptShare({ el }) {
    const plan = accept(el.dataset.id);
    if (plan) toast(`“${plan.name}” added to your plans`, 3500);
  },
  dismissShare({ el }) { dismiss(el.dataset.id); },

  logActivity: () => activitySheet(),
  editActivity: ({ el }) => activitySheet(el.dataset.id),
  logWeight: () => weightSheet(),
};
