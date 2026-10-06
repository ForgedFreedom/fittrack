// Profiles: one per person. Each phone remembers which profile it's using.
// Several profiles can share one Google account; each syncs to its own Drive file.

import { uid } from './util.js';
import { newState, writeInitial, emptyState } from './store.js';

const LIST = 'fittrack:profiles';
const CURRENT = 'fittrack:current';
const LEGACY = 'fittrack:data:v1'; // single-user data from before profiles existed

const read = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
};

export const profiles = () => read(LIST, []);
export const current = () => profiles().find((p) => p.id === localStorage.getItem(CURRENT)) || null;

function save(list) {
  localStorage.setItem(LIST, JSON.stringify(list));
}

function add(profile) {
  save([...profiles().filter((p) => p.id !== profile.id), profile]);
  localStorage.setItem(CURRENT, profile.id);
  localStorage.setItem('fittrack:dirty', '1');
  return profile;
}

// A brand-new person: starter plans and exercises included.
export function createProfile(name) {
  const p = { id: uid(), name };
  writeInitial(p.id, newState({ name }));
  return add(p);
}

// A profile that already exists on Google Drive: start empty, the first sync fills it in.
export function adoptRemoteProfile({ id, name }) {
  const existing = profiles().find((p) => p.id === id);
  if (!existing) writeInitial(id, emptyState());
  return add({ id, name });
}

export function switchTo(id) {
  localStorage.setItem(CURRENT, id);
  localStorage.setItem('fittrack:dirty', '1');
  localStorage.removeItem('fittrack:lastsync');
}

export function rename(id, name) {
  save(profiles().map((p) => (p.id === id ? { ...p, name } : p)));
}

// Remove a profile from this phone only (its Drive copy is untouched).
export function forget(id) {
  save(profiles().filter((p) => p.id !== id));
  localStorage.removeItem(`fittrack:data:v1:${id}`);
  if (localStorage.getItem(CURRENT) === id) localStorage.removeItem(CURRENT);
}

// Phones that used the app before profiles existed: turn that data into a profile.
export function migrateLegacy() {
  const raw = localStorage.getItem(LEGACY);
  if (!raw || profiles().length) return;
  let name = '';
  try { name = JSON.parse(raw).settings?.name || ''; } catch { /* ignore */ }
  const p = { id: uid(), name: name || 'Me' };
  localStorage.setItem(`fittrack:data:v1:${p.id}`, raw);
  localStorage.removeItem(LEGACY);
  add(p);
}
