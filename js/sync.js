// Google Drive sync. Data is stored as one JSON file in the user's hidden
// "appDataFolder": private to this app and not visible in their Drive file list.
// Each person signs in with their own Google account, so data stays separate.

import { GOOGLE_CLIENT_ID } from './config.js';
import { getState, replaceState, mergeStates } from './store.js';

const FILE_NAME = 'fittrack-data.json';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

const LS = {
  client: 'fittrack:gclient',
  connected: 'fittrack:gconnected',
  token: 'fittrack:gtoken',
  lastSync: 'fittrack:lastsync',
  dirty: 'fittrack:dirty',
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

async function findFile(token) {
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const res = await api(token, `${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)`);
  const { files } = await res.json();
  return files?.[0] || null;
}

async function upload(token, fileId, data) {
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
  const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] });
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  await api(token, `${UPLOAD}/files?uploadType=multipart`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
}

let syncing = null;

// interactive=true when the user tapped a button (may show Google sign-in).
// interactive=false for background syncs: silently skipped without a valid token.
export function syncNow(interactive = false) {
  if (syncing) return syncing;
  syncing = (async () => {
    const token = await getToken(interactive);
    if (!token) return { skipped: true };
    const file = await findFile(token);
    const remote = file
      ? await (await api(token, `${API}/files/${file.id}?alt=media`)).json()
      : null;
    const merged = mergeStates(getState(), remote);
    replaceState(merged);
    await upload(token, file?.id, merged);
    localStorage.setItem(LS.lastSync, new Date().toISOString());
    localStorage.setItem(LS.dirty, '0');
    return { ok: true };
  })().finally(() => { syncing = null; });
  return syncing;
}

export function disconnect() {
  const t = storedToken();
  if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t, () => {});
  localStorage.removeItem(LS.token);
  localStorage.removeItem(LS.connected);
  localStorage.removeItem(LS.lastSync);
}
