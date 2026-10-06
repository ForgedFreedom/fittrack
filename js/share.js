// Sharing a plan with another profile on the same Google account.
// The sender drops a "share" file addressed to the recipient into the app folder;
// the recipient's next sync moves it into a local inbox and deletes the Drive file.
// Accepting adds an independent copy of the plan (and any exercises it needs).

import { get, list, upsert } from './store.js';
import { current } from './profiles.js';
import { uid, dateKey, now } from './util.js';

const inboxKey = () => `fittrack:inbox:${current()?.id}`;

export function buildShare(planId) {
  const plan = get('plans', planId);
  const exercises = {};
  for (const it of plan.items) {
    const ex = get('exercises', it.exerciseId);
    if (ex) exercises[ex.id] = ex;
  }
  const me = current();
  return { kind: 'plan', from: { id: me.id, name: me.name }, sentAt: now(), plan, exercises };
}

export function inbox() {
  try { return JSON.parse(localStorage.getItem(inboxKey())) || []; } catch { return []; }
}

function saveInbox(items) {
  localStorage.setItem(inboxKey(), JSON.stringify(items));
}

export function addToInbox(share) {
  if (share?.kind !== 'plan' || !share.plan) return;
  saveInbox([...inbox(), { ...share, inboxId: uid() }]);
}

export function dismiss(inboxId) {
  saveInbox(inbox().filter((s) => s.inboxId !== inboxId));
}

// Add the shared plan as a new plan of this profile. Exercises this profile already
// has are kept as they are; missing ones are copied in.
export function accept(inboxId) {
  const share = inbox().find((s) => s.inboxId === inboxId);
  if (!share) return null;
  for (const ex of Object.values(share.exercises || {})) {
    if (!get('exercises', ex.id)) upsert('exercises', { ...ex });
  }
  const taken = new Set(list('plans').map((p) => p.name));
  const name = taken.has(share.plan.name) ? `${share.plan.name} (from ${share.from.name})` : share.plan.name;
  const plan = upsert('plans', {
    ...share.plan,
    id: null,
    name,
    active: true,
    startDate: dateKey(), // their week 1 starts today, so any ramp-up starts fresh
    items: share.plan.items.map((it) => ({ ...it, id: uid() })),
  });
  dismiss(inboxId);
  return plan;
}
