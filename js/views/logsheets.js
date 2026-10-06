// Bottom sheets for logging walks/runs and body weight (used by Today and Progress).

import { get, getState, upsert, remove, logWeight, weightsSorted, updateSettings } from '../store.js';
import { esc, dateKey, num } from '../util.js';
import { sheet, toast } from '../ui.js';
import { unit } from './common.js';

export const ACTIVITY_TYPES = ['Walk', 'Run', 'Bike', 'Hike', 'Other'];
export const distUnit = () => getState().settings.distUnit || 'mi';

const clock = (sec) => {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

export const durationText = (sec) => (sec ? clock(sec) : '');
export const paceText = (a) => (a.distance && a.duration ? `${clock(a.duration / a.distance)} /${distUnit()}` : '');
export const activityText = (a) =>
  [a.distance ? `${a.distance} ${distUnit()}` : '', durationText(a.duration), paceText(a)].filter(Boolean).join(' · ');

// ---- walks / runs -----------------------------------------------------------------------

export async function activitySheet(id) {
  const a = id ? get('activities', id) : { type: 'Walk', date: dateKey(), duration: 0, distance: 0, notes: '' };
  const mins = a.duration ? Math.round((a.duration / 60) * 10) / 10 : '';
  const { value, form } = await sheet({
    title: id ? 'Edit activity' : 'Log a walk or run',
    body: `
      <div class="seg wide" role="radiogroup" aria-label="Type">
        ${ACTIVITY_TYPES.map((t) => `<label><input type="radio" name="type" value="${t}" ${t === a.type ? 'checked' : ''}><span>${t}</span></label>`).join('')}
      </div>
      <div class="field-grid">
        <label class="field"><span>Distance (${distUnit()})</span>
          <input name="distance" type="number" inputmode="decimal" min="0" step="any" value="${a.distance || ''}" placeholder="2.5"></label>
        <label class="field"><span>Time (minutes)</span>
          <input name="minutes" type="number" inputmode="decimal" min="0" step="any" value="${mins}" placeholder="40"></label>
      </div>
      <label class="field"><span>Date</span><input name="date" type="date" value="${esc(a.date)}" max="${dateKey()}"></label>
      <label class="field"><span>Notes</span><input name="notes" value="${esc(a.notes || '')}" placeholder="Route, how it felt…" autocomplete="off"></label>
      <p class="muted small">Tip: copy the distance and time from your watch or the Health app.</p>`,
    buttons: [
      { label: 'Save', value: 'save', cls: 'primary' },
      ...(id ? [{ label: 'Delete', value: 'delete', cls: 'danger' }] : []),
      { label: 'Cancel', value: null },
    ],
  });
  if (value === 'delete') { remove('activities', id); toast('Activity deleted'); return; }
  if (value !== 'save') return;
  const distance = Math.round(num(form.distance) * 100) / 100;
  const duration = Math.round(num(form.minutes) * 60);
  if (!distance && !duration) { toast('Add a distance or a time'); return; }
  upsert('activities', {
    ...(id ? { id } : {}),
    type: form.type || 'Walk',
    date: form.date || dateKey(),
    distance,
    duration,
    notes: (form.notes || '').trim(),
  });
  toast(`${form.type || 'Walk'} logged 👟`);
}

// ---- body weight ---------------------------------------------------------------------------

export async function weightSheet(date) {
  const existing = date ? get('weights', `w-${date}`) : null;
  const last = weightsSorted().at(-1);
  const { value, form } = await sheet({
    title: existing ? 'Edit weight' : 'Log weight',
    body: `
      <label class="field"><span>Weight (${unit()})</span>
        <input name="weight" type="number" inputmode="decimal" min="0" step="any" value="${existing?.weight ?? ''}" placeholder="${last ? last.weight : ''}"></label>
      <label class="field"><span>Date</span><input name="date" type="date" value="${esc(date || dateKey())}" max="${dateKey()}"></label>
      <p class="muted small">For steady numbers, weigh at the same time of day (e.g. mornings). Your weight isn't shared with the household.</p>`,
    buttons: [
      { label: 'Save', value: 'save', cls: 'primary' },
      ...(existing ? [{ label: 'Delete', value: 'delete', cls: 'danger' }] : []),
      { label: 'Cancel', value: null },
    ],
  });
  if (value === 'delete') { remove('weights', existing.id); return; }
  if (value !== 'save') return;
  const w = num(form.weight);
  if (!w) { toast('Enter a weight'); return; }
  const d = form.date || dateKey();
  // Changing the date of an existing entry moves it.
  if (existing && d !== date) remove('weights', existing.id);
  logWeight(d, Math.round(w * 10) / 10);
  toast('Weight saved');
}

export async function goalSheet() {
  const st = getState().settings;
  const last = weightsSorted().at(-1);
  const { value, form } = await sheet({
    title: 'Weight goal',
    body: `
      <label class="field"><span>Goal weight (${unit()})</span>
        <input name="goal" type="number" inputmode="decimal" min="0" step="any" value="${st.goalWeight || ''}"></label>
      <p class="muted small">${last ? `Progress is measured from your latest weight (${last.weight} ${unit()}) when you save.` : 'Log a weight first so progress has a starting point.'}</p>`,
    buttons: [
      { label: 'Save goal', value: 'save', cls: 'primary' },
      ...(st.goalWeight ? [{ label: 'Remove goal', value: 'clear', cls: 'danger' }] : []),
      { label: 'Cancel', value: null },
    ],
  });
  if (value === 'clear') { updateSettings({ goalWeight: 0, goalStart: 0 }); return; }
  if (value !== 'save') return;
  const goal = Math.round(num(form.goal) * 10) / 10;
  if (!goal) { toast('Enter a goal weight'); return; }
  updateSettings({ goalWeight: goal, goalStart: last ? last.weight : 0, goalSetOn: dateKey() });
  toast('Goal saved');
}
