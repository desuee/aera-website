// dev-dsue Admin – helpers for the webmail: formatted (HTML) mails and the beta inbox – by Desue
const LOGO = (process.env.PUBLIC_URL || 'https://www.aerastudios.de').replace(/\/$/, '') + '/img/logo.png';
const SIG_SEP = '\n-- \n';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const link = t => esc(t)
  .replace(/\b(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" style="color:#3b4ef0;text-decoration:none">$1</a>')
  .replace(/(^|[\s(])((?:www\.|discord\.gg\/)[^\s<]+[^\s<.,;:!?)])/g, '$1<a href="https://$2" style="color:#3b4ef0;text-decoration:none">$2</a>')
  .replace(/\b([\w.+-]+@[\w-]+\.[\w.-]+[a-z])\b/gi, '<a href="mailto:$1" style="color:#3b4ef0;text-decoration:none">$1</a>');

function paras(text) {
  // plain text → paragraphs; "> " lines become a quote block
  const out = []; let quote = [];
  const flushQ = () => { if (quote.length) { out.push(`<blockquote style="margin:14px 0 0;padding:2px 0 2px 14px;border-left:3px solid #d4d7de;color:#6a7080">${paras(quote.join('\n'))}</blockquote>`); quote = []; } };
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n');
    if (lines.every(l => /^>/.test(l))) { quote.push(lines.map(l => l.replace(/^> ?/, '')).join('\n'), ''); continue; }
    flushQ();
    const q0 = lines.findIndex(l => /^>/.test(l));
    const own = q0 > 0 ? lines.slice(0, q0) : lines;
    out.push(`<p style="margin:0 0 14px">${own.map(link).join('<br>')}</p>`);
    if (q0 > 0) quote.push(lines.slice(q0).map(l => l.replace(/^> ?/, '')).join('\n'), '');
  }
  flushQ();
  return out.join('');
}

function sigHtml(sig) {
  const lines = sig.split('\n').map(l => l.trim());
  const name = lines.shift() || '';
  const rest = lines.map(l => l ? `<div>${link(l)}</div>` : '<div style="height:8px"></div>').join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:26px;border-top:1px solid #e3e5ea;padding-top:16px;width:100%"><tr>
<td style="width:58px;vertical-align:top;padding-top:16px"><img src="${LOGO}" width="44" height="44" alt="Desue" style="display:block;border-radius:50%;border:0"></td>
<td style="vertical-align:top;padding-top:14px;font-size:13px;line-height:1.55;color:#5d6372"><div style="font-size:15px;font-weight:700;color:#14161b;letter-spacing:-.01em">${esc(name)}</div>${rest}</td></tr></table>`;
}

// text with an optional "-- " signature block → full HTML mail
function toHtml(text) {
  const t = String(text || '').replace(/\r/g, '');
  const i = t.indexOf(SIG_SEP);
  // the signature sits between the own text and a quoted reply (if any)
  let body = t, sig = '', after = '';
  if (i >= 0) {
    body = t.slice(0, i); const rest = t.slice(i + SIG_SEP.length);
    const q = rest.search(/\n\n\n(Am |On |-{6,})/);
    if (q >= 0) { sig = rest.slice(0, q); after = rest.slice(q).trim(); } else sig = rest;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#ffffff"><div style="max-width:640px;padding:8px 4px;font-family:Inter,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1b1d22">
${paras(body.trim())}${sig.trim() ? sigHtml(sig.trim()) : ''}${after ? `<div style="margin-top:22px;font-size:14px;color:#5d6372">${paras(after)}</div>` : ''}
</div></body></html>`;
}

const BETA = { accepted: 'Beta Angenommen', waitlist: 'Beta Warteliste', declined: 'Beta Abgelehnt' };
module.exports = { toHtml, BETA, SIG_SEP };
