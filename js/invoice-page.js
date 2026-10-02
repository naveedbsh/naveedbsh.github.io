// /i/<token>: an invoice as the client sees it - read it, save it as a PDF,
// pay by UPI. ?print=1 (from the company's "Download PDF") opens the print
// dialog straight away.
import { $, esc, toast, copyText } from './ui.js';
import { icon } from './icons.js';
import { invoiceHtml, amt } from './invoice-doc.js';

const token = location.pathname.split('/')[2] || '';
const app = $('#app');

async function load() {
  let res;
  try { res = await fetch('/api/public/invoice/' + encodeURIComponent(token)); } catch { return fail('Cannot reach the server. Check your connection.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return fail(data.error || 'This invoice link is not valid.');
  const i = data.invoice;
  // Chrome and Edge name the saved PDF after the page title.
  document.title = i.title + ' ' + i.number + ' – ' + data.seller.legal_name;
  const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  app.innerHTML = `
    <div class="inv-bar no-print">
      <b class="grow" style="min-width:0">${esc(data.seller.legal_name)}</b>
      ${data.upi && mobile ? `<a class="btn primary" href="${esc(data.upi.link)}">${icon('rupee')} Pay ${esc(amt(data.upi.amount, i.currency))} with UPI</a>` : ''}
      ${data.upi ? `<button class="btn" data-copy-upi>${icon('copy')} Copy UPI ID</button>` : ''}
      <button class="btn${data.upi && mobile ? '' : ' primary'}" data-print>${icon('download')} Download PDF</button>
    </div>
    ${invoiceHtml(data)}
    <p class="small faint no-print" style="text-align:center;margin-top:14px">To save it: Download PDF, then choose “Save as PDF” as the printer.</p>`;
  $('[data-print]', app).addEventListener('click', () => window.print());
  $('[data-copy-upi]', app)?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(data.upi.vpa); toast('UPI ID copied: ' + data.upi.vpa, 'ok'); } catch { copyText(data.upi.vpa); }
  });
  if (new URLSearchParams(location.search).get('print') === '1') {
    // Wait for the logo, then print; the address bar loses ?print so a reload does not print again.
    history.replaceState({}, '', location.pathname);
    const img = $('.inv-logo', app);
    const go = () => setTimeout(() => window.print(), 150);
    if (img && !img.complete) { img.addEventListener('load', go, { once: true }); img.addEventListener('error', go, { once: true }); } else go();
  }
  return undefined;
}

function fail(message) {
  app.innerHTML = '<div class="card card-pad" style="max-width:460px;margin:12vh auto;text-align:center"><h2>Invoice not available</h2><p class="muted mt">' + esc(message) + '</p></div>';
}

load();
