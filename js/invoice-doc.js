// The invoice as a document: one renderer for the company's view and the
// client's link, designed for A4 on paper or as a PDF, and for a phone.
import { esc, fdate } from './ui.js';

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen',
  'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
const three = (n) => (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n));

/** 59000.5 -> "Rupees Fifty-Nine Thousand and Fifty Paise Only" (Indian numbering: lakh, crore). */
export function amountInWords(amount, currency = 'INR') {
  const total = Math.round(Math.abs(Number(amount) || 0) * 100);
  let n = Math.floor(total / 100);
  const paise = total % 100;
  const parts = [];
  for (const [size, word] of [[1e7, 'Crore'], [1e5, 'Lakh'], [1e3, 'Thousand']]) {
    if (n >= size) { const q = Math.floor(n / size); parts.push((q >= 100 ? amountInWords(q, 'raw') : two(q)) + ' ' + word); n %= size; }
  }
  if (n) parts.push(three(n));
  const words = parts.join(' ') || 'Zero';
  if (currency === 'raw') return words;
  const unit = currency === 'INR' ? 'Rupees' : currency;
  return unit + ' ' + words + (paise ? ' and ' + two(paise) + ' Paise' : '') + ' Only';
}

/** ₹ with paise, Indian grouping. */
export function amt(v, cur = 'INR') {
  try {
    return new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : undefined, { style: 'currency', currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0);
  } catch { return cur + ' ' + (Number(v) || 0).toFixed(2); }
}

const STAMP = {
  paid: ['Paid', 'paid'], partial: ['Part paid', 'partial'], unpaid: ['Due', 'due'], cancelled: ['Cancelled', 'cancelled'],
};
export function stateLabel(i) {
  if (i.state === 'cancelled') return 'Cancelled';
  if (i.state === 'paid') return 'Paid';
  if (i.overdue) return (i.state === 'partial' ? 'Part paid · ' : '') + 'Overdue ' + i.days_late + ' day' + (i.days_late === 1 ? '' : 's');
  return i.state === 'partial' ? 'Part paid' : 'Due ' + fdate(i.due_date);
}
export function statePill(i) {
  const cls = i.state === 'paid' ? 'ok' : i.state === 'cancelled' ? '' : i.overdue ? 'bad' : 'warn';
  return '<span class="pill ' + cls + '">' + esc(stateLabel(i)) + '</span>';
}

const lines = (...xs) => xs.filter(Boolean).map(esc).join('<br>');

/** The document HTML. */
export function invoiceHtml(doc) {
  const i = doc.invoice;
  const s = doc.seller;
  const c = i.client;
  const cur = i.currency;
  const [stamp, stampCls] = STAMP[i.state] || STAMP.unpaid;
  const tax = i.tax_type === 'cgst_sgst'
    ? `<tr><td>CGST ${i.tax_rate / 2}%</td><td class="num">${amt(i.cgst, cur)}</td></tr><tr><td>SGST ${i.tax_rate / 2}%</td><td class="num">${amt(i.sgst, cur)}</td></tr>`
    : i.tax_type === 'igst' ? `<tr><td>IGST ${i.tax_rate}%</td><td class="num">${amt(i.igst, cur)}</td></tr>` : '';
  return `
  <article class="inv-doc${i.state === 'cancelled' ? ' is-cancelled' : ''}">
    <header class="inv-head">
      <div class="inv-seller">
        ${s.logo_url ? `<img class="inv-logo" src="${esc(s.logo_url)}" alt="">` : ''}
        <div>
          <div class="inv-seller-name">${esc(s.legal_name)}</div>
          <div class="inv-small">${lines(s.address, s.state ? s.state + (s.state_code ? ' (' + s.state_code + ')' : '') : '')}</div>
          <div class="inv-small">${[s.gstin ? 'GSTIN ' + esc(s.gstin) : '', s.pan ? 'PAN ' + esc(s.pan) : ''].filter(Boolean).join(' · ')}</div>
          <div class="inv-small">${[s.phone, s.email].filter(Boolean).map(esc).join(' · ')}</div>
        </div>
      </div>
      <div class="inv-title">
        <h1>${esc(i.title)}</h1>
        <table class="inv-meta">
          <tr><td>Invoice no.</td><td><b>${esc(i.number)}</b></td></tr>
          <tr><td>Date</td><td>${fdate(i.issue_date)}</td></tr>
          <tr><td>Due date</td><td>${fdate(i.due_date)}</td></tr>
          ${i.place_of_supply ? `<tr><td>Place of supply</td><td>${esc(i.place_of_supply)}</td></tr>` : ''}
        </table>
        <div class="inv-stamp ${stampCls}${i.overdue ? ' overdue' : ''}">${i.overdue ? 'Overdue' : esc(stamp)}</div>
      </div>
    </header>

    <section class="inv-parties">
      <div>
        <div class="inv-label">Bill to</div>
        <div class="inv-client">${esc(c.name)}</div>
        <div class="inv-small">${lines(c.contact ? 'Attn: ' + c.contact : '', c.address, c.state ? c.state + ' (' + c.state_code + ')' : '')}</div>
        <div class="inv-small">${[c.gstin ? 'GSTIN ' + esc(c.gstin) : '', c.phone ? esc(c.phone) : '', c.email ? esc(c.email) : ''].filter(Boolean).join(' · ')}</div>
      </div>
      <div class="inv-summary">
        <div class="inv-label">${i.due > 0 ? 'Amount due' : i.state === 'cancelled' ? 'Cancelled' : 'Paid in full'}</div>
        <div class="inv-due">${amt(i.due > 0 ? i.due : i.total, cur)}</div>
        <div class="inv-small">${i.due > 0 ? (i.paid > 0 ? amt(i.paid, cur) + ' received of ' + amt(i.total, cur) + ' · ' : '') + 'due ' + fdate(i.due_date) : 'Total ' + amt(i.total, cur)}</div>
      </div>
    </section>

    <table class="inv-items">
      <thead><tr><th class="n">#</th><th>Description</th><th class="sac">SAC</th><th class="num">Amount</th></tr></thead>
      <tbody>
        ${doc.items.map((it, k) => `<tr>
          <td class="n">${k + 1}</td>
          <td>${esc(it.description)}${it.period_start ? `<div class="inv-small">${fdate(it.period_start)} – ${fdate(it.period_end)} · ${it.days} day${it.days === 1 ? '' : 's'}</div>` : ''}</td>
          <td class="sac">${esc(it.sac || '')}</td>
          <td class="num">${amt(it.amount, cur)}</td></tr>`).join('')}
      </tbody>
    </table>

    <section class="inv-bottom">
      <div class="inv-words">
        <div class="inv-label">Amount in words</div>
        <div>${esc(amountInWords(i.total, cur))}</div>
        ${(() => {
    // Money paid on the bookings directly (before this invoice, or marked paid on the board) counts too.
    const recorded = doc.payments.reduce((t, p) => t + p.amount, 0);
    const earlier = Math.round((i.paid - recorded) * 100) / 100;
    if (!doc.payments.length && earlier < 0.01) return '';
    return `<div class="inv-label" style="margin-top:14px">Payments received</div><table class="inv-pay">
      ${earlier >= 0.01 ? `<tr><td colspan="2">Paid against these bookings earlier</td><td class="num">${amt(earlier, cur)}</td></tr>` : ''}
      ${doc.payments.map((p) => `<tr><td>${fdate(p.paid_on)}</td><td>${esc({ upi: 'UPI', bank: 'Bank transfer', cash: 'Cash', cheque: 'Cheque', card: 'Card', other: 'Other' }[p.method] || p.method || '')}${p.reference ? ' · ' + esc(p.reference) : ''}</td><td class="num">${amt(p.amount, cur)}</td></tr>`).join('')}</table>`;
  })()}
      </div>
      <table class="inv-totals">
        <tr><td>${i.tax_type === 'none' ? 'Total' : 'Taxable value'}</td><td class="num">${amt(i.subtotal, cur)}</td></tr>
        ${tax}
        ${i.tax_type !== 'none' ? `<tr class="grand"><td>Total</td><td class="num">${amt(i.total, cur)}</td></tr>` : ''}
        ${i.paid > 0 && i.state !== 'cancelled' ? `<tr><td>Received</td><td class="num">− ${amt(i.paid, cur)}</td></tr>` : ''}
        ${i.state !== 'cancelled' ? `<tr class="due"><td>Balance due</td><td class="num">${amt(i.due, cur)}</td></tr>` : ''}
      </table>
    </section>

    ${(doc.bank || doc.upi) && i.state !== 'cancelled' ? `<section class="inv-payto">
      ${doc.bank ? `<div>
        <div class="inv-label">Pay by bank transfer</div>
        <table class="inv-bank">
          <tr><td>Account name</td><td>${esc(doc.bank.account_name || s.legal_name)}</td></tr>
          <tr><td>Bank</td><td>${esc(doc.bank.bank_name)}${doc.bank.branch ? ', ' + esc(doc.bank.branch) : ''}</td></tr>
          <tr><td>Account no.</td><td><b>${esc(doc.bank.account_number)}</b></td></tr>
          <tr><td>IFSC</td><td><b>${esc(doc.bank.ifsc)}</b></td></tr>
        </table>
      </div>` : ''}
      ${doc.upi ? `<div class="inv-upi">
        <div class="inv-qr">${doc.upi.qr_svg}</div>
        <div>
          <div class="inv-label">Scan to pay with UPI</div>
          <div class="inv-upi-amount">${amt(doc.upi.amount, cur)}</div>
          <div class="inv-small">${esc(doc.upi.vpa)}<br>Google Pay, PhonePe, Paytm, BHIM or any UPI app</div>
        </div>
      </div>` : ''}
    </section>` : ''}

    <footer class="inv-foot">
      <div class="inv-terms">${doc.terms || i.notes ? '<div class="inv-label">Terms &amp; notes</div>' : ''}${i.notes ? '<p>' + esc(i.notes) + '</p>' : ''}${doc.terms ? '<p>' + esc(doc.terms) + '</p>' : ''}</div>
      <div class="inv-sign">
        <div>For ${esc(s.legal_name)}</div>
        <div class="inv-sign-line"></div>
        <div class="inv-small">${esc(doc.signatory || 'Authorised signatory')}</div>
      </div>
    </footer>
    <div class="inv-generated">${i.tax_type !== 'none' ? 'This is a computer-generated invoice. ' : ''}Made with HoardHub</div>
  </article>`;
}
