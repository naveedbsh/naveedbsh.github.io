// Profit & loss: what the company earned, what it spent, and where.
import { client } from '../api.js';
import { store, $ } from '../ui.js';
import { icon } from '../icons.js';
import { can } from '../app.js';
import { renderPnl } from './pnl-report.js';

export async function render(root, params, query) {
  if (!can('manager')) {
    root.innerHTML = '<div class="page-head"><h1>Profit &amp; loss</h1></div><div class="card"><div class="empty">' + icon('lock') +
      '<div class="mt">Money reports are for managers and admins. Ask your company admin if you need access.</div></div></div>';
    return;
  }
  // Managers and admins (the only ones past the check above) may add and edit expenses.
  root.innerHTML = `
    <div class="page-head">
      <h1>Profit &amp; loss</h1>
      <span class="muted small">Revenue is counted day by day over each booking; costs are each board's running cost plus expenses.</span>
      <button class="btn primary" data-add>${icon('plus')} Add expense</button>
    </div>
    <div data-report></div>`;

  const report = renderPnl($('[data-report]', root), {
    api: client,
    currency: store.company.currency,
    links: true,
    canEdit: true,
    tab: query.tab,
    fileName: 'profit-loss',
    onTab: (tab) => {
      const url = new URL(location.href);
      if (tab === 'overview') url.searchParams.delete('tab'); else url.searchParams.set('tab', tab);
      history.replaceState({}, '', url.pathname + url.search);
    },
  });
  $('[data-add]', root).addEventListener('click', () => report.addExpense());
}
