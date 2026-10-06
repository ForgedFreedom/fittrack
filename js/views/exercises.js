import { list, get, upsert, remove, addAdhocExercise } from '../store.js';
import { esc, num, dateKey } from '../util.js';
import { icons, toast, confirmSheet, sheet } from '../ui.js';
import { backLink, emptyState } from './common.js';
import { newItem } from './plans.js';

let query = '';

const trackLabel = (ex) =>
  [ex.track.reps && 'reps', ex.track.weight && 'weight', ex.track.duration && 'time', ex.perSide && 'each side']
    .filter(Boolean).join(' · ');

export const listView = {
  render() {
    const q = query.toLowerCase();
    const all = list('exercises')
      .filter((e) => !q || e.name.toLowerCase().includes(q) || (e.category || '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    const groups = {};
    for (const ex of all) (groups[ex.category || 'Other'] ||= []).push(ex);

    return `
      <header class="page-head row-between">
        <h1>Exercises</h1>
        <a class="btn primary small" href="#/exercise/new">${icons.plus} New</a>
      </header>
      <input class="search" type="search" placeholder="Search exercises" value="${esc(query)}" data-search aria-label="Search exercises">
      <div id="ex-results">
        ${all.length ? Object.keys(groups).sort().map((cat) => `
          <h2 class="section-title">${esc(cat)}</h2>
          <div class="list card">
            ${groups[cat].map((ex) => `
              <a class="list-row" href="#/exercise/${ex.id}">
                <span>${esc(ex.name)}</span>
                <span class="muted small">${esc(trackLabel(ex))}</span>
              </a>`).join('')}
          </div>`).join('') : emptyState('No matches.')}
      </div>`;
  },
  onSearch(value) { query = value; },
};

let draft = null;

export const editView = {
  enter({ id }) {
    draft = id === 'new'
      ? { id: null, name: '', category: '', perSide: false, notes: '', link: '', track: { reps: true, weight: false, duration: false } }
      : structuredClone(get('exercises', id));
  },

  render() {
    if (!draft) return `${backLink('#/exercises', 'Exercises')}<p>Exercise not found.</p>`;
    const d = draft;
    const cats = [...new Set(list('exercises').map((e) => e.category).filter(Boolean))].sort();
    const usedIn = d.id ? list('plans').filter((p) => p.items.some((it) => it.exerciseId === d.id)) : [];
    const chk = (bind, label, on) => `<label><input type="checkbox" data-bind="${bind}" ${on ? 'checked' : ''}> ${label}</label>`;

    return `
      ${backLink('#/exercises', 'Exercises')}
      <header class="page-head"><h1>${d.id ? esc(d.name) || 'Exercise' : 'New exercise'}</h1></header>

      <section class="card form">
        <label class="field"><span>Name</span>
          <input data-bind="name" value="${esc(d.name)}" placeholder="e.g. Wall sit" autocomplete="off"></label>
        <label class="field"><span>Category</span>
          <input data-bind="category" list="cat-list" value="${esc(d.category)}" placeholder="Core, Legs, Stretch…">
          <datalist id="cat-list">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <fieldset class="checks"><legend>What do you log for each set?</legend>
          ${chk('track.reps', 'Reps', d.track.reps)}
          ${chk('track.weight', 'Weight', d.track.weight)}
          ${chk('track.duration', 'Time (timer)', d.track.duration)}
          ${chk('perSide', 'Done on each side', d.perSide)}
        </fieldset>
        <label class="field"><span>How to do it</span>
          <textarea data-bind="notes" rows="5" placeholder="Form cues, tips, easier/harder versions…">${esc(d.notes)}</textarea></label>
        <label class="field"><span>Video or link</span>
          <input data-bind="link" type="url" inputmode="url" value="${esc(d.link)}" placeholder="https://…"></label>
        ${d.link ? `<a href="${esc(d.link)}" target="_blank" rel="noopener" class="small">Open link ↗</a>` : ''}
      </section>

      <div class="btn-col">
        <button class="btn primary wide" data-act="saveExercise">Save exercise</button>
      </div>

      ${d.id ? `
        <h2 class="section-title">Plans</h2>
        <section class="card">
          ${usedIn.length
            ? `<p class="small">Used in: ${usedIn.map((p) => `<a href="#/plan/${p.id}">${esc(p.name)}</a>`).join(', ')}</p>`
            : '<p class="muted small">Not in any plan yet.</p>'}
          <div class="btn-row">
            <button class="btn small" data-act="addToPlan">${icons.plus} Add to a plan</button>
            <button class="btn small" data-act="logExerciseNow">${icons.play} Log it now</button>
          </div>
        </section>
        <div class="btn-col">
          <button class="btn ghost danger-text" data-act="deleteExercise">Delete exercise</button>
        </div>` : ''}
    `;
  },

  onInput(el) {
    const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? num(el.value) : el.value;
    const [a, b] = el.dataset.bind.split('.');
    if (b) draft[a][b] = v; else draft[a] = v;
    return false;
  },

  actions: {
    saveExercise() {
      if (!draft.name.trim()) return toast('Give the exercise a name');
      draft.name = draft.name.trim();
      draft.category = draft.category.trim() || 'Other';
      const isNew = !draft.id;
      const saved = upsert('exercises', draft);
      toast('Exercise saved');
      if (isNew) location.hash = `#/exercise/${saved.id}`; // stay, so it can be added to a plan
      else location.hash = '#/exercises';
    },

    logExerciseNow() {
      const s = addAdhocExercise(draft.id);
      location.hash = `#/workout/${s.id}`;
    },

    async addToPlan() {
      const plans = list('plans').sort((a, b) => a.name.localeCompare(b.name));
      const { value, form } = await sheet({
        title: `Add "${draft.name}" to…`,
        body: `
          <label class="field"><span>Plan</span>
            <select name="plan">
              ${plans.map((p) => `<option value="${p.id}">${esc(p.name)}${p.active ? '' : ' (paused)'}</option>`).join('')}
              <option value="__new">+ A new plan</option>
            </select></label>`,
        buttons: [{ label: 'Add', value: 'add', cls: 'primary' }, { label: 'Cancel', value: null }],
      });
      if (value !== 'add') return;
      if (form.plan === '__new') {
        const p = upsert('plans', {
          name: draft.name, description: '', active: true, days: [],
          startDate: dateKey(), ramp: [], items: [newItem(draft.id)],
        });
        location.hash = `#/plan/${p.id}`;
        return;
      }
      const p = get('plans', form.plan);
      p.items.push(newItem(draft.id));
      upsert('plans', p);
      toast(`Added to ${p.name}. Adjust sets/reps there.`);
      location.hash = `#/plan/${p.id}`;
    },

    async deleteExercise() {
      const usedIn = list('plans').filter((p) => p.items.some((it) => it.exerciseId === draft.id));
      const msg = usedIn.length
        ? `It will also be removed from: ${usedIn.map((p) => p.name).join(', ')}. Past workouts keep their logged sets.`
        : 'Past workouts keep their logged sets.';
      if (!(await confirmSheet('Delete exercise?', msg, 'Delete', true))) return;
      for (const p of usedIn) {
        p.items = p.items.filter((it) => it.exerciseId !== draft.id);
        upsert('plans', p);
      }
      remove('exercises', draft.id);
      location.hash = '#/exercises';
    },
  },
};
