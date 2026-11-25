// Demo mailbox for MOCK=1 (testing the page without a mail server). Not used in production.
const now = Date.now(), H = 3600000;
const boxes = {
  INBOX: [
    { uid: 7, subject: 'Frage zu MediaGrab auf dem Mac', from: { name: 'Lena Kraus', address: 'lena@example.com' }, date: now - 0.4 * H, seen: false, flagged: true,
      html: '<p>Hi Simon,</p><p>ich habe MediaGrab auf meinem <b>MacBook Air M2</b> installiert, aber macOS sagt, die App sei beschädigt. Was kann ich machen?</p><p>Danke und viele Grüße<br>Lena</p>' },
    { uid: 6, subject: 'Workshop Uploader – Feature-Idee', from: { name: 'Krystof', address: 'krystof@example.com' }, date: now - 3 * H, seen: false, att: true,
      text: 'Hey,\n\nwäre cool, wenn man im Uploader mehrere Mods gleichzeitig aktualisieren könnte.\n\nScreenshot hängt an.\n\nKrystof', attachments: [{ name: 'idee.png', size: 48211, type: 'image/png' }] },
    { uid: 5, subject: 'Deine Rechnung für dev-dsue.de', from: { name: 'Domain-Service', address: 'billing@example.net' }, date: now - 26 * H, seen: true,
      html: '<div style="font-family:Arial;max-width:520px;margin:auto;border:1px solid #ddd;border-radius:8px;padding:20px"><h2 style="color:#e84a3c;margin-top:0">Rechnung</h2><p>Vielen Dank für deine Bestellung.</p><table style="width:100%;border-collapse:collapse"><tr><td>Domain dev-dsue.de (12 Monate)</td><td style="text-align:right">9,90 €</td></tr></table><p><img src="https://example.net/tracker.png" alt="Logo"></p></div>' },
    { uid: 4, subject: 'Willkommen bei Online-Impressum', from: { name: 'Online-Impressum', address: 'service@example.org' }, date: now - 50 * H, seen: true, text: 'Deine Impressum-Adresse ist eingerichtet.' },
    { uid: 9, subject: 'AERA Beta', from: { name: 'Yannik Berger', address: 'yannik@example.com' }, date: now - 1.2 * H, seen: false, text: 'Hallo Simon,\n\nich habe dein TikTok gesehen und würde AERA sehr gerne testen. Ich spiele seit Jahren Flugsimulatoren und bin auf VATSIM unterwegs.\n\nViele Grüße\nYannik' },
    { uid: 8, subject: 'Beta access request', from: { name: 'Tom Hughes', address: 'tom.h@example.co.uk' }, date: now - 5 * H, seen: true, text: 'Hi,\n\ncould I join the AERA beta? Looks amazing.\n\nCheers, Tom' },
    { uid: 10, subject: 'AERA Team-Bewerbung: Social Media Manager – Max Mustermann', from: { name: 'AERA Bewerbungen', address: 'kontakt@aerastudios.de' }, replyTo: 'max@example.com', date: now - 54 * H, seen: true, text: 'Neue Bewerbung über dev-dsue.de/aera/team\n\nBereich: Social Media Manager\nName: Max Mustermann\nE-Mail: max@example.com\nDiscord: maxm\n\nWarum AERA:\nIch liebe ATC.' },
    { uid: 3, subject: 'EPS: Broadcast-Crew Meeting', from: { name: 'EPS Staff', address: 'staff@example.com' }, date: now - 80 * H, seen: true, answered: true, answeredAt: now - 79 * H, text: 'Meeting am Donnerstag 20 Uhr im Discord.' },
  ],
  Sent: [{ uid: 2, subject: 'Re: EPS: Broadcast-Crew Meeting', from: { name: 'Desue', address: 'kontakt@aerastudios.de' }, date: now - 79 * H, seen: true, text: 'Bin dabei!' }],
  Drafts: [{ uid: 20, subject: 'Antwort an Krystof', from: { name: 'Desue', address: 'kontakt@aerastudios.de' }, to: 'krystof@example.com', date: now - 2 * H, seen: true, text: 'Hey Krystof,\n\ndanke für die Idee!' }], 'Beta Angenommen': [{ uid: 30, subject: 'Re: AERA Beta Anfrage', from: { name: 'Maja Schulz', address: 'maja@example.com' }, date: now - 30 * H, seen: true, answered: true, text: 'Hi, ich will testen!' }], Junk: [{ uid: 1, subject: 'Sie haben gewonnen!!!', from: { name: 'Gewinnspiel', address: 'win@spam.example' }, date: now - 100 * H, seen: false, text: 'Klicken Sie hier.' }], Trash: [],
};
const special = { INBOX: '\\Inbox', Sent: '\\Sent', Drafts: '\\Drafts', Junk: '\\Junk', Trash: '\\Trash' };
let nextUid = 100;
const find = (f, uid) => (boxes[f] || []).find(m => m.uid === uid);
module.exports = {
  folders: () => Object.keys(boxes).map(k => ({ path: k, name: k, special: special[k] || '', unseen: boxes[k].filter(m => !m.seen).length, total: boxes[k].length })),
  list: (f, page, q, filter) => {
    let items = (boxes[f] || []).slice();
    if (q) { const s = q.toLowerCase(); items = items.filter(m => (m.subject + m.from.name + m.from.address + (m.text || m.html || '')).toLowerCase().includes(s)); }
    const own = /^(Sent|Drafts|Trash|Junk)$/.test(f);
    const counts = own ? null : { open: items.filter(m => !m.answered).length, unread: items.filter(m => !m.seen).length, flagged: items.filter(m => m.flagged).length };
    const fx = { open: m => !m.answered, answered: m => m.answered, unread: m => !m.seen, flagged: m => m.flagged }[filter]; if (fx) items = items.filter(fx);
    items.sort((a, b) => b.uid - a.uid);
    return { total: items.length, page, per: 50, counts, own, items: items.map(m => ({ uid: m.uid, subject: m.subject, from: m.from, replyTo: m.replyTo || '', to: [{ address: 'kontakt@aerastudios.de' }], date: new Date(m.date), seen: !!m.seen, flagged: !!m.flagged, answered: !!m.answered, answeredAt: m.answeredAt ? new Date(m.answeredAt) : null, size: 2000, att: !!m.att })) };
  },
  message: (f, uid) => {
    const m = find(f, uid); if (!m) throw new Error('Message not found');
    m.seen = true;
    return { uid, subject: m.subject, date: new Date(m.date), from: [m.from], to: [{ name: '', address: m.to || 'kontakt@aerastudios.de' }], cc: [], replyTo: m.replyTo ? [{ name: '', address: m.replyTo }] : [], messageId: `<${uid}@example>`, references: '', html: m.html || '', text: m.text || '', flagged: !!m.flagged, answered: !!m.answered,
      attachments: (m.attachments || []).map((a, i) => ({ i, ...a, cid: '' })), inline: {} };
  },
  attachment: () => ({ name: 'idee.png', type: 'image/png', data: Buffer.from('iVBORw0KGgo=', 'base64') }),
  flag: (f, uid, flag, on) => { const m = find(f, uid); if (m) m[flag === '\\Seen' ? 'seen' : flag === '\\Answered' ? 'answered' : 'flagged'] = on; },
  move: (f, uid, to) => { const i = (boxes[f] || []).findIndex(m => m.uid === uid); if (i >= 0 && boxes[to]) boxes[to].push(boxes[f].splice(i, 1)[0]); },
  remove: (f, uid, hard) => { if (f === 'Trash' || hard) boxes[f] = (boxes[f] || []).filter(m => m.uid !== uid); else module.exports.move(f, uid, 'Trash'); },
  ensure: name => { if (!boxes[name]) boxes[name] = []; return name; },
  saveDraft: msg => { if (msg.draftUid) boxes.Drafts = boxes.Drafts.filter(m => m.uid !== msg.draftUid); const uid = nextUid++; boxes.Drafts.push({ uid, subject: msg.subject, from: { name: 'Desue', address: 'kontakt@aerastudios.de' }, to: msg.to, date: Date.now(), seen: true, text: msg.text }); return { uid, folder: 'Drafts' }; },
  betaList: B => { const out = []; for (const m of boxes.INBOX) if (/beta/i.test(m.subject)) out.push({ folder: 'INBOX', uid: m.uid, status: 'open', subject: m.subject, from: m.from, date: new Date(m.date), seen: !!m.seen }); for (const [k, n] of Object.entries(B)) for (const m of boxes[n] || []) out.push({ folder: n, uid: m.uid, status: k, subject: m.subject, from: m.from, date: new Date(m.date), seen: true, answered: !!m.answered }); return out.sort((a, b) => b.date - a.date); },
  send: msg => { if (msg.replyFolder && msg.replyUid) { const r = find(msg.replyFolder, msg.replyUid); if (r) { r.answered = true; r.answeredAt = Date.now(); } } if (msg.html) module.exports.lastHtml = msg; boxes.Sent.push({ uid: nextUid++, subject: msg.subject, from: { name: 'Desue', address: 'kontakt@aerastudios.de' }, date: Date.now(), seen: true, text: msg.text }); return { ok: true }; },
};
