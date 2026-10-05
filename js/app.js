// App shell: hash router, event delegation, background sync.

import { load, onChange } from './store.js';
import { icons, toast } from './ui.js';
import * as sync from './sync.js';
import * as today from './views/today.js';
import * as workout from './views/workout.js';
import * as plans from './views/plans.js';
import * as exercises from './views/exercises.js';
import * as progress from './views/progress.js';
import * as settings from './views/settings.js';

const routes = [
  { re: /^#\/today$/, view: today, tab: 'today' },
  { re: /^#\/workout\/([\w-]+)$/, view: workout, tab: 'today', keys: ['id'] },
  { re: /^#\/plans$/, view: plans.listView, tab: 'plans' },
  { re: /^#\/plan\/([\w-]+)$/, view: plans.editView, tab: 'plans', keys: ['id'] },
  { re: /^#\/exercises$/, view: exercises.listView, tab: 'exercises' },
  { re: /^#\/exercise\/([\w-]+)$/, view: exercises.editView, tab: 'exercises', keys: ['id'] },
  { re: /^#\/progress$/, view: progress, tab: 'progress' },
  { re: /^#\/settings$/, view: settings, tab: 'settings' },
];

const TABS = [
  ['today', 'Today'], ['plans', 'Plans'], ['exercises', 'Exercises'], ['progress', 'Progress'], ['settings', 'Settings'],
];

// Actions from every screen, looked up by name from data-act / data-act-change.
const ACTIONS = Object.assign({},
  today.actions, workout.actions, plans.listView.actions, plans.editView.actions,
  exercises.editView.actions, progress.actions, settings.actions);

const viewEl = document.getElementById('view');
let current = null;
let params = {};

function match() {
  const hash = location.hash || '#/today';
  for (const r of routes) {
    const m = hash.match(r.re);
    if (m) return { route: r, params: Object.fromEntries((r.keys || []).map((k, i) => [k, m[i + 1]])) };
  }
  return { route: routes[0], params: {} };
}

function render() {
  if (!current) return;
  const y = scrollY;
  viewEl.innerHTML = current.view.render(params);
  scrollTo(0, y);
}

function navigate() {
  const m = match();
  current = m.route;
  params = m.params;
  current.view.enter?.(params);
  viewEl.innerHTML = current.view.render(params);
  scrollTo(0, 0);
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === current.tab));
}

function renderTabs() {
  document.getElementById('tabbar').innerHTML = TABS.map(([key, label]) =>
    `<a href="#/${key}" data-tab="${key}">${icons[key]}<span>${label}</span></a>`).join('');
}

async function runAction(name, el, ev) {
  const fn = ACTIONS[name];
  if (!fn) return;
  const result = fn({ el, ev, params, rerender: render });
  const settled = result instanceof Promise ? await result : result;
  if (settled !== false) render();
}

// ---- events -----------------------------------------------------------------------

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT') return;
  if (el.tagName === 'BUTTON') ev.preventDefault();
  runAction(el.dataset.act, el, ev);
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.actChange) return runAction(el.dataset.actChange, el, ev);
  if (el.dataset.setting) { if (settings.onSetting(el)) render(); return; }
  if (el.dataset.import !== undefined && el.files?.[0]) return settings.importFile(el.files[0]);
  if (el.dataset.bind && current?.view.onInput?.(el, 'change')) render();
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.dataset.bind) current?.view.onInput?.(el, 'input');
  if (el.dataset.search !== undefined) {
    exercises.listView.onSearch(el.value);
    // Re-render just the results so the search box keeps focus.
    const tmp = document.createElement('div');
    tmp.innerHTML = exercises.listView.render();
    document.getElementById('ex-results').replaceWith(tmp.querySelector('#ex-results'));
  }
});

// Re-render on data changes, unless the user is typing in a field on this screen.
onChange(() => {
  const a = document.activeElement;
  if (a && viewEl.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
  if (current?.view.enter && current.view !== workout) return; // editors render from their draft
  render();
});

// ---- background sync --------------------------------------------------------------------
// Only runs when a Google sign-in from the last hour is still valid; otherwise
// the user taps "Sync now" in Settings.

function backgroundSync() {
  if (!sync.isConnected()) return;
  sync.syncNow(false).catch((e) => console.warn('sync', e));
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && sync.isDirty()) backgroundSync();
  if (document.visibilityState === 'visible') backgroundSync();
});

// ---- start --------------------------------------------------------------------------------

load();
renderTabs();
addEventListener('hashchange', navigate);
if (!location.hash) history.replaceState(null, '', '#/today');
navigate();
sync.preload().catch(() => {});
backgroundSync();
navigator.storage?.persist?.();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Update ready. Reopen the app to use it.', 5000);
        }
      });
    });
  });
}
