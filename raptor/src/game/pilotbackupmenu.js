import { GameDialog, escapeHTML } from './ui.js';
import { current } from './settings.js';
import { BACKUP_LIMIT, createPilotBackup, parsePilotBackup, restorePilotBackup, summarizePilotBackup } from './pilotbackup.js';

export class PilotBackupMenu extends GameDialog {
  constructor({ state = window.__RAPTOR } = {}) {
    super({title:'Keep your pilot profile',label:'Backup & restore',className:'pilot-backup',onClose:()=>this.el.remove()});
    this.state = state;
    this.readSequence = 0;
    this.body.innerHTML = `<p class="dialog-intro">Take your completed missions and scenarios, operations, flight school, controls, and preferences with you. Your backup stays in a file on your device.</p>
      <div class="backup-actions"><button class="ui-button primary" type="button" data-backup-export>Download backup ↓</button><button class="ui-button" type="button" data-backup-choose ${state?.hangar?'':'disabled'}>Choose backup…</button><input type="file" accept=".json,application/json" data-backup-file hidden></div>
      <p class="backup-note">${state?.hangar?'Restore replaces your saved profile after you review it below.':'Restore is available from preflight so it cannot interrupt this flight.'} An unfinished flight is not included.</p>
      <p class="backup-status" role="status" aria-live="polite" data-backup-status></p><section class="backup-preview" data-backup-preview hidden aria-label="Review pilot backup"></section>`;
    this.status = this.body.querySelector('[data-backup-status]');
    this.preview = this.body.querySelector('[data-backup-preview]');
    const file = this.body.querySelector('[data-backup-file]');
    this.body.querySelector('[data-backup-choose]').onclick = () => file.click();
    file.onchange = () => {const selected = file.files?.[0]; file.value = ''; if (selected) this.readFile(selected);};
    this.body.querySelector('[data-backup-export]').onclick = () => this.download();
  }
  capture() {
    const bindings = this.state?.input?.actions && Object.fromEntries(Object.entries(this.state.input.actions).map(([id, action]) => [id, action.binds]));
    return createPilotBackup(localStorage, {settings:current(),bindings});
  }
  download() {
    try {
      const backup = this.capture();
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
      const a = document.createElement('a'); a.href = url; a.download = `raptor-pilot-${backup.createdAt.slice(0,10)}.json`;
      this.el.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
      this.status.textContent = 'Backup download started. Keep this file to restore your profile in another browser.';
    } catch (error) {this.status.textContent = error.message;}
  }
  async readFile(file) {
    const sequence = ++this.readSequence;
    this.pending = null; this.preview.hidden = true;
    this.status.textContent = 'Reading your backup…';
    try {
      if (file.size > BACKUP_LIMIT) throw new Error('Choose a Raptor backup smaller than 256 KB.');
      const content = await file.text();
      if (!this.open || sequence !== this.readSequence) return;
      const backup = parsePilotBackup(content), summary = summarizePilotBackup(backup);
      // A valid backup is also the recovery path for a damaged local profile.
      // Comparing the current save is best effort; restoration snapshots its
      // raw records independently and still rolls back failed writes.
      let present = null;
      try {present = summarizePilotBackup(this.capture());} catch { /* show unknown current counts */ }
      this.pending = backup;
      this.status.textContent = '';
      this.preview.innerHTML = `<p class="eyebrow">REVIEW BEFORE RESTORING</p><h3>Backup from ${escapeHTML(new Date(summary.createdAt).toLocaleDateString())}</h3>
        <dl class="backup-summary"><div><dt>Campaign missions</dt><dd>${summary.missions} / 30 <small>${present?present.missions+' currently saved':'Current profile unreadable'}</small></dd></div><div><dt>Standalone scenarios</dt><dd>${summary.scenarios} / 1 <small>${present?present.scenarios+' currently saved':'Current profile unreadable'}</small></dd></div><div><dt>Saved operations</dt><dd>${summary.operations} / 3 <small>${present?present.operations+' currently saved':'Current profile unreadable'}</small></dd></div><div><dt>Flight school</dt><dd>${summary.graduated?'Graduated':'Not completed'}</dd></div><div><dt>Controls & preferences</dt><dd>${summary.bindings||summary.settings?'Included':'Defaults'}</dd></div></dl>
        <p>This replaces the saved profile in this browser, including progress not in the backup. Download your current profile first if you want to keep both. Raptor will reload when the restore succeeds.</p>
        <div class="backup-actions"><button type="button" class="ui-button" data-backup-cancel>Keep current profile</button><button type="button" class="ui-button primary" data-backup-restore>Replace profile & reload</button></div>`;
      this.preview.hidden = false;
      this.preview.querySelector('[data-backup-cancel]').onclick = () => {this.pending=null;this.preview.hidden=true;this.status.textContent='Your current profile was kept.';this.body.querySelector('[data-backup-choose]').focus();};
      this.preview.querySelector('[data-backup-restore]').onclick = () => this.restore();
      this.preview.querySelector('[data-backup-cancel]').focus();
    } catch (error) {
      if (!this.open || sequence !== this.readSequence) return;
      this.status.textContent = error.message;
    }
  }
  restore() {
    if (!this.state?.hangar || !this.pending) return;
    const button = this.preview.querySelector('[data-backup-restore]'); button.disabled = true;
    try {
      restorePilotBackup(localStorage,this.pending);
      this.status.textContent = 'Profile restored. Reloading Raptor…';
      location.reload();
    } catch (error) {button.disabled=false;this.status.textContent=error.message;}
  }
}
