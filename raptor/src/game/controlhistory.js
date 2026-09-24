import { ACTIVE_ACTIONS } from '../engine/binds.js';
import { chordIdentity } from '../engine/input.js';

export function bindingSnapshot(input) {
  return Object.fromEntries(Object.entries(input.actions).map(([id, action]) =>
    [id, action.binds.map(chord => [...chord])]));
}
const sameLayout = (a, b) => Object.keys(a).length === Object.keys(b).length
  && Object.entries(a).every(([id, binds]) => JSON.stringify(binds) === JSON.stringify(b[id]));

// One undo step lasts for this menu instance, including closing/reopening it.
// Failed edits and canceled dialogs leave the previous undo step untouched.
export class BindingHistory {
  constructor(input) { this.input = input; this.previous = null; }
  get canUndo() { return !!this.previous && sameLayout(bindingSnapshot(this.input), this.previous.after); }
  change(label, edit) {
    const before = bindingSnapshot(this.input);
    if (edit() === false) return false;
    const after = bindingSnapshot(this.input);
    if (!sameLayout(before, after)) this.previous = { before, after, label };
    return true;
  }
  undo() {
    if (!this.canUndo || !this.input.replaceBindings(this.previous.before)) return false;
    const label = this.previous.label;
    this.previous = null;
    return label;
  }
}

// Planning has no side effects. The caller must show the conflicts before
// accepting the planned move, including actions left with no remaining key.
export function planActionRestore(input, id) {
  if (!Object.hasOwn(ACTIVE_ACTIONS, id)) return null;
  const layout = bindingSnapshot(input);
  const defaults = ACTIVE_ACTIONS[id].binds.map(chord => [...chord]);
  const identities = new Set(defaults.map(chordIdentity));
  const conflicts = defaults.flatMap(chord => input.findConflicts(id, chord));
  const affected = [...new Set(conflicts.map(conflict => conflict.id))];
  for (const other of affected) layout[other] = layout[other].filter(chord => !identities.has(chordIdentity(chord)));
  layout[id] = defaults;
  return { id, layout, conflicts, unbound: affected.filter(other => !layout[other].length) };
}

export function missingEssentialActions(input) {
  return Object.entries(input.actions).filter(([, action]) => action.essential && !action.binds.length);
}
