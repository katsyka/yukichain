'use strict';
const API = '/api';
const NANO = 1000000000n;
const view = document.getElementById('view');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let STATUS = null, LABELS = {}, live = null;

/* ---------- formatting ---------- */
function fmt(n, dec = 4) {
  n = BigInt(n); const neg = n < 0n; if (neg) n = -n;
  const w = n / NANO, f = (n % NANO).toString().padStart(9, '0').slice(0, dec).replace(/0+$/, '');
  return (neg ? '-' : '') + w.toLocaleString('en-US') + (f ? '.' + f : '');
}
function compact(n) {
  const y = Number(BigInt(n) / NANO);
  return y >= 1e9 ? (y / 1e9).toFixed(3) + 'B' : y >= 1e6 ? (y / 1e6).toFixed(2) + 'M' : y >= 1e3 ? (y / 1e3).toFixed(1) + 'K' : String(y);
}
function parseAmt(s) {
  s = String(s).trim().replace(',', '.');
  if (!/^\d+(\.\d{0,9})?$/.test(s)) throw Error('Enter an amount like 12.5');
  const [w, f = ''] = s.split('.');
  return BigInt(w) * NANO + BigInt(f.padEnd(9, '0'));
}
const short = (a, n = 6) => a ? (a.length > 2 * n + 8 ? a.slice(0, n + 5) + '…' + a.slice(-n) : a) : '';
function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000 | 0);
  return s < 60 ? s + 's ago' : s < 3600 ? (s / 60 | 0) + 'm ago' : s < 86400 ? (s / 3600 | 0) + 'h ago' : (s / 86400 | 0) + 'd ago';
}
const date = ms => new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' });
const num = n => Number(n).toLocaleString('en-US');

function hue(a) { let h = 0; for (const c of a) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function avatar(a, cls = '') {
  const h = hue(a), h2 = hue(a + '~'), fg = `hsl(${188 + h % 34} ${26 + (h2 >> 3) % 30}% ${64 + (h2 >> 9) % 18}%)`;
  let r = '';
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if ((h2 >>> (y * 3 + x)) & 1) {
    const c = y === 2 && x === 2 && (h & 1) ? 'var(--accent)' : fg;
    r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>` + (x < 2 ? `<rect x="${4 - x}" y="${y}" width="1" height="1" fill="${c}"/>` : '');
  }
  return `<div class="avatar ${cls}" style="background:#18202c"><svg viewBox="-1 -1 7 7" width="100%" height="100%" shape-rendering="crispEdges" aria-hidden="true">${r}</svg></div>`;
}
const addrLink = (a, n = 6) => a ? `<a href="#/address/${esc(a)}" class="mono" title="${esc(a)}">${LABELS[a] ? esc(LABELS[a]) : esc(short(a, n))}</a>` : '<span class="dim">—</span>';
const copyBtn = v => `<button class="copy" data-copy="${esc(v)}" title="Copy" aria-label="Copy"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="8.5" height="8.5" rx="2"/><path d="M10.5 5V3.5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3.5V9A1.5 1.5 0 0 0 4 10.5h1"/></svg></button>`;
const nameLink = n => `<a href="#/name/${esc(n)}" class="mono">${esc(n)}.yuki</a>`;

function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'on' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', 3200);
}

/* ---------- api ---------- */
async function get(p) {
  const r = await fetch(API + p); const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(j.error || 'HTTP ' + r.status); return j;
}
async function post(p, b) {
  const r = await fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(j.error || 'HTTP ' + r.status); return j;
}

/* ---------- crypto: bech32 + ed25519 ---------- */
const B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l', GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
function polymod(v) { let c = 1; for (const x of v) { const t = c >>> 25; c = ((c & 0x1ffffff) << 5) ^ x; for (let i = 0; i < 5; i++) if ((t >>> i) & 1) c ^= GEN[i]; } return c >>> 0; }
const hrpExp = h => [...[...h].map(c => c.charCodeAt(0) >> 5), 0, ...[...h].map(c => c.charCodeAt(0) & 31)];
function bech32(hrp, bytes) {
  const d = []; let acc = 0, bits = 0;
  for (const b of bytes) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; d.push((acc >> bits) & 31); } }
  if (bits) d.push((acc << (5 - bits)) & 31);
  const mod = polymod([...hrpExp(hrp), ...d, 0, 0, 0, 0, 0, 0]) ^ 1;
  for (let i = 0; i < 6; i++) d.push((mod >>> (5 * (5 - i))) & 31);
  return hrp + '1' + d.map(x => B32[x]).join('');
}
const toHex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
const fromHex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
async function addrFromPub(pub) { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', pub)); return bech32('yuki', h.slice(0, 20)); }

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
};
async function loadWallet() {
  const sk = store.get('yk_wallet'); if (!sk) return null;
  try { const kp = nacl.sign.keyPair.fromSecretKey(fromHex(sk)); return { kp, address: await addrFromPub(kp.publicKey) }; } catch { return null; }
}
async function signAndSend(w, tx) {
  const st = STATUS || await get('/status');
  const acc = await get('/account/' + w.address);
  const t = { type: tx.type, from: w.address, to: tx.to || '', amount: String(tx.amount || 0n), fee: STATUS ? STATUS.min_fee : '1000000', nonce: acc.next_nonce, name: tx.name || '', memo: tx.memo || '' };
  const msg = [st.chain_id, t.type, t.from, t.to, t.amount, t.fee, t.nonce, t.name, t.memo].join('\n');
  t.pubkey = toHex(w.kp.publicKey);
  t.sig = toHex(nacl.sign.detached(new TextEncoder().encode(msg), w.kp.secretKey));
  return post('/tx', t);
}
async function resolveTo(q) {
  q = q.trim().toLowerCase(); if (!q) throw Error('Enter a recipient');
  try { return (await get('/account/' + encodeURIComponent(q))).address; } catch { throw Error('Unknown address or name: ' + q); }
}

/* ---------- live stream ---------- */
function startStream() {
  let es;
  const open = () => {
    es = new EventSource(API + '/stream');
    es.onmessage = e => { const m = JSON.parse(e.data); STATUS = m.status; if (live) live(m); };
    es.onerror = () => { es.close(); setTimeout(open, 4000); };
  };
  open();
}

/* ---------- shared pieces ---------- */
function statsHTML() {
  return `<div class="stats">
  ${[['height', 'Block height'], ['supply', 'Total supply · YUKI'], ['txs', 'Transactions'], ['accounts', 'Accounts'], ['names', '.yuki names'], ['burned', 'Burned · YUKI']]
    .map(([k, l]) => `<div class="stat"><small>${l}</small><b data-st="${k}">—</b></div>`).join('')}</div>`;
}
function fillStats(s, flash) {
  const v = { height: num(s.height), supply: compact(s.supply), txs: num(s.txs), accounts: num(s.accounts), names: num(s.names), burned: fmt(s.burned, 2) };
  $$('[data-st]').forEach(el => {
    const nv = v[el.dataset.st]; if (el.textContent !== nv) { el.textContent = nv; if (flash) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } }
  });
}
function txSummary(t, me) {
  const amt = BigInt(t.amount || 0);
  switch (t.type) {
    case 'transfer': return { kind: me ? (t.to === me ? 'in' : 'out') : 'out', label: 'Transfer', amount: amt };
    case 'name_register': return { kind: 'dns', label: 'Register ' + t.name + '.yuki', amount: 0n };
    case 'name_transfer': return { kind: 'dns', label: 'Transfer ' + t.name + '.yuki', amount: 0n };
    case 'name_target': return { kind: 'dns', label: 'Point ' + t.name + '.yuki', amount: 0n };
  }
  return { kind: 'out', label: t.type, amount: amt };
}
function blockRow(b, enter) {
  return `<tr${enter ? ' class="enter"' : ''}><td><a href="#/block/${b.height}" class="mono">#${num(b.height)}</a></td><td class="muted">${ago(b.time)}</td><td>${b.txs} tx</td><td class="r mono">+${fmt(b.reward, 3)}</td></tr>`;
}
function txRow(v, enter) {
  const t = v.tx, s = txSummary(t);
  return `<tr${enter ? ' class="enter"' : ''}><td><a href="#/tx/${t.hash}" class="mono">${t.hash.slice(0, 10)}…</a></td><td>${addrLink(t.from, 4)} <span class="dim">→</span> ${t.type === 'transfer' ? addrLink(t.to, 4) : `<span class="dir dns">${esc(s.label)}</span>`}</td><td class="r mono">${s.amount ? fmt(s.amount, 3) : '—'}</td><td class="muted r">${ago(v.time)}</td></tr>`;
}

/* ---------- views ---------- */
const views = {};

let landing = null;
views.home = async () => {
  document.body.classList.add('home');
  const m = await import('./landing.js?v=12');
  landing = await m.mount(view, { get, fmt, esc });
  live = msg => landing && landing.live(msg);
};

views.explorer = async () => {
  view.innerHTML = `<div class="wrap page">
  <div class="page-h"><h1>Explorer</h1><span class="pill info" id="hb">● live</span></div>
  ${statsHTML()}
  <div class="card" style="margin-top:18px"><div class="card-h"><h3>Transactions, last 14 days</h3><span class="muted" id="ctot"></span></div><div class="card-b"><div class="chart" id="chart"></div></div></div>
  <div class="grid2">
   <div class="card"><div class="card-h"><h3>Latest blocks</h3><span class="muted">every 5s with txs · 60s idle</span></div><table><thead><tr><th>Block</th><th>Age</th><th>Txs</th><th class="r">Reward</th></tr></thead><tbody id="blk"></tbody></table></div>
   <div class="card"><div class="card-h"><h3>Latest transactions</h3></div><table><thead><tr><th>Hash</th><th>From → To</th><th class="r">YUKI</th><th class="r">Age</th></tr></thead><tbody id="txl"></tbody></table></div>
  </div></div>`;
  const [st, blocks, txs, daily] = await Promise.all([get('/status'), get('/blocks?limit=12'), get('/txs?limit=12'), get('/stats/daily?days=14')]);
  fillStats(st);
  $('#blk').innerHTML = blocks.map(b => blockRow(b)).join('');
  $('#txl').innerHTML = txs.length ? txs.map(v => txRow(v)).join('') : `<tr><td colspan="4" class="empty">No transactions yet. <a href="#/wallet">Make the first one →</a></td></tr>`;
  const max = Math.max(1, ...daily.txs);
  $('#ctot').textContent = num(daily.txs.reduce((a, b) => a + b, 0)) + ' total';
  $('#chart').innerHTML = daily.txs.map((n, i) => `<div style="height:${n / max * 100}%" data-t="${new Date(daily.start_day + i * 864e5).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${n} tx"></div>`).join('');
  live = async m => {
    fillStats(m.status, true);
    const tb = $('#blk'); tb.insertAdjacentHTML('afterbegin', blockRow(m.block, true)); while (tb.rows.length > 12) tb.deleteRow(-1);
    if (m.block.txs) {
      const b = await get('/block/' + m.block.height); const tl = $('#txl'); if (!tl) return;
      if (tl.querySelector('.empty')) tl.innerHTML = '';
      b.txs.slice(-12).forEach(t => tl.insertAdjacentHTML('afterbegin', txRow({ tx: t, time: b.time }, true)));
      while (tl.rows.length > 12) tl.deleteRow(-1);
    }
  };
};

function kv(rows) { return `<div class="kv">${rows.filter(Boolean).map(([k, v]) => `<div>${k}</div><div>${v}</div>`).join('')}</div>`; }

views.block = async id => {
  const b = await get('/block/' + encodeURIComponent(id));
  view.innerHTML = `<div class="wrap page">
  <div class="page-h"><h1>Block #${num(b.height)}</h1>${b.height ? `<a class="btn sm" href="#/block/${b.height - 1}">← prev</a>` : ''}<a class="btn sm" href="#/block/${b.height + 1}">next →</a></div>
  <div class="card">${kv([
    ['Hash', `<span class="mono">${b.hash}</span> ${copyBtn(b.hash)}`],
    ['Previous', b.height ? `<a class="mono" href="#/block/${b.height - 1}">${b.prev}</a>` : `<span class="mono dim">${b.prev}</span> <span class="pill info">genesis</span>`],
    ['Time', `${date(b.time)} <span class="dim">(${ago(b.time)})</span>`],
    ['Proposer', addrLink(b.proposer, 10)],
    ['Transactions', b.txs.length],
    ['Block reward', `${fmt(b.reward, 9)} YUKI <span class="dim">minted</span>`],
    ['Fees', `${fmt(b.fees, 9)} YUKI`],
    ['Tx Merkle root', `<span class="mono">${b.tx_root}</span>`],
    ['State root', `<span class="mono">${b.state_root}</span>`],
    b.sig && ['Validator signature', `<span class="mono dim">${b.sig}</span>`],
  ])}</div>
  <div class="card" style="margin-top:18px"><div class="card-h"><h3>Transactions</h3></div>
  ${b.txs.length ? `<table><thead><tr><th>Hash</th><th>From → To</th><th class="r">YUKI</th><th class="r">Fee</th></tr></thead><tbody>${b.txs.map(t => { const s = txSummary(t); return `<tr><td><a class="mono" href="#/tx/${t.hash}">${t.hash.slice(0, 14)}…</a></td><td>${addrLink(t.from, 4)} <span class="dim">→</span> ${t.type === 'transfer' ? addrLink(t.to, 4) : `<span class="dir dns">${esc(s.label)}</span>`}</td><td class="r mono">${s.amount ? fmt(s.amount) : '—'}</td><td class="r mono dim">${fmt(t.fee, 4)}</td></tr>`; }).join('')}</tbody></table>` : '<div class="empty">Empty block: only the validator reward.</div>'}</div></div>`;
  live = m => { if (m.block.height === b.height + 1) toast('New block #' + num(m.block.height)); };
};

views.tx = async hash => {
  const v = await get('/tx/' + encodeURIComponent(hash)); const t = v.tx, s = txSummary(t);
  view.innerHTML = `<div class="wrap page">
  <div class="page-h"><h1>Transaction</h1>${v.pending ? '<span class="pill warn">● Pending</span>' : '<span class="pill ok">✓ Confirmed</span>'}</div>
  <div class="card">${kv([
    ['Hash', `<span class="mono">${t.hash}</span> ${copyBtn(t.hash)}`],
    ['Type', `<span class="dir ${s.kind}">${esc(s.label)}</span>`],
    ['From', `${addrLink(t.from, 12)} ${copyBtn(t.from)}`],
    t.to && [t.type === 'name_target' ? 'Points to' : t.type === 'name_transfer' ? 'New owner' : 'To', `${addrLink(t.to, 12)} ${copyBtn(t.to)}`],
    t.type === 'transfer' && ['Amount', `<b>${fmt(t.amount, 9)} YUKI</b>`],
    t.name && ['Name', nameLink(t.name)],
    t.type === 'name_register' && ['Burned', `${fmt(namePrice(t.name), 1)} YUKI`],
    ['Fee', `${fmt(t.fee, 9)} YUKI`],
    t.memo && ['Memo', esc(t.memo)],
    ['Nonce', t.nonce],
    !v.pending && ['Block', `<a href="#/block/${v.height}">#${num(v.height)}</a>`],
    !v.pending && ['Time', `${date(v.time)} <span class="dim">(${ago(v.time)})</span>`],
    ['Public key', `<span class="mono dim">${t.pubkey}</span>`],
    ['Signature', `<span class="mono dim">${t.sig}</span>`],
  ])}</div></div>`;
  live = v.pending ? () => route() : null;
};
// mirrors NamePrice in node/types.go: shorter costs more, any digit halves the price
const NAME_TIERS = [[3, 3000], [4, 1000], [5, 300], [6, 100], [7, 50], [8, 25], ['9-11', 15], ['12+', 10]];
const nameBase = n => n.length <= 8 ? ({ 3: 3000, 4: 1000, 5: 300, 6: 100, 7: 50, 8: 25 })[n.length] : n.length <= 11 ? 15 : 10;
const namePrice = n => BigInt(nameBase(n)) * NANO / (/\d/.test(n) ? 2n : 1n);
const validName = n => /^[a-z0-9]([a-z0-9-]{1,30})[a-z0-9]$/.test(n) && !n.includes('--');
const ICON = {
  in: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 4 12M4 6v6h6"/></svg>',
  out: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12 12 4M6 4h6v6"/></svg>',
  dns: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="2.6"/><path d="M10.6 8v1.2a1.9 1.9 0 0 0 3.8 0V8A6.4 6.4 0 1 0 12 13"/></svg>',
};

views.address = async (id, q) => {
  const offset = +(q.get('offset') || 0);
  const a = await get(`/account/${encodeURIComponent(id)}?offset=${offset}&limit=25`);
  if (a.label) LABELS[a.address] = a.label;
  const me = a.address, mainName = a.names.find(n => n.active);
  view.innerHTML = `<div class="wrap page">
  <div class="card"><div class="acct-head">${avatar(me)}
   <div style="min-width:0"><h2>${esc(a.label || (mainName ? mainName.name + '.yuki' : 'Account'))}</h2>
    <div class="addr">${me} ${copyBtn(me)}</div>
    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${a.is_validator ? '<span class="pill info">Validator</span>' : ''}${a.names.map(n => `<a class="pill ${n.active ? 'ok' : 'warn'}" href="#/name/${n.name}">${esc(n.name)}.yuki</a>`).join('')}<span class="pill info">${num(a.tx_count)} tx</span></div></div>
   <div class="bal"><span class="muted">Balance</span><b>${fmt(a.balance)} <span class="grad">YUKI</span></b>${STATUS ? `<span class="dim mono">${(Number(BigInt(a.balance) * 1000000n / BigInt(STATUS.supply)) / 10000).toFixed(4)}% of supply</span>` : ''}</div>
  </div></div>
  ${a.pending && a.pending.length ? `<div class="warnbox" style="margin-top:18px">${a.pending.length} pending transaction(s), they land in the next block.</div>` : ''}
  <div class="card" style="margin-top:18px"><div class="card-h"><h3>History</h3><span class="muted">nonce ${a.nonce}</span></div>
  ${a.txs.length ? `<table><thead><tr><th></th><th>Tx</th><th>Counterparty</th><th class="r">YUKI</th><th>Memo</th><th class="r">Age</th></tr></thead><tbody>${a.txs.map(v => {
    const t = v.tx, s = txSummary(t, me), other = s.kind === 'in' ? t.from : t.to;
    const amt = s.amount ? `<span class="${s.kind === 'in' ? 'amt-in' : 'amt-out'}">${s.kind === 'in' ? '+' : '−'}${fmt(s.amount)}</span>` : `<span class="dim">−${fmt(BigInt(t.fee) + (t.type === 'name_register' ? namePrice(t.name) : 0n), 3)}</span>`;
    return `<tr><td><span class="dir ${s.kind}">${s.kind === 'in' ? 'IN' : s.kind === 'out' ? 'OUT' : 'DNS'}</span></td><td><a class="mono" href="#/tx/${t.hash}">${t.hash.slice(0, 10)}…</a></td><td>${s.kind === 'dns' ? esc(s.label) : addrLink(other, 5)}</td><td class="r mono">${amt}</td><td><span class="memo">${esc(t.memo)}</span></td><td class="r muted">${ago(v.time)}</td></tr>`;
  }).join('')}</tbody></table>` : '<div class="empty">No transactions yet.</div>'}
  ${a.tx_count > 25 ? `<div class="pager">${offset ? `<a class="btn sm" href="#/address/${me}?offset=${Math.max(0, offset - 25)}">← newer</a>` : ''}${offset + 25 < a.tx_count ? `<a class="btn sm" href="#/address/${me}?offset=${offset + 25}">older →</a>` : ''}</div>` : ''}</div></div>`;
  live = m => { if (m.block.txs) get('/account/' + me).then(n => { if (n.tx_count !== a.tx_count || n.balance !== a.balance) route(); }); };
};

views.name = async n => {
  const r = await get('/name/' + encodeURIComponent(n));
  const digits = /\d/.test(r.name);
  view.innerHTML = `<div class="wrap page">
  <div class="page-h"><div class="grow"><h1 class="mono" style="font-family:var(--mono);letter-spacing:-.03em">${esc(r.name)}<span class="dim">.yuki</span></h1>
   <p class="sub">${r.available ? 'Nobody owns this name. Register it for a year and it points at your wallet.' : 'Owned on-chain. Anyone sending to this name reaches the wallet below.'}</p></div>
   ${r.available ? '<span class="pill ok">Available</span>' : r.active ? '<span class="pill info">Registered</span>' : '<span class="pill warn">Expired</span>'}</div>
  ${r.available ? `<div class="card"><div class="card-b" style="display:flex;justify-content:space-between;align-items:center;gap:24px;flex-wrap:wrap">
     <div><div class="dim" style="font-size:14px">One year</div><div style="font:700 44px var(--head);letter-spacing:-.04em">${fmt(r.price, 1)} <span style="font-size:18px;color:var(--accent)">YUKI</span></div>
     <div class="dim" style="font-size:14px">${r.name.length} characters${digits ? ', has a digit so half price' : ''}. The fee is burned.</div></div>
     <a class="btn pri" href="#/wallet?name=${encodeURIComponent(r.name)}">Register ${esc(r.name)}.yuki</a></div></div>`
  : `<div class="card"><div class="acct-head">${avatar(r.resolves)}<div style="min-width:0"><div class="dim" style="font-size:13px">Resolves to</div><div class="addr" style="font-size:15px;color:var(--snow)">${addrLink(r.resolves, 14)} ${copyBtn(r.resolves)}</div></div></div>
    ${kv([
    ['Owner', addrLink(r.owner, 14)],
    ['Points to', r.target ? addrLink(r.target, 14) : '<span class="dim">the owner\'s wallet</span>'],
    ['Registered', date(r.registered)],
    ['Expires', `${date(r.expires)} <span class="dim">(${Math.max(0, Math.round((r.expires - Date.now()) / 864e5))} days left)</span>`],
    ['Renewal', `${fmt(r.price, 1)} YUKI per year, from the owner's wallet`],
  ])}</div>`}</div>`;
  live = null;
};

views.accounts = async () => {
  const [st, top] = await Promise.all([get('/status'), get('/top?limit=100')]);
  const sup = BigInt(st.supply), pct = b => Number(BigInt(b) * 1000000n / sup) / 10000;
  const lead = top.slice(0, 8), restPct = Math.max(0, 100 - lead.reduce((a, r) => a + pct(r.balance), 0));
  const shade = i => `hsl(205 ${24 - i}% ${84 - i * 7}%)`;
  const maxPct = top.length ? pct(top[0].balance) : 1;
  view.innerHTML = `<div class="wrap page">
  <div class="page-h"><div class="grow"><h1>Accounts</h1><p class="sub">${num(st.accounts)} wallets hold ${fmt(st.supply, 0)} YUKI. Ranked by balance, live from the chain.</p></div>
   <form data-search style="min-width:min(100%,360px)"><label class="sr" for="aq">Find an account</label><input id="aq" name="q" class="nav-search-in" placeholder="Find address or name.yuki" style="width:100%;height:46px;background:var(--ink-2);border:1px solid var(--hair-2);border-radius:99px;padding:0 20px;outline:none" autocomplete="off" spellcheck="false"></form></div>
  <div class="dist" role="img" aria-label="Share of supply held by the largest accounts">${lead.map((r, i) => `<i style="flex:${pct(r.balance)};background:${i === 0 ? 'var(--accent)' : shade(i)}" title="${esc(r.label || short(r.address, 4))}: ${pct(r.balance).toFixed(2)}%"></i>`).join('')}${restPct > .01 ? `<i style="flex:${restPct};background:var(--ink-4)" title="Everyone else: ${restPct.toFixed(2)}%"></i>` : ''}</div>
  <div class="dist-legend">${lead.slice(0, 6).map((r, i) => `<span><i style="background:${i === 0 ? 'var(--accent)' : shade(i)}"></i>${esc(r.label || short(r.address, 4))} ${pct(r.balance).toFixed(1)}%</span>`).join('')}${restPct > .01 ? `<span><i style="background:var(--ink-4)"></i>Others ${restPct.toFixed(1)}%</span>` : ''}</div>
  <div class="card"><table><thead><tr><th>#</th><th>Account</th><th class="r">Balance, YUKI</th><th class="r hide-sm">Share of supply</th></tr></thead><tbody>
  ${top.map((r, i) => `<tr><td><span class="rank">${i + 1}</span></td>
    <td><a class="who" href="#/address/${r.address}">${avatar(r.address, 's')}<span><b>${esc(r.label || short(r.address, 6))}</b>${r.label ? `<small>${short(r.address, 6)}</small>` : ''}</span></a></td>
    <td class="r mono">${fmt(r.balance, 2)}</td>
    <td class="r hide-sm"><span class="share"><i style="width:${Math.max(2, pct(r.balance) / maxPct * 120)}px;${i === 0 ? 'background:var(--accent)' : ''}"></i><span class="mono muted">${pct(r.balance).toFixed(pct(r.balance) < .01 ? 4 : 2)}%</span></span></td></tr>`).join('')}
  </tbody></table></div></div>`;
  live = null;
};

views.names = async () => {
  const list = await get('/names?limit=200');
  view.innerHTML = `<div class="wrap page">
  <div class="nhero">
   <div>
    <div class="page-h" style="margin-bottom:28px"><div class="grow"><h1>Get a name.yuki</h1><p class="sub">Short names are rare, so they cost more. Any name with a digit costs half. You pay once a year and the fee is burned, so it leaves the supply for good.</p></div></div>
    <form class="namebox" id="nq"><label class="sr" for="nqi">Name</label><input id="nqi" name="n" placeholder="yourname" maxlength="32" autocomplete="off" spellcheck="false"><em>.yuki</em><button class="btn pri">Check</button></form>
    <div class="verdict" id="nv" aria-live="polite"><div class="v-note">3 to 32 characters: a to z, digits and single dashes.</div></div>
   </div>
   <div class="ptable" id="pt"><div class="ph"><span>Length</span><span>Letters only</span><span>With digits</span></div>
    ${NAME_TIERS.map(([l, p]) => `<div class="pr" data-len="${l}"><span>${typeof l === 'number' ? l + ' characters' : l + ' characters'}</span><b>${num(p)}</b><em>${num(p / 2)}</em></div>`).join('')}
   </div>
  </div>
  <div class="page-h" style="margin-bottom:22px"><h1 style="font-size:28px">Registered</h1><span class="pill info">${list.length}</span></div>
  ${list.length ? `<div class="ngrid">${list.map(n => `<a class="ncard" href="#/name/${esc(n.name)}"><div class="nn">${esc(n.name)}<span>.yuki</span></div>
    <dl><dt>Points to</dt><dd>${esc(LABELS[n.resolves] || short(n.resolves, 4))}</dd><dt>${n.active ? 'Until' : 'Expired'}</dt><dd>${new Date(n.expires).toLocaleDateString('en-GB')}</dd></dl></a>`).join('')}</div>`
  : `<div class="card"><div class="empty"><b>No names yet</b>The first one is waiting. Check a name above.</div></div>`}</div>`;
  const tierOf = n => n.length <= 8 ? String(n.length) : n.length <= 11 ? '9-11' : '12+';
  const nv = $('#nv'), input = $('#nqi');
  let seq = 0;
  const check = async () => {
    const n = input.value.trim().toLowerCase().replace(/\.yuki$/, ''), my = ++seq;
    $$('#pt .pr').forEach(r => r.classList.toggle('on', !!n && r.dataset.len === tierOf(n)));
    if (!n) { nv.innerHTML = '<div class="v-note">3 to 32 characters: a to z, digits and single dashes.</div>'; return; }
    if (!validName(n)) { nv.innerHTML = '<div class="v-note no">Use 3 to 32 characters: a to z, digits and single dashes, not at the ends.</div>'; return; }
    const d = await get('/name/' + n).catch(e => ({ error: e.message })); if (my !== seq) return;
    if (d.error) { nv.innerHTML = `<div class="v-note no">${esc(d.error)}</div>`; return; }
    nv.innerHTML = d.available
      ? `<div class="v-name"><span class="ok">Available</span> · ${esc(n)}.yuki</div><div class="v-price">${fmt(d.price, 1)} <small>YUKI per year${/\d/.test(n) ? ', digit discount applied' : ''}</small></div><a class="btn pri sm" href="#/wallet?name=${encodeURIComponent(n)}">Register it</a>`
      : `<div class="v-name"><span class="no">Taken</span> · ${esc(n)}.yuki</div><div class="v-price" style="font-size:24px">${addrLink(d.resolves, 6)}</div><a class="btn sm" href="#/name/${encodeURIComponent(n)}">View owner</a>`;
  };
  let t; input.oninput = () => { clearTimeout(t); t = setTimeout(check, 220); };
  $('#nq').onsubmit = e => { e.preventDefault(); check(); };
  live = null;
};

function feedItem(v, me) {
  const t = v.tx, s = txSummary(t, me);
  const title = s.kind === 'in' ? 'Received' : s.kind === 'out' ? 'Sent' : s.label;
  const who = s.kind === 'in' ? t.from : s.kind === 'out' ? t.to : '';
  const amt = s.kind === 'dns' ? `<span class="dim">−${fmt(BigInt(t.fee) + (t.type === 'name_register' ? namePrice(t.name) : 0n), 2)}</span>`
    : `<span class="${s.kind === 'in' ? 'amt-in' : ''}">${s.kind === 'in' ? '+' : '−'}${fmt(s.amount, 3)}</span>`;
  return `<li><span class="fi ${s.kind}">${ICON[s.kind] || ICON.out}</span><div style="min-width:0"><b>${esc(title)}</b><small>${who ? (s.kind === 'in' ? 'from ' : 'to ') + esc(LABELS[who] || short(who, 4)) + ' · ' : ''}${v.time ? ago(v.time) : 'pending'}${t.memo ? ' · ' + esc(t.memo.slice(0, 40)) : ''}</small></div><a class="fa" href="#/tx/${t.hash}">${amt}</a></li>`;
}

views.wallet = async (_, q) => {
  live = null;
  const w = await loadWallet();
  if (!w) {
    view.innerHTML = `<div class="wrap page" style="max-width:960px">
    <div class="page-h"><div class="grow"><h1>Your YukiChain wallet</h1><p class="sub">A wallet is a key pair that lives in this browser. It signs your transfers locally; the key never goes to the server.</p></div></div>
    <div class="onboard">
     <div class="card"><div class="card-b"><h3>Create a new wallet</h3><p>Makes a fresh Ed25519 key and a yuki1 address. You get 100 test YUKI from the faucet right after.</p><button class="btn pri block" id="wnew">Create wallet</button></div></div>
     <div class="card"><div class="card-b"><h3>Import a key</h3><p>Paste a key saved from this site or from <span class="mono">yukid keygen</span>.</p>
      <div class="field" style="margin-bottom:12px"><label class="sr" for="wimp">Secret key</label><input id="wimp" placeholder="64 or 128 hex characters" spellcheck="false" autocomplete="off"></div><button class="btn block" id="wimpb">Import</button></div></div>
    </div>
    <div class="warnbox" style="margin-top:20px">This is the testnet. Coins here are for trying things out. Still, save your key: nobody can recover it for you.</div></div>`;
    const save = kp => { store.set('yk_wallet', toHex(kp.secretKey)); store.set('yk_fresh', toHex(kp.secretKey)); route(); };
    $('#wnew').onclick = () => save(nacl.sign.keyPair());
    $('#wimpb').onclick = () => {
      const h = $('#wimp').value.trim().toLowerCase();
      try {
        if (!/^[0-9a-f]+$/.test(h)) throw 0;
        save(h.length === 64 ? nacl.sign.keyPair.fromSeed(fromHex(h)) : h.length === 128 ? nacl.sign.keyPair.fromSecretKey(fromHex(h)) : (() => { throw 0; })());
      } catch { toast('That is not a valid key', true); }
    };
    return;
  }
  const fresh = store.get('yk_fresh'); store.set('yk_fresh', null);
  const pre = (q.get('name') || '').toLowerCase();
  view.innerHTML = `<div class="wrap page">
  <div class="page-h"><div class="grow"><h1>Wallet</h1></div><span class="pill warn">testnet</span></div>
  ${fresh ? `<div class="warnbox"><b>Save your secret key now.</b> It is the only way to restore this wallet on another device.<div class="secret">${fresh}</div><button class="btn sm" data-copy="${fresh}">Copy key</button></div>` : ''}
  <div class="wallet">
   <div>
    <div class="wcard"><span class="wl" id="wname">Balance</span><div class="wb" id="wbal">…</div><span class="wu">YUKI</span>
     <div class="wa">${w.address} ${copyBtn(w.address)}</div></div>
    <div class="wactions"><button class="btn pri" id="wfaucet">Get 100 test YUKI</button><a class="btn" href="#/address/${w.address}">Full history</a></div>
    <div class="card" style="margin-top:20px"><div class="card-h"><h3>Recent activity</h3></div><ul class="feed" id="wfeed"><li style="display:block" class="dim">Loading…</li></ul></div>
    <details class="card" style="margin-top:20px"><summary class="card-b" style="cursor:pointer;color:var(--snow-2)">Key and security</summary>
     <div class="card-b" style="padding-top:0"><div class="cta" style="margin:0"><button class="btn sm" id="wexp">Show secret key</button><button class="btn sm" id="wdel">Remove from this browser</button></div><div id="wsec"></div></div></details>
   </div>
   <div class="card"><div class="tabs" role="tablist"><button class="on" data-tab="send" role="tab">Send</button><button data-tab="name" role="tab">Names</button></div>
    <div class="card-b" data-pane="send">
     <div class="field"><label for="sto">Recipient</label><input id="sto" placeholder="yuki1… or name.yuki" spellcheck="false" autocomplete="off"><span class="hint" id="stoh"></span></div>
     <div class="field"><label for="samt">Amount</label><div class="row"><input id="samt" class="big" inputmode="decimal" placeholder="0"><button class="btn" id="smax" type="button" style="height:64px">Max</button></div><span class="hint" id="samth"></span></div>
     <div class="field"><label for="smemo">Memo <span class="dim">(public, optional)</span></label><input id="smemo" maxlength="140"></div>
     <div class="sumline"><span>Network fee</span><b>0.001 YUKI</b></div>
     <div class="sumline" style="margin-bottom:18px"><span>Arrives</span><b>next block, about 5 seconds</b></div>
     <button class="btn pri block" id="ssend">Send YUKI</button>
    </div>
    <div class="card-b" data-pane="name" hidden>
     <div class="field"><label for="nname">Register or renew</label><div class="namebox" style="height:60px;padding-left:20px"><input id="nname" value="${esc(pre)}" placeholder="yourname" maxlength="32" spellcheck="false" autocomplete="off" style="font-size:18px"><em style="font-size:18px">.yuki</em></div><span class="hint" id="nh"></span></div>
     <div class="sumline"><span>Price for one year</span><b id="nprice">-</b></div>
     <div class="sumline"><span>Network fee</span><b>0.001 YUKI</b></div>
     <div class="sumline" style="margin-bottom:18px"><span>Total</span><b id="ntotal" style="font:700 20px var(--head)">-</b></div>
     <button class="btn pri block" id="nreg" disabled>Register</button>
     <div id="mynames" style="margin-top:30px"></div>
    </div>
   </div>
  </div></div>`;
  let acct = null;
  const refresh = async () => {
    const a = await get('/account/' + w.address + '?limit=6').catch(() => null); if (!a || !$('#wbal')) return;
    acct = a;
    $('#wbal').textContent = fmt(a.balance);
    const main = a.names.find(n => n.active); $('#wname').textContent = main ? main.name + '.yuki' : 'Balance';
    const items = [...(a.pending || []).map(t => ({ tx: t })), ...a.txs].slice(0, 6);
    $('#wfeed').innerHTML = items.length ? items.map(v => feedItem(v, w.address)).join('') : '<li style="display:block" class="dim">Nothing yet. Grab test YUKI above, then send some to a friend.</li>';
    const mine = a.names.filter(n => n.active);
    $('#mynames').innerHTML = mine.length ? `<div class="field" style="margin:0"><label>Your names</label><div class="mynames">${mine.map(n => `<div class="myname"><div class="mn">${esc(n.name)}.yuki<small>${n.target ? 'points to ' + short(n.target, 4) : 'points to this wallet'} · until ${new Date(n.expires).toLocaleDateString('en-GB')}</small></div>
      <button class="btn sm" data-nact="name_target" data-n="${esc(n.name)}">Point</button><button class="btn sm" data-nact="name_transfer" data-n="${esc(n.name)}">Give</button></div>`).join('')}</div></div>` : '';
  };
  refresh(); live = refresh;
  const busy = async (btn, fn) => { const l = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; try { await fn(); } catch (e) { toast(e.message, true); } btn.disabled = false; btn.innerHTML = l; };
  $('#wfaucet').onclick = e => busy(e.currentTarget, async () => { await post('/faucet', { address: w.address }); toast('100 YUKI on the way, next block'); refresh(); });
  $('#wexp').onclick = () => $('#wsec').innerHTML = `<div class="secret">${toHex(w.kp.secretKey)}</div>`;
  $('#wdel').onclick = () => { if (confirm('Remove this wallet from the browser? Without the saved key it is gone forever.')) { store.set('yk_wallet', null); route(); } };
  let rt; $('#sto').oninput = e => {
    clearTimeout(rt); const v = e.target.value.trim(), h = $('#stoh'); h.textContent = ''; h.className = 'hint';
    if (!v || v.startsWith('yuki1')) return;
    rt = setTimeout(() => resolveTo(v).then(a => { h.textContent = '→ ' + a; h.className = 'hint ok'; }, err => { h.textContent = err.message; h.className = 'hint no'; }), 300);
  };
  $('#smax').onclick = () => { if (acct) { const m = BigInt(acct.balance) - 1000000n; $('#samt').value = m > 0n ? fmt(m, 9).replace(/,/g, '') : '0'; } };
  $('#ssend').onclick = e => busy(e.currentTarget, async () => {
    const to = await resolveTo($('#sto').value), amount = parseAmt($('#samt').value);
    if (amount <= 0n) throw Error('Amount must be above zero');
    const r = await signAndSend(w, { type: 'transfer', to, amount, memo: $('#smemo').value.replace(/[\r\n]/g, ' ') });
    toast('Sent · ' + r.hash.slice(0, 10) + '…'); $('#samt').value = ''; $('#smemo').value = ''; refresh();
  });
  const nin = $('#nname'), nh = $('#nh'), nreg = $('#nreg');
  let nseq = 0;
  const updN = async () => {
    const n = nin.value.toLowerCase().replace(/\.yuki$/, '').trim(), my = ++nseq;
    nreg.disabled = true; $('#nprice').textContent = '-'; $('#ntotal').textContent = '-'; nh.className = 'hint';
    if (!n) { nh.textContent = ''; return; }
    if (!validName(n)) { nh.textContent = '3 to 32 characters: a to z, digits and single dashes'; nh.className = 'hint no'; return; }
    const price = namePrice(n);
    $('#nprice').textContent = fmt(price, 1) + ' YUKI' + (/\d/.test(n) ? ' (half, has a digit)' : '');
    $('#ntotal').textContent = fmt(price + 1000000n, 3) + ' YUKI';
    const d = await get('/name/' + n).catch(() => null); if (my !== nseq || !d) return;
    const mine = !d.available && d.owner === w.address;
    if (d.available || mine) { nh.textContent = mine ? 'You own it. Registering again adds a year.' : 'Available'; nh.className = 'hint ok'; nreg.disabled = false; nreg.textContent = mine ? 'Renew for a year' : 'Register ' + n + '.yuki'; }
    else { nh.textContent = 'Taken by ' + short(d.owner, 4); nh.className = 'hint no'; nreg.textContent = 'Register'; }
    if (acct && BigInt(acct.balance) < price + 1000000n && !nreg.disabled) { nh.textContent += '. Not enough YUKI in this wallet yet.'; nh.className = 'hint no'; nreg.disabled = true; }
  };
  let nt; nin.oninput = () => { clearTimeout(nt); nt = setTimeout(updN, 200); };
  nreg.onclick = e => busy(e.currentTarget, async () => {
    const name = nin.value.toLowerCase().replace(/\.yuki$/, '').trim();
    const r = await signAndSend(w, { type: 'name_register', name });
    toast(name + '.yuki submitted · ' + r.hash.slice(0, 10) + '…'); refresh();
  });
  $('#mynames').onclick = e => {
    const b = e.target.closest('[data-nact]'); if (!b) return;
    const act = b.dataset.nact, name = b.dataset.n;
    const v = prompt(act === 'name_target' ? `Point ${name}.yuki at which wallet? Leave empty for this one.` : `Give ${name}.yuki to which wallet? This cannot be undone.`);
    if (v === null || (act === 'name_transfer' && !v.trim())) return;
    busy(b, async () => {
      const to = v.trim() ? await resolveTo(v) : '';
      const r = await signAndSend(w, { type: act, name, to });
      toast('Submitted · ' + r.hash.slice(0, 10) + '…'); refresh();
    });
  };
  $$('[data-tab]').forEach(b => b.onclick = () => { $$('[data-tab]').forEach(x => x.classList.toggle('on', x === b)); $$('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== b.dataset.tab); });
  if (pre) { $('[data-tab=name]').click(); updN(); }
};

/* ---------- router ---------- */
async function route() {
  const raw = location.hash.replace(/^#\/?/, ''), [path, qs] = raw.split('?'), [name, ...rest] = path.split('/');
  const q = new URLSearchParams(qs || ''), key = name || 'home';
  document.body.classList.remove('home'); live = null;
  if (landing) { landing.unmount(); landing = null; }
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === key || (key === 'block' || key === 'tx') && a.dataset.nav === 'explorer' || key === 'address' && a.dataset.nav === 'accounts' || key === 'name' && a.dataset.nav === 'names'));
  const fn = views[key];
  if (!fn) { view.innerHTML = `<div class="wrap page"><div class="empty">Page not found. <a href="#/">Home</a></div></div>`; return; }
  try { await fn(decodeURIComponent(rest.join('/')), q); }
  catch (e) { view.innerHTML = `<div class="wrap page"><div class="card"><div class="empty">${esc(e.message)}<br><br><a href="#/explorer">Back to explorer</a></div></div></div>`; }
  if (!view.dataset.keep) scrollTo(0, 0);
}

document.addEventListener('submit', async e => {
  const f = e.target.closest('[data-search]'); if (!f) return;
  e.preventDefault(); const q = f.q.value.trim(); if (!q) return;
  try {
    const r = await get('/search?q=' + encodeURIComponent(q));
    location.hash = r.kind === 'account' ? '#/address/' + r.id : r.kind === 'tx' ? '#/tx/' + r.id : r.kind === 'block' ? '#/block/' + r.id : '#/name/' + r.id;
    f.q.value = ''; f.q.blur();
  } catch (err) { toast('Nothing found for “' + q + '”', true); }
});
document.addEventListener('click', e => {
  const c = e.target.closest('[data-copy]');
  if (c) { navigator.clipboard.writeText(c.dataset.copy).then(() => toast('Copied')); return; }
  const g = e.target.closest('[data-goto]');
  if (g) { e.preventDefault(); const go = () => document.getElementById(g.dataset.goto)?.scrollIntoView({ behavior: 'smooth' }); if (location.hash.length > 2) { location.hash = '#/'; setTimeout(go, 400); } else go(); }
});
addEventListener('hashchange', route);
(async () => {
  try { (await get('/top?limit=20')).forEach(r => { if (r.label) LABELS[r.address] = r.label; }); } catch {}
  route(); startStream();
})();
