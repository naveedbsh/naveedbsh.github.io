// "Report a problem" on a medium: category, severity, note and a photo.
import { upload } from '../api.js';
import { store, $, el, esc, modal, options, toast, busy } from '../ui.js';
import { can } from '../app.js';

export function openReportModal({ medium, onSaved }) {
  const body = el(`
    <form novalidate>
      <p class="muted" style="margin-bottom:14px">${esc(medium.code)} · ${esc(medium.title)}</p>
      <label class="field"><span>What is wrong? *</span><select name="category">${options(store.meta.issue_categories, '', { blank: 'Choose a problem…' })}</select></label>
      <label class="field mt"><span>How urgent?</span>
        <div class="row" style="gap:16px;margin-top:4px">
          <label class="check"><input type="radio" name="severity" value="low"> Low</label>
          <label class="check"><input type="radio" name="severity" value="medium" checked> Medium</label>
          <label class="check"><input type="radio" name="severity" value="high"> High – client visible / unsafe</label>
        </div>
      </label>
      <label class="field mt"><span>Details</span><textarea name="description" maxlength="5000" placeholder="What did you see? When did it start?"></textarea></label>
      <label class="field mt"><span>Photo</span><input type="file" name="photo" accept="image/*" capture="environment"></label>
      ${can('manager') ? '<label class="check mt"><input type="checkbox" name="mark_maintenance"> Take it off sale (mark under maintenance) until fixed</label>' : ''}
      <div class="error-text mt hidden" data-err></div>
    </form>`);
  const m = modal({
    title: 'Report a problem', body,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-send>Send report</button>',
  });
  $('[data-send]', m.el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const err = $('[data-err]', body);
    err.classList.add('hidden');
    if (!body.category.value) { err.textContent = 'Choose what is wrong.'; err.classList.remove('hidden'); return; }
    const fd = new FormData(body);
    fd.set('medium_id', medium.id);
    if (body.mark_maintenance) fd.set('mark_maintenance', body.mark_maintenance.checked ? '1' : '0');
    if (!body.photo.files.length) fd.delete('photo');
    try {
      await upload('/issues', fd);
      toast('Problem reported. The team will see it under Problem reports.', 'ok');
      m.close();
      onSaved?.();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  }));
}
