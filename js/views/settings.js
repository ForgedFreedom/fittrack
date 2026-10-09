import { getState, updateSettings, mergeStates, replaceState } from '../store.js';
import { current as currentProfile, rename } from '../profiles.js';
import { esc, dateKey, num } from '../util.js';
import { icons, toast, confirmSheet, speak, unlockAudio } from '../ui.js';
import * as sync from '../sync.js';

let syncError = '';
let busy = false;

function syncCard() {
  const id = sync.clientId();
  const connected = sync.isConnected();
  const last = sync.lastSync();
  return `
    <section class="card form">
      <p class="small">Back up and sync to Google Drive, in a private app folder only this app can see. Profiles that sign in to the <b>same Google account</b> keep separate data but can see each other's streaks on the Today screen.</p>
      ${id ? '' : `<p class="small warn">One-time setup: a Google Client ID is needed. See README → "Google Drive sync".</p>`}
      <details ${id ? '' : 'open'}><summary class="small">Google Client ID</summary>
        <label class="field"><span>Client ID</span>
          <input data-setting="clientId" value="${esc(id)}" placeholder="xxxx.apps.googleusercontent.com" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      </details>
      <p class="small muted">${connected ? `Connected. ${last ? `Last synced ${new Date(last).toLocaleString()}` : 'Not synced yet'}` : 'Not connected'}</p>
      ${syncError ? `<p class="small warn">${esc(syncError)}</p>` : ''}
      <div class="btn-row">
        <button class="btn primary" data-act="syncNow" ${id && !busy ? '' : 'disabled'}>${icons.sync} ${busy ? 'Syncing…' : connected ? 'Sync now' : 'Connect Google Drive'}</button>
        ${connected ? `<button class="btn" data-act="disconnect">Disconnect</button>` : ''}
      </div>
    </section>`;
}

export function render() {
  const st = getState().settings;
  return `
    <header class="page-head"><h1>Settings</h1></header>

    <a class="card list-row profile-link" href="#/profiles">
      <span><span class="muted small">Profile on this phone</span><br><b>${esc(currentProfile()?.name || '')}</b></span>
      <span class="small">Switch / add ›</span>
    </a>

    <section class="card form">
      <label class="field"><span>Your name</span>
        <input data-setting="name" value="${esc(st.name)}" placeholder="Shown on the Today screen" autocomplete="given-name"></label>
      <div class="field-grid">
        <label class="field"><span>Weight unit</span>
          <select data-setting="unit">
            <option value="lb" ${st.unit === 'lb' ? 'selected' : ''}>Pounds (lb)</option>
            <option value="kg" ${st.unit === 'kg' ? 'selected' : ''}>Kilograms (kg)</option>
          </select></label>
        <label class="field"><span>Distance unit</span>
          <select data-setting="distUnit">
            <option value="mi" ${(st.distUnit || 'mi') === 'mi' ? 'selected' : ''}>Miles (mi)</option>
            <option value="km" ${st.distUnit === 'km' ? 'selected' : ''}>Kilometers (km)</option>
          </select></label>
      </div>
    </section>

    <h2 class="section-title">Workout timers</h2>
    <section class="card form">
      <label class="field inline"><span>Auto-start next timer after rest</span>
        <span class="switch"><input type="checkbox" data-setting="autoStart" ${st.autoStart !== false ? "checked" : ""}><span></span></span></label>
      <label class="field"><span>Get-ready seconds before an auto-start</span>
        <input type="number" inputmode="numeric" min="0" max="30" step="1" data-setting="grace" value="${st.grace ?? 2}"></label>
      <label class="field inline"><span>Read exercises aloud</span>
        <span class="switch"><input type="checkbox" data-setting="voice" ${st.voice !== false ? "checked" : ""}><span></span></span></label>
      <button class="btn small" data-act="testVoice">${icons.sound} Test voice</button>
      <p class="small muted">Announces rest, what's next, "Get ready" and "Go", using your phone's built-in voice. Turn the volume up. On iPhone, speech may be silent while the Ring/Silent switch is set to silent.</p>
      <p class="small muted">When on, the next timed set starts by itself after the rest countdown, with a short "Get ready" countdown first. When off, you tap Start for each set. You can stop the auto-start on the rest screen anytime.</p>
    </section>

    <h2 class="section-title">Google Drive sync</h2>
    ${syncCard()}

    <h2 class="section-title">Backup file</h2>
    <section class="card form">
      <p class="small muted">Save a copy of everything as a file, or restore from one. Restoring merges with what's already here.</p>
      <div class="btn-row">
        <button class="btn" data-act="exportData">Export</button>
        <label class="btn">Import<input type="file" accept="application/json,.json" data-import hidden></label>
      </div>
    </section>

    <h2 class="section-title">Install on iPhone</h2>
    <section class="card">
      <p class="small">In Safari, tap <b>Share</b> → <b>Add to Home Screen</b>. It then opens full-screen like a regular app and works offline.</p>
    </section>

    <div class="btn-col">
      <button class="btn ghost danger-text" data-act="resetAll">Erase all data on this phone</button>
    </div>
  `;
}

export function onSetting(el) {
  const key = el.dataset.setting;
  if (key === 'clientId') {
    sync.setClientId(el.value);
    sync.preload().catch(() => {});
    return true;
  }
  const value = el.type === "checkbox" ? el.checked
    : el.type === "number" ? Math.max(0, Math.round(num(el.value)))
    : el.value.trim();
  updateSettings({ [key]: value });
  if (key === 'name' && value) rename(currentProfile().id, value);
  return false;
}

export async function importFile(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || !data.exercises) throw new Error('bad');
    replaceState(mergeStates(getState(), data));
    toast('Backup imported');
  } catch {
    toast('That file is not a FitTrack backup');
  }
}

export const actions = {
  async syncNow({ rerender }) {
    syncError = '';
    busy = true;
    rerender();
    try {
      await sync.syncNow(true);
      toast('Synced with Google Drive');
    } catch (e) {
      syncError = e.message;
      toast(e.message, 4000);
    }
    busy = false;
    rerender();
  },
  disconnect() {
    sync.disconnect();
    toast('Disconnected. Data stays on this phone.');
  },
  testVoice() {
    unlockAudio();
    speak('Rest, 45 seconds. Next: Bodyweight squats, set 2 of 4, 13 reps.');
    return false;
  },
  exportData() {
    const blob = new Blob([JSON.stringify(getState(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fittrack-backup-${dateKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  async resetAll() {
    if (!(await confirmSheet('Erase everything on this phone?', 'All profiles, plans, exercises and history on this phone will be deleted. Data already synced to Google Drive is not touched, and can be restored by picking your profile from Google Drive.', 'Erase', true))) return;
    sync.disconnect();
    Object.keys(localStorage).filter((k) => k.startsWith('fittrack:')).forEach((k) => localStorage.removeItem(k));
    location.hash = '#/today';
    location.reload();
  },
};
