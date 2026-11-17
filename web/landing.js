// YukiChain landing: one fixed Three.js scene choreographed by a scrubbed GSAP timeline.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const LIBS = {};
const loadScript = src => LIBS[src] ||= new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
});
async function libs() {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js');
  await Promise.all([
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js'),
    loadScript('https://unpkg.com/lenis@1.1.13/dist/lenis.min.js'),
  ]);
  gsap.registerPlugin(ScrollTrigger);
}
if (!document.querySelector('link[data-lx]')) {
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'landing.css?v=8'; l.dataset.lx = 1; document.head.appendChild(l);
}

const ARROW = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ADDR = 'yuki1qz8f3x7h2m9kd5wrlc0v6tnj4aes8p7mxk';
const NAME = 'vasya.yuki';
const B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const SEGS = [['Founder', 30], ['Ecosystem rewards', 30], ['Validator stake', 20], ['Treasury', 15], ['Faucet and airdrops', 5]];

/* ---------------- shaders ---------------- */
const NOISE = `
float hash(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
 return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*noise(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=.5;}return s;}
float fbm3(vec3 p){float a=.5,s=0.;for(int i=0;i<3;i++){s+=a*noise(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=.5;}return s+.12;}`;

const BG_FRAG = `
uniform vec2 uRes,uMouse;uniform float uTime,uScroll,uMood;
${NOISE}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes; vec2 p=(uv-.5)*vec2(uRes.x/uRes.y,1.);
  float t=uTime*.025;
  vec3 q=vec3(p*1.15,t);
  float a=fbm(q+vec3(0.,uScroll*.4,0.));
  float b=fbm(q*1.4+vec3(a*1.7,a*1.2,t*1.3)+vec3(5.2,1.3,0.));
  float f=fbm(q*1.05+vec3(b*2.1,b*1.4,t*.7)+vec3(uMouse*.12,0.));
  vec3 ink=vec3(.031,.043,.063), deep=vec3(.045,.095,.15), glac=vec3(.47,.65,.76), ember=vec3(.95,.42,.25);
  vec3 col=mix(ink,deep,smoothstep(.3,.9,f));
  float rib=pow(smoothstep(.42,.95,b),2.2)*smoothstep(-.9,.7,p.y+.18*sin(p.x*2.2+t*7.));
  col+=glac*rib*.3*(1.-uMood*.35);
  col+=ember*pow(smoothstep(.5,1.,a*b*1.7),3.)*.2*(.35+uMood);
  col*=1.-.6*dot(p*.85,p*.85);
  col+=(hash(vec3(gl_FragCoord.xy,uTime))-.5)*(2./255.);
  gl_FragColor=vec4(col,1.);
}`;

const ICE_VERT = `
attribute float aSeg;
varying vec3 vN,vW,vO,vCol;varying float vSeg;
void main(){
  vec4 lp=vec4(position,1.);vec3 n=normal;
  #ifdef USE_INSTANCING
    lp=instanceMatrix*lp;n=mat3(instanceMatrix)*n;
  #endif
  vCol=vec3(1.);
  #ifdef USE_INSTANCING_COLOR
    vCol=instanceColor;
  #endif
  vO=position;vSeg=aSeg;
  vec4 wp=modelMatrix*lp;vW=wp.xyz;vN=normalize(mat3(modelMatrix)*n);
  gl_Position=projectionMatrix*viewMatrix*wp;
}`;
const ICE_FRAG = `
uniform float uTime,uIntro,uFlash,uOpacity,uSeg;uniform vec3 uAccent;
varying vec3 vN,vW,vO,vCol;varying float vSeg;
${NOISE}
vec3 env(vec3 d){
  vec3 ink=vec3(.03,.045,.07),glac=vec3(.55,.74,.86);
  vec3 c=mix(ink,glac*.55,smoothstep(-.4,.9,d.y));
  c+=vec3(.9,.97,1.)*pow(max(0.,sin(d.x*7.+d.y*3.+uTime*.15)),48.)*1.3;
  c+=vec3(.9,.97,1.)*pow(max(0.,sin(d.z*5.-d.y*6.+1.3)),60.)*.9;
  c+=uAccent*pow(max(0.,dot(d,normalize(vec3(-.7,.35,.6)))),9.)*.6;
  c+=glac*pow(max(0.,dot(d,normalize(vec3(.6,.8,-.2)))),6.)*.45;
  return c;
}
void main(){
  vec3 N=normalize(vN);vec3 V=normalize(cameraPosition-vW);
  if(!gl_FrontFacing)N=-N;
  float nd=clamp(dot(N,V),0.,1.);
  float fr=pow(1.-nd,3.);
  vec3 refr=env(refract(-V,N,.76));
  vec3 refl=env(reflect(-V,N));
  vec3 film=.5+.5*cos(6.2831*(vec3(.02,.12,.2)+nd*1.1+vO.y*.25+uTime*.03));film=mix(vec3(dot(film,vec3(.33))),film,.55);
  float frost=fbm3(vO*3.5+uTime*.02);
  vec3 col=refr*vec3(.62,.8,.92)*(.7+.55*frost)+refl*fr*1.25+film*fr*.32;
  col*=vCol;
  float hl=(uSeg>-.5&&abs(vSeg-uSeg)<.5)?1.:0.;
  col=mix(col,uAccent*(.75+fr*.8),hl*.8);
  float n=fbm3(vO*2.2+3.);
  float edge=uIntro*1.25-.1;
  if(n>edge)discard;
  float rim=smoothstep(edge-.07,edge,n)*step(uIntro,.999);
  col+=vec3(.85,.95,1.)*rim*1.6;
  col+=vec3(1.)*uFlash*(.35+fr);
  gl_FragColor=vec4(col,clamp(.4+fr*.6+rim+uFlash*.3,0.,1.)*uOpacity);
}`;

const SNOW_VERT = `
attribute float aSize,aSpeed,aPhase;uniform float uTime,uScroll,uH,uPR;varying float vA;
void main(){
  vec3 p=position;
  p.y=mod(p.y-uTime*aSpeed-uScroll*aSpeed*9.+uH*.5,uH)-uH*.5;
  p.x+=sin(uTime*.35+aPhase)*.3;
  vec4 mv=modelViewMatrix*vec4(p,1.);
  gl_PointSize=aSize*uPR*(16./-mv.z);
  gl_Position=projectionMatrix*mv;
  vA=smoothstep(32.,5.,-mv.z)*smoothstep(.6,3.,-mv.z);
}`;
const SNOW_FRAG = `varying float vA;void main(){float d=length(gl_PointCoord-.5);gl_FragColor=vec4(.9,.95,1.,smoothstep(.5,.08,d)*vA*.8);}`;

const COMET_VERT = `attribute float aK;uniform float uPR,uVis;varying float vK;
void main(){vK=aK;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=uPR*(.25+(1.-aK)*(1.-aK)*(aK<.01?2.2:1.))*70./-mv.z*uVis;gl_Position=projectionMatrix*mv;}`;
const COMET_FRAG = `uniform vec3 uAccent;varying float vK;
void main(){float d=length(gl_PointCoord-.5);vec3 c=mix(vec3(1.,.97,.93),uAccent,smoothstep(0.,.35,vK));gl_FragColor=vec4(c,smoothstep(.5,0.,d)*(1.-vK));}`;

/* ---------------- poses per section ---------------- */
const POSES = {
  hero:   {hx: 3.75, hy: -.1, hz: 0, hs: 1, camY: 0, camZ: 10, shard: 0, rx: 3.3, ry: 0, rz: -1, mood: 0, chain: 1, spin: 0},
  freeze: {hx: 3.3, hy: .1, hz: -1, hs: .92, camY: .5, camZ: 9.4, shard: 0, mood: .25, chain: 1, spin: .4},
  chain:  {hx: 0, hy: -1.4, hz: -8, hs: .9, camY: 0, camZ: 11, shard: 0, mood: .4, chain: .7, spin: 1.2},
  coin:   {hx: 3.5, hy: .6, hz: -1, hs: .3, camY: 0, camZ: 10, shard: 1, rx: 3.5, ry: .6, rz: -1, mood: .55, chain: 0, spin: .2},
  names:  {hx: 4.4, hy: 2.3, hz: -6, hs: .8, camY: .2, camZ: 10, shard: 0, mood: .3, chain: .8, spin: .5},
  build:  {hx: 0, hy: -.4, hz: -7, hs: .8, camY: 0, camZ: 10, shard: 0, mood: .12, chain: .5, spin: .3},
  road:   {hx: 0, hy: -6.5, hz: -3, hs: 1, camY: -.4, camZ: 10, shard: 0, mood: .45, chain: .9, spin: .6},
  outro:  {hx: 0, hy: .1, hz: 0, hs: 1.22, camY: 0, camZ: 9.5, shard: 0, mood: .85, chain: 1, spin: .9},
};

export async function mount(view, ctx) {
  const {get, fmt, esc} = ctx;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [status, blocks] = await Promise.all([get('/status'), get('/blocks?limit=9'), libs()]);
  const cleanups = [];
  const on = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); cleanups.push(() => el.removeEventListener(ev, fn, o)); };

  view.innerHTML = `<div class="lx">
  <canvas class="lx-gl" role="img" aria-label="An ice crystal with the latest YukiChain blocks orbiting it as ice cubes"></canvas>

  <section class="lx-hero" data-pose="hero"><div class="lx-w">
    <h1 class="lx-h1"><span class="ln"><span>Every block,</span></span><span class="ln"><span>frozen for good<em>.</em></span></span></h1>
    <p class="lx-lead" data-in>YukiChain is a Layer 1 we wrote from zero for the Yuki apps. Send <b>YUKI</b> in about five seconds, to a name instead of a hash.</p>
    <div class="lx-cta" data-in><a class="lx-btn pri" data-mag href="#/wallet">Create a wallet ${ARROW}</a><a class="lx-btn" data-mag href="#/explorer">Open the explorer</a></div>
  </div>
  <div class="lx-live" data-in aria-live="polite"><i></i><span>Block <b data-l="h">#${status.height.toLocaleString('en-US')}</b> sealed <span data-l="ago">just now</span></span></div>
  </section>

  <section class="lx-freeze" data-pose="freeze"><div class="lx-sticky"><div class="lx-w"><div>
    <p class="lx-q">What happens when you press <span>Send</span></p>
    <div class="lx-words">${['Sign.', 'Broadcast.', 'Freeze.'].map((w, i) => `<span class="w" data-w="${i}">${[...w].map(c => `<span class="c">${c}</span>`).join('')}</span>`).join('')}</div>
    <div class="lx-steps">
      <p class="on">Your browser signs the transfer with an <b>Ed25519 key</b>. The key itself never leaves your device.</p>
      <p>The node checks the <b>signature, nonce and balance</b>, then queues the transfer for the next block.</p>
      <p>The validator seals the block. Its hash commits to <b>every balance on the chain</b>, so history cannot be edited.</p>
    </div>
    <div class="lx-prog"><span><i></i></span><span><i></i></span><span><i></i></span></div>
  </div></div></div></section>

  <section class="lx-chain" data-pose="chain">
    <div class="lx-w lx-chain-head"><h2 data-split>The chain, right now.</h2><p data-rv>These are real blocks, streamed live from the validator. Each one links to the hash of the block before it.</p></div>
    <div class="lx-track"></div>
  </section>

  <section class="lx-coin" data-pose="coin"><div class="lx-w">
    <div>
      <h2 data-split>YUKI, the coin of the chain.</h2>
      <div class="lx-count" aria-label="1,000,000,000 YUKI at genesis">0</div>
      <p class="lead" data-rv>Minted once at genesis. Validators earn ${status.inflation_pct}% a year for sealing blocks, and every name fee is burned for good.</p>
      <div class="lx-facts" data-rv>
        <div><b data-l="supply">${fmt(status.supply, 0)}</b><span>Supply right now</span></div>
        <div><b data-l="burned">${fmt(status.burned, 2)}</b><span>Burned by names</span></div>
        <div><b>10<sup>9</sup></b><span>nanoyuki in one YUKI</span></div>
      </div>
    </div>
    <ul class="lx-alloc" data-rv>${SEGS.map(([n, p], i) => `<li data-seg="${i}"><i style="background:hsl(205 22% ${86 - i * 13}%)"></i><span>${n}</span><b>${p}%</b></li>`).join('')}</ul>
  </div></section>

  <section class="lx-names" data-pose="names"><div class="lx-w">
    <h2 data-split>Send to a name, not a hash.</h2>
    <div class="lx-morph" aria-label="${ADDR} becomes ${NAME}">${ADDR}</div>
    <div class="row">
      <p class="sub" data-rv>Names live on the chain itself. Shorter ones are rarer and cost more, and the fee is burned. Register one for a year, point it at any wallet, or hand it to a friend. Wallets resolve it before signing, so nothing is ambiguous.</p>
      <div data-rv>
        <form class="lx-check"><label for="lxn" class="sr">Name</label><input id="lxn" name="n" placeholder="yourname" maxlength="32" autocomplete="off" spellcheck="false"><em>.yuki</em><button class="lx-btn pri">Check</button></form>
        <div class="lx-res" aria-live="polite">3 to 32 characters: a to z, digits and dashes.</div>
        <div class="lx-prices"><div><b>3000</b>3 letters</div><div><b>1000</b>4 letters</div><div><b>300</b>5 letters</div><div><b>100</b>6 letters</div><div><b>Half</b>with a digit</div></div>
      </div>
    </div>
  </div></section>

  <section class="lx-build" data-pose="build"><div class="lx-w">
    <div>
      <h2 data-split>One binary. Plain HTTP.</h2>
      <p data-rv>The node is a single Go program with no dependencies. Every Yuki app reads the chain and submits signed transactions over the same open API.</p>
      <button class="lx-btn pri" data-mag data-try data-rv>Run it live ${ARROW}</button>
    </div>
    <div class="lx-term" data-rv><div class="lx-term-h"><span>chain.yukichat.lol</span><span>api</span></div><pre></pre></div>
  </div></section>

  <section class="lx-road" data-pose="road"><div class="lx-w">
    <h2 data-split>From one node to a network.</h2>
    <div class="lx-line"><span class="fill"></span>
      <div class="lx-node live" data-rv><small>Live now</small><h3>Core chain</h3><p>Accounts, transfers and fees. Signed blocks with state roots. Names, explorer and wallet.</p></div>
      <div class="lx-node" data-rv><small>Next</small><h3>Network</h3><p>Nodes gossip transactions and vote on every block. A second validator joins.</p></div>
      <div class="lx-node" data-rv><small>After that</small><h3>Staking</h3><p>Anyone can stake YUKI and validate. Rewards, slashing, and a wallet inside the Yuki apps.</p></div>
      <div class="lx-node" data-rv><small>Later</small><h3>Contracts</h3><p>Custom tokens on YukiChain, our own contract VM, then mainnet.</p></div>
    </div>
  </div></section>

  <section class="lx-outro" data-pose="outro"><div class="lx-w">
    <h2 data-split>Get 100 test YUKI and make your first transfer.</h2>
    <div class="lx-cta" data-rv><a class="lx-btn pri" data-mag href="#/wallet">Create a wallet ${ARROW}</a><a class="lx-btn" data-mag href="#/names">Browse names</a></div>
  </div></section>
</div>`;

  const root = view.querySelector('.lx');
  const $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];

  /* ---------- three.js scene ---------- */
  const canvas = $('.lx-gl');
  const small = innerWidth < 760;
  const renderer = new THREE.WebGLRenderer({canvas, antialias: devicePixelRatio < 1.5, alpha: false, powerPreference: 'high-performance'});
  let PR = Math.min(devicePixelRatio, small ? 1.25 : 1.5);
  renderer.setPixelRatio(PR);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
  const accent = new THREE.Color('#f26a3f');
  const S = {...POSES.hero, intro: reduce ? 1 : 0, flash: 0, comet: 0, cometVis: 0, seg: -1, chainOff: 0, pop: 1, mx: 0, my: 0, tmx: 0, tmy: 0, scroll: 0};

  const bgMat = new THREE.ShaderMaterial({
    vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}', fragmentShader: BG_FRAG, depthTest: false, depthWrite: false,
    uniforms: {uRes: {value: new THREE.Vector2()}, uMouse: {value: new THREE.Vector2()}, uTime: {value: 0}, uScroll: {value: 0}, uMood: {value: 0}},
  });
  // the aurora is soft noise: render it at a third of the resolution, every other frame, then upscale
  const bgScene = new THREE.Scene(), bgRT = new THREE.WebGLRenderTarget(2, 2, {depthBuffer: false});
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat); bg.frustumCulled = false; bgScene.add(bg);
  const blit = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: 'uniform sampler2D tMap;varying vec2 vUv;void main(){gl_FragColor=texture2D(tMap,vUv);}',
    uniforms: {tMap: {value: bgRT.texture}}, depthTest: false, depthWrite: false}));
  blit.frustumCulled = false; blit.renderOrder = -10; scene.add(blit);

  const iceUniforms = () => ({uTime: {value: 0}, uIntro: {value: S.intro}, uFlash: {value: 0}, uOpacity: {value: 1}, uSeg: {value: -1}, uAccent: {value: accent}});
  const iceMat = (side, u) => new THREE.ShaderMaterial({vertexShader: ICE_VERT, fragmentShader: ICE_FRAG, uniforms: u, transparent: true, depthWrite: false, side});

  // crystal: hexagonal bipyramid prism, flat-shaded facets, back faces then front faces
  const hero = new THREE.Group(); scene.add(hero);
  const prof = [[0, -2.15], [.58, -1.55], [1, -.5], [1, .5], [.58, 1.55], [0, 2.15]].map(([x, y]) => new THREE.Vector2(x, y));
  const cgeo = new THREE.LatheGeometry(prof, 6).toNonIndexed(); cgeo.computeVertexNormals();
  const cU = iceUniforms();
  const crystal = new THREE.Group(); hero.add(crystal);
  const cBack = new THREE.Mesh(cgeo, iceMat(THREE.BackSide, cU)); cBack.renderOrder = 1;
  const cFront = new THREE.Mesh(cgeo, iceMat(THREE.FrontSide, cU)); cFront.renderOrder = 2;
  const edgeMat = new THREE.LineBasicMaterial({color: 0xdff3ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false});
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.LatheGeometry(prof, 6), 20), edgeMat); edges.renderOrder = 3;
  crystal.add(cBack, cFront, edges);

  // chain: latest blocks as ice cubes on a helix around the crystal
  const N = 24, chainU = iceUniforms();
  const cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(.34, .34, .34), iceMat(THREE.FrontSide, chainU), N);
  cubes.renderOrder = 4; cubes.frustumCulled = false; hero.add(cubes);
  const linkGeo = new THREE.BufferGeometry(); linkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N - 1) * 6), 3));
  const linkMat = new THREE.LineBasicMaterial({color: 0xbcd6e4, transparent: true, opacity: .22, depthWrite: false});
  const links = new THREE.LineSegments(linkGeo, linkMat); links.frustumCulled = false; hero.add(links);

  // shards: scattered debris that assembles into the tokenomics ring
  const M = small ? 70 : 100, shardU = iceUniforms();
  const sgeo = new THREE.OctahedronGeometry(.14, 0);
  const segOf = new Float32Array(M); const bounds = [0, 30, 60, 80, 95, 100].map(b => Math.round(b / 100 * M));
  for (let i = 0; i < M; i++) segOf[i] = bounds.findIndex((b, k) => i >= b && i < bounds[k + 1]);
  sgeo.setAttribute('aSeg', new THREE.InstancedBufferAttribute(segOf, 1));
  const shards = new THREE.InstancedMesh(sgeo, iceMat(THREE.FrontSide, shardU), M); shards.renderOrder = 5; shards.frustumCulled = false; scene.add(shards);
  const sd = Array.from({length: M}, (_, i) => {
    const seg = segOf[i], gap = .09, span = Math.PI * 2 - gap * 5;
    const local = (i - bounds[seg] + .5) / (bounds[seg + 1] - bounds[seg]);
    const a0 = bounds[seg] / M * span + seg * gap;
    return {
      ring: a0 + local * (bounds[seg + 1] - bounds[seg]) / M * span,
      th: Math.random() * 6.283, ph: Math.acos(2 * Math.random() - 1), r: 5.5 + Math.random() * 4, sp: .03 + Math.random() * .06,
      delay: Math.random(), rot: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
    };
  });
  for (let i = 0; i < M; i++) { const v = .98 - segOf[i] * .13; shards.setColorAt(i, new THREE.Color(v * .97, v, v * 1.04)); }

  // snow
  const SN = small ? 900 : 1800, sp = new Float32Array(SN * 3), sa = new Float32Array(SN), ss = new Float32Array(SN), sph = new Float32Array(SN);
  for (let i = 0; i < SN; i++) { sp[i * 3] = (Math.random() - .5) * 30; sp[i * 3 + 1] = (Math.random() - .5) * 20; sp[i * 3 + 2] = -Math.random() * 22 + 6; sa[i] = .6 + Math.random() * 1.8; ss[i] = .15 + Math.random() * .35; sph[i] = Math.random() * 6.28; }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3)); snowGeo.setAttribute('aSize', new THREE.BufferAttribute(sa, 1));
  snowGeo.setAttribute('aSpeed', new THREE.BufferAttribute(ss, 1)); snowGeo.setAttribute('aPhase', new THREE.BufferAttribute(sph, 1));
  const snowMat = new THREE.ShaderMaterial({vertexShader: SNOW_VERT, fragmentShader: SNOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {uTime: {value: 0}, uScroll: {value: 0}, uH: {value: 20}, uPR: {value: PR}}});
  const snow = new THREE.Points(snowGeo, snowMat); snow.frustumCulled = false; snow.renderOrder = 6; scene.add(snow);

  // comet: a transaction travelling into the crystal
  const CK = 140, cpos = new Float32Array(CK * 3), ck = new Float32Array(CK);
  for (let i = 0; i < CK; i++) ck[i] = i / CK;
  const cometGeo = new THREE.BufferGeometry();
  cometGeo.setAttribute('position', new THREE.BufferAttribute(cpos, 3)); cometGeo.setAttribute('aK', new THREE.BufferAttribute(ck, 1));
  const cometMat = new THREE.ShaderMaterial({vertexShader: COMET_VERT, fragmentShader: COMET_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {uPR: {value: PR}, uVis: {value: 0}, uAccent: {value: accent}}});
  const comet = new THREE.Points(cometGeo, cometMat); comet.frustumCulled = false; comet.renderOrder = 7; scene.add(comet);

  /* ---------- per-frame ---------- */
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e3 = new THREE.Euler(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  const prev = new THREE.Vector3(), hp = new THREE.Vector3(), cp = new THREE.Vector3();
  const tilt = new THREE.Matrix4().makeRotationX(-1.05).multiply(new THREE.Matrix4().makeRotationZ(.25));
  let fc = 0, acc = 0, xf = 1, raf = 0, last = performance.now(), T = 0, alive = true, visible = true;

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    const bw = Math.ceil(w / 3), bh = Math.ceil(h / 3); bgRT.setSize(bw, bh); bgMat.uniforms.uRes.value.set(bw, bh);
    xf = w < 760 ? .2 : w < 1100 ? .65 : 1;
  }
  resize(); on(window, 'resize', resize);
  on(window, 'pointermove', e => { S.tmx = e.clientX / innerWidth * 2 - 1; S.tmy = e.clientY / innerHeight * 2 - 1; }, {passive: true});
  on(document, 'visibilitychange', () => { visible = !document.hidden; if (visible) loop(); });

  function frame(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now; T += reduce ? dt * .25 : dt;
    S.mx += (S.tmx - S.mx) * .05; S.my += (S.tmy - S.my) * .05;
    const mob = innerWidth < 760, mobileLift = mob ? 2.5 : 0;

    camera.position.set(S.mx * .5, S.camY - S.my * .3, S.camZ);
    camera.lookAt(0, S.camY * .5, 0);

    hero.position.set(S.hx * xf, S.hy + (S.hx > 2 ? mobileLift : 0), S.hz);
    hero.scale.setScalar(S.hs * (mob ? .55 : 1));
    crystal.rotation.set(.18 + S.my * .12, T * (.12 + S.spin * .1) + S.mx * .35, -.12);

    [cU, chainU, shardU].forEach(u => { u.uTime.value = T; u.uIntro.value = S.intro; });
    cU.uFlash.value = S.flash; chainU.uFlash.value = S.flash * .6;
    edgeMat.opacity = .2 * S.intro;
    shardU.uSeg.value = S.seg;
    bgMat.uniforms.uTime.value = T; bgMat.uniforms.uMood.value = S.mood; bgMat.uniforms.uScroll.value = S.scroll;
    bgMat.uniforms.uMouse.value.set(S.mx, S.my);
    snowMat.uniforms.uTime.value = T; snowMat.uniforms.uScroll.value = S.scroll;

    // chain helix
    const pos = linkGeo.attributes.position.array;
    for (let k = 0; k < N; k++) {
      const u = k + S.chainOff, a = u * .44 + T * (.18 + S.spin * .15);
      v3.set(Math.cos(a) * 2.25, 1.95 - u * .17, Math.sin(a) * 2.25);
      const fade = Math.max(0, 1 - u / N) * S.chain * S.intro;
      const sc = (k === 0 ? S.pop : 1) * (.55 + .45 * fade) * (fade > .01 ? 1 : 0);
      e3.set(T * .3 + k, T * .4 + k * .7, 0); q4.setFromEuler(e3); s3.setScalar(sc);
      cubes.setMatrixAt(k, m4.compose(v3, q4, s3));
      if (k > 0) { pos.set([prev.x, prev.y, prev.z, v3.x, v3.y, v3.z], (k - 1) * 6); }
      prev.copy(v3);
    }
    cubes.instanceMatrix.needsUpdate = true; linkGeo.attributes.position.needsUpdate = true;
    linkMat.opacity = .22 * S.chain * S.intro;

    // shards: scatter <-> ring
    hero.getWorldPosition(hp);
    for (let i = 0; i < M; i++) {
      const d = sd[i];
      const th = d.th + T * d.sp, r = d.r;
      const sx = hp.x * .5 + r * Math.sin(d.ph) * Math.cos(th), sy = r * Math.cos(d.ph) * .5, sz = -5.5 + r * Math.sin(d.ph) * Math.sin(th) * .45;
      let m = Math.min(1, Math.max(0, S.shard * 1.5 - d.delay * .5)); m = m * m * (3 - 2 * m);
      const ra = d.ring + T * .08;
      v3.set(Math.cos(ra) * 2.35, Math.sin(ra) * 2.35, 0).applyMatrix4(tilt);
      v3.x += S.rx * xf; v3.y += S.ry + mobileLift; v3.z += S.rz - (mob ? 7 : 0);
      v3.set(sx + (v3.x - sx) * m, sy + (v3.y - sy) * m, sz + (v3.z - sz) * m);
      const hl = S.seg === segOf[i] ? 1.35 : 1;
      e3.set(d.rot.x + T * .5, d.rot.y + T * .3, d.rot.z); q4.setFromEuler(e3);
      s3.set(1, 1.6, 1).multiplyScalar((.55 + m * .65) * hl * S.intro);
      shards.setMatrixAt(i, m4.compose(v3, q4, s3));
    }
    shards.instanceMatrix.needsUpdate = true;

    // comet path: from lower left into the crystal centre
    cometMat.uniforms.uVis.value = S.cometVis;
    if (S.cometVis > .01) {
      const p0 = new THREE.Vector3(-11 * Math.max(xf, .5), -3.2, 3.5), p1 = new THREE.Vector3(-2, 3, 2.5);
      for (let i = 0; i < CK; i++) {
        const t = Math.max(0, S.comet - i * .0032);
        cp.set(0, 0, 0).addScaledVector(p0, (1 - t) * (1 - t)).addScaledVector(p1, 2 * (1 - t) * t).addScaledVector(hp, t * t);
        cpos.set([cp.x + Math.sin(T * 9 + i) * .02 * i / CK, cp.y, cp.z], i * 3);
      }
      cometGeo.attributes.position.needsUpdate = true;
    }
    if ((fc++ & 1) === 0) { renderer.setRenderTarget(bgRT); renderer.render(bgScene, camera); renderer.setRenderTarget(null); }
    renderer.render(scene, camera);
    // adaptive quality: step resolution down while frames are slow
    acc += dt; if (fc % 90 === 0) { if (acc / 90 > .021 && PR > .75) { PR = Math.max(.75, PR - .25); renderer.setPixelRatio(PR); snowMat.uniforms.uPR.value = cometMat.uniforms.uPR.value = PR; resize(); } acc = 0; }
  }
  function loop() {
    cancelAnimationFrame(raf);
    const step = now => { if (!alive || !visible) return; frame(now); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
  }
  loop();

  /* ---------- live data bits ---------- */
  let headTime = blocks[0]?.time || Date.now();
  const agoTxt = ms => { const s = Math.max(0, (Date.now() - ms) / 1000 | 0); return s < 2 ? 'just now' : s < 60 ? s + 's ago' : s < 3600 ? (s / 60 | 0) + 'm ago' : (s / 3600 | 0) + 'h ago'; };
  const shortH = h => h.slice(0, 6) + '…' + h.slice(-4);
  const track = $('.lx-track');
  function renderSlabs() {
    track.innerHTML = blocks.map((b, i) => `<a class="lx-slab${i === 0 ? ' fresh' : ''}" href="#/block/${b.height}">
      <small>${i === 0 ? 'Latest block' : 'Block'} <span data-ago="${b.time}">${agoTxt(b.time)}</span></small>
      <div class="h">#${b.height.toLocaleString('en-US')}</div>
      <dl><dt>Transactions</dt><dd>${b.txs}</dd><dt>Reward</dt><dd>${fmt(b.reward, 3)}</dd><dt>Hash</dt><dd>${esc(shortH(b.hash))}</dd></dl></a>`).join('')
      + `<a class="lx-slab more" href="#/explorer"><b>Every block<br>in the explorer</b>${ARROW}</a>`;
  }
  renderSlabs();
  const tickAgo = setInterval(() => {
    root.querySelector('[data-l="ago"]').textContent = agoTxt(headTime);
    $$('[data-ago]').forEach(el => el.textContent = agoTxt(+el.dataset.ago));
  }, 1000);
  cleanups.push(() => clearInterval(tickAgo));

  /* ---------- names checker ---------- */
  const form = $('.lx-check'), res = $('.lx-res');
  on(form, 'submit', async e => {
    e.preventDefault();
    const n = form.n.value.trim().toLowerCase().replace(/\.yuki$/, '');
    if (!n) return form.n.focus();
    res.textContent = 'Checking…';
    try {
      const d = await get('/name/' + encodeURIComponent(n));
      res.innerHTML = d.available
        ? `<span class="ok">${esc(d.name)}.yuki is free.</span> ${fmt(d.price, 0)} YUKI for a year. <a href="#/wallet">Register it</a>`
        : `<span class="no">${esc(d.name)}.yuki is taken.</span> <a href="#/name/${esc(d.name)}">See who owns it</a>`;
    } catch (err) { res.innerHTML = `<span class="no">${esc(err.message)}</span>`; }
  });

  /* ---------- live terminal ---------- */
  const pre = $('.lx-term pre');
  const idle = `<span class="c"># read the chain</span>
<span class="k">GET</span>  /api/status
<span class="k">GET</span>  /api/account/<span class="s">vasya.yuki</span>
<span class="k">GET</span>  /api/blocks?limit=20
<span class="k">GET</span>  /api/stream     <span class="c"># live blocks</span>

<span class="c"># write to it</span>
<span class="k">POST</span> /api/tx         <span class="c"># signed transfer</span>

<span class="c"># or from a terminal</span>
$ yukid send -key me.key -to <span class="s">vasya.yuki</span> -amount <span class="s">12.5</span>`;
  pre.innerHTML = idle;
  let typing = 0;
  on($('[data-try]'), 'click', async () => {
    clearInterval(typing);
    pre.innerHTML = `$ curl https://chain.yukichat.lol/api/status\n<span class="lx-caret"></span>`;
    let txt;
    try { txt = JSON.stringify(await get('/status'), null, 2); } catch (e) { txt = 'error: ' + e.message; }
    let i = 0;
    typing = setInterval(() => {
      i = Math.min(txt.length, i + (reduce ? txt.length : 9));
      pre.innerHTML = `$ curl https://chain.yukichat.lol/api/status\n${esc(txt.slice(0, i)).replace(/"([^"]+)":/g, '<span class="k">"$1"</span>:')}<span class="lx-caret"></span>`;
      if (i >= txt.length) clearInterval(typing);
    }, 16);
  });
  cleanups.push(() => clearInterval(typing));

  /* ---------- allocation highlight (synced with the 3D ring) ---------- */
  const rows = $$('.lx-alloc li');
  let autoSeg = 0, manual = 0, segTimer = 0;
  const setSeg = i => { S.seg = i; rows.forEach((r, k) => r.classList.toggle('on', k === i)); };
  rows.forEach((r, i) => { on(r, 'pointerenter', () => { manual = Date.now(); setSeg(i); }); });
  on($('.lx-alloc'), 'pointerleave', () => { manual = 0; });

  /* ---------- names morph ---------- */
  const morph = $('.lx-morph');
  function renderMorph(p) {
    if (p <= .02) { morph.innerHTML = `<span>${ADDR}</span>`; return; }
    if (p >= .97) { morph.innerHTML = `<span class="ok">vasya</span><span class="tl">.yuki</span>`; return; }
    const L = Math.round(ADDR.length + (NAME.length - ADDR.length) * Math.min(1, p * 1.25));
    let h = '';
    for (let i = 0; i < L; i++) {
      const done = i < NAME.length && p > .15 + i / NAME.length * .75;
      const ch = done ? NAME[i] : B32[(Math.random() * 32) | 0];
      h += done ? `<span class="${i >= 5 ? 'tl' : 'ok'}">${ch}</span>` : ch;
    }
    morph.innerHTML = h;
  }

  /* ---------- motion ---------- */
  const gctx = gsap.context(() => {});
  let lenis = null, tick = null, master = null, masterST = null;
  if (reduce) {
    renderMorph(1); $('.lx-count').textContent = '1,000,000,000'; setSeg(0);
    $$('.lx-words .w').forEach(w => w.style.opacity = 1);
  } else {
    lenis = new Lenis({lerp: .11, smoothWheel: true}); window.__lenis = lenis;
    lenis.on('scroll', ScrollTrigger.update);
    tick = t => lenis.raf(t * 1000); gsap.ticker.add(tick); gsap.ticker.lagSmoothing(0);

    gctx.add(() => {
      // intro: crystal freezes into existence, headline rises
      const intro = gsap.timeline({delay: .15});
      intro.to(S, {intro: 1, duration: 2.6, ease: 'power2.inOut'}, 0)
        .from('.lx-h1 .ln>span', {yPercent: 115, duration: 1.4, ease: 'expo.out', stagger: .12}, .35)
        .from('[data-in]', {y: 22, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: .1}, .8);

      // split headings into masked words
      $$('[data-split]').forEach(h => {
        h.innerHTML = h.textContent.split(' ').map(w => `<span style="display:inline-block;overflow:hidden;padding-bottom:.1em;margin-bottom:-.1em;vertical-align:top"><span class="wd" style="display:inline-block">${w}</span></span>`).join(' ');
        gsap.from(h.querySelectorAll('.wd'), {yPercent: 110, duration: 1.2, ease: 'expo.out', stagger: .05, scrollTrigger: {trigger: h, start: 'top 85%'}});
      });
      $$('[data-rv]').forEach(el => gsap.from(el, {y: 40, opacity: 0, duration: 1.2, ease: 'expo.out', scrollTrigger: {trigger: el, start: 'top 90%'}}));

      // freeze sequence
      const words = $$('.lx-words .w'), steps = $$('.lx-steps p'), bars = $$('.lx-prog i');
      gsap.set(words.slice(1).map(w => w.querySelectorAll('.c')), {yPercent: 110});
      let cur = 0;
      const show = i => {
        if (i === cur) return;
        gsap.to(words[cur].querySelectorAll('.c'), {yPercent: i > cur ? -110 : 110, duration: .5, ease: 'power3.in', stagger: .018, overwrite: true});
        gsap.fromTo(words[i].querySelectorAll('.c'), {yPercent: i > cur ? 110 : -110}, {yPercent: 0, duration: .9, ease: 'expo.out', stagger: .025, delay: .15, overwrite: true});
        steps.forEach((p, k) => p.classList.toggle('on', k === i));
        if (i === 2 && cur === 1) gsap.fromTo(S, {flash: 1}, {flash: 0, duration: 1.4, ease: 'expo.out'});
        cur = i;
      };
      ScrollTrigger.create({trigger: '.lx-freeze', start: 'top top', end: 'bottom bottom', onUpdate: self => {
        const p = self.progress;
        show(p < .34 ? 0 : p < .67 ? 1 : 2);
        bars.forEach((b, k) => gsap.set(b, {scaleX: Math.min(1, Math.max(0, p * 3 - k))}));
        S.comet = Math.min(1, Math.max(0, (p - .3) / .4));
        S.cometVis = p > .05 && p < .95 && S.comet < .995 ? Math.min(1, (p - .05) * 8) : 0;
      }});

      // live chain: horizontal pan
      const dist = () => Math.max(0, track.scrollWidth - innerWidth);
      gsap.to(track, {x: () => -dist(), ease: 'none', scrollTrigger: {trigger: '.lx-chain', start: 'top top', end: () => '+=' + dist(), pin: true, scrub: 1, invalidateOnRefresh: true}});

      // genesis counter
      const cnt = {v: 0}, countEl = $('.lx-count');
      gsap.to(cnt, {v: 1e9, ease: 'none', scrollTrigger: {trigger: countEl, start: 'top 88%', end: 'top 40%', scrub: 1}, onUpdate: () => countEl.textContent = Math.round(cnt.v).toLocaleString('en-US')});
      ScrollTrigger.create({trigger: '.lx-coin', start: 'top 60%', end: 'bottom 40%', onToggle: self => {
        clearInterval(segTimer);
        if (self.isActive) { setSeg(autoSeg); segTimer = setInterval(() => { if (Date.now() - manual > 3500) { autoSeg = (autoSeg + 1) % SEGS.length; setSeg(autoSeg); } }, 2200); }
        else setSeg(-1);
      }});
      cleanups.push(() => clearInterval(segTimer));

      // name morph
      ScrollTrigger.create({trigger: morph, start: 'top 85%', end: 'top 30%', scrub: true, onUpdate: s => renderMorph(s.progress)});

      // roadmap line
      gsap.to('.lx-line .fill', {scaleX: 1, ease: 'none', scrollTrigger: {trigger: '.lx-line', start: 'top 75%', end: 'bottom 60%', scrub: 1}});

      // magnetic buttons
      if (matchMedia('(pointer:fine)').matches) $$('[data-mag]').forEach(b => {
        const qx = gsap.quickTo(b, 'x', {duration: .5, ease: 'power3.out'}), qy = gsap.quickTo(b, 'y', {duration: .5, ease: 'power3.out'});
        on(b, 'pointermove', e => { const r = b.getBoundingClientRect(); qx((e.clientX - r.left - r.width / 2) * .22); qy((e.clientY - r.top - r.height / 2) * .3); });
        on(b, 'pointerleave', () => { qx(0); qy(0); });
      });

      // scroll velocity feeds the snow and aurora drift
      ScrollTrigger.create({start: 0, end: 'max', onUpdate: s => { S.scroll = s.progress * 4; }});
    }, root);

    // camera choreography: one timeline across the whole page, rebuilt after layout changes
    const buildMaster = () => {
      master?.kill(); masterST?.kill();
      const total = ScrollTrigger.maxScroll(window), vh = innerHeight;
      master = gsap.timeline({paused: true});
      $$('[data-pose]').forEach((el, i) => {
        if (!i) return;
        const top = el.getBoundingClientRect().top + scrollY;
        const at = Math.min(Math.max(0, top - vh * .95), total), dur = Math.min(vh * .85, Math.max(1, total - at));
        master.to(S, {...POSES[el.dataset.pose], duration: dur, ease: 'sine.inOut'}, at);
      });
      master.set({}, {}, Math.max(total, master.duration()));
      masterST = ScrollTrigger.create({start: 0, end: () => master.duration(), scrub: 1, animation: master});
    };
    const onRefresh = () => buildMaster();
    document.fonts?.ready.then(() => { if (alive) ScrollTrigger.refresh(); });
    ScrollTrigger.addEventListener('refresh', onRefresh);
    cleanups.push(() => ScrollTrigger.removeEventListener('refresh', onRefresh));
    ScrollTrigger.refresh();
  }

  /* ---------- api for the router ---------- */
  function live(m) {
    const b = m.block, s = m.status;
    headTime = b.time;
    const liveEl = $('.lx-live'); liveEl.querySelector('[data-l="h"]').textContent = '#' + b.height.toLocaleString('en-US');
    liveEl.classList.remove('tick'); void liveEl.offsetWidth; liveEl.classList.add('tick');
    root.querySelector('[data-l="supply"]').textContent = fmt(s.supply, 0);
    root.querySelector('[data-l="burned"]').textContent = fmt(s.burned, 2);
    blocks.unshift(b); blocks.length = 9; renderSlabs();
    if (!reduce) {
      gsap.fromTo(S, {chainOff: 1}, {chainOff: 0, duration: 1.4, ease: 'expo.out'});
      gsap.fromTo(S, {pop: 0}, {pop: 1, duration: 1.1, ease: 'back.out(2.2)'});
      gsap.fromTo(S, {flash: .55}, {flash: 0, duration: 1.2, ease: 'expo.out'});
    }
  }
  function unmount() {
    alive = false; cancelAnimationFrame(raf);
    cleanups.forEach(f => f());
    gctx.revert(); master?.kill(); masterST?.kill();
    if (tick) gsap.ticker.remove(tick);
    lenis?.destroy();
    ScrollTrigger.getAll().forEach(t => t.kill());
    scene.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); bg.geometry.dispose(); bgMat.dispose(); bgRT.dispose();
    renderer.dispose(); renderer.forceContextLoss();
  }
  return {live, unmount};
}
