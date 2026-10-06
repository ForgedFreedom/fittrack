// Google Drive sync. Data is stored as JSON files in the signed-in account's hidden
// "appDataFolder": private to this app and not visible in the Drive file list.
// Several profiles (people) can share one Google account; each has its own file,
// plus a small summary file the others read for the household view.

import { GOOGLE_CLIENT_ID } from './config.js';
import { getState, replaceState, mergeStates } from './store.js';
import { current as currentProfile } from './profiles.js';
import { summary } from './stats.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

const LS = {
  client: 'fittrack:gclient',
  connected: 'fittrack:gconnected',
  token: 'fittrack:gtoken',
  lastSync: 'fittrack:lastsync',
  dirty: 'fittrack:dirty',
  household: 'fittrack:household',
};

let tokenClient = null;
let pending = null; // {resolve, reject} for the in-flight token request
let gisPromise = null;

export const clientId = () => localStorage.getItem(LS.client) || GOOGLE_CLIENT_ID;
export const setClientId = (id) => {
  localStorage.setItem(LS.client, id.trim());
  tokenClient = null;
};
export const isConnected = () => localStorage.getItem(LS.connected) === '1';
export const lastSync = () => localStorage.getItem(LS.lastSync);
export const isDirty = () => localStorage.getItem(LS.dirty) === '1';

function storedToken() {
  try {
    const t = JSON.parse(localStorage.getItem(LS.token));
    if (t && Date.now() < t.exp - 60_000) return t.value;
  } catch { /* ignore */ }
  return null;
}

// Load Google Identity Services ahead of time, so the sign-in popup can open
// directly from a tap (iOS blocks popups that aren't tied to a tap).
export function preload() {
  if (!clientId()) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { gisPromise = null; reject(new Error('Could not load Google sign-in (offline?)')); };
      document.head.appendChild(s);
    }).then(initClient);
  }
  return gisPromise;
}

function initClient() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId(),
    scope: SCOPE,
    callback: (resp) => {
      const p = pending; pending = null;
      if (resp.error) return p?.reject(new Error(resp.error_description || resp.error));
      localStorage.setItem(LS.token, JSON.stringify({
        value: resp.access_token,
        exp: Date.now() + resp.expires_in * 1000,
      }));
      localStorage.setItem(LS.connected, '1');
      p?.resolve(resp.access_token);
    },
    error_callback: (err) => {
      const p = pending; pending = null;
      p?.reject(new Error(err.type === 'popup_closed' ? 'Sign-in was cancelled' : (err.message || err.type)));
    },
  });
}

// Must be called from a tap handler when interactive.
function getToken(interactive) {
  const t = storedToken();
  if (t) return Promise.resolve(t);
  if (!interactive) return Promise.resolve(null);
  if (!clientId()) return Promise.reject(new Error('Add a Google Client ID in Settings first'));
  if (!tokenClient) {
    // Not ready yet: load it, then ask the user to tap again.
    return preload().then(() => { throw new Error('Google sign-in is ready. Tap Sync again.'); });
  }
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    tokenClient.requestAccessToken({ prompt: isConnected() ? '' : 'consent' });
  });
}

async function api(token, url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    localStorage.removeItem(LS.token);
    throw new Error('Google sign-in expired. Tap Sync to sign in again.');
  }
  if (!res.ok) throw new Error(`Google Drive error ${res.status}: ${await res.text()}`);
  return res;
}

// Drive files, all in the hidden app folder of the signed-in Google account:
//   fittrack-p-<profileId>.json  full data for one profile
//   fittrack-s-<profileId>.json  small shareable summary (streaks, this week, today's plans)
const dataName = (id) => `fittrack-p-${id}.json`;
const summaryName = (id) => `fittrack-s-${id}.json`;

async function listFiles(token) {
  const q = encodeURIComponent("name contains 'fittrack-'");
  const res = await api(token, `${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime)&pageSize=100`);
  return (await res.json()).files || [];
}

const download = async (token, fileId) => (await api(token, `${API}/files/${fileId}?alt=media`)).json();

async function upload(token, fileId, name, data) {
  const body = JSON.stringify(data);
  if (fileId) {
    await api(token, `${UPLOAD}/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return;
  }
  const boundary = 'fittrack' + Date.now();
  const meta = JSON.stringify({ name, parents: ['appDataFolder'] });
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  await api(token, `${UPLOAD}/files?uploadType=multipart`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
}

// Summaries of the other profiles on this Google account (read-only).
async function readHousehold(token, files, ownId) {
  const others = files.filter((f) => f.name.startsWith('fittrack-s-') && f.name !== summaryName(ownId));
  const members = (await Promise.all(others.map((f) => download(token, f.id).catch(() => null)))).filter(Boolean);
  localStorage.setItem(LS.household, JSON.stringify({ fetchedAt: new Date().toISOString(), members }));
}

export function household() {
  try { return JSON.parse(localStorage.getItem(LS.household))?.members || []; } catch { return []; }
}

let syncing = null;

// interactive=true when the user tapped a button (may show Google sign-in).
// interactive=false for background syncs: silently skipped without a valid token.
export function syncNow(interactive = false) {
  if (syncing) return syncing;
  syncing = (async () => {
    const token = await getToken(interactive);
    const profile = currentProfile();
    if (!token || !profile) return { skipped: true };
    const files = await listFiles(token);
    const own = files.find((f) => f.name === dataName(profile.id));
    const remote = own ? await download(token, own.id) : null;
    const merged = mergeStates(getState(), remote);
    replaceState(merged);
    await upload(token, own?.id, dataName(profile.id), merged);
    const ownSummary = files.find((f) => f.name === summaryName(profile.id));
    await upload(token, ownSummary?.id, summaryName(profile.id), summary(profile));
    await readHousehold(token, files, profile.id);
    localStorage.setItem(LS.lastSync, new Date().toISOString());
    localStorage.setItem(LS.dirty, '0');
    return { ok: true };
  })().finally(() => { syncing = null; });
  return syncing;
}

// Profiles saved on this Google account, for setting up a phone with an existing profile.
export async function remoteProfiles(interactive = true) {
  const token = await getToken(interactive);
  if (!token) return [];
  const files = await listFiles(token);
  const sums = files.filter((f) => f.name.startsWith('fittrack-s-'));
  const all = await Promise.all(sums.map((f) => download(token, f.id).catch(() => null)));
  return all
    .filter((s) => s && files.some((f) => f.name === dataName(s.id)))
    .map((s) => ({ id: s.id, name: s.name, updatedAt: s.updatedAt }));
}

export function disconnect() {
  const t = storedToken();
  if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t, () => {});
  localStorage.removeItem(LS.token);
  localStorage.removeItem(LS.connected);
  localStorage.removeItem(LS.lastSync);
  localStorage.removeItem(LS.household);
}
