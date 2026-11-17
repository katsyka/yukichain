/*! YUKI Connect SDK v1 — connect dApps to Yuki Wallet. https://chain.yukichat.lol/docs#connect
 * Messages travel through an encrypted bridge (nacl box, X25519 + XSalsa20-Poly1305) between a
 * session key held by the dApp and one held by the wallet. The bridge never sees plaintext. */
(function (g) {
  'use strict';
  const VERSION = '1.0.0';
  const DEF = {
    bridge: 'https://chain.yukichat.lol/bridge',
    walletUrl: 'https://wallet.yukichat.lol/connect',
    getWallet: 'https://wallet.yukichat.lol',
    chain: 'yuki-testnet-1',
  };
  const LIBS = {
    nacl: 'https://cdnjs.cloudflare.com/ajax/libs/tweetnacl/1.0.3/nacl-fast.min.js',
    QRCode: 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  };
  const NANO = 1000000000n;

  /* ---------- small helpers ---------- */
  const enc = new TextEncoder(), dec = new TextDecoder();
  const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  const unhex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
  const b64 = b => btoa(String.fromCharCode(...b));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const b64url = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const short = (a, n = 4) => a && a.length > 2 * n + 6 ? a.slice(0, n + 5) + '…' + a.slice(-n) : a || '';
  const loaded = {};
  const load = (name) => g[name] ? Promise.resolve() : loaded[name] ||= new Promise((ok, no) => {
    const s = document.createElement('script'); s.src = LIBS[name]; s.onload = ok; s.onerror = () => no(new Error('YUKI Connect: could not load ' + name));
    document.head.append(s);
  });
  const deps = () => Promise.all([load('nacl'), load('QRCode')]);

  function toNano(v) {
    const s = String(v).trim().replace(',', '.');
    if (!/^\d+(\.\d{0,9})?$/.test(s)) throw new Error('Bad YUKI amount: ' + v);
    const [w, f = ''] = s.split('.');
    return (BigInt(w) * NANO + BigInt((f + '000000000').slice(0, 9))).toString();
  }
  function fromNano(n, dp = 9) {
    n = BigInt(n); const w = n / NANO, f = (n % NANO).toString().padStart(9, '0').slice(0, dp).replace(/0+$/, '');
    return w.toLocaleString('en-US') + (f ? '.' + f : '');
  }

  /* bech32 + address check, mirrors the node (sha256(pubkey)[:20] -> bech32 "yuki") */
  const B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  function polymod(v) { let c = 1; for (const x of v) { const t = c >>> 25; c = ((c & 0x1ffffff) << 5) ^ x; for (let i = 0; i < 5; i++) if ((t >>> i) & 1) c ^= [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3][i]; } return c; }
  const hrpX = h => [...[...h].map(c => c.charCodeAt(0) >> 5), 0, ...[...h].map(c => c.charCodeAt(0) & 31)];
  function bech32(hrp, bytes) {
    const d = []; let acc = 0, bits = 0;
    for (const b of bytes) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; d.push((acc >> bits) & 31); } }
    if (bits) d.push((acc << (5 - bits)) & 31);
    const p = polymod([...hrpX(hrp), ...d, 0, 0, 0, 0, 0, 0]) ^ 1;
    return hrp + '1' + [...d, ...[0, 1, 2, 3, 4, 5].map(i => (p >> (5 * (5 - i))) & 31)].map(x => B32[x]).join('');
  }
  async function addressOf(pubHex) { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', unhex(pubHex))); return bech32('yuki', h.slice(0, 20)); }

  /** The exact strings wallets sign. Servers should rebuild them the same way. */
  const proofMessage = (p, address) => ['yuki-connect/v1', p.domain, p.timestamp, address, p.payload].join('\n');
  const signedMessage = (s, address) => ['yuki-signed-message/v1', s.domain, s.timestamp, address, s.text].join('\n');

  async function verify(msg, sigHex, pubHex, address) {
    await load('nacl');
    if (await addressOf(pubHex) !== address) return false;
    return g.nacl.sign.detached.verify(enc.encode(msg), unhex(sigHex), unhex(pubHex));
  }

  /* ---------- QR as rounded dots (uses qrcodejs only for the matrix) ---------- */
  function qrSVG(text) {
    const tmp = document.createElement('div');
    const q = new g.QRCode(tmp, {text, width: 64, height: 64, correctLevel: g.QRCode.CorrectLevel.M});
    const m = q._oQRCode, n = m.getModuleCount(), hole = Math.ceil(n * .22) | 1, h0 = (n - hole) / 2;
    const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    let dots = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!m.isDark(r, c) || finder(r, c)) continue;
      if (r >= h0 - .5 && r < h0 + hole && c >= h0 - .5 && c < h0 + hole) continue;
      dots += `<circle cx="${c + .5}" cy="${r + .5}" r=".42"/>`;
    }
    const eye = (x, y) => `<rect x="${x + .5}" y="${y + .5}" width="6" height="6" rx="2" fill="none" stroke="currentColor" stroke-width="1"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="1"/>`;
    return `<svg viewBox="-1 -1 ${n + 2} ${n + 2}" fill="currentColor" aria-hidden="true">${dots}${eye(0, 0)}${eye(n - 7, 0)}${eye(0, n - 7)}</svg>`;
  }

  const LOGO = '<svg viewBox="0 0 64 64" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M32 6 54.5 19v26L32 58 9.5 45V19z" stroke="currentColor" stroke-width="4.5"/><path d="M17 23.3 32 32l15-8.7M32 32v17" stroke="#f26a3f" stroke-width="4.5"/></svg>';
  const IC = {
    x: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 5l10 10M15 5 5 15"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    no: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>',
    copy: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="2.5"/><path d="M13 4.5V4a1 1 0 0 0-1-1H5a2 2 0 0 0-2 2v7a1 1 0 0 0 1 1h.5"/></svg>',
    out: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3M8 14l-4-4 4-4M4 10h9"/></svg>',
    chev: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 8 4 4 4-4"/></svg>',
  };

  /* ---------- styles (shadow DOM, so the host page cannot break them) ---------- */
  const CSS = `
:host{all:initial}
*{box-sizing:border-box;margin:0;padding:0}
.t{--ink:#0b0f15;--ink-2:#121822;--ink-3:#19212d;--hair:rgba(220,235,245,.1);--hair-2:rgba(220,235,245,.18);--snow:#eef3f6;--snow-2:#a9b6c2;--snow-3:#76838f;
  --acc:#f26a3f;--g:linear-gradient(140deg,#ffa074,#f26a3f 46%,#d9481f);--ok:#7fdcb0;--bad:#ff8a78;--qr-bg:#eef3f6;--qr:#0b0f15;--shadow:0 40px 90px -30px rgba(0,0,0,.85);
  font:15px/1.5 Onest,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--snow);-webkit-font-smoothing:antialiased}
.t.light{--ink:#ffffff;--ink-2:#f3f5f8;--ink-3:#e8ecf1;--hair:rgba(15,23,33,.08);--hair-2:rgba(15,23,33,.14);--snow:#0d131a;--snow-2:#4a5866;--snow-3:#7b8794;
  --ok:#169063;--bad:#d1422f;--qr-bg:#f3f5f8;--shadow:0 40px 90px -30px rgba(15,23,33,.45)}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}
a{color:inherit;text-decoration:none}
:focus-visible{outline:2px solid var(--acc);outline-offset:3px;border-radius:10px}
.h{font-family:Unbounded,Onest,ui-sans-serif,system-ui,sans-serif;letter-spacing:-.03em}

/* button */
.cb{display:inline-flex;align-items:center;gap:10px;height:46px;padding:0 20px 0 14px;border-radius:99px;background:var(--g);color:#140a05;font-weight:600;font-size:15px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 12px 26px -14px rgba(242,106,63,.9);transition:transform .2s cubic-bezier(.23,1,.32,1),filter .2s}
.cb:hover{filter:brightness(1.07)}.cb:active{transform:scale(.97)}
.cb svg{width:22px;height:22px;color:#140a05}
.chip{display:inline-flex;align-items:center;gap:10px;height:46px;padding:0 12px 0 6px;border-radius:99px;background:var(--ink-2);border:1px solid var(--hair-2);font-weight:600;font-size:14.5px;position:relative;transition:background .2s}
.chip:hover{background:var(--ink-3)}
.chip .av{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--ink-3);border:1px solid var(--hair)}
.chip .av svg{width:20px;height:20px}
.chip .ad{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:13.5px;font-weight:500}
.chip>svg{width:16px;height:16px;color:var(--snow-3);transition:transform .25s}
.wrapb{position:relative;display:inline-block}
.menu{position:absolute;right:0;top:calc(100% + 8px);min-width:220px;padding:6px;border-radius:18px;background:var(--ink);border:1px solid var(--hair-2);box-shadow:var(--shadow);
  opacity:0;transform:translateY(-6px) scale(.97);transform-origin:top right;pointer-events:none;transition:opacity .18s,transform .25s cubic-bezier(.23,1,.32,1);z-index:10}
.wrapb.open .menu{opacity:1;transform:none;pointer-events:auto}
.wrapb.open .chip>svg{transform:rotate(180deg)}
.menu .who{padding:10px 12px 12px;border-bottom:1px solid var(--hair);margin-bottom:4px}
.menu .who b{display:block;font-size:14px}.menu .who small{color:var(--snow-3);font:12px "JetBrains Mono",ui-monospace,monospace;word-break:break-all}
.menu button{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border-radius:12px;font-size:14.5px;text-align:left}
.menu button:hover{background:var(--ink-2)}
.menu button svg{width:18px;height:18px;color:var(--snow-2)}
.menu .dz{color:var(--bad)}.menu .dz svg{color:var(--bad)}

/* modal */
.ov{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:rgba(4,6,9,.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:fade .25s}
.t.light .ov{background:rgba(20,28,38,.3)}
.ov.out{animation:fade .2s reverse forwards}
.md{position:relative;width:min(400px,calc(100vw - 32px));border-radius:30px;background:var(--ink);border:1px solid var(--hair-2);box-shadow:var(--shadow);padding:22px 22px 18px;overflow:hidden;isolation:isolate;
  animation:pop .45s cubic-bezier(.34,1.35,.64,1)}
.ov.out .md{animation:pop .2s reverse forwards}
.md:before{content:"";position:absolute;inset:-40% -30% auto;height:70%;z-index:-1;filter:blur(50px);opacity:.55;pointer-events:none;
  background:radial-gradient(30% 40% at 30% 60%,rgba(242,106,63,.55),transparent 72%),radial-gradient(30% 40% at 72% 50%,rgba(143,200,230,.35),transparent 72%);animation:drift 12s ease-in-out infinite alternate}
.t.light .md:before{opacity:.35}
@keyframes drift{to{transform:translate(8%,6%) rotate(10deg) scale(1.1)}}
@keyframes fade{from{opacity:0}}
@keyframes pop{from{opacity:0;transform:translateY(14px) scale(.95)}}
@media (max-width:520px){
  .ov{place-items:end center}
  .md{width:100%;border-radius:30px 30px 0 0;border-bottom:0;padding-bottom:calc(18px + env(safe-area-inset-bottom,0px));animation:up .45s cubic-bezier(.23,1,.32,1)}
  .ov.out .md{animation:up .22s reverse forwards}
}
@keyframes up{from{transform:translateY(100%)}}
.top{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.top .lg{width:30px;height:30px;color:var(--snow)}
.top b{font-size:16.5px;font-weight:700}
.x{margin-left:auto;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--ink-2);border:1px solid var(--hair);color:var(--snow-2);transition:background .2s,color .2s}
.x:hover{background:var(--ink-3);color:var(--snow)}
.x svg{width:18px;height:18px}
.lead{color:var(--snow-2);font-size:14.5px;margin:-6px 0 16px}

.qrw{position:relative;margin:0 auto 16px;width:min(280px,72vw);aspect-ratio:1;border-radius:26px;background:var(--qr-bg);color:var(--qr);padding:14px;overflow:hidden;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.04)}
.qrw svg{display:block;width:100%;height:100%}
.qrw svg circle{transform-box:fill-box;transform-origin:center;animation:dot .5s cubic-bezier(.34,1.56,.64,1) both;animation-delay:calc(var(--d,0) * 1ms)}
@keyframes dot{from{transform:scale(0)}}
.qrw .ql{position:absolute;left:50%;top:50%;width:19%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:28%;background:#0b0f15;display:grid;place-items:center;box-shadow:0 0 0 5px var(--qr-bg)}
.qrw .ql svg{width:72%;height:72%;color:#eef3f6}
.qrw .scan{position:absolute;left:0;right:0;height:38%;top:-38%;pointer-events:none;background:linear-gradient(to bottom,transparent,rgba(242,106,63,.16) 70%,rgba(242,106,63,.32));
  animation:scan 2.8s cubic-bezier(.45,0,.25,1) infinite;mix-blend-mode:multiply}
@keyframes scan{to{top:100%}}
.qrw.done .scan{display:none}
.qrw .okv{position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:10px;background:var(--qr-bg);opacity:0;transition:opacity .3s}
.qrw.done .okv{opacity:1}
.okv i{width:74px;height:74px;border-radius:50%;display:grid;place-items:center;background:var(--g);color:#140a05;transform:scale(.4);transition:transform .5s cubic-bezier(.34,1.56,.64,1) .1s}
.qrw.done .okv i{transform:none}
.okv i svg{width:38px;height:38px}
.okv b{font-size:15px}.okv small{font:12.5px "JetBrains Mono",ui-monospace,monospace;color:#4a5866}

.btns{display:grid;gap:8px}
.b{display:flex;align-items:center;justify-content:center;gap:9px;height:52px;border-radius:99px;font-weight:600;font-size:15.5px;border:1px solid var(--hair-2);transition:transform .2s cubic-bezier(.23,1,.32,1),background .2s,filter .2s}
.b:active{transform:scale(.97)}
.b.p{background:var(--g);border-color:transparent;color:#140a05;box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 14px 28px -16px rgba(242,106,63,.9)}
.b.p:hover{filter:brightness(1.07)}
.b.p svg{width:22px;height:22px}
.b.s:hover{background:var(--ink-2)}
.b svg{width:18px;height:18px}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.st{display:flex;align-items:center;justify-content:center;gap:8px;color:var(--snow-3);font-size:13px;margin-top:14px}
.st i{width:7px;height:7px;border-radius:50%;background:var(--acc);animation:pulse 1.6s infinite}
@keyframes pulse{50%{opacity:.25;transform:scale(.7)}}
.st.ok i{background:var(--ok);animation:none}.st.err{color:var(--bad)}.st.err i{background:var(--bad);animation:none}
.ft{display:flex;align-items:center;gap:10px;margin-top:14px;padding-top:14px;border-top:1px solid var(--hair);font-size:13px;color:var(--snow-3)}
.ft img{width:22px;height:22px;border-radius:7px;object-fit:cover;background:var(--ink-3)}
.ft a{margin-left:auto;color:var(--snow-2);font-weight:600}.ft a:hover{color:var(--acc)}

/* request (approve in wallet) */
.rq{display:grid;justify-items:center;text-align:center;padding:6px 0 4px}
.orb{position:relative;width:96px;height:96px;margin:4px 0 18px;display:grid;place-items:center}
.orb:before{content:"";position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 55%,rgba(255,160,116,.9) 80%,#f26a3f 92%,transparent);
  -webkit-mask:radial-gradient(closest-side,transparent calc(100% - 4px),#000 calc(100% - 3px));mask:radial-gradient(closest-side,transparent calc(100% - 4px),#000 calc(100% - 3px));animation:spin 1.1s linear infinite}
.orb:after{content:"";position:absolute;inset:-18px;border-radius:50%;z-index:-1;background:radial-gradient(closest-side,rgba(242,106,63,.35),transparent);filter:blur(10px);animation:breath 2.4s ease-in-out infinite}
.orb span{width:64px;height:64px;border-radius:22px;display:grid;place-items:center;background:var(--ink-2);border:1px solid var(--hair-2);color:var(--snow);transition:background .4s,color .4s,transform .5s cubic-bezier(.34,1.56,.64,1)}
.orb span svg{width:36px;height:36px}
.orb.ok:before,.orb.err:before{animation:none;opacity:0;transition:opacity .3s}
.orb.ok span{background:var(--g);color:#140a05;border-color:transparent;transform:scale(1.08)}
.orb.err span{background:rgba(255,138,120,.14);color:var(--bad)}
@keyframes spin{to{transform:rotate(1turn)}}
@keyframes breath{50%{opacity:.4;transform:scale(.85)}}
.rq h2{font-size:21px;font-weight:700;margin-bottom:6px}
.rq p{color:var(--snow-2);font-size:14.5px;max-width:300px}
.sum{width:100%;margin:18px 0 16px;border-radius:20px;background:var(--ink-2);border:1px solid var(--hair);padding:4px 16px;text-align:left}
.sum div{display:flex;justify-content:space-between;gap:14px;padding:11px 0;border-top:1px solid var(--hair);font-size:14px}
.sum div:first-child{border-top:0}
.sum span{color:var(--snow-3)}.sum b{font-weight:600;overflow-wrap:anywhere;text-align:right}
.sum .big b{font:700 18px Unbounded,Onest,sans-serif;letter-spacing:-.03em}
.sum .mono{font:13px "JetBrains Mono",ui-monospace,monospace}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;

  /* ---------- the SDK ---------- */
  class YukiConnect {
    constructor(opts = {}) {
      if (!opts.manifestUrl) throw new Error('YUKI Connect: manifestUrl is required');
      this.o = Object.assign({}, DEF, {storageKey: 'yuki-connect', theme: 'auto'}, opts);
      this.s = this._load();
      this.req = {}; this.subs = new Set(); this.es = null; this.seq = this.s.seq || 0;
      if (this.s.account) deps().then(() => this._listen()).catch(() => {});
    }

    /** Connected account or null: {address, pubkey, name, chain, device} */
    get account() { return this.s.account || null; }
    get connected() { return !!this.s.account; }

    onStatusChange(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
    _emit() { for (const f of this.subs) try { f(this.account); } catch (e) { console.error(e); } }

    _load() { try { return JSON.parse(localStorage.getItem(this.o.storageKey)) || {}; } catch { return {}; } }
    _save() { try { localStorage.setItem(this.o.storageKey, JSON.stringify(this.s)); } catch {} }

    /** Opens the connect window. proof: optional string your server wants signed (a nonce) */
    async connect({proof} = {}) {
      if (this.account) return this.account;
      await deps();
      const nacl = g.nacl, kp = nacl.box.keyPair();
      this.s = {sk: hex(kp.secretKey), pk: hex(kp.publicKey), last: 0, seq: 0};
      this._save();
      const items = [{name: 'address'}];
      if (proof != null) items.push({name: 'proof', payload: String(proof)});
      const link = this.connectLink({manifestUrl: this.o.manifestUrl, items});
      this._listen();
      return new Promise((resolve, reject) => {
        this.pend = {resolve, reject};
        this._connectModal(link);
      });
    }

    /** Universal link a wallet opens; you can render it yourself instead of using the modal. */
    connectLink(request) {
      return `${this.o.walletUrl}?v=1&id=${this.s.pk}&r=${b64url(JSON.stringify(request))}`;
    }

    _listen() {
      if (this.es) this.es.close();
      if (!this.s.pk) return;
      const es = this.es = new EventSource(`${this.o.bridge}/events?client_id=${this.s.pk}&last_event_id=${this.s.last || 0}`);
      es.addEventListener('message', e => {
        if (e.lastEventId) { this.s.last = +e.lastEventId; this._save(); }
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (this.s.wallet && m.from !== this.s.wallet) return;
        let body; try {
          const raw = unb64(m.message), box = g.nacl.box.open(raw.slice(24), raw.slice(0, 24), unhex(m.from), unhex(this.s.sk));
          if (!box) return; body = JSON.parse(dec.decode(box));
        } catch { return; }
        this._on(m.from, body);
      });
    }

    _on(from, m) {
      if (m.event === 'connect' && !this.s.account) {
        const a = (m.payload.items || []).find(i => i.name === 'address'), pr = (m.payload.items || []).find(i => i.name === 'proof');
        if (!a) return;
        this.s.wallet = from;
        this.s.account = {address: a.address, pubkey: a.pubkey, name: a.yukiName || '', chain: a.chain, device: m.payload.device || {}, proof: pr ? pr.proof : null};
        this._save(); this._emit();
        if (this.pend) { this.pend.resolve(this.account); this.pend = null; }
        if (this.ui && this.ui.connected) this.ui.connected(this.account);
      } else if (m.event === 'connect_error') {
        if (this.pend) { this.pend.reject(Object.assign(new Error(m.payload && m.payload.message || 'Declined in wallet'), {code: m.payload && m.payload.code})); this.pend = null; }
        if (this.ui && this.ui.failed) this.ui.failed(m.payload && m.payload.message || 'Declined in wallet');
        this._reset(false);
      } else if (m.event === 'disconnect') {
        this._reset(true);
      } else if (m.id != null && this.req[m.id]) {
        const r = this.req[m.id]; delete this.req[m.id];
        m.error ? r.reject(Object.assign(new Error(m.error.message || 'Declined'), {code: m.error.code})) : r.resolve(m.result);
      }
    }

    async _send(body) {
      const nonce = g.nacl.randomBytes(24), box = g.nacl.box(enc.encode(JSON.stringify(body)), nonce, unhex(this.s.wallet), unhex(this.s.sk));
      const all = new Uint8Array(24 + box.length); all.set(nonce); all.set(box, 24);
      const r = await fetch(`${this.o.bridge}/message?client_id=${this.s.pk}&to=${this.s.wallet}&ttl=300`, {method: 'POST', body: b64(all)});
      if (!r.ok) throw new Error('Bridge error ' + r.status);
    }

    async _request(method, params, ui) {
      if (!this.account) throw new Error('Not connected');
      await deps();
      const id = String(++this.seq); this.s.seq = this.seq; this._save();
      const validUntil = params.valid_until || Date.now() + 5 * 60e3;
      const p = new Promise((resolve, reject) => {
        this.req[id] = {resolve, reject};
        setTimeout(() => { if (this.req[id]) { delete this.req[id]; reject(Object.assign(new Error('Request expired'), {code: 'expired'})); } }, Math.max(1000, validUntil - Date.now()));
      });
      const view = ui ? this._requestModal(ui, () => { const r = this.req[id]; if (r) { delete this.req[id]; r.reject(Object.assign(new Error('Cancelled'), {code: 'cancelled'})); } }) : null;
      try {
        await this._send({method, id, params: Object.assign({}, params, {valid_until: validUntil})});
        const res = await p;
        if (view) view.done(res);
        return res;
      } catch (e) { if (view) view.fail(e.message); throw e; }
    }

    /** {to, amount (nanoYUKI string or bigint), memo?, valid_until?} -> {hash} */
    sendTransaction(tx, {modal = true} = {}) {
      const amount = typeof tx.amount === 'bigint' ? tx.amount.toString() : String(tx.amount);
      if (!/^\d+$/.test(amount) || amount === '0') throw new Error('amount must be a positive integer in nanoYUKI (use YukiConnect.toNano)');
      const params = {to: tx.to, amount, memo: tx.memo || '', valid_until: tx.valid_until};
      return this._request('sendTransaction', params, modal && {kind: 'tx', params});
    }

    /** Sign a text with the wallet key -> {signature, pubkey, address, domain, timestamp, text} */
    signMessage(text, {modal = true} = {}) {
      return this._request('signMessage', {text: String(text)}, modal && {kind: 'sign', params: {text: String(text)}});
    }

    async disconnect() {
      if (this.s.wallet) try { await deps(); await this._send({method: 'disconnect', id: String(++this.seq), params: {}}); } catch {}
      this._reset(true);
    }
    _reset(emit) {
      if (this.es) { this.es.close(); this.es = null; }
      for (const k in this.req) this.req[k].reject(new Error('Disconnected'));
      this.req = {}; this.s = {}; this._save();
      if (emit) this._emit();
    }

    /* ---------- UI ---------- */
    _theme() { const t = this.o.theme; return t === 'light' || (t === 'auto' && g.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark'; }
    _host() {
      const host = document.createElement('yuki-connect-modal'), sh = host.attachShadow({mode: 'open'});
      sh.innerHTML = `<style>${CSS}</style><div class="t ${this._theme()}"><div class="ov" part="overlay"><div class="md" role="dialog" aria-modal="true"></div></div></div>`;
      document.body.append(host);
      const ov = sh.querySelector('.ov'), md = sh.querySelector('.md');
      const prevFocus = document.activeElement;
      const close = () => { ov.classList.add('out'); setTimeout(() => host.remove(), 220); removeEventListener('keydown', key); if (prevFocus && prevFocus.focus) prevFocus.focus(); };
      const key = e => { if (e.key === 'Escape') m.dismiss(); };
      addEventListener('keydown', key);
      const m = {sh, md, close, dismiss: close};
      ov.addEventListener('click', e => { if (e.target === ov) m.dismiss(); });
      return m;
    }
    async _manifest() {
      try { return this._mf ||= await (await fetch(this.o.manifestUrl)).json(); } catch { return {name: location.host, url: location.origin}; }
    }

    _connectModal(link) {
      const m = this._host(), {md} = m;
      md.setAttribute('aria-label', 'Connect Yuki Wallet');
      md.innerHTML = `<div class="top"><span class="lg">${LOGO}</span><b class="h">Connect Yuki Wallet</b><button class="x" aria-label="Close">${IC.x}</button></div>
        <p class="lead">Scan with your phone camera, or open the wallet on this device.</p>
        <div class="qrw">${qrSVG(link)}<span class="ql">${LOGO}</span><i class="scan"></i><div class="okv"><i>${IC.ok}</i><b class="h">Connected</b><small></small></div></div>
        <div class="btns"><a class="b p" href="${esc(link)}" target="_blank" rel="noopener">${LOGO.replace('currentColor', '#140a05')}Open Yuki Wallet</a>
          <button class="b s cp">${IC.copy}Copy link</button></div>
        <div class="st" role="status"><i></i><span>Waiting for the wallet…</span></div>
        <div class="ft"><img alt="" hidden><span class="app"></span><a href="${esc(this.o.getWallet)}" target="_blank" rel="noopener">Get Yuki Wallet →</a></div>`;
      // dots pop in from the centre outwards
      const svg = md.querySelector('.qrw svg'), n = svg.viewBox.baseVal.width / 2;
      svg.querySelectorAll('circle').forEach(c => { const d = Math.hypot(c.cx.baseVal.value - n, c.cy.baseVal.value - n); c.style.setProperty('--d', (d * 14) | 0); });
      md.querySelector('.x').onclick = () => m.dismiss();
      md.querySelector('.cp').onclick = e => navigator.clipboard.writeText(link).then(() => { e.currentTarget.lastChild.textContent = 'Copied'; });
      this._manifest().then(mf => { const img = md.querySelector('.ft img'); if (mf.iconUrl) { img.src = mf.iconUrl; img.hidden = false; } md.querySelector('.ft .app').textContent = (mf.name || location.host); });
      const st = md.querySelector('.st');
      m.dismiss = () => { m.close(); this.ui = null; if (this.pend) { this.pend.reject(Object.assign(new Error('Connect window closed'), {code: 'closed'})); this.pend = null; this._reset(false); } };
      this.ui = {
        connected: a => {
          md.querySelector('.qrw').classList.add('done'); md.querySelector('.okv small').textContent = short(a.address, 6);
          st.className = 'st ok'; st.lastChild.textContent = 'Connected to ' + (a.device.app || 'Yuki Wallet');
          setTimeout(() => { m.close(); this.ui = null; }, 1300);
        },
        failed: msg => { st.className = 'st err'; st.lastChild.textContent = msg; setTimeout(() => { m.close(); this.ui = null; }, 1600); },
      };
    }

    _requestModal(ui, cancel) {
      const m = this._host(), {md} = m, p = ui.params, tx = ui.kind === 'tx';
      md.setAttribute('aria-label', tx ? 'Confirm transaction' : 'Sign message');
      md.innerHTML = `<div class="top"><span class="lg">${LOGO}</span><b class="h">${tx ? 'Approve transaction' : 'Sign message'}</b><button class="x" aria-label="Close">${IC.x}</button></div>
        <div class="rq"><div class="orb"><span>${LOGO}</span></div><h2 class="h">Confirm in Yuki Wallet</h2><p>Open the wallet on your phone and approve the request.</p>
        <div class="sum">${tx ? `<div class="big"><span>Amount</span><b>${esc(fromNano(p.amount))} YUKI</b></div><div><span>To</span><b class="mono">${esc(short(p.to, 6))}</b></div>${p.memo ? `<div><span>Comment</span><b>${esc(p.memo)}</b></div>` : ''}<div><span>Network fee</span><b>0.001 YUKI</b></div>`
          : `<div><span>Message</span><b>${esc(p.text.length > 160 ? p.text.slice(0, 160) + '…' : p.text)}</b></div>`}</div></div>
        <div class="row2"><button class="b s cn">Cancel</button><a class="b p" href="${esc(this.o.walletUrl)}" target="_blank" rel="noopener">Open wallet</a></div>
        <div class="st" role="status"><i></i><span>Waiting for approval…</span></div>`;
      const st = md.querySelector('.st'), orb = md.querySelector('.orb'), h = md.querySelector('.rq h2'), pp = md.querySelector('.rq p');
      m.dismiss = () => { cancel(); m.close(); };
      md.querySelector('.x').onclick = md.querySelector('.cn').onclick = () => m.dismiss();
      return {
        done: res => {
          orb.classList.add('ok'); orb.querySelector('span').innerHTML = IC.ok; h.textContent = tx ? 'Sent' : 'Signed';
          pp.textContent = tx ? 'It lands in the next block.' : 'The wallet signed your message.';
          st.className = 'st ok'; st.lastChild.textContent = tx ? 'tx ' + short(res.hash, 6) : 'Signature received';
          m.dismiss = m.close; setTimeout(m.close, 1800);
        },
        fail: msg => {
          orb.classList.add('err'); orb.querySelector('span').innerHTML = IC.no; h.textContent = 'Not approved';
          pp.textContent = msg; st.className = 'st err'; st.lastChild.textContent = msg;
          m.dismiss = m.close; setTimeout(m.close, 2200);
        },
      };
    }

    /** Renders the Connect button / account chip into el and keeps it in sync. */
    button(el, {proof} = {}) {
      if (typeof el === 'string') el = document.querySelector(el);
      const sh = el.shadowRoot || el.attachShadow({mode: 'open'});
      const draw = () => {
        const a = this.account;
        sh.innerHTML = `<style>${CSS}:host{display:inline-block}</style><div class="t ${this._theme()}">${a
          ? `<div class="wrapb"><button class="chip" aria-haspopup="menu" aria-expanded="false"><span class="av">${LOGO}</span><span class="ad">${esc(short(a.address))}</span>${IC.chev}</button>
             <div class="menu" role="menu"><div class="who"><b>${esc(a.device && a.device.app || 'Yuki Wallet')}</b><small>${esc(a.address)}</small></div>
             <button role="menuitem" class="cpy">${IC.copy}Copy address</button><button role="menuitem" class="dz dis">${IC.out}Disconnect</button></div></div>`
          : `<button class="cb">${LOGO.replace('currentColor', '#140a05')}Connect wallet</button>`}</div>`;
        if (!a) { sh.querySelector('.cb').onclick = () => this.connect({proof: typeof proof === 'function' ? proof() : proof}).catch(() => {}); return; }
        const w = sh.querySelector('.wrapb'), chip = sh.querySelector('.chip');
        const set = o => { w.classList.toggle('open', o); chip.setAttribute('aria-expanded', o); };
        chip.onclick = e => { e.stopPropagation(); const o = !w.classList.contains('open'); set(o); if (o) document.addEventListener('click', () => set(false), {once: true}); };
        sh.querySelector('.cpy').onclick = () => { navigator.clipboard.writeText(a.address); set(false); };
        sh.querySelector('.dis').onclick = () => this.disconnect();
      };
      this.onStatusChange(draw); draw();
      return draw;
    }
  }

  YukiConnect.version = VERSION;
  YukiConnect.toNano = toNano;
  YukiConnect.fromNano = fromNano;
  YukiConnect.addressOf = addressOf;
  YukiConnect.proofMessage = proofMessage;
  YukiConnect.signedMessage = signedMessage;
  /** Checks a connect proof: wallet key matches the address and signed your payload for your domain. */
  YukiConnect.verifyProof = (account, proof = account.proof) => !proof ? Promise.resolve(false) : verify(proofMessage(proof, account.address), proof.signature, account.pubkey, account.address);
  YukiConnect.verifySignedMessage = s => verify(signedMessage(s, s.address), s.signature, s.pubkey, s.address);
  g.YukiConnect = YukiConnect;
})(typeof window !== 'undefined' ? window : globalThis);
