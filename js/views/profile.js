// "Who's using this phone?": first-run setup and switching between profiles.

import { profiles, current, createProfile, adoptRemoteProfile, switchTo, forget } from '../profiles.js';
import * as sync from '../sync.js';
import { esc } from '../util.js';
import { icons, toast, confirmSheet } from '../ui.js';
import { backLink } from './common.js';

let remote = null; // profiles found on Google Drive
let busy = false;
let error = '';

const restart = (msg) => {
  if (msg) sessionStorage.setItem('fittrack:toast', msg);
  location.hash = '#/today';
  location.reload();
};

function remoteSection() {
  const mine = new Set(profiles().map((p) => p.id));
  const found = (remote || []).filter((r) => !mine.has(r.id));
  return `
    <section class="card form">
      <p class="small">If you already use FitTrack on another phone, sign in to the Google account you sync with to pick your profile.</p>
      ${sync.clientId() ? '' : '<p class="small warn">Google sync isn\'t set up in this copy of the app.</p>'}
      <button class="btn" data-act="findRemote" ${busy || !sync.clientId() ? 'disabled' : ''}>${icons.sync} ${busy ? 'Looking…' : 'Find profiles on Google Drive'}</button>
      ${error ? `<p class="small warn">${esc(error)}</p>` : ''}
      ${remote && !found.length ? '<p class="small muted">No other profiles found on this Google account.</p>' : ''}
      ${found.map((r) => `
        <button class="btn wide" data-act="adoptRemote" data-id="${esc(r.id)}" data-name="${esc(r.name)}">
          Use “${esc(r.name)}”${r.updatedAt ? ` <span class="muted small">· synced ${esc(new Date(r.updatedAt).toLocaleDateString())}</span>` : ''}
        </button>`).join('')}
    </section>`;
}

const newProfileForm = (label) => `
  <section class="card form">
    <label class="field"><span>Your name</span>
      <input id="new-profile-name" autocomplete="given-name" placeholder="e.g. Rob"></label>
    <button class="btn primary" data-act="createProfile">${esc(label)}</button>
    <p class="muted small">Comes with starter plans and exercises you can change.</p>
  </section>`;

export function enter() {
  remote = null; error = ''; busy = false;
}

export function render() {
  const me = current();
  if (!me) {
    return `
      <header class="page-head">
        <h1>Welcome to FitTrack</h1>
        <p class="muted">Who's using this phone?</p>
      </header>
      ${newProfileForm('Start my profile')}
      <h2 class="section-title">Already set up on another phone?</h2>
      ${remoteSection()}`;
  }
  const others = profiles().filter((p) => p.id !== me.id);
  return `
    ${backLink('#/settings', 'Settings')}
    <header class="page-head"><h1>Profiles</h1>
      <p class="muted small">Each person has their own profile, with separate plans and history. Profiles on the same Google account can see each other's streaks.</p></header>

    <h2 class="section-title">On this phone</h2>
    <div class="list card">
      <div class="list-row"><span><b>${esc(me.name)}</b></span><span class="ok small">${icons.check} In use</span></div>
      ${others.map((p) => `
        <div class="list-row">
          <span>${esc(p.name)}</span>
          <span class="btn-row">
            <button class="btn small" data-act="switchProfile" data-id="${esc(p.id)}">Switch</button>
            <button class="icon-btn" data-act="forgetProfile" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)} from this phone">${icons.trash}</button>
          </span>
        </div>`).join('')}
    </div>

    <h2 class="section-title">Add a person</h2>
    ${newProfileForm('Create profile')}

    <h2 class="section-title">Profiles on Google Drive</h2>
    ${remoteSection()}`;
}

export const actions = {
  createProfile() {
    const name = document.getElementById('new-profile-name').value.trim();
    if (!name) { toast('Enter your name'); return false; }
    createProfile(name);
    restart(`Welcome, ${name}!`);
    return false;
  },

  async findRemote({ rerender }) {
    busy = true; error = '';
    const p = sync.remoteProfiles(true); // starts sign-in right away, inside the tap
    rerender();
    try {
      remote = await p;
    } catch (e) {
      error = e.message;
    }
    busy = false;
  },

  adoptRemote({ el }) {
    adoptRemoteProfile({ id: el.dataset.id, name: el.dataset.name });
    restart(`Loading ${el.dataset.name}'s data from Google Drive…`);
    return false;
  },

  switchProfile({ el }) {
    switchTo(el.dataset.id);
    restart('Switched profile');
    return false;
  },

  async forgetProfile({ el }) {
    const p = profiles().find((x) => x.id === el.dataset.id);
    const ok = await confirmSheet(`Remove ${p.name} from this phone?`,
      'Their data stays on Google Drive if it was synced, and can be added back from there. Anything not synced will be lost.',
      'Remove', true);
    if (ok) forget(p.id);
  },
};
