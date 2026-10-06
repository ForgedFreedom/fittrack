// Unsaved work in the plan and exercise editors.
// Tracks whether the draft differs from what was opened, and keeps unsaved
// changes on the phone so they survive iOS closing the app in the background
// (e.g. while you switch to a video). Cleared once saved or discarded.

import { current } from './profiles.js';

export class Draft {
  constructor(kind) {
    this.kind = kind;     // 'plan' | 'exercise'
    this.value = null;    // the object being edited (mutated in place by the editor)
    this.base = '';       // JSON of the value as opened, to detect changes
    this.storeId = null;
    this.restored = false;
  }

  key() {
    return `fittrack:draft:${current()?.id}:${this.kind}:${this.storeId}`;
  }

  // Start editing. An unsaved draft left from an earlier visit takes priority.
  begin(id, value) {
    this.storeId = id || 'new';
    this.base = JSON.stringify(value);
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(this.key())); } catch { /* ignore */ }
    this.restored = !!saved && JSON.stringify(saved) !== this.base;
    this.value = this.restored ? saved : value;
    if (!this.restored) localStorage.removeItem(this.key());
    return this.value;
  }

  dirty() {
    return !!this.value && JSON.stringify(this.value) !== this.base;
  }

  // Call after every change.
  persist() {
    if (!this.value) return;
    if (this.dirty()) localStorage.setItem(this.key(), JSON.stringify(this.value));
    else localStorage.removeItem(this.key());
  }

  // After a save: the saved state becomes the new baseline. `id` is set for new records.
  saved(id) {
    localStorage.removeItem(this.key());
    if (id) this.storeId = id;
    this.base = JSON.stringify(this.value);
  }

  discard() {
    localStorage.removeItem(this.key());
    this.value = null;
  }
}
