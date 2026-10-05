import { getState, updateSettings, mergeStates, replaceState, load } from '../store.js';
import { esc, dateKey } from '../util.js';
import { icons, toast, confirmSheet } from '../ui.js';
import * as sync from '../sync.js';

let syncError = '';
let busy = false;

function syncCard() {
  const id = sync.clientId();
  const connected = sync.isConnected();
  const last = sync.lastSync();
  return `
    <section class="card form">
      <p class="small">Back up and sync your data to <b>your own Google Drive</b>, in a private app folder only this app can see. Each person signs in with their own Google account, so your data stays separate.</p>
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

    <section class="card form">
      <label class="field"><span>Your name</span>
        <input data-setting="name" value="${esc(st.name)}" placeholder="Shown on the Today screen" autocomplete="given-name"></label>
      <label class="field"><span>Weight unit</span>
        <select data-setting="unit">
          <option value="lb" ${st.unit === 'lb' ? 'selected' : ''}>Pounds (lb)</option>
          <option value="kg" ${st.unit === 'kg' ? 'selected' : ''}>Kilograms (kg)</option>
        </select></label>
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
  updateSettings({ [key]: el.value.trim?.() ?? el.value });
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
  exportData() {
    const blob = new Blob([JSON.stringify(getState(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fittrack-backup-${dateKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  async resetAll() {
    if (!(await confirmSheet('Erase everything?', 'All plans, exercises and history on this phone will be deleted and the starter data restored. Data already synced to Google Drive is not touched, but a later sync will bring it back.', 'Erase', true))) return;
    localStorage.removeItem('fittrack:data:v1');
    sync.disconnect();
    load();
    location.hash = '#/today';
    location.reload();
  },
};
