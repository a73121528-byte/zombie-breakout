import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

// ============================================================================
// Procedural character kit: rounded parts (capsules / lathes / ellipsoids) are
// baked per-bone into ONE vertex-coloured mesh each, so a whole zombie is only
// ~12 draw calls. Rigs are built once per type/variant and then cloned.
// ============================================================================
const GC = new Map();
const cached = (k, fn) => { let g = GC.get(k); if (!g) { g = fn(); GC.set(k, g); } return g; };
const V2 = pts => pts.map(p => new THREE.Vector2(p[0], p[1]));
const GEO = {
  cap: (r, len, rs = 8) => cached(`cap${r}_${len}_${rs}`, () => new THREE.CapsuleGeometry(r, len, 3, rs)),
  sph: (w = 12, h = 9) => cached(`sph${w}_${h}`, () => new THREE.SphereGeometry(1, w, h)),
  sphPart: (ts, tl, w = 14, h = 9) => cached(`sp${ts}_${tl}_${w}`, () => new THREE.SphereGeometry(1, w, h, 0, Math.PI * 2, ts, tl)),
  box: () => cached('box', () => new THREE.BoxGeometry(1, 1, 1)),
  cyl: (rt, rb, s = 10, open = false) => cached(`cyl${rt}_${rb}_${s}_${open}`, () => new THREE.CylinderGeometry(rt, rb, 1, s, 1, open)),
  cone: (s = 6) => cached(`cone${s}`, () => new THREE.ConeGeometry(1, 1, s)),
  torus: (r, t, a = Math.PI * 2, rs = 5, ts = 14) => cached(`tor${r}_${t}_${a}_${rs}_${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts, a)),
  lathe: (key, pts, segs = 12, ps = 0, pl = Math.PI * 2) => cached('lat' + key, () => new THREE.LatheGeometry(V2(pts), segs, ps, pl)),
};
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _c = new THREE.Color();

// ============================================================================
// v0.4 character detail atlas (1024², 4×4 cells of 256²). Cells are mostly
// white so they MULTIPLY the per-part vertex colours: skin mottling, veins,
// bruises, wounds, cloth weave/grime/blood, leather grain, hair strands and
// per-type zombie faces. The same texture doubles as a bump map on mid/high.
// ============================================================================
const CELL = { skin: 0, wound: 1, cloth: 2, clothB: 3, leather: 4, plain: 5, bone: 6, hair: 7, fwalker: 8, frunner: 9, fbrute: 10, fspitter: 11, farmored: 12, flesh: 13, metal: 14, hskin: 15 };
const INS = 5 / 1024, CS = 0.25 - 2 * INS;
function cellUV(geo, cell) {
  const uv = geo.attributes.uv; if (!uv) return;
  const cx = cell % 4, cy = cell / 4 | 0, u0 = cx / 4 + INS, v0 = 1 - (cy + 1) / 4 + INS;
  const a = uv.array;
  for (let i = 0; i < a.length; i += 2) { a[i] = u0 + Math.min(1, Math.max(0, a[i])) * CS; a[i + 1] = v0 + Math.min(1, Math.max(0, a[i + 1])) * CS; }
  uv.needsUpdate = true;
}
let ATL = null;
export function getCharAtlas() {
  if (ATL) return ATL;
  const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 1024, 1024);
  let s = 99; const R = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const cell = (i, fn) => { const x = (i % 4) * 256, y = (i / 4 | 0) * 256; g.save(); g.beginPath(); g.rect(x, y, 256, 256); g.clip(); g.translate(x, y); fn(); g.restore(); };
  const blot = (n, rgb, a0, a1, r0, r1) => { for (let i = 0; i < n; i++) { const x = R() * 256, y = R() * 256, r = r0 + R() * (r1 - r0); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${rgb},${a0 + R() * (a1 - a0)})`); gr.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); } };
  const speck = (n, rgb, a, sz = 1.5) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${rgb},${a * R()})`; g.fillRect(R() * 256, R() * 256, sz, sz); } };
  const vein = (x, y, ang, len, w, col) => { g.strokeStyle = col; g.lineCap = 'round'; const step = (x, y, a, l, w) => { g.lineWidth = w; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < l; k++) { a += (R() - 0.5) * 0.8; x += Math.cos(a) * 5; y += Math.sin(a) * 5; g.lineTo(x, y); if (R() < 0.13 && w > 0.6 && l - k > 3) { g.stroke(); step(x, y, a + (R() < 0.5 ? 0.9 : -0.9), (l - k) * 0.6 | 0, w * 0.6); g.lineWidth = w; g.beginPath(); g.moveTo(x, y); } } g.stroke(); }; step(x, y, ang, len, w); };
  const gash = (x, y, l, w, ang) => {
    g.save(); g.translate(x, y); g.rotate(ang);
    g.fillStyle = 'rgba(120,40,40,.45)'; g.beginPath(); g.ellipse(0, 0, l * 0.62, w * 1.9, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(70,4,6,.95)'; g.beginPath(); g.ellipse(0, 0, l / 2, w, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(30,0,2,.95)'; g.beginPath(); g.ellipse(0, 0, l * 0.4, w * 0.4, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(200,140,140,.5)'; for (let k = 0; k < 5; k++) g.fillRect(-l * 0.4 + k * l * 0.2, -w * 0.6, 1.5, w * 1.2); g.restore();
    g.fillStyle = 'rgba(80,4,6,.7)'; for (let k = 0; k < 3; k++) { const dx = x + (R() - 0.5) * l * 0.6; g.fillRect(dx, y, 1.6, 8 + R() * 26); }
  };
  const skinBase = (bruise = 1) => {
    blot(40, '150,150,140', 0.12, 0.3, 10, 40); blot(18, '255,255,250', 0.2, 0.4, 8, 30);
    blot(6 * bruise, '80,40,90', 0.25, 0.45, 12, 30); blot(4 * bruise, '120,110,40', 0.15, 0.3, 10, 24);
    for (let i = 0; i < 10; i++) vein(R() * 256, R() * 256, R() * 7, 8 + R() * 14 | 0, 1.6, 'rgba(50,30,70,.42)');
    speck(500, '60,50,50', 0.4);
  };
  cell(CELL.skin, () => skinBase(1));
  cell(CELL.wound, () => { skinBase(1.5); for (let i = 0; i < 4; i++) gash(30 + R() * 196, 30 + R() * 180, 30 + R() * 40, 4 + R() * 5, (R() - 0.5) * 1.4); speck(300, '90,0,0', 0.7, 2); });
  const clothBase = (blood) => {
    g.strokeStyle = 'rgba(0,0,0,.07)'; g.lineWidth = 1; for (let y = 0; y < 256; y += 3) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); } for (let x = 0; x < 256; x += 3) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
    const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(60,50,40,0)'); gr.addColorStop(1, 'rgba(60,50,40,.35)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    blot(30, '90,80,60', 0.15, 0.35, 8, 34);
    blot(blood, '90,6,8', 0.5, 0.85, 6, 26);
    for (let i = 0; i < blood; i++) { g.fillStyle = 'rgba(80,4,6,.6)'; g.fillRect(R() * 256, R() * 256, 2, 10 + R() * 30); }
    speck(400, '30,25,20', 0.5);
  };
  cell(CELL.cloth, () => clothBase(6));
  cell(CELL.clothB, () => { clothBase(16); g.fillStyle = 'rgba(15,10,10,.85)'; for (let i = 0; i < 6; i++) { g.beginPath(); const x = R() * 256, y = R() * 256; g.moveTo(x, y); for (let k = 0; k < 7; k++) g.lineTo(x + (R() - 0.5) * 40, y + (R() - 0.5) * 30); g.fill(); } });
  cell(CELL.leather, () => {
    blot(60, '0,0,0', 0.03, 0.08, 6, 20); speck(2600, '0,0,0', 0.18, 1.2); speck(900, '255,255,255', 0.5, 1);
    g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 1.2; for (let i = 0; i < 26; i++) { g.beginPath(); const x = R() * 256, y = R() * 256; g.moveTo(x, y); g.quadraticCurveTo(x + 10, y + (R() - .5) * 8, x + 18 + R() * 20, y + (R() - .5) * 10); g.stroke(); }
  });
  cell(CELL.plain, () => { speck(1500, '0,0,0', 0.12, 1.2); });
  cell(CELL.bone, () => { g.fillStyle = 'rgba(200,190,160,.35)'; g.fillRect(0, 0, 256, 256); blot(20, '120,100,70', 0.2, 0.4, 6, 20); for (let i = 0; i < 8; i++) vein(R() * 256, R() * 256, R() * 7, 6, 1, 'rgba(60,40,30,.55)'); });
  cell(CELL.hair, () => {
    for (let i = 0; i < 260; i++) { const x = R() * 256, v = R(); g.strokeStyle = v < 0.5 ? `rgba(0,0,0,${0.15 + R() * 0.3})` : `rgba(255,255,255,${0.2 + R() * 0.4})`; g.lineWidth = 0.8 + R() * 1.6; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + (R() - 0.5) * 10, 90, x + (R() - 0.5) * 10, 170, x + (R() - 0.5) * 8, 256); g.stroke(); }
    const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(0,0,0,.18)'); gr.addColorStop(0.5, 'rgba(255,255,255,.1)'); gr.addColorStop(1, 'rgba(0,0,0,.12)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  });
  // zombie faces: head sphere UVs (u wraps, front of face at u=.25 → x≈64; eyes at y≈117)
  const zface = (type) => {
    skinBase(type === 'armored' ? 2 : 1);
    const fx = 64, ey = 117;
    // scalp shading / back of head mottling
    g.fillStyle = 'rgba(40,30,30,.18)'; g.fillRect(0, 0, 256, 50);
    for (const s of [-1, 1]) { // sunken sockets
      const x = fx + s * 16; const gr = g.createRadialGradient(x, ey, 1, x, ey, 15); gr.addColorStop(0, 'rgba(10,0,0,.95)'); gr.addColorStop(0.55, 'rgba(40,10,20,.75)'); gr.addColorStop(1, 'rgba(60,30,50,0)'); g.fillStyle = gr; g.fillRect(x - 16, ey - 16, 32, 32);
      g.strokeStyle = 'rgba(30,10,20,.5)'; g.lineWidth = 1.2; g.beginPath(); g.arc(x, ey + 4, 11, 0.3, 2.8); g.stroke();
    }
    g.fillStyle = 'rgba(20,0,0,.9)'; g.beginPath(); g.moveTo(fx - 4, ey + 26); g.lineTo(fx + 4, ey + 26); g.lineTo(fx, ey + 14); g.fill(); // nose cavity
    for (let i = 0; i < 6; i++) vein(fx + (R() - 0.5) * 50, ey - 30 + R() * 20, -1.6 + (R() - 0.5), 6, 1.3, 'rgba(40,20,60,.6)');
    // cracked lips line
    g.fillStyle = 'rgba(40,0,4,.85)'; g.fillRect(fx - 14, ey + 38, 28, 4);
    if (type === 'walker') { gash(fx + 22, ey + 30, 26, 5, 0.3); g.fillStyle = 'rgba(235,225,190,.95)'; for (let k = 0; k < 5; k++) g.fillRect(fx + 13 + k * 4, ey + 29 + (k % 2), 2.5, 4); }
    if (type === 'runner') { g.fillStyle = 'rgba(110,0,0,.85)'; for (const s of [-1, 1]) for (let k = 0; k < 2; k++) g.fillRect(fx + s * 16 + k * 3 - 2, ey + 6, 1.8, 26 + R() * 18); gash(fx - 10, ey - 30, 30, 4, -0.4); }
    if (type === 'brute') { g.strokeStyle = 'rgba(40,10,10,.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo(fx - 30, ey - 40); g.lineTo(fx + 26, ey + 10); g.stroke(); g.lineWidth = 1.2; for (let k = 0; k < 9; k++) { const t = k / 8, x = fx - 30 + 56 * t, y = ey - 40 + 50 * t; g.beginPath(); g.moveTo(x - 4, y + 4); g.lineTo(x + 4, y - 4); g.stroke(); } gash(fx - 24, ey + 26, 20, 4, 1.0); }
    if (type === 'spitter') { for (let i = 0; i < 12; i++) vein(fx + (R() - 0.5) * 40, ey + 40, -1.57 + (R() - 0.5) * 1.6, 9, 2, 'rgba(60,150,30,.7)'); blot(6, '120,170,40', 0.4, 0.6, 6, 14); }
    if (type === 'armored') { gash(fx + 4, ey - 34, 30, 4, 0.1); g.fillStyle = 'rgba(80,4,6,.7)'; for (let k = 0; k < 4; k++) g.fillRect(fx - 6 + k * 5, ey - 30, 1.6, 40 + R() * 20); }
    // back-of-head wound / hair loss
    gash(192, 60 + R() * 60, 26, 4, R());
  };
  cell(CELL.fwalker, () => zface('walker')); cell(CELL.frunner, () => zface('runner')); cell(CELL.fbrute, () => zface('brute'));
  cell(CELL.fspitter, () => zface('spitter')); cell(CELL.farmored, () => zface('armored'));
  cell(CELL.flesh, () => {
    g.fillStyle = 'rgba(200,120,120,.25)'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(90,10,20,.45)'; g.lineWidth = 2; for (let i = 0; i < 60; i++) { const x = R() * 256, y = R() * 256; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 10, y + 30, x + (R() - 0.5) * 12, y + 60); g.stroke(); }
    for (let i = 0; i < 18; i++) vein(R() * 256, R() * 256, R() * 7, 12, 2.2, 'rgba(40,10,50,.6)');
    for (let i = 0; i < 26; i++) { const x = R() * 256, y = R() * 256, r = 3 + R() * 9; const gr = g.createRadialGradient(x - r * .3, y - r * .3, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,200,.9)'); gr.addColorStop(0.6, 'rgba(200,190,90,.7)'); gr.addColorStop(1, 'rgba(90,40,20,.6)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    for (let i = 0; i < 5; i++) gash(R() * 256, R() * 256, 30, 5, R() * 3);
  });
  cell(CELL.metal, () => { speck(1200, '0,0,0', 0.2); g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 0.8; for (let i = 0; i < 70; i++) { const x = R() * 256, y = R() * 256; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 30, y + (R() - 0.5) * 8); g.stroke(); } blot(10, '60,40,20', 0.2, 0.4, 8, 20); });
  cell(CELL.hskin, () => { blot(30, '255,240,240', 0.2, 0.4, 10, 40); speck(500, '160,120,120', 0.08); });
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 2;
  const bump = new THREE.CanvasTexture(c); bump.anisotropy = 1;
  ATL = { map, bump, canvas: c }; return ATL;
}
// face decal for 星璃: drawn on a partial sphere patch that hugs the front of the head
const FACE = { phiLen: 2.2, thS: 0.55, thL: 1.75 };
let heroFace = null;
export function getHeroFaceTex() {
  if (heroFace) return heroFace;
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  const ey = 131, ex = 45;
  // soft cheek blush + under-eye shading
  for (const s of [-1, 1]) {
    const gr = g.createRadialGradient(128 + s * 58, 176, 2, 128 + s * 58, 176, 26); gr.addColorStop(0, 'rgba(230,120,130,.35)'); gr.addColorStop(1, 'rgba(230,120,130,0)'); g.fillStyle = gr; g.fillRect(128 + s * 58 - 30, 146, 60, 60);
  }
  for (const s of [-1, 1]) {
    const x = 128 + s * ex;
    g.save(); g.translate(x, ey); g.rotate(s * -0.06);
    // eye socket shadow / lid crease
    g.fillStyle = 'rgba(120,70,90,.22)'; g.beginPath(); g.ellipse(0, -5, 20, 12, 0, Math.PI, 0); g.fill();
    // sclera (almond)
    g.fillStyle = '#f6eff2'; g.beginPath(); g.moveTo(-16, 1); g.quadraticCurveTo(-4, -11, 15, -3); g.quadraticCurveTo(6, 9, -16, 1); g.fill();
    g.save(); g.clip();
    const ir = g.createRadialGradient(1, -1, 1, 1, -1, 9); ir.addColorStop(0, '#c08ef0'); ir.addColorStop(0.55, '#7440b8'); ir.addColorStop(1, '#2a1048'); g.fillStyle = ir; g.beginPath(); g.arc(1, -1, 8.5, 0, 7); g.fill();
    g.fillStyle = '#12061e'; g.beginPath(); g.arc(1, -1, 3.6, 0, 7); g.fill();
    g.fillStyle = 'rgba(40,10,60,.55)'; g.fillRect(-16, -12, 32, 6); // upper lid shadow
    g.restore();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(-2.5, -4.5, 2.4, 0, 7); g.fill(); g.beginPath(); g.arc(4, 2, 1.1, 0, 7); g.fill();
    // lashes: thick upper line with a flick at the outer corner
    g.strokeStyle = '#140a1c'; g.lineCap = 'round'; g.lineWidth = 3.2; g.beginPath(); g.moveTo(-17, 1.5); g.quadraticCurveTo(-4, -12.5, 16, -3.5); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.moveTo(14 * 1, -3); g.lineTo(20, -7); g.stroke();
    g.lineWidth = 1; g.strokeStyle = 'rgba(40,20,40,.6)'; g.beginPath(); g.moveTo(-12, 4); g.quadraticCurveTo(2, 9, 13, 0); g.stroke();
    g.restore();
    // brows: slim, slightly angled (determined)
    g.save(); g.translate(128 + s * (ex + 2), 99); g.scale(s, 1);
    g.fillStyle = '#3a1f4c'; g.beginPath(); g.moveTo(-17, 4); g.quadraticCurveTo(0, -5, 19, 1); g.quadraticCurveTo(0, -1, -17, 7); g.fill();
    g.restore();
  }
  // nose: soft shadow + tip highlight
  g.fillStyle = 'rgba(150,90,90,.35)'; g.beginPath(); g.ellipse(128, 170, 7, 2.5, 0, 0, 7); g.fill();
  g.strokeStyle = 'rgba(140,90,90,.25)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(122, 140); g.quadraticCurveTo(120, 158, 124, 166); g.stroke();
  // lips
  const ly = 211;
  g.fillStyle = '#b25a68'; g.beginPath(); g.moveTo(112, ly); g.quadraticCurveTo(120, ly - 7, 128, ly - 4); g.quadraticCurveTo(136, ly - 7, 144, ly); g.quadraticCurveTo(128, ly + 2, 112, ly); g.fill();
  g.fillStyle = '#c86a78'; g.beginPath(); g.moveTo(113, ly + 0.5); g.quadraticCurveTo(128, ly + 12, 143, ly + 0.5); g.quadraticCurveTo(128, ly + 3, 113, ly + 0.5); g.fill();
  g.strokeStyle = '#5a2030'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(111, ly); g.quadraticCurveTo(128, ly + 3, 145, ly); g.stroke();
  g.fillStyle = 'rgba(255,255,255,.45)'; g.beginPath(); g.ellipse(131, ly + 5, 5, 1.5, 0, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2;
  heroFace = t; return t;
}

class Kit {
  constructor(rng = Math.random) { this.lists = new Map(); this.rng = rng; }
  // add(parent, geo, color, [x,y,z], [sx,sy,sz], [rx,ry,rz], jitter)
  add(parent, geo, color, p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0], jit = 0.04) {
    const g = geo.clone();
    if (!g.index) { const n0 = g.attributes.position.count, ix = new Uint16Array(n0); for (let i = 0; i < n0; i++) ix[i] = i; g.setIndex(new THREE.BufferAttribute(ix, 1)); }
    const cell = this.nextCell !== undefined ? this.nextCell : (this.cellOf ? this.cellOf(color) : -1); this.nextCell = undefined;
    if (cell >= 0) cellUV(g, cell);
    _m.compose(_p.set(p[0], p[1], p[2]), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s.set(s[0], s[1], s[2]));
    g.applyMatrix4(_m);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    _c.set(color); const k = 1 + (this.rng() - 0.5) * jit * 2;
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r * k; col[i * 3 + 1] = _c.g * k; col[i * 3 + 2] = _c.b * k; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!this.lists.has(parent)) this.lists.set(parent, []);
    this.lists.get(parent).push(g);
    return this;
  }
  t(cell) { this.nextCell = cell; return this; }
  build(mat, cast = true) {
    const out = [];
    for (const [parent, list] of this.lists) {
      const geo = mergeGeometries(list, false); list.forEach(g => g.dispose());
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.userData.cast = cast; parent.add(m); out.push(m);
    }
    this.lists.clear();
    return out;
  }
}
function grp(parent, name, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.name = name || ''; g.position.set(x, y, z); parent.add(g); return g; }
function seeded(s) { return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

// soft round glow texture for eye / sac / core halos
let glowTex = null;
export function getGlowTex() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c); glowTex.colorSpace = THREE.SRGBColorSpace; return glowTex;
}
function glowSprite(color, size, opacity = 0.8) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTex(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
  s.scale.setScalar(size); s.userData.glow = true; return s;
}

// ============================================================================
// HEROINE 星璃 — black hooded leather long coat with bronze trim, long purple
// hair in a ponytail with a star ornament, machete.
// ============================================================================
const HC = {
  coat: 0x1d1a22, coatHi: 0x2a2630, inner: 0x34303c, pants: 0x221f28, boot: 0x0f0e12, bronze: 0x9a6232, bronzeHi: 0xc08040,
  skin: 0xe8d4c8, lip: 0xa0545c, eye: 0x2a1838, hair: 0x5a2f8c, hairHi: 0x8452c4, hairDk: 0x3a1c60, glove: 0x16141a, belt: 0x2c1c14, strap: 0x24180f,
};
export function buildHeroine() {
  const A = getCharAtlas();
  const leather = new THREE.MeshPhongMaterial({ vertexColors: true, map: A.map, shininess: 38, specular: 0x2a2630, emissive: 0x050308 });
  const coatSide = new THREE.MeshPhongMaterial({ vertexColors: true, map: A.map, shininess: 30, specular: 0x222026, side: THREE.DoubleSide, emissive: 0x050308 });
  leather.userData.bumpable = coatSide.userData.bumpable = 0.6;
  const kit = new Kit(seeded(7)), skirtKit = new Kit(seeded(9));
  const LEATHER = new Set([HC.coat, HC.coatHi, HC.inner, HC.pants, HC.boot, HC.glove, HC.belt, HC.strap, 0x0a090c, 0x060606]);
  const HAIR = new Set([HC.hair, HC.hairHi, HC.hairDk]);
  kit.cellOf = skirtKit.cellOf = col => LEATHER.has(col) ? CELL.leather : HAIR.has(col) ? CELL.hair : col === HC.skin ? CELL.hskin : (col === HC.bronze || col === HC.bronzeHi) ? CELL.metal : CELL.plain;
  const root = new THREE.Group();
  const body = grp(root, 'body', 0, 0.95, 0);
  const R = { root, body };
  // ---- legs: slim trousers, tall laced boots with bronze toe caps and straps
  for (const s of [1, -1]) {
    const leg = grp(body, '', 0.09 * s, -0.04, 0);
    kit.add(leg, GEO.cap(0.07, 0.3, 10), HC.pants, [0, -0.2, 0], [1, 1, 1.05]);
    kit.add(leg, GEO.cyl(0.074, 0.074, 12, true), HC.strap, [0, -0.17, 0], [1, 0.03, 1.08]);           // thigh strap
    if (s < 0) { kit.add(leg, GEO.box(), HC.strap, [-0.06, -0.2, 0.0], [0.03, 0.14, 0.07]); kit.add(leg, GEO.box(), HC.bronze, [-0.077, -0.2, 0], [0.006, 0.03, 0.03]); }
    kit.add(leg, GEO.sph(), HC.pants, [0, -0.43, 0.02], [0.062, 0.05, 0.06]);                         // knee
    const shin = grp(leg, '', 0, -0.43, 0);
    kit.add(shin, GEO.cap(0.06, 0.3, 10), HC.boot, [0, -0.2, 0]);
    kit.add(shin, GEO.cyl(0.072, 0.066, 12, true), HC.boot, [0, -0.05, 0], [1, 0.1, 1.06]);            // boot cuff
    kit.add(shin, GEO.cyl(0.074, 0.074, 12, true), HC.bronze, [0, -0.002, 0], [1, 0.012, 1.08]);
    for (let k = 0; k < 4; k++) kit.add(shin, GEO.box(), HC.coatHi, [0, -0.11 - k * 0.055, 0.058], [0.05, 0.007, 0.012], [0, 0, (k % 2 ? 0.25 : -0.25)]); // laces
    for (const yy of [-0.16, -0.3]) { kit.add(shin, GEO.cyl(0.066, 0.064, 12, true), HC.strap, [0, yy, 0], [1, 0.02, 1.06]); kit.add(shin, GEO.box(), HC.bronzeHi, [0.064 * s, yy, 0.01], [0.012, 0.022, 0.024]); }
    kit.add(shin, GEO.sph(14, 9), HC.boot, [0, -0.44, 0.045], [0.06, 0.05, 0.13]);
    kit.add(shin, GEO.sphPart(0, 1.4, 12, 6), HC.bronze, [0, -0.445, 0.115], [0.05, 0.04, 0.05], [Math.PI / 2, 0, 0]); // toe cap
    kit.add(shin, GEO.box(), 0x060606, [0, -0.49, 0.04], [0.112, 0.03, 0.25]);
    kit.add(shin, GEO.box(), 0x060606, [0, -0.47, -0.06], [0.1, 0.05, 0.06]); // heel
    R[s > 0 ? 'legL' : 'legR'] = leg; R[s > 0 ? 'shinL' : 'shinR'] = shin;
  }
  // ---- long coat skirt in two layers (open at front), double-sided so it can flutter
  const skirtPivot = grp(body, 'skirt', 0, 0.04, 0); R.skirt = skirtPivot;
  const skirtProf = [[0.155, 0.02], [0.175, -0.12], [0.215, -0.34], [0.26, -0.6], [0.278, -0.7]];
  skirtKit.add(skirtPivot, GEO.lathe('skirt2', skirtProf, 20, 0.55, Math.PI * 2 - 1.1), HC.coat, [0, 0, 0], [1, 1, 0.82]);
  skirtKit.add(skirtPivot, GEO.lathe('hem2', [[0.274, -0.63], [0.282, -0.71]], 20, 0.55, Math.PI * 2 - 1.1), HC.bronze, [0, 0, 0], [1.01, 1, 0.83]);
  skirtKit.add(skirtPivot, GEO.lathe('skirtO', [[0.165, 0.0], [0.19, -0.12], [0.235, -0.3], [0.255, -0.38]], 20, 0.85, Math.PI * 2 - 1.7), HC.coatHi, [0, 0, 0], [1.04, 1, 0.86]); // outer tail layer
  skirtKit.add(skirtPivot, GEO.lathe('hemO', [[0.252, -0.35], [0.258, -0.39]], 20, 0.85, Math.PI * 2 - 1.7), HC.bronze, [0, 0, 0], [1.045, 1, 0.865]);
  skirtKit.add(skirtPivot, GEO.box(), HC.coatHi, [0, -0.42, -0.214], [0.012, 0.56, 0.01]); // back slit fold
  // ---- torso
  const torso = grp(body, 'torso', 0, 0, 0); R.torso = torso;
  kit.add(torso, GEO.sph(), HC.pants, [0, 0.0, 0], [0.15, 0.1, 0.11]);
  const torsoProf = [[0.001, -0.02], [0.142, -0.01], [0.146, 0.08], [0.124, 0.19], [0.146, 0.31], [0.164, 0.4], [0.16, 0.47], [0.115, 0.53], [0.06, 0.56], [0.001, 0.565]];
  kit.add(torso, GEO.lathe('htorso2', torsoProf, 18), HC.coat, [0, 0, 0], [1, 1, 0.72]);
  kit.add(torso, GEO.sph(), HC.inner, [0, 0.36, 0.088], [0.055, 0.15, 0.03]);
  kit.add(torso, GEO.box(), HC.bronze, [0, 0.43, 0.112], [0.012, 0.012, 0.01]);   // inner clasp
  // belts: waist belt + slung hip belt with pouches
  kit.add(torso, GEO.cyl(0.15, 0.15, 18, true), HC.belt, [0, 0.085, 0], [1, 0.045, 0.75]);
  kit.add(torso, GEO.box(), HC.bronzeHi, [0, 0.085, 0.11], [0.05, 0.038, 0.012]);
  kit.add(torso, GEO.box(), HC.belt, [0, 0.085, 0.117], [0.026, 0.016, 0.004]);
  kit.add(torso, GEO.cyl(0.158, 0.158, 18, true), HC.strap, [0, 0.0, 0], [1, 0.035, 0.76], [0, 0, 0.12]);
  for (const [px, pz, ry] of [[0.12, 0.07, 0.6], [-0.135, 0.04, -0.9], [0.0, -0.118, 0]]) { kit.add(torso, GEO.box(), HC.belt, [px, 0.0 + px * 0.12, pz], [0.05, 0.065, 0.032], [0, ry, 0]); kit.add(torso, GEO.box(), HC.bronze, [px * 1.04, 0.025 + px * 0.12, pz * 1.1], [0.02, 0.01, 0.005], [0, ry, 0]); }
  for (const s of [1, -1]) {
    kit.add(torso, GEO.box(), HC.bronze, [0.045 * s, 0.3, 0.112], [0.014, 0.42, 0.01], [0.06, 0, -0.16 * s]); // lapel trim
    kit.add(torso, GEO.box(), HC.coatHi, [0.07 * s, 0.33, 0.108], [0.05, 0.34, 0.012], [0.06, 0, -0.2 * s]);
    kit.add(torso, GEO.box(), HC.coatHi, [0.1 * s, 0.25, 0.1], [0.04, 0.05, 0.012], [0, 0.4 * s, 0]);       // chest pocket flap
    kit.add(torso, GEO.sph(), HC.coat, [0.156 * s, 0.47, 0], [0.078, 0.064, 0.082]);
    kit.add(torso, GEO.box(), HC.coatHi, [0.165 * s, 0.515, 0], [0.085, 0.012, 0.06], [0, 0, 0.32 * s]); // epaulette
    kit.add(torso, GEO.box(), HC.bronze, [0.2 * s, 0.505, 0], [0.012, 0.016, 0.03], [0, 0, 0.32 * s]);
    // diagonal back harness strap holding the machete sheath
    kit.add(torso, GEO.box(), HC.strap, [0.02 * s, 0.32, -0.112], [0.03, 0.42, 0.01], [-0.1, 0, 0.7 * s]);
  }
  // shoulder capelet (layered) + standing collar + hood
  skirtKit.add(torso, GEO.lathe('cape', [[0.1, 0.545], [0.17, 0.5], [0.2, 0.43], [0.215, 0.36]], 18, 0.75, Math.PI * 2 - 1.5), HC.coat, [0, 0, 0], [1.02, 1, 0.82]);
  skirtKit.add(torso, GEO.lathe('capeH', [[0.212, 0.37], [0.218, 0.35]], 18, 0.75, Math.PI * 2 - 1.5), HC.bronze, [0, 0, 0], [1.02, 1, 0.82]);
  kit.add(torso, GEO.cyl(0.082, 0.1, 16, true), HC.coat, [0, 0.575, -0.008], [1, 0.08, 0.95]);
  kit.add(torso, GEO.cyl(0.084, 0.084, 16, true), HC.bronze, [0, 0.615, -0.008], [1, 0.006, 0.95]);
  kit.add(torso, GEO.sph(), HC.coat, [0, 0.5, -0.12], [0.14, 0.125, 0.075], [0.3, 0, 0]);
  kit.add(torso, GEO.sph(), 0x0a090c, [0, 0.52, -0.1], [0.108, 0.088, 0.04], [0.3, 0, 0]);
  kit.add(torso, GEO.torus(0.124, 0.007, Math.PI), HC.bronze, [0, 0.52, -0.105], [1.05, 0.85, 1], [0.3 - Math.PI / 2, 0, 0]);
  kit.add(torso, starGeo(), HC.bronzeHi, [0, 0.2, -0.112], [0.035, 0.035, 0.02], [0, Math.PI, 0]);  // bronze star emblem, lower back
  kit.add(torso, GEO.torus(0.045, 0.004), HC.bronze, [0, 0.2, -0.113], [1, 1, 1], [0, 0, 0]);
  const holster = grp(torso, 'holster', -0.07, 0.46, -0.135); holster.rotation.set(Math.PI / 2, 0, 0.55, 'ZYX'); R.holster = holster;
  // ---- head
  const head = grp(torso, 'head', 0, 0.555, 0.005); R.head = head;
  kit.add(head, GEO.cap(0.037, 0.06, 10), HC.skin, [0, 0.045, 0]);
  kit.add(head, GEO.sph(20, 14), HC.skin, [0, 0.175, 0.012], [0.094, 0.114, 0.102]);
  kit.add(head, GEO.sph(14, 10), HC.skin, [0, 0.125, 0.03], [0.06, 0.05, 0.062]);       // jaw (inside the face patch)
  kit.add(head, GEO.sph(), HC.skin, [0, 0.163, 0.108], [0.011, 0.015, 0.013]);      // nose
  for (const s of [1, -1]) kit.add(head, GEO.sph(), HC.skin, [0.093 * s, 0.17, 0.0], [0.012, 0.024, 0.016]); // ears
  // face decal patch (eyes, brows, lips)
  const faceMat = new THREE.MeshPhongMaterial({ map: getHeroFaceTex(), transparent: true, depthWrite: false, shininess: 38, specular: 0x2a2630, emissive: 0x050308 });
  const face = new THREE.Mesh(cached('heroFace', () => new THREE.SphereGeometry(1, 20, 14, Math.PI / 2 - FACE.phiLen / 2, FACE.phiLen, FACE.thS, FACE.thL)), faceMat);
  face.position.set(0, 0.175, 0.012); face.scale.set(0.094 * 1.012, 0.114 * 1.012, 0.102 * 1.012); face.renderOrder = 1; face.userData.cast = false; head.add(face);
  // hair: cap + layered back strands + two rows of bangs + side locks
  kit.add(head, GEO.sphPart(0, 1.95, 18, 10), HC.hair, [0, 0.188, -0.004], [0.106, 0.124, 0.116], [-0.5, 0, 0]);
  kit.add(head, GEO.sph(14, 10), HC.hairDk, [0, 0.16, -0.05], [0.1, 0.12, 0.08]);
  for (let i = 0; i < 13; i++) { // back layer: strands from the crown to the nape
    const a = Math.PI * (0.55 + i / 12 * 0.9), cx = Math.sin(a) * 0.088, cz = Math.cos(a) * 0.088 - 0.01;
    kit.add(head, GEO.cap(0.019, 0.13, 5), [HC.hair, HC.hairHi, HC.hairDk][i % 3], [cx, 0.12, cz], [1.25, 1, 0.6], [-Math.cos(a) * 0.32, a, -Math.sin(a) * 0.12]);
  }
  for (let i = 0; i < 7; i++) { // bangs, back row (longer)
    const x = -0.07 + i * 0.0233;
    kit.add(head, GEO.cap(0.018, 0.085, 5), i % 2 ? HC.hair : HC.hairDk, [x, 0.222, 0.082 - Math.abs(x) * 0.3], [1.25, 1, 0.55], [-0.4, 0, (x > 0 ? 1 : -1) * 0.22 + (i - 3) * 0.03]);
  }
  for (let i = 0; i < 6; i++) { // bangs, front row (short, highlighted)
    const x = -0.058 + i * 0.023;
    kit.add(head, GEO.cap(0.014, 0.06, 5), i % 2 ? HC.hairHi : HC.hair, [x + 0.006, 0.245, 0.094 - Math.abs(x) * 0.3], [1.2, 1, 0.5], [-0.62, 0, (x > 0 ? 1 : -1) * 0.3 + (i - 2.5) * 0.05]);
  }
  for (const s of [1, -1]) { // face-framing locks (two layers)
    kit.add(head, GEO.cap(0.02, 0.2, 5), HC.hair, [0.086 * s, 0.11, 0.055], [1, 1, 0.6], [0.1, 0, 0.06 * s]);
    kit.add(head, GEO.cap(0.016, 0.13, 5), HC.hairHi, [0.072 * s, 0.02, 0.064], [1, 1, 0.6], [0.2, 0, 0.12 * s]);
    kit.add(head, GEO.cap(0.017, 0.16, 5), HC.hairDk, [0.095 * s, 0.1, 0.02], [1, 1, 0.6], [0.05, 0, 0.1 * s]);
  }
  kit.add(head, GEO.torus(0.032, 0.011), HC.bronzeHi, [0, 0.26, -0.105], [1, 1, 1], [1.2, 0, 0]);
  const star = new THREE.Mesh(starGeo(), new THREE.MeshLambertMaterial({ color: 0xffd36a, emissive: 0x8a5a10 }));
  star.position.set(-0.088, 0.262, 0.025); star.rotation.set(0, -1.2, 0.3); star.scale.setScalar(0.035); head.add(star);
  const starGlow = glowSprite(0xffc860, 0.12, 0.5); starGlow.position.copy(star.position); head.add(starGlow);
  // ponytail chain (3 segments, spring-animated in main), each a bundle of strands
  const pony = []; let parent = head;
  const segLen = [0.2, 0.22, 0.22], segR = [0.05, 0.045, 0.032];
  for (let i = 0; i < 3; i++) {
    const g = grp(parent, 'pony' + i, 0, i === 0 ? 0.26 : -segLen[i - 1], i === 0 ? -0.12 : 0);
    kit.add(g, GEO.cap(segR[i], segLen[i] - segR[i], 8), HC.hair, [0, -segLen[i] / 2, 0], [1.15, 1, 0.75]);
    for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2 + i; kit.add(g, GEO.cap(segR[i] * 0.42, segLen[i] * 0.85, 5), k === 0 ? HC.hairHi : k === 1 ? HC.hairDk : HC.hair, [Math.cos(a) * segR[i] * 0.7, -segLen[i] / 2 - 0.01, Math.sin(a) * segR[i] * 0.5], [1, 1, 1], [Math.sin(a) * 0.1, 0, Math.cos(a) * 0.12]); }
    pony.push(g); parent = g;
  }
  kit.add(pony[2], GEO.cone(6), HC.hairDk, [0, -0.25, 0], [0.026, 0.09, 0.02], [Math.PI, 0, 0]);
  kit.add(pony[2], GEO.cone(5), HC.hairHi, [0.015, -0.24, 0.005], [0.014, 0.07, 0.012], [Math.PI, 0, 0.2]);
  pony[0].rotation.x = 0.35; R.pony = pony; R.hair = pony[0]; R.hairTip = pony[1];
  // ---- arms: sleeves with folds, bronze cuffs, gloves with knuckle plates
  for (const s of [1, -1]) {
    const arm = grp(torso, '', 0.183 * s, 0.47, 0); arm.rotation.order = 'YXZ';
    kit.add(arm, GEO.cap(0.05, 0.19, 10), HC.coat, [0, -0.13, 0]);
    kit.add(arm, GEO.cyl(0.054, 0.054, 12, true), HC.coatHi, [0, -0.2, 0], [1, 0.02, 1]);
    const fore = grp(arm, '', 0, -0.275, 0);
    kit.add(fore, GEO.cap(0.044, 0.17, 10), HC.coat, [0, -0.11, 0]);
    kit.add(fore, GEO.cyl(0.056, 0.05, 12, true), HC.coat, [0, -0.175, 0], [1, 0.06, 1]);           // flared cuff
    kit.add(fore, GEO.cyl(0.057, 0.057, 12, true), HC.bronze, [0, -0.207, 0], [1, 0.012, 1]);
    kit.add(fore, GEO.cyl(0.04, 0.036, 10, true), HC.glove, [0, -0.215, 0], [1, 0.04, 1]);
    kit.add(fore, GEO.sph(), HC.glove, [0, -0.255, 0.008], [0.036, 0.048, 0.032]);
    kit.add(fore, GEO.box(), HC.bronze, [0, -0.262, 0.036], [0.05, 0.022, 0.008]);                     // knuckle plate
    for (let f = 0; f < 3; f++) kit.add(fore, GEO.cap(0.009, 0.025, 4), HC.glove, [-0.017 + f * 0.017, -0.29, 0.02], [1, 1, 1], [0.4, 0, 0]);
    kit.add(fore, GEO.cap(0.012, 0.03, 4), HC.glove, [0, -0.25, 0.036], [1, 1, 1], [0.9, 0, 0]);
    R[s > 0 ? 'armL' : 'armR'] = arm; R[s > 0 ? 'foreL' : 'foreR'] = fore;
  }
  // ---- machete
  const weapon = grp(R.foreR, 'weapon', 0, -0.27, 0.012); R.weapon = weapon;
  weapon.add(buildMachete());
  const holstered = buildMachete(); holstered.scale.setScalar(0.95); R.holster.add(holstered); R.holster.visible = false;
  R.gunMount = grp(R.foreR, 'gunMount', 0, -0.265, 0.01);
  kit.build(leather); skirtKit.build(coatSide);
  R.mats = { coat: leather, coatSide, star: star.material, face: faceMat };
  R.star = star;
  return R;
}
function starGeo() {
  return cached('star', () => {
    const sh = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 0.42 : 1; if (i) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r); else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false }); g.translate(0, 0, -0.15); return g;
  });
}
const bladeMat = new THREE.MeshPhongMaterial({ color: 0xa9adb5, specular: 0xffffff, shininess: 90, emissive: 0x111114 });
const handleMat = new THREE.MeshLambertMaterial({ color: 0x2b1a12 });
const bloodMat = new THREE.MeshLambertMaterial({ color: 0x4a0408 });
function buildMachete() {
  const g = new THREE.Group();
  const bladeGeo = cached('blade', () => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.018); s.lineTo(0.42, -0.03); s.quadraticCurveTo(0.56, -0.03, 0.6, 0.03); s.lineTo(0.5, 0.052); s.lineTo(0, 0.03); s.lineTo(0, -0.018);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.007, bevelEnabled: false }); geo.translate(0, 0, -0.0035); geo.rotateY(-Math.PI / 2); geo.translate(0, 0, 0.075); return geo;
  });
  const blade = new THREE.Mesh(bladeGeo, bladeMat); g.add(blade); blade.castShadow = true;
  const handle = new THREE.Mesh(GEO.cyl(0.016, 0.018, 8), handleMat); handle.scale.y = 0.14; handle.rotation.x = Math.PI / 2; handle.position.z = -0.0; g.add(handle);
  const guard = new THREE.Mesh(GEO.box(), handleMat); guard.scale.set(0.02, 0.07, 0.015); guard.position.set(0, 0.005, 0.07); g.add(guard);
  const smear = new THREE.Mesh(GEO.box(), bloodMat); smear.scale.set(0.009, 0.035, 0.2); smear.position.set(0, -0.005, 0.38); g.add(smear);
  return g;
}

// ============================================================================
// GUNS (barrel along +z, grip at origin). Attachments are child meshes that are
// toggled visible when equipped.
// ============================================================================
const GM = {
  metal: new THREE.MeshPhongMaterial({ color: 0x24252a, specular: 0x555560, shininess: 60 }),
  metal2: new THREE.MeshPhongMaterial({ color: 0x3c3d44, specular: 0x666670, shininess: 50 }),
  wood: new THREE.MeshLambertMaterial({ color: 0x5a3420 }),
  poly: new THREE.MeshLambertMaterial({ color: 0x1a1a1d }),
  tan: new THREE.MeshLambertMaterial({ color: 0x6a5a40 }),
  lens: new THREE.MeshBasicMaterial({ color: 0x4060ff }),
  red: new THREE.MeshBasicMaterial({ color: 0xff3020 }),
  orange: new THREE.MeshLambertMaterial({ color: 0xc86420, emissive: 0x401800 }),
  brass: new THREE.MeshPhongMaterial({ color: 0xc89a40, shininess: 80 }),
};
function bx(p, mat, sx, sy, sz, x, y, z, rx = 0) { const m = new THREE.Mesh(GEO.box(), mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.rotation.x = rx; p.add(m); return m; }
function cz(p, mat, r, len, x, y, z, s = 10) { const m = new THREE.Mesh(GEO.cyl(1, 1, s), mat); m.scale.set(r, len, r); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); p.add(m); return m; }
export function buildGuns() {
  const guns = {};
  // ---- pistol
  {
    const g = new THREE.Group(), A = {};
    bx(g, GM.metal, 0.03, 0.034, 0.18, 0, 0.045, 0.055);
    bx(g, GM.poly, 0.028, 0.022, 0.15, 0, 0.022, 0.05);
    bx(g, GM.poly, 0.027, 0.095, 0.042, 0, -0.02, -0.005, 0.22);
    bx(g, GM.poly, 0.008, 0.025, 0.035, 0, 0.003, 0.04);
    A.extMag = bx(g, GM.metal2, 0.025, 0.05, 0.036, 0, -0.085, -0.02, 0.22);
    A.speed = bx(g, GM.orange, 0.03, 0.012, 0.03, 0, -0.065, -0.017, 0.22);
    A.scope = new THREE.Group(); g.add(A.scope); bx(A.scope, GM.poly, 0.026, 0.024, 0.04, 0, 0.074, 0.03); bx(A.scope, GM.lens, 0.018, 0.016, 0.003, 0, 0.076, 0.051);
    A.suppressor = cz(g, GM.metal2, 0.016, 0.12, 0, 0.046, 0.205);
    A.stabilizer = cz(g, GM.metal2, 0.019, 0.035, 0, 0.046, 0.158);
    A.ap = bx(g, GM.red, 0.031, 0.006, 0.03, 0, 0.035, 0.11);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.046, 0.15); g.add(muzzle);
    guns.pistol = { g, A, muzzle, baseMuzzle: 0.15, supLen: 0.12 };
  }
  // ---- shotgun (pump)
  {
    const g = new THREE.Group(), A = {};
    bx(g, GM.metal, 0.042, 0.06, 0.2, 0, 0.035, 0.07);
    cz(g, GM.metal, 0.013, 0.46, 0, 0.055, 0.39);
    cz(g, GM.metal2, 0.011, 0.36, 0, 0.03, 0.33);
    bx(g, GM.wood, 0.046, 0.04, 0.14, 0, 0.03, 0.32);
    bx(g, GM.wood, 0.034, 0.075, 0.05, 0, -0.03, 0.0, 0.35);
    bx(g, GM.wood, 0.04, 0.07, 0.26, 0, -0.005, -0.15, -0.12);
    bx(g, GM.poly, 0.042, 0.08, 0.02, 0, -0.01, -0.28, -0.12);
    A.extMag = cz(g, GM.metal2, 0.012, 0.12, 0, 0.03, 0.56);
    A.speed = new THREE.Group(); g.add(A.speed); for (let i = 0; i < 4; i++) { const sh = cz(A.speed, GM.red, 0.008, 0.03, 0.024, 0.035, 0.03 + i * 0.022); sh.rotation.set(0, 0, 0); sh.rotation.x = 0; }
    A.scope = new THREE.Group(); g.add(A.scope); bx(A.scope, GM.poly, 0.02, 0.03, 0.05, 0, 0.08, 0.1); bx(A.scope, GM.lens, 0.012, 0.012, 0.003, 0, 0.088, 0.126);
    A.suppressor = cz(g, GM.metal2, 0.02, 0.14, 0, 0.055, 0.69);
    A.stabilizer = bx(g, GM.poly, 0.025, 0.06, 0.03, 0, -0.012, 0.32);
    A.ap = bx(g, GM.red, 0.044, 0.008, 0.04, 0, 0.068, 0.07);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.055, 0.62); g.add(muzzle);
    guns.shotgun = { g, A, muzzle, baseMuzzle: 0.62, supLen: 0.14 };
  }
  // ---- rifle
  {
    const g = new THREE.Group(), A = {};
    bx(g, GM.metal, 0.038, 0.055, 0.24, 0, 0.04, 0.07);
    bx(g, GM.poly, 0.044, 0.05, 0.2, 0, 0.045, 0.28);
    cz(g, GM.metal, 0.009, 0.16, 0, 0.05, 0.45);
    bx(g, GM.metal, 0.012, 0.015, 0.22, 0, 0.075, 0.18);
    bx(g, GM.poly, 0.03, 0.08, 0.04, 0, -0.02, 0.0, 0.3);
    const mag = bx(g, GM.metal2, 0.026, 0.11, 0.045, 0, -0.03, 0.13, -0.18);
    bx(g, GM.poly, 0.035, 0.06, 0.2, 0, 0.025, -0.14);
    bx(g, GM.poly, 0.04, 0.085, 0.03, 0, 0.012, -0.24);
    A.extMag = bx(g, GM.metal2, 0.03, 0.07, 0.07, 0, -0.12, 0.14, -0.18);
    A.speed = bx(g, GM.orange, 0.03, 0.012, 0.03, 0, -0.07, 0.135, -0.18);
    A.scope = new THREE.Group(); g.add(A.scope); cz(A.scope, GM.poly, 0.018, 0.16, 0, 0.105, 0.14); cz(A.scope, GM.lens, 0.014, 0.004, 0, 0.105, 0.222); bx(A.scope, GM.poly, 0.012, 0.02, 0.03, 0, 0.088, 0.14);
    A.suppressor = cz(g, GM.metal2, 0.018, 0.15, 0, 0.05, 0.6);
    A.stabilizer = new THREE.Group(); g.add(A.stabilizer); bx(A.stabilizer, GM.poly, 0.02, 0.06, 0.025, 0, -0.008, 0.3); cz(A.stabilizer, GM.metal2, 0.013, 0.04, 0, 0.05, 0.545);
    A.ap = bx(g, GM.red, 0.04, 0.008, 0.04, 0, 0.073, 0.03);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.05, 0.53); g.add(muzzle);
    guns.rifle = { g, A, muzzle, baseMuzzle: 0.53, supLen: 0.15, mag };
  }
  for (const k in guns) {
    guns[k].g.traverse(o => { if (o.isMesh) o.castShadow = false; });
    for (const a in guns[k].A) guns[k].A[a].visible = false;
    guns[k].g.visible = false;
  }
  return guns;
}

// ============================================================================
// ZOMBIES
// ============================================================================
const ZSTYLE = {
  walker: { skin: [0x6a7262, 0x74745e, 0x64705c], cloth: [0x3a4658, 0x4a3a2c, 0x45454a, 0x5a2a2a, 0x3e4a32], pants: [0x2a2c34, 0x3a3226, 0x26262a], eye: 0xe8dca0, bulk: 1, thin: 1, hunch: 0.38 },
  runner: { skin: [0x7a6660, 0x72645a], cloth: [0x6a1a1e, 0x2a3a5a, 0x5a5a20], pants: [0x1e1e24, 0x2a2a30], eye: 0xff4a30, bulk: 0.86, thin: 0.78, hunch: 0.6 },
  brute: { skin: [0x62625a, 0x6a5e54], cloth: [0x3a3634, 0x2c3238], pants: [0x22232a], eye: 0xffa040, bulk: 1.5, thin: 1.3, hunch: 0.34 },
  spitter: { skin: [0x66764e, 0x5c6c4c], cloth: [0x3c3e34, 0x4a4436], pants: [0x2a2c26], eye: 0x9cff60, bulk: 1.05, thin: 0.95, hunch: 0.24 },
  armored: { skin: [0x6a6e62], cloth: [0x1e2638], pants: [0x1a2030], eye: 0xff3a2a, bulk: 1.1, thin: 1.05, hunch: 0.15 },
};
const BLOOD = 0x5e080c, BLOOD2 = 0x2e0306, BONE = 0xc4b8a0, MOUTH = 0x1a0606, TEETH = 0xd0c8a8, RAW = 0x6a1e22;
const zTemplates = new Map();
export function buildZombie(type, variant = (Math.random() * 3) | 0) {
  const key = type + variant;
  let T = zTemplates.get(key);
  if (!T) { T = makeZombieTemplate(type, variant); zTemplates.set(key, T); }
  return instantiate(T, type);
}
const BONES = ['body', 'torso', 'head', 'legL', 'legR', 'shinL', 'shinR', 'armL', 'armR', 'foreL', 'foreR', 'smallL', 'smallR', 'core', 'sac', 'jaw', 'shield', 'sacCore'];
let charBump = false;
export function setCharDetail(on) { charBump = on; }
export function applyCharBump(mats, on) { const A = getCharAtlas(); for (const m of mats) if (m.userData && m.userData.bumpable) { const want = on ? A.bump : null; if (m.bumpMap !== want) { m.bumpMap = want; m.bumpScale = m.userData.bumpable; m.needsUpdate = true; } } }
function instantiate(T, type) {
  const root = T.root.clone(true);
  const matMap = new Map(), mats = [], glows = [];
  root.traverse(o => {
    if (!o.material) return;
    let m = matMap.get(o.material);
    if (!m) { m = o.material.clone(); matMap.set(o.material, m); mats.push(m); }
    o.material = m;
    if (o.userData.glow) glows.push(o);
  });
  applyCharBump(mats, charBump);
  const R = { root, type, hunch: T.hunch, mats, glows, limp: T.limp, headTilt: T.headTilt || 0, lean: T.lean || 0 };
  for (const b of BONES) { const o = root.getObjectByName(b); if (o) R[b] = o; }
  R.sacMat = T.sacMat ? matMap.get(T.sacMat) : null;
  R.coreMat = T.coreMat ? matMap.get(T.coreMat) : null;
  R.veinMat = T.veinMat ? matMap.get(T.veinMat) : null;
  return R;
}
let crackTex = null;
function visorCrackTex() {
  if (crackTex) return crackTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,1)'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(40,40,40,1)'; g.lineWidth = 1.2;
  const cx = 78, cy = 52;
  for (let i = 0; i < 14; i++) { const a = i / 14 * 6.28 + Math.random() * 0.3; let x = cx, y = cy; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += Math.cos(a + (Math.random() - 0.5) * 0.5) * 9; y += Math.sin(a + (Math.random() - 0.5) * 0.5) * 9; g.lineTo(x, y); } g.stroke(); }
  for (let r = 6; r < 30; r += 8) { g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke(); }
  g.fillStyle = 'rgba(60,8,8,1)'; for (let i = 0; i < 9; i++) g.fillRect(20 + Math.random() * 80, 60 + Math.random() * 50, 3, 3 + Math.random() * 8);
  crackTex = new THREE.CanvasTexture(c); crackTex.colorSpace = THREE.SRGBColorSpace; return crackTex;
}
function makeZombieTemplate(type, variant) {
  const S = ZSTYLE[type], rng = seeded(101 + variant * 977 + type.length * 31);
  const pick = a => a[(rng() * a.length) | 0];
  const skin = pick(S.skin), cloth = pick(S.cloth), pants = pick(S.pants), cloth2 = pick(S.cloth);
  const A = getCharAtlas();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: A.map, emissive: 0x000000 }); mat.userData.bumpable = 1.2;
  const eyeMat = new THREE.MeshBasicMaterial({ color: S.eye });
  const kit = new Kit(rng), eyeKit = new Kit(rng);
  const bloody = rng() < 0.5;
  const CLOTHS = new Set([cloth, pants, cloth2]);
  kit.cellOf = col => col === skin ? CELL.skin : (col === BLOOD || col === BLOOD2 || col === RAW) ? CELL.wound : CLOTHS.has(col) ? (bloody ? CELL.clothB : CELL.cloth) : (col === BONE || col === TEETH) ? CELL.bone : CELL.plain;
  const root = new THREE.Group();
  const body = grp(root, 'body', 0, 0.92, 0);
  const b = S.bulk, t = S.thin;
  const T = { root, hunch: S.hunch, limp: rng() < 0.5 ? 1 : -1, headTilt: (rng() - 0.5) * 0.5, lean: (rng() - 0.5) * 0.18 };
  const bareFoot = rng() < 0.5;
  // ---- legs
  for (const s of [1, -1]) {
    const leg = grp(body, s > 0 ? 'legL' : 'legR', 0.1 * s * b, -0.03, 0);
    kit.add(leg, GEO.cap(0.072 * t, 0.29), pants, [0, -0.2, 0]);
    if (rng() < 0.6) { kit.add(leg, GEO.sph(9, 6), skin, [0.02 * s, -0.3, 0.062 * t], [0.04, 0.07, 0.02]); kit.t(CELL.wound).add(leg, GEO.sph(9, 6), RAW, [0.02 * s, -0.31, 0.066 * t], [0.022, 0.04, 0.012]); }
    const shin = grp(leg, s > 0 ? 'shinL' : 'shinR', 0, -0.43, 0);
    const torn = s < 0 && type !== 'armored' && rng() < 0.7;
    kit.add(shin, GEO.cap(0.06 * t, 0.29), torn ? skin : pants, [0, -0.2, 0]);
    if (torn) { kit.add(shin, GEO.cyl(0.07 * t, 0.066 * t, 8, true), pants, [0, -0.03, 0], [1, 0.08, 1]); for (let k = 0; k < 3; k++) kit.add(shin, GEO.box(), pants, [Math.cos(k * 2) * 0.05, -0.09, Math.sin(k * 2) * 0.05], [0.03, 0.08 + rng() * 0.05, 0.006], [0, k * 2, 0]); }
    if (type === 'armored') kit.add(shin, GEO.sph(9, 6), 0x121418, [0, -0.04, 0.05], [0.055, 0.07, 0.04]);
    const foot = bareFoot && s > 0 ? skin : (type === 'armored' ? 0x0c0c0e : 0x1c1814);
    kit.add(shin, GEO.sph(9, 6), foot, [0, -0.44, 0.045], [0.06, 0.048, 0.12]);
    if (bareFoot && s > 0) kit.add(shin, GEO.sph(9, 6), BLOOD, [0, -0.46, 0.1], [0.04, 0.02, 0.04]);
  }
  // ---- torso (asymmetric: twisted + leaning)
  const torso = grp(body, 'torso', 0, 0, 0); torso.rotation.x = S.hunch; torso.rotation.z = T.lean;
  kit.add(torso, GEO.sph(9, 6), pants, [0, 0, 0], [0.15 * b, 0.1, 0.11 * b]);
  const prof = type === 'brute'
    ? [[0.001, -0.02], [0.16, -0.01], [0.19, 0.1], [0.2, 0.22], [0.2, 0.34], [0.22, 0.44], [0.2, 0.52], [0.12, 0.58], [0.001, 0.6]]
    : [[0.001, -0.02], [0.142, -0.01], [0.145, 0.1], [0.135, 0.22], [0.155, 0.34], [0.168, 0.43], [0.158, 0.5], [0.1, 0.56], [0.001, 0.57]];
  const tz = (type === 'brute' ? 0.85 : 0.72) * b, tx = b * (type === 'brute' ? 1.05 : 1);
  kit.add(torso, GEO.lathe('ztorso' + (type === 'brute'), prof, 14), cloth, [0, 0, 0], [tx, 1, tz]);
  // wounds / bites on the torso
  for (let i = 0; i < 3; i++) {
    const a = (rng() - 0.5) * 2.4, y = 0.12 + rng() * 0.32, rr = 0.152 * b;
    kit.add(torso, GEO.sph(9, 6), skin, [Math.sin(a) * rr * tx / b, y, Math.cos(a) * rr * 0.72], [0.045 + rng() * 0.04, 0.045 + rng() * 0.05, 0.02], [0, a, 0]);
    kit.t(CELL.wound).add(torso, GEO.sph(9, 6), RAW, [Math.sin(a) * (rr + 0.006) * tx / b, y, Math.cos(a) * (rr + 0.006) * 0.72], [0.022, 0.03, 0.012], [0, a, 0]);
  }
  if (type !== 'armored') {
    kit.add(torso, GEO.sph(9, 6), BLOOD2, [0.03, 0.4, 0.11 * b], [0.07, 0.09, 0.02]);
    // torn-open flank: dark cavity with exposed ribs
    const side = rng() < 0.5 ? 1 : -1, ribA = side > 0 ? 0.35 : Math.PI / 2 + 0.35;
    kit.add(torso, GEO.sph(9, 6), MOUTH, [0.085 * side * b, 0.3, 0.075 * b], [0.055 * b, 0.1, 0.045], [0, side * 0.8, 0]);
    kit.t(CELL.wound).add(torso, GEO.sph(9, 6), RAW, [0.088 * side * b, 0.3, 0.078 * b], [0.07 * b, 0.12, 0.03], [0, side * 0.8, 0]);
    for (let i = 0; i < 4; i++) kit.add(torso, GEO.torus(0.15, 0.0075, Math.PI * 0.42, 4, 8), BONE, [0, 0.245 + i * 0.04, 0], [tx * 1.03, tz / 0.72 * 0.75, 1], [Math.PI / 2, 0, -ribA - (side > 0 ? 0 : 0)]);
    // layered torn clothing: open jacket flaps + hanging rags of different lengths
    if (type === 'walker' || type === 'spitter') {
      for (const s of [1, -1]) {
        kit.add(torso, GEO.box(), cloth2, [0.085 * s * b, 0.25, 0.118 * b], [0.075 * b, 0.48, 0.012], [0.12, s * 0.25, s * 0.06]);
        kit.add(torso, GEO.box(), cloth2, [0.1 * s * b, -0.04, 0.12 * b], [0.05, 0.12 + rng() * 0.12, 0.008], [0.25, s * 0.3, s * (0.2 + rng() * 0.3)]);
      }
      kit.add(torso, GEO.box(), cloth2, [0, 0.27, -0.12 * b], [0.27 * b, 0.5, 0.012], [-0.1, 0, 0]);
    }
    for (let i = 0; i < 6; i++) {
      const a = (rng() - 0.5) * 5.5;
      kit.add(torso, GEO.box(), i % 2 ? cloth : cloth2, [Math.sin(a) * 0.145 * b, -0.06 - rng() * 0.08, Math.cos(a) * 0.105 * b], [0.04 + rng() * 0.04, 0.12 + rng() * 0.2, 0.008], [rng() * 0.3, a, (rng() - 0.5) * 0.5]);
    }
    // belt
    kit.add(torso, GEO.cyl(0.148, 0.148, 14, true), 0x1a1410, [0, 0.03, 0], [tx, 0.04, tz / 0.72 * 0.75]);
  }
  if (type === 'brute') {
    for (const s of [1, -1]) kit.add(torso, GEO.sph(9, 6), skin, [0.24 * s, 0.5, 0], [0.16, 0.14, 0.15]);
    kit.add(torso, GEO.sph(9, 6), skin, [0, 0.14, 0.1], [0.19, 0.17, 0.15]);
    kit.t(CELL.wound).add(torso, GEO.sph(9, 6), skin, [0.05, 0.16, 0.2], [0.1, 0.08, 0.05]);
    kit.t(CELL.flesh).add(torso, GEO.sph(9, 6), 0x7a5a54, [-0.1, 0.55, -0.15], [0.14, 0.12, 0.1]);
    kit.t(CELL.flesh).add(torso, GEO.sph(9, 6), 0x6a4a44, [0.15, 0.3, -0.16], [0.09, 0.1, 0.07]);
    for (let i = 0; i < 5; i++) kit.add(torso, GEO.cone(5), BONE, [-0.18 + i * 0.09, 0.52 + (i % 2) * 0.04, -0.17], [0.025, 0.14, 0.025], [-0.8, 0, (i - 2) * 0.2]);
    for (let i = 0; i < 3; i++) kit.add(torso, GEO.box(), 0x2a2a2c, [0.2, 0.35 - i * 0.07, 0.1], [0.008, 0.008, 0.06], [0.4, 0.5, 0]); // stitches
  }
  if (type === 'runner') { // hoodie hood + spine ridge
    kit.add(torso, GEO.sph(9, 6), cloth, [0, 0.55, -0.1], [0.13, 0.11, 0.08], [0.3, 0, 0]);
    for (let i = 0; i < 5; i++) kit.add(torso, GEO.sph(9, 6), BONE, [0, 0.18 + i * 0.065, -0.11], [0.018, 0.016, 0.02]);
    kit.t(CELL.wound).add(torso, GEO.sph(9, 6), RAW, [0, 0.3, -0.106], [0.04, 0.18, 0.012]);
  }
  if (type === 'armored') {
    kit.add(torso, GEO.lathe('vest', [[0.001, 0.1], [0.165, 0.1], [0.172, 0.22], [0.182, 0.34], [0.182, 0.44], [0.13, 0.52], [0.001, 0.53]], 14, 0.25, Math.PI * 2 - 0.5), 0x14161b, [0, 0, 0], [1.08, 1, 0.82]);
    kit.t(CELL.metal).add(torso, GEO.box(), 0xb8b8b0, [0, 0.36, 0.152], [0.2, 0.035, 0.01]);
    kit.add(torso, GEO.box(), 0x0c0c0e, [0.09, 0.2, 0.15], [0.06, 0.07, 0.03]);
    kit.add(torso, GEO.box(), 0x0c0c0e, [-0.09, 0.2, 0.15], [0.06, 0.07, 0.03]);
    for (const s of [1, -1]) kit.t(CELL.metal).add(torso, GEO.sph(9, 6), 0x121418, [0.2 * s, 0.49, 0], [0.09, 0.07, 0.09]);
    kit.add(torso, GEO.cyl(0.152, 0.152, 14, true), 0x0c0c0e, [0, 0.06, 0], [1.05, 0.05, 0.8]);
    // weak point: the vest is torn open at the back, exposing raw rotting flesh
    kit.t(CELL.wound).add(torso, GEO.sph(9, 6), RAW, [0.0, 0.3, -0.115], [0.075, 0.13, 0.035]);
    kit.t(CELL.flesh).add(torso, GEO.sph(9, 6), 0x8a3a38, [0.01, 0.31, -0.122], [0.05, 0.09, 0.02]);
    for (const s of [1, -1]) kit.add(torso, GEO.box(), 0x14161b, [0.07 * s, 0.4, -0.13], [0.05, 0.1, 0.01], [0.3, 0, s * 0.5]); // ripped flaps
  }
  // ---- head
  const head = grp(torso, 'head', 0, 0.56, 0.035);
  const hs = type === 'brute' ? 0.85 : 1;
  kit.add(head, GEO.cap(0.042 * hs, 0.06), skin, [0, 0.04, 0]);
  kit.t(CELL['f' + type]).add(head, GEO.sph(14, 10), skin, [0, 0.17 * hs, 0.01], [0.098 * hs, 0.118 * hs, 0.108 * hs]);
  kit.add(head, GEO.sph(9, 6), skin, [0, 0.13 * hs, 0.06 * hs], [0.025, 0.02, 0.03]);
  kit.add(head, GEO.sph(9, 6), skin, [0, 0.215 * hs, 0.08 * hs], [0.08 * hs, 0.022, 0.03]); // heavy brow ridge
  const jaw = grp(head, 'jaw', 0, 0.12 * hs, 0.02);
  kit.add(jaw, GEO.sph(9, 6), skin, [0, -0.02, 0.035], [0.066 * hs, 0.04, 0.07 * hs]);
  kit.add(jaw, GEO.sph(9, 6), BLOOD, [0, -0.035, 0.08 * hs], [0.05 * hs, 0.02, 0.02]);
  kit.add(head, GEO.sph(9, 6), MOUTH, [0, 0.11 * hs, 0.08 * hs], [0.047 * hs, 0.027, 0.02]);
  for (let k = -3; k <= 3; k++) { // exposed teeth (upper on the skull, lower on the jaw), some missing
    if (rng() < 0.2) continue;
    kit.add(head, GEO.box(), TEETH, [k * 0.011 * hs, 0.112 * hs, 0.093 * hs - Math.abs(k) * 0.003], [0.008, 0.016 + rng() * 0.006, 0.006], [0, k * 0.15, (rng() - 0.5) * 0.3]);
    if (rng() < 0.75) kit.add(jaw, GEO.box(), TEETH, [k * 0.011 * hs, 0.0, 0.088 * hs - Math.abs(k) * 0.003], [0.008, 0.014, 0.006], [0, k * 0.15, (rng() - 0.5) * 0.3]);
  }
  if (type !== 'armored' && rng() < 0.7) kit.add(head, GEO.sphPart(0, 1.3), pick([0x1a1614, 0x3a2a1a, 0x5a5048]), [0, 0.19 * hs, -0.01], [0.105 * hs, 0.12 * hs, 0.115 * hs], [-0.4, rng() - 0.5, 0.2]);
  if (type === 'runner') kit.add(head, GEO.sphPart(0, 1.7), cloth, [0, 0.18, -0.02], [0.118, 0.13, 0.125], [-0.7, 0, 0]);
  for (const s of [1, -1]) eyeKit.add(head, GEO.sph(6, 4), S.eye, [0.034 * s * hs, 0.19 * hs, 0.092 * hs], [0.015, 0.01, 0.008], [0, 0, 0], 0);
  const eg = glowSprite(S.eye, 0.17 * hs, 0.75); eg.position.set(0, 0.19 * hs, 0.115 * hs); head.add(eg);
  if (type === 'armored') {
    kit.t(CELL.metal).add(head, GEO.sphPart(0, 1.75, 14, 8), 0x101216, [0, 0.19, -0.005], [0.122, 0.13, 0.13], [-0.25, 0, 0]);
    kit.add(head, GEO.box(), 0x0a0b0e, [0, 0.27, -0.03], [0.02, 0.03, 0.2]);
    const visor = new THREE.Mesh(GEO.sphPart(0, 0.95, 14, 6), new THREE.MeshPhongMaterial({ color: 0x8aa0b8, map: visorCrackTex(), specular: 0xaabbcc, shininess: 100, transparent: true, opacity: 0.42, depthWrite: false }));
    visor.material.userData.op = 0.42;
    visor.scale.set(0.13, 0.135, 0.14); visor.position.set(0, 0.185, 0.0); visor.rotation.set(Math.PI / 2 + 0.12, 0, 0); visor.renderOrder = 2; head.add(visor);
  }
  if (type === 'spitter') {
    // translucent bile sacs with a glowing core visible through the membrane
    const sacMat = new THREE.MeshPhongMaterial({ color: 0x8ac050, emissive: 0x3a8a10, emissiveIntensity: 1, specular: 0xe0ffc0, shininess: 70, transparent: true, opacity: 0.5, depthWrite: false });
    sacMat.userData.op = 0.5;
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xc8ff40 });
    const sac = new THREE.Group(); sac.name = 'sac'; sac.position.set(0, 0.03, 0.07); head.add(sac);
    const s1 = new THREE.Mesh(GEO.sph(14, 10), sacMat); s1.scale.set(0.12, 0.1, 0.11); s1.renderOrder = 2; sac.add(s1);
    const c1 = new THREE.Mesh(GEO.sph(8, 6), coreMat); c1.name = 'sacCore'; c1.scale.set(0.06, 0.045, 0.05); c1.position.set(0.01, -0.01, 0.01); sac.add(c1);
    for (const [px, py, pz, sc] of [[0.1, 0.4, 0.11, 0.065], [-0.08, 0.22, 0.12, 0.05], [0.13, 0.15, 0.06, 0.04]]) {
      const s2 = new THREE.Mesh(GEO.sph(10, 8), sacMat); s2.scale.set(sc * 1.1, sc, sc * 0.85); s2.position.set(px, py, pz); s2.renderOrder = 2; torso.add(s2);
      const c2 = new THREE.Mesh(GEO.sph(6, 4), coreMat); c2.scale.setScalar(sc * 0.5); c2.position.set(px, py, pz); torso.add(c2);
    }
    const g = glowSprite(0x80ff40, 0.6, 0.6); g.position.set(0, 0, 0.06); sac.add(g);
    T.sacMat = sacMat;
    for (let i = 0; i < 6; i++) kit.add(torso, GEO.box(), 0x3a7a1a, [(rng() - 0.5) * 0.2, 0.3 + rng() * 0.2, 0.118], [0.006, 0.08 + rng() * 0.06, 0.006], [0, 0, (rng() - 0.5) * 1.2]);
  }
  // ---- arms (one shoulder dropped)
  const armLen = type === 'runner' ? 1.12 : 1, drop = rng() < 0.5 ? 1 : -1;
  for (const s of [1, -1]) {
    const arm = grp(torso, s > 0 ? 'armL' : 'armR', (0.2 * b + 0.01) * s, s === drop ? 0.44 : 0.47, 0); arm.rotation.order = 'YXZ';
    const sleeve = type === 'armored' || (s > 0 ? rng() < 0.8 : rng() < 0.4);
    kit.add(arm, GEO.cap(0.052 * b * t, 0.2 * armLen), sleeve ? cloth : skin, [0, -0.13 * armLen, 0]);
    if (sleeve && type !== 'armored') for (let k = 0; k < 3; k++) kit.add(arm, GEO.box(), cloth, [Math.cos(k * 2.1) * 0.05 * b, -0.27 * armLen, Math.sin(k * 2.1) * 0.05 * b], [0.03, 0.07 + rng() * 0.06, 0.006], [0.2, k * 2.1, 0.2]);
    if (!sleeve) kit.t(CELL.wound).add(arm, GEO.sph(9, 6), skin, [0, -0.15, 0.04 * b], [0.035, 0.07, 0.02]);
    const fore = grp(arm, s > 0 ? 'foreL' : 'foreR', 0, -0.28 * armLen, 0);
    kit.add(fore, GEO.cap(0.046 * b * t, 0.2 * armLen), type === 'armored' ? cloth : skin, [0, -0.12 * armLen, 0]);
    if (type !== 'armored' && rng() < 0.5) kit.add(fore, GEO.cap(0.012, 0.12, 4), BONE, [0.03 * s, -0.12, 0.03], [1, 1, 1], [0, 0, 0.05]); // bone poking out
    if (type === 'armored') kit.t(CELL.metal).add(fore, GEO.cap(0.05 * b, 0.1), 0x121418, [0, -0.1, 0.01]);
    const hy = -0.25 * armLen;
    kit.add(fore, GEO.sph(9, 6), type === 'armored' ? 0x0c0c0e : skin, [0, hy - 0.01, 0.01], [0.04 * b, 0.05 * b, 0.03 * b]);
    for (let f = -1; f <= 1; f++) kit.add(fore, GEO.cap(0.009 * b, 0.055 * b, 4), type === 'armored' ? 0x0c0c0e : skin, [f * 0.018 * b, hy - 0.072 * b, 0.022], [1, 1, 1], [0.5 + rng() * 0.3, 0, f * 0.15]);
    if (type !== 'armored') for (let f = -1; f <= 1; f++) kit.add(fore, GEO.cone(4), MOUTH, [f * 0.018 * b, hy - 0.11 * b, 0.04], [0.005, 0.014, 0.005], [0.6, 0, 0]); // black nails
    if (type === 'brute') kit.add(fore, GEO.cap(0.075, 0.16), skin, [0, -0.12, 0]);
    if (type === 'armored' && s > 0) {
      const sh = grp(fore, 'shield', 0, -0.12, 0.09);
      kit.add(sh, GEO.box(), 0x0c0d10, [0, 0, 0], [0.42, 0.72, 0.03]);
      kit.t(CELL.metal).add(sh, GEO.box(), 0x556070, [0, 0.02, 0.012], [0.36, 0.62, 0.012], [0, 0, 0], 0);
      kit.add(sh, GEO.box(), 0xd8d8d0, [0, 0.2, 0.02], [0.3, 0.05, 0.004], [0, 0, 0], 0);
      kit.add(sh, GEO.box(), 0x0c0d10, [0, -0.15, 0.02], [0.36, 0.015, 0.004]);
      kit.add(sh, GEO.box(), BLOOD, [0.08, -0.05, 0.02], [0.12, 0.2, 0.003], [0, 0, 0.4]);
    }
    if (type === 'armored' && s < 0) kit.add(fore, GEO.cyl(0.014, 0.014, 6), 0x0a0a0c, [0, hy - 0.02, 0.18], [1, 0.4, 1], [Math.PI / 2, 0, 0]);
  }
  kit.build(mat); eyeKit.build(eyeMat, false);
  return T;
}

// ============================================================================
// BOSS: 融合巨獸 fused abomination with a pulsing chest core weak point
// ============================================================================
let bossTemplate = null;
export function buildBoss() {
  if (!bossTemplate) bossTemplate = makeBossTemplate();
  return instantiate(bossTemplate, 'boss');
}
function makeBossTemplate() {
  const FL = 0x7a6060, SN = 0x6a2026, BN = 0xc4b8a0, DK = 0x2a1a1c, rng = seeded(4242);
  const A = getCharAtlas();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: A.map, emissive: 0x000000 }); mat.userData.bumpable = 1.6;
  const kit = new Kit(rng);
  kit.cellOf = col => col === FL ? CELL.wound : col === SN ? CELL.flesh : col === BN ? CELL.bone : CELL.flesh;
  const root = new THREE.Group();
  const body = grp(root, 'body', 0, 2.1, 0);
  const T = { root, hunch: 0.25, headTilt: 0.2, lean: 0.1 };
  for (const s of [1, -1]) {
    const leg = grp(body, s > 0 ? 'legL' : 'legR', 0.55 * s, 0, 0);
    kit.add(leg, GEO.cap(0.3, 0.6), FL, [0, -0.5, 0]);
    kit.add(leg, GEO.sph(), SN, [0.1 * s, -0.4, 0.2], [0.2, 0.3, 0.15]);
    const shin = grp(leg, s > 0 ? 'shinL' : 'shinR', 0, -1.02, 0);
    kit.add(shin, GEO.cap(0.24, 0.6), SN, [0, -0.45, 0]);
    kit.add(shin, GEO.sph(), BN, [0, -0.98, 0.12], [0.3, 0.12, 0.42]);
    for (let k = -1; k <= 1; k++) kit.add(shin, GEO.cone(5), BN, [k * 0.13, -1.0, 0.5], [0.05, 0.16, 0.05], [Math.PI / 2, 0, 0]);
    for (let k = 0; k < 3; k++) kit.add(shin, GEO.cone(5), BN, [0.2 * s, -0.3 - k * 0.2, -0.1], [0.04, 0.14, 0.04], [-0.6, 0, s * 1.2]);
  }
  const torso = grp(body, 'torso', 0, 0, 0); torso.rotation.x = 0.25; torso.rotation.z = 0.1;
  kit.add(torso, GEO.sph(16, 12), FL, [0, 0.4, 0], [0.7, 0.5, 0.55]);
  kit.add(torso, GEO.sph(16, 12), FL, [0, 1.2, 0], [0.95, 0.65, 0.62]);
  kit.add(torso, GEO.sph(), SN, [0.75, 1.45, -0.2], [0.5, 0.5, 0.45]);
  kit.add(torso, GEO.sph(), SN, [-0.8, 0.85, -0.25], [0.42, 0.38, 0.4]);
  kit.add(torso, GEO.sph(), FL, [-0.5, 1.6, -0.45], [0.55, 0.45, 0.5]);
  for (let i = 0; i < 14; i++) kit.add(torso, GEO.sph(), rng() < 0.5 ? SN : 0x8a6a68, [(rng() - 0.5) * 1.7, 0.3 + rng() * 1.4, (rng() - 0.35) * 0.95], [0.12 + rng() * 0.22, 0.12 + rng() * 0.22, 0.12 + rng() * 0.2]);
  for (let i = 0; i < 9; i++) kit.add(torso, GEO.cone(6), BN, [-0.85 + i * 0.21, 1.75 + (i % 2) * 0.12, -0.5], [0.08, 0.6 + (i % 3) * 0.25, 0.08], [-0.6, 0, (i - 4) * 0.13]);
  // ribcage splayed open around the core
  for (let i = 0; i < 5; i++) for (const s of [1, -1]) kit.add(torso, GEO.torus(0.42, 0.035, Math.PI * 0.5), BN, [0.0, 0.82 + i * 0.15, 0.2], [1, 1, 1.05], [Math.PI / 2 - 0.25, 0, s > 0 ? -0.35 + i * 0.03 : Math.PI - 1.22 - i * 0.03]);
  kit.add(torso, GEO.sph(), DK, [0, 1.15, 0.48], [0.36, 0.42, 0.14]);
  kit.t(CELL.wound).add(torso, GEO.sph(), 0x8a2a2a, [0, 1.15, 0.47], [0.46, 0.52, 0.12]);
  // weak point core + glowing veins that pulse with it
  const core = grp(torso, 'core', 0, 1.15, 0.56);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffd84a });
  const cm = new THREE.Mesh(GEO.sph(14, 12), coreMat); cm.scale.set(0.26, 0.26, 0.16); core.add(cm);
  const cg = glowSprite(0xffb020, 1.4, 0.7); core.add(cg);
  T.coreMat = coreMat;
  const veinMat = new THREE.MeshBasicMaterial({ color: 0xff9a2a });
  const vk = new Kit(rng);
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2 + rng() * 0.3, L = 0.35 + rng() * 0.4;
    vk.add(torso, GEO.box(), 0xffffff, [Math.cos(a) * (0.3 + L / 2), 1.15 + Math.sin(a) * (0.3 + L / 2), 0.5 - L * 0.12], [L, 0.022, 0.02], [0, -0.15 * Math.cos(a), a], 0);
  }
  vk.build(veinMat, false); T.veinMat = veinMat;
  // main head with a hinged jaw full of teeth + a second fused head
  const head = grp(torso, 'head', 0.1, 1.85, 0.25);
  kit.add(head, GEO.sph(14, 10), FL, [0, 0.25, 0], [0.3, 0.32, 0.3]);
  kit.add(head, GEO.sph(), SN, [0.15, 0.4, -0.05], [0.16, 0.14, 0.15]);
  kit.add(head, GEO.sph(), MOUTH, [0, 0.1, 0.22], [0.22, 0.1, 0.1]);
  for (let k = -3; k <= 3; k++) kit.add(head, GEO.cone(4), BN, [k * 0.05, 0.16, 0.27], [0.015, 0.06, 0.015], [Math.PI, 0, 0]);
  const jaw = grp(head, 'jaw', 0, 0.1, 0.05);
  kit.add(jaw, GEO.sph(), FL, [0, -0.06, 0.12], [0.24, 0.08, 0.17]);
  for (let k = -3; k <= 3; k++) kit.add(jaw, GEO.cone(4), BN, [k * 0.05, 0.0, 0.25], [0.014, 0.05, 0.014]);
  const eyeKit = new Kit(rng);
  for (const s of [1, -1]) eyeKit.add(head, GEO.sph(6, 4), 0xffd84a, [0.12 * s, 0.33, 0.25], [0.045, 0.03, 0.02], [0, 0, 0], 0);
  eyeKit.add(head, GEO.sph(6, 4), 0xffd84a, [0.03, 0.45, 0.22], [0.025, 0.02, 0.015], [0, 0, 0], 0);
  const eg = glowSprite(0xffc040, 0.8, 0.6); eg.position.set(0, 0.33, 0.3); head.add(eg);
  const head2 = grp(torso, '', -0.75, 1.75, 0.1); head2.rotation.set(0.3, 0, 0.5);
  kit.add(head2, GEO.sph(), FL, [0, 0.15, 0], [0.2, 0.22, 0.2]);
  kit.add(head2, GEO.sph(), MOUTH, [0, 0.07, 0.15], [0.1, 0.05, 0.06]);
  eyeKit.add(head2, GEO.sph(6, 4), 0xffd84a, [0.05, 0.2, 0.18], [0.03, 0.02, 0.015], [0, 0, 0], 0);
  for (const s of [1, -1]) {
    const arm = grp(torso, s > 0 ? 'armL' : 'armR', 1.05 * s, 1.55, 0);
    kit.add(arm, GEO.cap(0.26, 0.6), FL, [0, -0.5, 0]);
    kit.add(arm, GEO.sph(), SN, [0, -0.1, 0], [0.38, 0.32, 0.36]);
    const fore = grp(arm, s > 0 ? 'foreL' : 'foreR', 0, -1.0, 0);
    kit.add(fore, GEO.cap(0.3, 0.6), SN, [0, -0.5, 0]);
    kit.add(fore, GEO.sph(), BN, [0, -1.1, 0.05], [0.34, 0.18, 0.22]);
    for (let k = -1; k <= 1; k++) kit.add(fore, GEO.cone(5), BN, [k * 0.18, -1.35, 0.1], [0.06, 0.35, 0.06], [Math.PI, 0, 0]);
    const small = grp(torso, s > 0 ? 'smallL' : 'smallR', 0.7 * s, 0.7, 0.35);
    kit.add(small, GEO.cap(0.08, 0.5, 5), SN, [0, -0.3, 0.1], [1, 1, 1], [-0.8, 0, 0.3 * s]);
    kit.add(small, GEO.sph(), skinPick(rng), [0, -0.6, 0.35], [0.07, 0.08, 0.06]);
  }
  kit.build(mat); eyeKit.build(new THREE.MeshBasicMaterial({ color: 0xffd84a }), false);
  return T;
}
function skinPick(r) { return r() < 0.5 ? 0x7d8474 : 0x8a7470; }
