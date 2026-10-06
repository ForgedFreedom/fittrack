import { list, get, upsert, remove, timerOn } from '../store.js';
import { esc, uid, dateKey, DAY_NAMES, num } from '../util.js';
import { icons, sheet, toast, confirmSheet } from '../ui.js';
import { scheduleText, backLink, exerciseOf, targetText, emptyState } from './common.js';
import * as sync from '../sync.js';
import { buildShare } from '../share.js';

// ---- shared ---------------------------------------------------------------------

export function exerciseOptions(selected) {
  const groups = {};
  for (const ex of list('exercises').sort((a, b) => a.name.localeCompare(b.name))) {
    (groups[ex.category || 'Other'] ||= []).push(ex);
  }
  return Object.keys(groups).sort().map((cat) => `
    <optgroup label="${esc(cat)}">
      ${groups[cat].map((ex) => `<option value="${ex.id}" ${ex.id === selected ? 'selected' : ''}>${esc(ex.name)}</option>`).join('')}
    </optgroup>`).join('');
}

export function newItem(exerciseId) {
  const ex = exerciseOf(exerciseId);
  return {
    id: uid(),
    exerciseId,
    sets: 3,
    reps: ex.track.reps ? 10 : 0,
    duration: ex.track.duration ? 30 : 0,
    timer: true, // on by default; 0 seconds = stopwatch
    weight: 0,
    rest: 45,
  };
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys[keys.length - 1]] = value;
}

// ---- plan list ---------------------------------------------------------------------

export const listView = {
  render() {
    const plans = list('plans').sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
    return `
      <header class="page-head row-between">
        <h1>Plans</h1>
        <a class="btn primary small" href="#/plan/new">${icons.plus} New plan</a>
      </header>
      <p class="muted small">Turn on as many plans as you like. Active plans show up on Today on their scheduled days.</p>
      ${plans.length ? plans.map((p) => `
        <section class="card plan-row ${p.active ? '' : 'inactive'}">
          <a class="plan-link" href="#/plan/${p.id}">
            <h3>${esc(p.name)}</h3>
            <p class="muted small">${esc(scheduleText(p))} · ${p.items.length} exercises</p>
          </a>
          <label class="switch" aria-label="Active">
            <input type="checkbox" data-act="togglePlanActive" data-plan="${p.id}" ${p.active ? 'checked' : ''}>
            <span></span>
          </label>
        </section>`).join('') : emptyState('No plans yet.')}
    `;
  },
  actions: {
    togglePlanActive({ el }) {
      const p = get('plans', el.dataset.plan);
      p.active = el.checked;
      if (p.active && !p.startDate) p.startDate = dateKey();
      upsert('plans', p);
      toast(p.active ? `${p.name} is active` : `${p.name} paused`);
    },
  },
};

// ---- plan editor ------------------------------------------------------------------------

let draft = null;

export const editView = {
  enter({ id }) {
    draft = id === 'new'
      ? { id: null, name: '', description: '', active: true, days: [], startDate: dateKey(), ramp: [], items: [] }
      : structuredClone(get('plans', id));
  },

  render() {
    if (!draft) return `${backLink('#/plans', 'Plans')}<p>Plan not found.</p>`;
    const d = draft;
    return `
      ${backLink('#/plans', 'Plans')}
      <header class="page-head"><h1>${d.id ? 'Edit plan' : 'New plan'}</h1></header>

      <section class="card form">
        <label class="field"><span>Name</span>
          <input data-bind="name" value="${esc(d.name)}" placeholder="e.g. Morning core" autocomplete="off"></label>
        <label class="field"><span>Notes</span>
          <textarea data-bind="description" rows="3" placeholder="Goal, tips, where you found it…">${esc(d.description)}</textarea></label>
        <label class="field inline"><span>Active</span>
          <span class="switch"><input type="checkbox" data-bind="active" ${d.active ? 'checked' : ''}><span></span></span></label>
      </section>

      <h2 class="section-title">Schedule</h2>
      <section class="card form">
        <div class="days" role="group" aria-label="Days of the week">
          ${DAY_NAMES.map((n, i) => `<button class="day ${d.days.includes(i) ? 'on' : ''}" data-act="toggleDay" data-d="${i}" aria-pressed="${d.days.includes(i)}">${n[0]}<span class="sr">${n}</span></button>`).join('')}
        </div>
        <p class="muted small">${d.days.length ? scheduleText(d) : 'No days picked = every day'}</p>
        <label class="field"><span>Start date (week 1)</span>
          <input type="date" data-bind="startDate" value="${esc(d.startDate || '')}"></label>
      </section>

      <h2 class="section-title">Ramp up <span class="muted small">(optional)</span></h2>
      <section class="card form">
        <p class="muted small">Ease in by doing a percentage of the target reps in early weeks. For example: week 1 at 50%, week 3 at 100%.</p>
        ${d.ramp.map((r, i) => `
          <div class="ramp-row">
            <label class="field"><span>From week</span><input type="number" inputmode="numeric" min="1" data-bind="ramp.${i}.week" value="${r.week}"></label>
            <label class="field"><span>% of target</span><input type="number" inputmode="numeric" min="1" max="200" data-bind="ramp.${i}.pct" value="${r.pct}"></label>
            <button class="icon-btn" data-act="removeRamp" data-i="${i}" aria-label="Remove step">${icons.trash}</button>
          </div>`).join('')}
        <button class="btn small" data-act="addRamp">${icons.plus} Add step</button>
      </section>

      <h2 class="section-title">Exercises</h2>
      ${d.items.map((it, i) => itemEditor(it, i, d.items.length)).join('')}
      <section class="card form">
        <label class="field"><span>Add exercise</span>
          <select data-act-change="addItem"><option value="">Choose from library…</option>${exerciseOptions()}</select></label>
        <button class="btn small" data-act="quickExercise">${icons.plus} Create a new exercise</button>
      </section>

      <div class="btn-col">
        <button class="btn primary wide" data-act="savePlan">Save plan</button>
        ${d.id ? `
          <button class="btn wide" data-act="sharePlan">${icons.share} Share with household</button>
          <button class="btn wide" data-act="duplicatePlan">Duplicate</button>
          <button class="btn ghost danger-text" data-act="deletePlan">Delete plan</button>` : ''}
      </div>
    `;
  },

  // Returns true if the screen should re-render after this change.
  onInput(el, type) {
    const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? num(el.value) : el.value;
    setPath(draft, el.dataset.bind, v);
    return type === 'change' && (el.tagName === 'SELECT' || el.type === 'checkbox');
  },

  actions: {
    toggleDay({ el }) {
      const d = +el.dataset.d;
      draft.days = draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d].sort();
    },
    addRamp() {
      const last = draft.ramp[draft.ramp.length - 1];
      draft.ramp.push(last ? { week: last.week + 1, pct: Math.min(100, last.pct + 25) } : { week: 1, pct: 50 });
    },
    removeRamp({ el }) { draft.ramp.splice(+el.dataset.i, 1); },
    addItem({ el }) {
      if (!el.value) return;
      draft.items.push(newItem(el.value));
    },
    moveItem({ el }) {
      const i = +el.dataset.i, j = i + +el.dataset.dir;
      if (j < 0 || j >= draft.items.length) return;
      [draft.items[i], draft.items[j]] = [draft.items[j], draft.items[i]];
    },
    removeItem({ el }) { draft.items.splice(+el.dataset.i, 1); },

    async quickExercise({ rerender }) {
      const { value, form } = await sheet({
        title: 'New exercise',
        body: quickExerciseForm(),
        buttons: [{ label: 'Create & add', value: 'save', cls: 'primary' }, { label: 'Cancel', value: null }],
      });
      if (value !== 'save' || !form.name?.trim()) return;
      const ex = upsert('exercises', {
        name: form.name.trim(),
        category: form.category?.trim() || 'Other',
        perSide: form.perSide === 'on',
        notes: '',
        link: '',
        track: { reps: form.reps === 'on', weight: form.weight === 'on', duration: form.duration === 'on' },
      });
      draft.items.push(newItem(ex.id));
      rerender();
    },

    savePlan() {
      if (!draft.name.trim()) return toast('Give the plan a name');
      draft.name = draft.name.trim();
      draft.ramp = draft.ramp.filter((r) => r.week > 0 && r.pct > 0);
      upsert('plans', draft);
      toast('Plan saved');
      location.hash = '#/plans';
    },
    async sharePlan() {
      const people = sync.isConnected() ? sync.household() : [];
      if (!people.length) {
        toast(sync.isConnected()
          ? 'No one else has synced on this Google account yet'
          : 'Connect Google Drive in Settings to share plans', 4000);
        return;
      }
      // Share what's saved, so unsaved edits on this screen aren't sent by surprise.
      const saved = get('plans', draft.id);
      const { value, form } = await sheet({
        title: `Share “${saved.name}”`,
        body: `
          <label class="field"><span>Send a copy to</span>
            <select name="to">${people.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select></label>
          <p class="muted small">They get their own copy to add from their Today screen. Changes either of you make later stay separate.</p>`,
        buttons: [{ label: 'Send', value: 'send', cls: 'primary' }, { label: 'Cancel', value: null }],
      });
      if (value !== 'send') return;
      const to = people.find((m) => m.id === form.to);
      try {
        await sync.sendShare(to.id, buildShare(saved.id));
        toast(`Sent to ${to.name}. It shows up when their app next syncs.`, 4000);
      } catch (e) {
        toast(e.message, 4000);
      }
    },

    duplicatePlan() {
      const copy = structuredClone(draft);
      copy.id = null;
      copy.name = `${draft.name} (copy)`;
      copy.active = false;
      copy.items = copy.items.map((it) => ({ ...it, id: uid() }));
      const saved = upsert('plans', copy);
      toast('Copied. The copy is paused.');
      location.hash = `#/plan/${saved.id}`;
    },
    async deletePlan() {
      if (!(await confirmSheet('Delete plan?', `"${draft.name}" will be removed. Past workouts stay in your history.`, 'Delete', true))) return;
      remove('plans', draft.id);
      location.hash = '#/plans';
    },
  },
};

function itemEditor(it, i, count) {
  const ex = exerciseOf(it.exerciseId);
  const n = (bind, label, val, attrs = '') => `
    <label class="field"><span>${label}</span>
      <input type="number" inputmode="numeric" min="0" ${attrs} data-bind="items.${i}.${bind}" value="${val || 0}"></label>`;
  return `
    <section class="card form item-edit">
      <div class="card-head">
        <select data-bind="items.${i}.exerciseId" aria-label="Exercise">${exerciseOptions(it.exerciseId)}</select>
        <div class="icon-group">
          <button class="icon-btn" data-act="moveItem" data-i="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icons.up}</button>
          <button class="icon-btn" data-act="moveItem" data-i="${i}" data-dir="1" ${i === count - 1 ? 'disabled' : ''} aria-label="Move down">${icons.down}</button>
          <button class="icon-btn" data-act="removeItem" data-i="${i}" aria-label="Remove">${icons.trash}</button>
        </div>
      </div>
      <div class="field-grid">
        ${n('sets', 'Sets', it.sets, 'min="1"')}
        ${ex.track.reps ? n('reps', ex.perSide ? 'Reps / side' : 'Reps', it.reps) : ''}
        ${timerOn(it) || ex.track.duration ? n('duration', 'Seconds', it.duration) : ''}
        ${ex.track.weight ? n('weight', 'Weight', it.weight, 'inputmode="decimal" step="any"') : ''}
        ${n('rest', 'Rest (s)', it.rest)}
      </div>
      <label class="field inline"><span>Timer${timerOn(it) && !it.duration ? ' <span class="muted">(0 seconds = stopwatch)</span>' : ''}</span>
        <span class="switch"><input type="checkbox" data-bind="items.${i}.timer" ${timerOn(it) ? 'checked' : ''} aria-label="Timer"><span></span></span></label>
      <p class="muted small">${esc(targetText(it, ex, timerOn(it)))}</p>
    </section>`;
}

export function quickExerciseForm() {
  const cats = [...new Set(list('exercises').map((e) => e.category).filter(Boolean))].sort();
  return `
    <label class="field"><span>Name</span><input name="name" required autocomplete="off" placeholder="e.g. Wall sit"></label>
    <label class="field"><span>Category</span><input name="category" list="cat-list" placeholder="Core, Legs, Stretch…">
      <datalist id="cat-list">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
    <fieldset class="checks"><legend>Track</legend>
      <label><input type="checkbox" name="reps" checked> Reps</label>
      <label><input type="checkbox" name="weight"> Weight</label>
      <label><input type="checkbox" name="duration"> Time</label>
      <label><input type="checkbox" name="perSide"> Each side</label>
    </fieldset>`;
}
