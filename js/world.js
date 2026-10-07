import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { buildCar, makePlateAtlas, plateUV } from './cars.js?v=20261007b';
import { buildDistricts, AREAS, INTERIORS, STAIRS, PORTALS, HOLES, BOSS_SPOT } from './districts.js?v=20261007b';

// seeded rng
let seed = 1337;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const rr = (a, b) => a + rnd() * (b - a);
const pick = a => a[(rnd() * a.length) | 0];
const PI = Math.PI;
const FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}
// Box with UVs scaled to world size (tile = T meters)
function tiledBox(w, h, d, T = 4, Ty = T) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const s = [[d / T, h / Ty], [d / T, h / Ty], [w / T, d / T], [w / T, d / T], [w / T, h / Ty], [w / T, h / Ty]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * s[f][0], uv.getY(k) * s[f][1]); }
  return g;
}

// ---------------------------------------------------------------- map constants
export const BOUND = 84;
const ROADS = [-56, 0, 56];
const RH = 6;      // road half width (asphalt)
const SWW = 3;     // sidewalk width
const SPANS = [[-84, -65], [-47, -9], [9, 47], [65, 84]];
const CH = 63;     // render chunk size
const DETAIL = new Set(['vcD', 'vc2D', 'blood', 'puddle', 'decal']);

export function buildWorld(scene) {
  seed = 1337;
  const camPos = { x: 0, z: 0 };
  const colliders = [];   // OBB {x,z,hw,hd,c,s,h, minX,maxX,minZ,maxZ}
  const mapRects = [];    // minimap {x,z,w,d,rot,kind}
  const buckets = new Map();
  const mats = {};
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
  const chunkKey = (x, z) => `${Math.floor((x + 126) / CH)},${Math.floor((z + 126) / CH)}`;
  // plain-coloured materials are folded into a few vertex-coloured ones to keep draw calls low
  const VC = { curb: 0x77757a, metal: 0x2c2b30, rust: 0x4a2e22, white: 0x9a9890, dumpster: 0x1e3426, sand: 0x6a5a40, bush: 0x1e2618, statue: 0x3a4a44, lampOff: 0x3a3a3c, tire: 0x0d0d0e, carDark: 0x0f0f11, bumper: 0x1c1c1f, rubble: 0x3e3c42, gasRed: 0x9a1818 };
  const VCD = { ledge: 0x56545c, ledgeD: 0x3a3840, pipe: 0x3a3634, sheet: 0x5a3a2c, sheet2: 0x3a4a4c, trash: 0x141316, bag: 0x0e0e10, wood: 0x4a3424, crate: 0x5a4430, brick: 0x5a3028, can: 0x2a3a2e, tireD: 0x0c0c0d, acunit: 0x8a8a86, tank: 0x9a9a9e, cone: 0xc05418 };
  const VC2 = { paper: 0x8a867a, leaf: 0x3a3020, awning: 0x4a1e1c, awning2: 0x1e3a4a };
  const VCP = { chrome: 0x8a8a90, rim: 0x55565c, lightOff: 0x6a6a64, tailOff: 0x4a0808, glass: 0x07080b, water: 0x06080c };
  const VCB = { headL: 0xfff0c8, tailL: 0xd01010, panelLit: 0xd8e0e8 };
  const _vc = new THREE.Color();
  const setVC = (g, hex) => { _vc.set(hex); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = _vc.r; a[i * 3 + 1] = _vc.g; a[i * 3 + 2] = _vc.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); };
  const pushGeo = (g, matKey, cx, cz) => {
    let n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose();
    if (VC[matKey] !== undefined) { setVC(n, VC[matKey]); matKey = 'vc'; }
    else if (VCD[matKey] !== undefined) { setVC(n, VCD[matKey]); matKey = 'vcD'; }
    else if (VC2[matKey] !== undefined) { setVC(n, VC2[matKey]); matKey = matKey === 'paper' || matKey === 'leaf' ? 'vc2D' : 'vc2'; }
    else if (VCP[matKey] !== undefined) { setVC(n, VCP[matKey]); matKey = 'paint'; }
    else if (VCB[matKey] !== undefined) { setVC(n, VCB[matKey]); matKey = 'vcB'; }
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    const key = matKey + '@' + chunkKey(cx, cz);
    if (!buckets.has(key)) buckets.set(key, { mat: matKey, list: [], cx, cz });
    buckets.get(key).list.push(n);
  };
  const add = (geo, matKey, x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    const g = geo.clone(); g.applyMatrix4(_m); pushGeo(g, matKey, x, z);
  };
  const addCollider = (x, z, w, d, ry = 0, h = 3) => {
    const c = Math.cos(ry), s = Math.sin(ry), ac = Math.abs(c), as = Math.abs(s);
    const ex = (w * ac + d * as) / 2, ez = (w * as + d * ac) / 2;
    const col = { x, z, hw: w / 2, hd: d / 2, c, s, h, minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez };
    colliders.push(col); return col;
  };
  const free = (x, z, pad = 0.5) => !colliders.some(c => x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad);
  const onRoad = (x, z) => ROADS.some(r => Math.abs(x - r) < RH) || ROADS.some(r => Math.abs(z - r) < RH);

  // ---------------------------------------------------------------- textures
  const brokenWin = (g, x, y, W = 36, H = 40) => {
    g.fillStyle = '#0a090c'; g.fillRect(x, y, W, H);
    g.fillStyle = 'rgba(150,160,175,.55)';
    for (let k = 0; k < 4; k++) { g.beginPath(); const sx = x + (k % 2) * W, sy = y + (k < 2 ? 0 : H); g.moveTo(sx, sy); g.lineTo(sx + (k % 2 ? -1 : 1) * (W / 6 + Math.random() * W / 3), sy); g.lineTo(sx, sy + (k < 2 ? 1 : -1) * (H / 5 + Math.random() * H / 2.5)); g.fill(); }
  };
  // v0.4 facades: 256² tile = 6 m × 6 m (2 floors × 2 bays). Pattern (brick / concrete panels / plaster /
  // Taiwanese mosaic tile), recessed windows with frames, sills, iron grilles, AC stains and grime streaks.
  // The same canvas doubles as a bump map on mid/high (dark mortar / recessed windows read as depth).
  const WINS = [[30, 22], [158, 22], [30, 150], [158, 150]], WW = 68, WH = 82;
  const mkFacade = (kind, bg) => canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const R = Math.random;
    if (kind === 'brick') {
      for (let y = 0, row = 0; y < h; y += 8, row++) for (let x = -(row % 2) * 9; x < w; x += 18) { const v = (R() - 0.5) * 30 | 0; g.fillStyle = `rgb(${96 + v},${52 + v * 0.6 | 0},${42 + v * 0.5 | 0})`; g.fillRect(x + 1, y + 1, 16, 6); }
    } else if (kind === 'panel') {
      for (let y = 0; y < h; y += 64) for (let x = 0; x < w; x += 128) { const v = (R() - 0.5) * 16 | 0; g.fillStyle = `rgb(${80 + v},${79 + v},${86 + v})`; g.fillRect(x + 2, y + 2, 124, 60); }
      g.fillStyle = 'rgba(0,0,0,.5)'; for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 2); for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 2, h);
    } else if (kind === 'tile') {
      for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) { const v = (R() - 0.5) * 22 | 0; g.fillStyle = `rgb(${140 + v},${142 + v},${138 + v})`; g.fillRect(x, y, 3, 3); }
      for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(60,58,56,.8)'; g.fillRect(R() * w, R() * h, 4 + R() * 12, 4 + R() * 8); } // missing tiles
    } else { // plaster
      for (let i = 0; i < 60; i++) { const v = (R() - 0.5) * 30 | 0; g.fillStyle = `rgba(${120 + v},${114 + v},${100 + v},.35)`; g.beginPath(); g.arc(R() * w, R() * h, 6 + R() * 22, 0, 7); g.fill(); }
      for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(70,64,60,.7)'; const x = R() * w, y = R() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) g.lineTo(x + (R() - .5) * 40, y + (R() - .5) * 30); g.fill(); } // peeled patches
    }
    for (let i = 0; i < 1600; i++) { const v = R() * 60 | 0; g.fillStyle = `rgba(${v},${v},${v},.25)`; g.fillRect(R() * w, R() * h, 2, 2); }
    // cracks
    g.strokeStyle = 'rgba(10,8,8,.55)'; g.lineWidth = 1;
    for (let i = 0; i < 4; i++) { let x = R() * w, y = R() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (R() - 0.5) * 18; y += R() * 12; g.lineTo(x, y); } g.stroke(); }
    // floor slab band
    g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, 124, w, 8); g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(0, 122, w, 2);
    for (const [x, y] of WINS) {
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(x - 6, y - 6, WW + 12, WH + 12);           // reveal shadow
      g.fillStyle = kind === 'brick' ? '#8a8478' : '#3a383e'; g.fillRect(x - 4, y - 4, WW + 8, WH + 8); // frame / lintel
      if (R() < 0.3) brokenWin(g, x, y, WW, WH); else {
        g.fillStyle = '#0b0a0d'; g.fillRect(x, y, WW, WH);
        const gr = g.createLinearGradient(x, y, x + WW, y + WH); gr.addColorStop(0, 'rgba(90,100,130,.25)'); gr.addColorStop(1, 'rgba(20,20,30,0)'); g.fillStyle = gr; g.fillRect(x, y, WW, WH);
        g.fillStyle = '#2a282c'; g.fillRect(x + WW / 2 - 2, y, 4, WH); g.fillRect(x, y + WH * 0.4, WW, 3);    // mullions
        if (R() < 0.35) { g.fillStyle = 'rgba(60,50,40,.9)'; g.fillRect(x + 2, y + 2, WW * (0.3 + R() * 0.4), WH - 4); } // curtain
      }
      if (R() < 0.45) { g.strokeStyle = 'rgba(40,36,34,.95)'; g.lineWidth = 2; for (let k = 0; k <= 6; k++) { g.beginPath(); g.moveTo(x - 2 + k * (WW + 4) / 6, y - 3); g.lineTo(x - 2 + k * (WW + 4) / 6, y + WH + 3); g.stroke(); } g.beginPath(); g.moveTo(x - 3, y + WH / 2); g.lineTo(x + WW + 3, y + WH / 2); g.stroke(); } // iron grille 鐵窗
      g.fillStyle = 'rgba(200,196,186,.55)'; g.fillRect(x - 8, y + WH + 3, WW + 16, 5);                  // sill
      // grime streaks running down from the sill
      for (let k = 0; k < 5; k++) { const sx = x + R() * WW, L = 14 + R() * 36; const gr = g.createLinearGradient(0, y + WH + 8, 0, y + WH + 8 + L); gr.addColorStop(0, 'rgba(14,12,12,.55)'); gr.addColorStop(1, 'rgba(14,12,12,0)'); g.fillStyle = gr; g.fillRect(sx, y + WH + 8, 2 + R() * 5, L); }
    }
    // overall grime: darker at the bottom of each floor, rust/water stains
    for (const y0 of [0, 128]) { const gr = g.createLinearGradient(0, y0 + 70, 0, y0 + 128); gr.addColorStop(0, 'rgba(10,10,12,0)'); gr.addColorStop(1, 'rgba(10,10,12,.3)'); g.fillStyle = gr; g.fillRect(0, y0 + 70, w, 58); }
    for (let i = 0; i < 6; i++) { const x = R() * w; const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(60,34,20,.35)'); gr.addColorStop(1, 'rgba(60,34,20,0)'); g.fillStyle = gr; g.fillRect(x, R() * h * 0.5, 3 + R() * 8, 40 + R() * 90); }
  });
  const facA = mkFacade('panel', '#4e4c54');
  const facB = mkFacade('brick', '#3a2620');
  const facC = mkFacade('plaster', '#8a8478');
  const facE = mkFacade('tile', '#8a8a86');
  const facadeEm = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const lit = [[1, '#8a4a18'], [2, '#4a2a10'], [3, '#1a3050']];
    for (const [i, c] of lit) { const [x, y] = WINS[i]; const gr = g.createRadialGradient(x + WW / 2, y + WH / 2, 4, x + WW / 2, y + WH / 2, WW * 0.7); gr.addColorStop(0, c); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(x, y, WW, WH); g.fillStyle = '#000'; g.fillRect(x + WW / 2 - 2, y, 4, WH); }
  });
  const shopTex = kind => canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#2a282c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1a181b'; g.fillRect(0, 0, w, 18);
    const y0 = 18, hh = 104;
    if (kind === 0) {
      g.fillStyle = '#6a6a6e'; g.fillRect(6, y0, 116, hh); g.fillStyle = 'rgba(30,30,34,.6)'; for (let y = y0; y < y0 + hh; y += 4) g.fillRect(6, y, 116, 1);
      g.fillStyle = 'rgba(70,40,30,.5)'; for (let i = 0; i < 20; i++) g.fillRect(6 + Math.random() * 116, y0 + Math.random() * hh, 2, 6 + Math.random() * 14);
      g.font = 'bold 26px ' + FONT; g.fillStyle = 'rgba(190,30,40,.75)'; g.save(); g.translate(30, 80); g.rotate(-0.12); g.fillText('救命', 0, 0); g.restore();
    } else if (kind === 1) {
      g.fillStyle = '#0a0a0d'; g.fillRect(6, y0, 116, hh); g.fillStyle = '#3a3638'; g.fillRect(62, y0, 4, hh); g.fillRect(6, y0 + 70, 116, 3);
      g.fillStyle = 'rgba(160,170,185,.5)'; for (let k = 0; k < 8; k++) { g.beginPath(); const x = 6 + Math.random() * 116, y = y0 + Math.random() * 30; g.moveTo(x, y); g.lineTo(x + 8 - Math.random() * 16, y + 10 + Math.random() * 30); g.lineTo(x + 6, y); g.fill(); }
      g.fillStyle = 'rgba(60,40,30,.6)'; for (let i = 0; i < 12; i++) g.fillRect(10 + Math.random() * 100, y0 + 75 + Math.random() * 20, 6, 8);
    } else {
      g.fillStyle = '#121014'; g.fillRect(6, y0, 116, hh);
      for (let i = 0; i < 7; i++) { g.save(); g.translate(64, y0 + 10 + i * 14); g.rotate((Math.random() - .5) * 0.25); g.fillStyle = `rgb(${80 + Math.random() * 30 | 0},${58 + Math.random() * 20 | 0},40)`; g.fillRect(-60, -5, 120, 10); g.restore(); }
      g.fillStyle = 'rgba(200,190,170,.7)'; g.font = 'bold 18px ' + FONT; g.fillText('內有活人', 34, y0 + 60);
    }
  });
  const signAtlas = canvasTex(1024, 384, (g) => {
    const names = ['便利商店', '牛肉麵', '牙科診所', '五金行', '書局', '洗衣店', '檳榔', '早餐店', '眼鏡行', '手機維修', '茶行', '小吃部', '當舖', '電器行', '診所', '機車行'];
    const cols = [['#c01818', '#fff'], ['#f0d020', '#a01010'], ['#ffffff', '#1a50a0'], ['#1a3a7a', '#fff'], ['#2a6a3a', '#fff'], ['#e8e8e8', '#2050c0'], ['#d02080', '#fff'], ['#f08a20', '#fff']];
    for (let i = 0; i < 16; i++) {
      const x = (i % 4) * 256, y = (i / 4 | 0) * 96, [bg, fg] = cols[i % cols.length];
      g.fillStyle = bg; g.fillRect(x + 2, y + 2, 252, 92); g.fillStyle = 'rgba(0,0,0,.35)'; for (let k = 0; k < 40; k++) g.fillRect(x + Math.random() * 256, y + Math.random() * 96, 3 + Math.random() * 8, 2);
      g.fillStyle = fg; g.font = `bold 52px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(names[i], x + 128, y + 50);
      if (Math.random() < 0.4) { g.fillStyle = 'rgba(10,8,8,.7)'; g.beginPath(); g.moveTo(x + 180 + Math.random() * 60, y); g.lineTo(x + 256, y); g.lineTo(x + 256, y + 96); g.lineTo(x + 230, y + 96); g.fill(); }
    }
  });
  const asphalt = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#29282d'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { const v = 30 + Math.random() * 22 | 0; g.fillStyle = `rgba(${v},${v},${v + 4},.25)`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 20 + Math.random() * 60, 0, 7); g.fill(); }
    for (let i = 0; i < 16000; i++) { const v = 22 + Math.random() * 48 | 0; g.fillStyle = `rgb(${v},${v},${v + 3})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5); }
    for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(18,18,22,.45)'; g.fillRect(Math.random() * w, Math.random() * h, 40 + Math.random() * 80, 30 + Math.random() * 60); }
    g.strokeStyle = 'rgba(6,6,8,.85)';
    const crack = (x, y, a, len, wd) => { g.lineWidth = wd; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < len; k++) { a += (Math.random() - .5) * 0.9; x += Math.cos(a) * 9; y += Math.sin(a) * 9; g.lineTo(x, y); if (Math.random() < 0.12 && wd > 0.8) { g.stroke(); crack(x, y, a + (Math.random() < .5 ? 1 : -1), len / 2 | 0, wd * 0.6); g.lineWidth = wd; g.beginPath(); g.moveTo(x, y); } } g.stroke(); };
    for (let i = 0; i < 12; i++) crack(Math.random() * w, Math.random() * h, Math.random() * 7, 10 + Math.random() * 14 | 0, 1.6);
    for (let i = 0; i < 8; i++) { const x = Math.random() * w, y = Math.random() * h, r = 8 + Math.random() * 22; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(5,5,8,.55)'); gr.addColorStop(1, 'rgba(5,5,8,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    for (let i = 0; i < 900; i++) { const v = 80 + Math.random() * 50 | 0; g.fillStyle = `rgba(${v},${v},${v},.5)`; g.fillRect(Math.random() * w, Math.random() * h, 1, 1); }
  });
  asphalt.repeat.set(30, 30);
  // wet patches (specular / reflection mask for the road on mid/high)
  const wetTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) { const x = Math.random() * w, y = Math.random() * h, r = 10 + Math.random() * 40; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(0.7, 'rgba(200,200,200,.6)'); gr.addColorStop(1, 'rgba(120,120,120,0)'); g.fillStyle = gr; g.save(); g.translate(x, y); g.scale(1, 0.4 + Math.random() * 0.8); g.translate(-x, -y); g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.restore(); }
    for (let i = 0; i < 3000; i++) { const v = Math.random() * 120 | 0; g.fillStyle = `rgba(${v},${v},${v},.4)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  }, false);
  wetTex.repeat.set(14, 14);
  // cheap env cube for wet reflections: dark sky, orange city glow on the horizon, scattered lights
  const envCube = (() => {
    const faces = [];
    for (let f = 0; f < 6; f++) {
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
      if (f === 2) { g.fillStyle = '#0c0b12'; g.fillRect(0, 0, 64, 64); }
      else if (f === 3) { g.fillStyle = '#0a0808'; g.fillRect(0, 0, 64, 64); }
      else {
        const gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, '#0e0d16'); gr.addColorStop(0.45, '#2a1418'); gr.addColorStop(0.55, '#5a2a18'); gr.addColorStop(0.62, '#120c0c'); gr.addColorStop(1, '#060505'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
        for (let i = 0; i < 10; i++) { g.fillStyle = ['#ffb060', '#ff4060', '#40c0ff', '#ffd080'][i % 4]; g.globalAlpha = 0.5 + Math.random() * 0.5; g.fillRect(Math.random() * 64, 30 + Math.random() * 8, 2, 2); }
        g.globalAlpha = 1;
      }
      faces.push(c);
    }
    const t = new THREE.CubeTexture(faces); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t;
  })();
  const lotTex = asphalt.clone(); lotTex.repeat.set(1, 1); lotTex.needsUpdate = true;
  const splat = makeSplatTex();
  const concrete = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#4b4a4f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 20; i++) { const v = 50 + Math.random() * 40 | 0; g.fillStyle = `rgba(${v},${v},${v + 2},.35)`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 6 + Math.random() * 18, 0, 7); g.fill(); }
    for (let i = 0; i < 1500; i++) { const v = 50 + Math.random() * 50 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
    for (let i = 0; i < 6; i++) { const x = Math.random() * w, y = Math.random() * h, r = 4 + Math.random() * 10; g.fillStyle = 'rgba(15,14,18,.4)'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } // gum / oil stains
    g.strokeStyle = 'rgba(12,12,14,.7)'; g.lineWidth = 1; for (let i = 0; i < 3; i++) { let x = Math.random() * w, y = Math.random() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (Math.random() - .5) * 20; y += (Math.random() - .5) * 20; g.lineTo(x, y); } g.stroke(); }
    g.fillStyle = '#26252a'; g.fillRect(0, 0, w, 3); g.fillRect(0, 0, 3, h);
  });
  const paving = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#56504c'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) { const v = 70 + Math.random() * 25 | 0; g.fillStyle = `rgb(${v},${v - 6},${v - 10})`; g.fillRect(x * 32 + (y % 2) * 16 - 16 + 1, y * 16 + 1, 30, 14); }
    for (let i = 0; i < 200; i++) { g.fillStyle = 'rgba(20,18,18,.3)'; g.fillRect(Math.random() * w, Math.random() * h, 1, 1); }
  });
  const stripeTex = canvasTex(64, 16, (g) => { g.fillStyle = '#d8d4c8'; g.fillRect(0, 0, 64, 16); for (let i = -1; i < 8; i += 2) { g.fillStyle = '#b01818'; g.beginPath(); g.moveTo(i * 8, 16); g.lineTo(i * 8 + 8, 0); g.lineTo(i * 8 + 16, 0); g.lineTo(i * 8 + 8, 16); g.fill(); } });
  const fenceTex = canvasTex(64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(150,150,155,1)'; g.lineWidth = 2; for (let i = -64; i < 128; i += 10) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke(); g.beginPath(); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke(); } });
  const grime = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(110,90,75,${Math.random() * .12})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 7, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(200,200,200,.6)'; g.lineWidth = 1; for (let i = 0; i < 18; i++) { g.beginPath(); const x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); g.lineTo(x + (Math.random() - .5) * 50, y + (Math.random() - .5) * 12); g.stroke(); }
  });
  const crackGlass = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#121418'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(170,180,195,.38)'; g.lineWidth = 1;
    const cx = 20 + Math.random() * 24, cy = 20 + Math.random() * 24;
    for (let i = 0; i < 12; i++) { const a = i / 12 * 6.28 + Math.random() * .3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 60, cy + Math.sin(a) * 60); g.stroke(); }
    for (let r = 5; r < 22; r += 7) { g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke(); }
  });
  const plates = makePlateAtlas();
  // posters / notices / graffiti atlas (4×2 cells), alpha-tested decals on walls
  const decalTex = canvasTex(512, 256, (g) => {
    const R = Math.random;
    const cellAt = (i, fn) => { g.save(); g.translate((i % 4) * 128, (i / 4 | 0) * 128); fn(); g.restore(); };
    const torn = (x, y, w, h, bg) => { g.fillStyle = bg; g.beginPath(); g.moveTo(x, y); for (let k = 0; k <= 8; k++) g.lineTo(x + w * k / 8, y + (R() * 4)); for (let k = 0; k <= 8; k++) g.lineTo(x + w - R() * 4, y + h * k / 8); for (let k = 8; k >= 0; k--) g.lineTo(x + w * k / 8, y + h - R() * 6); g.closePath(); g.fill(); };
    const grimeP = () => { for (let k = 0; k < 120; k++) { g.fillStyle = `rgba(40,30,20,${R() * 0.3})`; g.fillRect(R() * 128, R() * 128, 3, 3); } };
    cellAt(0, () => { torn(14, 8, 100, 112, '#d8d0bc'); g.fillStyle = '#a01010'; g.font = 'bold 26px ' + FONT; g.textAlign = 'center'; g.fillText('尋人', 64, 38); g.fillStyle = '#2a2a2a'; g.fillRect(36, 46, 56, 44); g.fillStyle = '#5a5a5a'; g.beginPath(); g.arc(64, 62, 11, 0, 7); g.fill(); g.fillRect(48, 74, 32, 16); g.fillStyle = '#222'; g.font = '11px ' + FONT; g.fillText('最後見於 中山路', 64, 104); grimeP(); });
    cellAt(1, () => { torn(10, 10, 108, 106, '#e0dccc'); g.fillStyle = '#d8a010'; g.beginPath(); g.moveTo(64, 22); g.lineTo(90, 66); g.lineTo(38, 66); g.closePath(); g.fill(); g.fillStyle = '#111'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.fillText('!', 64, 62); g.font = 'bold 18px ' + FONT; g.fillText('撤離通知', 64, 90); g.font = '10px ' + FONT; g.fillText('請前往指定避難所', 64, 106); grimeP(); });
    cellAt(2, () => { torn(12, 6, 104, 116, '#b81818'); g.fillStyle = '#fff'; g.font = 'bold 30px ' + FONT; g.textAlign = 'center'; g.fillText('隔離區', 64, 50); g.font = 'bold 13px ' + FONT; g.fillText('禁止進入', 64, 74); g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(64, 98, 12, 0, 7); g.stroke(); grimeP(); });
    cellAt(3, () => { torn(16, 10, 96, 110, '#2a4a8a'); g.fillStyle = '#f0e8d0'; g.font = 'bold 20px ' + FONT; g.textAlign = 'center'; g.fillText('里長', 64, 36); g.fillText('陳志明', 64, 62); g.fillStyle = '#f0d020'; g.fillRect(28, 76, 72, 20); g.fillStyle = '#2a4a8a'; g.font = 'bold 13px ' + FONT; g.fillText('為民服務', 64, 91); g.fillStyle = 'rgba(120,0,0,.8)'; g.beginPath(); g.ellipse(80, 50, 14, 22, 0.4, 0, 7); g.fill(); grimeP(); });
    cellAt(4, () => { g.font = 'bold 44px ' + FONT; g.textAlign = 'center'; g.fillStyle = 'rgba(190,20,20,.9)'; g.save(); g.translate(64, 76); g.rotate(-0.12); g.fillText('快逃', 0, 0); g.restore(); for (let k = 0; k < 8; k++) { g.fillStyle = 'rgba(170,10,10,.85)'; g.fillRect(28 + R() * 72, 70 + R() * 10, 2, 10 + R() * 30); } });
    cellAt(5, () => { g.font = 'bold 26px ' + FONT; g.textAlign = 'center'; g.fillStyle = 'rgba(230,230,220,.9)'; g.fillText('他們', 64, 50); g.fillText('聽得到', 64, 84); g.strokeStyle = 'rgba(230,230,220,.9)'; g.lineWidth = 4; g.beginPath(); g.moveTo(14, 100); g.lineTo(114, 100); g.lineTo(104, 92); g.moveTo(114, 100); g.lineTo(104, 108); g.stroke(); });
    cellAt(6, () => { for (let k = 0; k < 4; k++) { const x = 20 + R() * 80, y = 20 + R() * 80; g.fillStyle = 'rgba(110,4,6,.9)'; g.beginPath(); g.ellipse(x, y, 10, 13, R(), 0, 7); g.fill(); for (let f = 0; f < 5; f++) { const a = -2.4 + f * 0.45; g.beginPath(); g.ellipse(x + Math.cos(a) * 16, y + Math.sin(a) * 16, 3, 7, a + 1.57, 0, 7); g.fill(); } g.fillRect(x - 2, y + 10, 2, 20 + R() * 20); } });
    cellAt(7, () => { g.strokeStyle = 'rgba(40,200,120,.85)'; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.moveTo(20, 30); g.quadraticCurveTo(70, 0, 60, 60); g.quadraticCurveTo(50, 110, 108, 90); g.stroke(); g.strokeStyle = 'rgba(240,200,40,.85)'; g.lineWidth = 5; g.beginPath(); g.moveTo(30, 100); g.lineTo(60, 20); g.lineTo(90, 100); g.moveTo(40, 70); g.lineTo(80, 70); g.stroke(); });
  });
  decalTex.wrapS = decalTex.wrapT = THREE.ClampToEdgeWrapping;

  const L = (o) => new THREE.MeshLambertMaterial(o);
  mats.facA = L({ map: facA, emissiveMap: facadeEm, emissive: 0xffffff, emissiveIntensity: 0.5, color: 0xa8a4ae });
  mats.facB = L({ map: facB, emissiveMap: facadeEm, emissive: 0xffffff, emissiveIntensity: 0.4, color: 0xb0a098 });
  mats.facC = L({ map: facC, color: 0x9a968e });
  mats.facD = L({ map: facA, color: 0x5d5a63 });
  mats.facE = L({ map: facE, emissiveMap: facadeEm, emissive: 0xffffff, emissiveIntensity: 0.35, color: 0x9a9a98 });
  for (const [k, t] of [['facA', facA], ['facB', facB], ['facC', facC], ['facE', facE], ['facD', facA]]) mats[k].userData.bump = [t, 0.9];
  mats.shop0 = L({ map: shopTex(0), color: 0x9a96a0 }); mats.shop1 = L({ map: shopTex(1), color: 0x9a96a0 }); mats.shop2 = L({ map: shopTex(2), color: 0x9a96a0 });
  mats.signs = L({ map: signAtlas, emissiveMap: signAtlas, emissive: 0xffffff, emissiveIntensity: 0.28, color: 0xa0a0a0 });
  mats.concrete = L({ map: concrete, color: 0x8a8790 });
  mats.sidewalk = L({ map: concrete, color: 0x6a6870 }); mats.sidewalk.userData.bump = [concrete, 0.6];
  mats.curb = L({ color: 0x77757a });
  mats.paving = L({ map: paving, color: 0x8a8480 });
  mats.lot = L({ map: lotTex, color: 0x8a8690 });
  mats.rubble = L({ color: 0x3e3c42 });
  mats.metal = L({ color: 0x2c2b30 });
  mats.rust = L({ color: 0x4a2e22 });
  mats.trash = L({ color: 0x141316 }); mats.bag = L({ color: 0x0e0e10 });
  mats.wood = L({ color: 0x4a3424 }); mats.crate = L({ color: 0x5a4430 });
  mats.cone = L({ color: 0xb04a14, emissive: 0x200800 });
  mats.white = L({ color: 0x9a9890 });
  mats.paper = L({ color: 0x8a867a, side: THREE.DoubleSide });
  mats.brick = L({ color: 0x5a3028 });
  mats.can = L({ color: 0x2a3a2e });
  mats.tireD = L({ color: 0x0c0c0d });
  mats.acunit = L({ color: 0x8a8a86 });
  mats.tank = L({ color: 0x9a9a9e });
  mats.awning = L({ color: 0x4a1e1c, side: THREE.DoubleSide });
  mats.awning2 = L({ color: 0x1e3a4a, side: THREE.DoubleSide });
  mats.dumpster = L({ color: 0x1e3426 });
  mats.sand = L({ color: 0x6a5a40 });
  mats.bush = L({ color: 0x1e2618 });
  mats.leaf = L({ color: 0x3a3020, side: THREE.DoubleSide });
  mats.stripe = L({ map: stripeTex });
  mats.fence = L({ map: fenceTex, alphaTest: 0.5, side: THREE.DoubleSide, color: 0x9a9aa0 });
  mats.water = new THREE.MeshPhongMaterial({ color: 0x06080c, specular: 0x6a7090, shininess: 90 });
  mats.statue = L({ color: 0x3a4a44 });
  mats.gasRed = L({ color: 0x8a1414, emissive: 0x2a0404 });
  mats.panelLit = new THREE.MeshBasicMaterial({ color: 0xd8e0e8 });
  mats.blood = new THREE.MeshBasicMaterial({ map: splat, color: 0x3a0407, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  mats.line = new THREE.MeshBasicMaterial({ color: 0x6a6450, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  mats.lineY = new THREE.MeshBasicMaterial({ color: 0x8a6a20, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  mats.puddle = new THREE.MeshPhongMaterial({ color: 0x0c0d14, specular: 0x3a3a50, shininess: 120, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  // vehicles
  mats.paint = new THREE.MeshPhongMaterial({ vertexColors: true, map: grime, shininess: 60, specular: 0x3a3a44 });
  mats.glass = new THREE.MeshPhongMaterial({ color: 0x07080b, specular: 0x9098b0, shininess: 110 });
  mats.glassBroken = new THREE.MeshPhongMaterial({ map: crackGlass, color: 0x9aa0aa, specular: 0x606878, shininess: 60 });
  mats.chrome = new THREE.MeshPhongMaterial({ color: 0x8a8a90, specular: 0xffffff, shininess: 80 });
  mats.rim = new THREE.MeshPhongMaterial({ color: 0x55565c, specular: 0x8a8a90, shininess: 50 });
  mats.tire = L({ color: 0x0d0d0e });
  mats.carDark = L({ color: 0x0f0f11 });
  mats.bumper = L({ color: 0x1c1c1f });
  mats.headL = new THREE.MeshBasicMaterial({ color: 0xfff0c8 });
  mats.headF = new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true });
  mats.lightOff = new THREE.MeshPhongMaterial({ color: 0x6a6a64, specular: 0xffffff, shininess: 90 });
  mats.tailL = new THREE.MeshBasicMaterial({ color: 0xd01010 });
  mats.tailOff = new THREE.MeshPhongMaterial({ color: 0x4a0808, specular: 0x804040, shininess: 60 });
  mats.plate = L({ map: plates });
  mats.signEm = new THREE.MeshBasicMaterial({ map: plates });
  mats.sirenR = new THREE.MeshBasicMaterial({ color: 0xff2020 });
  mats.sirenB = new THREE.MeshBasicMaterial({ color: 0x2050ff });
  mats.lampOff = L({ color: 0x3a3a3c });
  mats.decal = L({ map: decalTex, alphaTest: 0.45, color: 0x9a9690, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mats.puddle.envMap = envCube; mats.puddle.combine = THREE.MixOperation; mats.puddle.reflectivity = 0.5;
  mats.vc = L({ vertexColors: true }); mats.vcD = mats.vc;
  mats.vc2 = L({ vertexColors: true, side: THREE.DoubleSide }); mats.vc2D = mats.vc2;
  mats.vcB = new THREE.MeshBasicMaterial({ vertexColors: true });

  const aoMat = (m, k = 0.5) => { m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vAoY; varying float vAoN;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAoY = position.y; vAoN = abs(normal.y);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAoY; varying float vAoN;').replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb *= mix(1.0, mix(${(1 - k).toFixed(2)}, 1.0, smoothstep(0.0, 1.5, vAoY)), step(vAoN, 0.5));`);
  }; m.customProgramCacheKey = () => 'ao' + k; };
  for (const k of ['facA', 'facB', 'facC', 'facD', 'facE', 'shop0', 'shop1', 'shop2', 'concrete', 'vc', 'metroWall', 'curtain', 'floorGran']) if (mats[k]) aoMat(mats[k], k === 'vc' ? 0.35 : 0.5);
  mats.puddle.reflectivity = 0.72; mats.puddle.shininess = 160;
  const box1 = new THREE.BoxGeometry(1, 1, 1);
  const plane = new THREE.PlaneGeometry(1, 1); const flat = plane.clone(); flat.rotateX(-PI / 2);

  // ---------------------------------------------------------------- ground
  const groundL = L({ map: asphalt, color: 0x9a96a0 });
  const groundP = new THREE.MeshPhongMaterial({ map: asphalt, color: 0x8e8a96, specularMap: wetTex, specular: 0x8a8aa0, shininess: 55, envMap: envCube, combine: THREE.MixOperation, reflectivity: 0.32, bumpMap: asphalt, bumpScale: 0.8 }); groundP.userData.bm = asphalt;
  // one asphalt sheet over all districts (600 m) with holes for stairwells; uv 0..1 over the sheet
  const GX0 = -240, GZ0 = -250, GS = 560;
  const gShape = new THREE.Shape([[GX0, -GZ0], [GX0 + GS, -GZ0], [GX0 + GS, -(GZ0 + GS)], [GX0, -(GZ0 + GS)]].map(p => new THREE.Vector2(p[0], p[1])));
  for (const [x0, x1, z0, z1] of HOLES) gShape.holes.push(new THREE.Path([[x0, -z0], [x0, -z1], [x1, -z1], [x1, -z0]].map(p => new THREE.Vector2(p[0], p[1]))));
  const gGeo = new THREE.ShapeGeometry(gShape); gGeo.rotateX(-PI / 2);
  { const pa = gGeo.attributes.position, uv = gGeo.attributes.uv; for (let i = 0; i < pa.count; i++) uv.setXY(i, (pa.getX(i) - GX0) / GS, 1 - (pa.getZ(i) - GZ0) / GS); }
  asphalt.repeat.set(GS / 8.67, GS / 8.67); wetTex.repeat.set(GS / 18.6, GS / 18.6);
  const ground = new THREE.Mesh(gGeo, groundL);
  ground.receiveShadow = true; scene.add(ground);

  // ---------------------------------------------------------------- blocks: sidewalks, curbs
  const blocks = [];
  for (const [x0, x1] of SPANS) for (const [z0, z1] of SPANS) blocks.push({ x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 });
  const slab = (x0, x1, z0, z1, key) => { const w = x1 - x0, d = z1 - z0; add(tiledBox(w, 0.1, d, key === 'lot' ? 24 : key === 'paving' ? 2 : 1.5), key, (x0 + x1) / 2, 0.05, (z0 + z1) / 2); };
  for (const b of blocks) {
    const x0 = b.x0, x1 = b.x1, z0 = b.z0, z1 = b.z1;
    b.special = (b.x0 === 9 && b.z0 === -47) ? 'plaza' : (b.x0 === -47 && b.z0 === 9) ? 'gas' : null;
    if (b.special === 'plaza') { slab(x0, 28, z0, z1, 'paving'); slab(28, x1, z0, z1, 'lot'); }
    else slab(x0, x1, z0, z1, 'sidewalk');
    const curb = (x, z, w, d) => add(box1, 'curb', x, 0.07, z, 0, 0, 0, w, 0.14, d);
    if (b.x0 > -84) curb(b.x0 + 0.1, (z0 + z1) / 2, 0.2, z1 - z0);
    if (b.x1 < 84) curb(b.x1 - 0.1, (z0 + z1) / 2, 0.2, z1 - z0);
    if (b.z0 > -84) curb((x0 + x1) / 2, b.z0 + 0.1, x1 - x0, 0.2);
    if (b.z1 < 84) curb((x0 + x1) / 2, b.z1 - 0.1, x1 - x0, 0.2);
    mapRects.push({ x: b.cx, z: b.cz, w: b.w, d: b.d, rot: 0, kind: b.special === 'plaza' ? 'p' : 'blk' });
  }
  // ---------------------------------------------------------------- road markings
  for (const r of ROADS) {
    for (let t = -108; t < 108; t += 4) {
      if (ROADS.some(q => Math.abs(t - q) < 10)) continue;
      if (r === 0) { add(flat, 'lineY', r - 0.12, 0.02, t, 0, 0, 0, 0.12, 1, 2); add(flat, 'lineY', r + 0.12, 0.02, t, 0, 0, 0, 0.12, 1, 2); add(flat, 'lineY', t, 0.02, r - 0.12, 0, 0, 0, 2, 1, 0.12); add(flat, 'lineY', t, 0.02, r + 0.12, 0, 0, 0, 2, 1, 0.12); }
      else { add(flat, 'line', r, 0.02, t, 0, 0, 0, 0.14, 1, 2); add(flat, 'line', t, 0.02, r, 0, 0, 0, 2, 1, 0.14); }
    }
    for (const q of ROADS) {
      for (let k = -5; k <= 5; k++) for (const s of [-1, 1]) {
        add(flat, 'line', r + k * 1.08, 0.021, q + s * 7.6, 0, 0, 0, 0.55, 1, 2.4);
        add(flat, 'line', q + s * 7.6, 0.021, r + k * 1.08, 0, 0, 0, 2.4, 1, 0.55);
      }
      for (const s of [-1, 1]) { add(flat, 'line', r + s * 3, 0.021, q + s * 9.3, 0, 0, 0, 6, 1, 0.3); add(flat, 'line', q - s * 9.3, 0.021, r + s * 3, 0, 0, 0, 0.3, 1, 6); }
    }
  }

  // ---------------------------------------------------------------- buildings
  const buildings = [];
  const facKeys = ['facA', 'facE', 'facB', 'facB', 'facC', 'facE', 'facD'];
  const decalGeo = (slot) => { const g = new THREE.PlaneGeometry(1, 1); const col = slot % 4, row = slot / 4 | 0, uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + uv.getX(i)) / 4, 1 - (row + 1 - uv.getY(i)) / 2); return g; };
  const decalGeos = [0, 1, 2, 3, 4, 5, 6, 7].map(decalGeo);
  const pipeGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 6), mastGeo = new THREE.CylinderGeometry(0.03, 0.04, 1, 4);
  const shedGeo = (() => { const s = new THREE.Shape(); s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0.5, 0.75); s.lineTo(-0.5, 1); s.closePath(); const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }); g.translate(0, 0, -0.5); return g; })();
  // wall decal on a face: f = 'x+'/'x-'/'z+'/'z-'
  const wallDecal = (x, z, w, d, f, t, y, sz, slot) => {
    const sgn = f[1] === '+' ? 1 : -1, ry = f[0] === 'x' ? sgn * PI / 2 : (sgn > 0 ? 0 : PI);
    const px = f[0] === 'x' ? x + sgn * (w / 2 + 0.03) : x + t, pz = f[0] === 'x' ? z + t : z + sgn * (d / 2 + 0.03);
    add(decalGeos[slot], 'decal', px, y, pz, ry, 0, rr(-0.08, 0.08), sz, sz, 1);
  };
  let signIdx = 0;
  const signGeo = (slot) => { const g = new THREE.PlaneGeometry(1, 1); const col = slot % 4, row = slot / 4 | 0, uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + uv.getX(i)) / 4, 1 - (row + 1 - uv.getY(i)) / 4); return g; };
  const tankGeo = new THREE.CylinderGeometry(0.6, 0.6, 1.4, 10);
  // faces: subset of 'x-','x+','z-','z+' that face streets (shopfronts + signs + AC units)
  const building = (x0, x1, z0, z1, h, faces, opt = {}) => {
    const w = x1 - x0, d = z1 - z0, x = (x0 + x1) / 2, z = (z0 + z1) / 2;
    const fk = opt.fac || pick(facKeys);
    const ruined = opt.ruined ?? rnd() < 0.22;
    const gf = 3.6, shop = faces.length > 0;
    if (shop) {
      add(tiledBox(w, gf, d, 4, 4), pick(['shop0', 'shop1', 'shop2', 'shop0', 'shop1']), x, gf / 2, z);
      add(tiledBox(w, h - gf, d, 6, 6), fk, x, gf + (h - gf) / 2, z);
      add(box1, 'metal', x, gf + 0.05, z, 0, 0, 0, w + 0.3, 0.12, d + 0.3);
    } else add(tiledBox(w, h, d, 6, 6), fk, x, h / 2, z);
    for (const f of faces) {
      const along = f[0] === 'x' ? d : w, sgn = f[1] === '+' ? 1 : -1;
      const n = Math.max(1, Math.floor(along / 7));
      const ry = f[0] === 'x' ? sgn * PI / 2 : (sgn > 0 ? 0 : PI);
      for (let i = 0; i < n; i++) {
        const t = -along / 2 + along * (i + 0.5) / n;
        const px = f[0] === 'x' ? x + sgn * (w / 2 + 0.05) : x + t, pz = f[0] === 'x' ? z + t : z + sgn * (d / 2 + 0.05);
        if (rnd() < 0.85) add(signGeo(signIdx++ % 16), 'signs', px, gf - 0.45, pz, ry, 0, rnd() < 0.15 ? rr(-.25, .25) : 0, 3.2, 0.9, 1);
        if (rnd() < 0.45) {
          const ax = f[0] === 'x' ? x + sgn * (w / 2 + 0.7) : px, az = f[0] === 'x' ? pz : z + sgn * (d / 2 + 0.7);
          add(box1, rnd() < .5 ? 'awning' : 'awning2', ax, gf - 1.05, az, ry, -0.35, 0, 3.0, 0.05, 1.5);
        }
        for (let fl = 0; fl < Math.min(4, (h - gf) / 3 | 0); fl++) {
          if (rnd() < 0.5) continue;
          const yy = gf + 1.0 + fl * 3, off = rr(-1.5, 1.5);
          const qx = f[0] === 'x' ? x + sgn * (w / 2 + 0.25) : px + off, qz = f[0] === 'x' ? pz + off : z + sgn * (d / 2 + 0.25);
          if (rnd() < 0.6) add(box1, 'acunit', qx, yy, qz, ry, 0, 0, 0.8, 0.55, 0.45);
          else {
            const bx = f[0] === 'x' ? x + sgn * (w / 2 + 0.45) : qx, bz = f[0] === 'x' ? qz : z + sgn * (d / 2 + 0.45);
            add(box1, 'concrete', bx, yy - 0.6, bz, ry, 0, 0, 2.4, 0.12, 0.9);
            const rx2 = f[0] === 'x' ? x + sgn * (w / 2 + 0.88) : qx, rz2 = f[0] === 'x' ? qz : z + sgn * (d / 2 + 0.88);
            add(box1, 'metal', rx2, yy - 0.1, rz2, ry, 0, 0, 2.4, 0.9, 0.04);
          }
        }
      }
    }
    // floor ledges + cornice so blocks read as stacked storeys, not boxes
    const floors = Math.max(0, Math.floor((h - gf) / 3));
    for (let k = 1; k <= Math.min(floors, 6); k += (floors > 4 ? 2 : 1)) add(box1, 'ledge', x, gf + k * 3 - 0.05, z, 0, 0, 0, w + 0.22, 0.12, d + 0.22);
    if (!ruined) { add(box1, 'ledgeD', x, h - 0.12, z, 0, 0, 0, w + 0.45, 0.28, d + 0.45); add(box1, 'ledge', x, h + 0.05, z, 0, 0, 0, w + 0.3, 0.1, d + 0.3); }
    // drain pipes down one or two corners (with a horizontal run)
    for (let k = 0; k < 1 + (rnd() < 0.4 ? 1 : 0); k++) {
      const sx = rnd() < 0.5 ? -1 : 1, sz = rnd() < 0.5 ? -1 : 1, px = x + sx * (w / 2 + 0.1), pz = z + sz * (d / 2 - 0.4);
      add(pipeGeo, 'pipe', px, h / 2, pz, 0, 0, 0, 1, h, 1);
      if (rnd() < 0.5) { const yy = rr(gf, h - 1); add(pipeGeo, 'pipe', px - sx * 0.02, yy, z + sz * (d / 2 - 0.4) - sz * rr(1, d * 0.4) / 2, 0, PI / 2, 0, 0.8, rr(1, d * 0.4), 0.8); }
    }
    // posters / notices / graffiti at street level on every side
    for (const f of ['x-', 'x+', 'z-', 'z+']) {
      const along = f[0] === 'x' ? d : w, n = Math.floor(along / 6);
      for (let i = 0; i < n; i++) {
        if (rnd() < 0.55) continue;
        const t = rr(-along / 2 + 1, along / 2 - 1), slot = rnd() < 0.55 ? (rnd() * 4 | 0) : 4 + (rnd() * 4 | 0);
        wallDecal(x, z, w, d, f, t, slot < 4 ? rr(1.2, 1.8) : rr(1.0, 2.2), slot < 4 ? rr(0.55, 0.8) : rr(1.4, 2.4), slot);
        if (slot < 4 && rnd() < 0.6) wallDecal(x, z, w, d, f, t + rr(0.5, 0.8) * (rnd() < .5 ? -1 : 1), rr(1.1, 1.9), rr(0.5, 0.7), rnd() * 4 | 0);
      }
    }
    if (ruined) {
      for (let k = 0; k < 4; k++) { const ww = rr(1.5, w * 0.5), dd = rr(1.5, d * 0.5), hh = rr(1, 4); add(tiledBox(ww, hh, dd, 6), fk, x + rr(-w, w) * 0.3, h + hh / 2 - 0.3, z + rr(-d, d) * 0.3, rr(-.2, .2), rr(-.15, .15), rr(-.15, .15)); }
      for (let k = 0; k < 6; k++) { const s = rr(0.4, 1.4), side = rnd() < 0.5; const px = x + (side ? (rnd() < .5 ? -1 : 1) * (w / 2 + rr(0.2, 1.0)) : rr(-w / 2, w / 2)); const pz = z + (!side ? (rnd() < .5 ? -1 : 1) * (d / 2 + rr(0.2, 1.0)) : rr(-d / 2, d / 2)); add(box1, 'rubble', px, s * 0.3, pz, rr(0, 3), rr(-.4, .4), rr(-.4, .4), s, s * 0.6, s * 0.8); }
    } else {
      // varied rooflines: setback penthouse, iron-sheet rooftop shack (頂樓加蓋), billboard frame or masts
      const rt = rnd();
      if (rt < 0.3 && w > 6 && d > 6) {
        const pw = w * rr(0.45, 0.7), pd = d * rr(0.45, 0.7), ph = rr(2.8, 6), ox = rr(-1, 1) * (w - pw) / 2, oz = rr(-1, 1) * (d - pd) / 2;
        add(tiledBox(pw, ph, pd, 6, 6), fk, x + ox, h + ph / 2, z + oz); add(box1, 'ledgeD', x + ox, h + ph, z + oz, 0, 0, 0, pw + 0.3, 0.2, pd + 0.3);
      } else if (rt < 0.6) {
        const sw = Math.min(w * 0.8, rr(4, 8)), sd = Math.min(d * 0.8, rr(3, 6)), ox = rr(-1, 1) * (w - sw) / 2.5, oz = rr(-1, 1) * (d - sd) / 2.5;
        add(box1, rnd() < 0.5 ? 'sheet' : 'sheet2', x + ox, h + 1.2, z + oz, 0, 0, 0, sw, 2.4, sd);
        add(shedGeo, 'rust', x + ox, h + 2.4, z + oz, rnd() < 0.5 ? 0 : PI / 2, 0, 0, sw + 0.4, 0.9, sd + 0.4);
      } else if (rt < 0.75) {
        const bw = Math.min(w, 7), side = rnd() < 0.5 ? 1 : -1;
        for (const s of [-1, 1]) add(box1, 'metal', x + s * bw * 0.4, h + 2.2, z + side * d * 0.3, 0, 0, 0, 0.12, 4.4, 0.12);
        add(box1, 'metal', x, h + 3.0, z + side * d * 0.3, 0, 0, 0, bw, 2.4, 0.15);
        add(signGeo(signIdx++ % 16), 'signs', x, h + 3.0, z + side * (d * 0.3 + 0.09), side > 0 ? 0 : PI, 0, 0, bw - 0.3, 2.1, 1);
      } else for (let k = 0; k < 2; k++) { const mh = rr(3, 7); add(mastGeo, 'metal', x + rr(-w / 3, w / 3), h + mh / 2, z + rr(-d / 3, d / 3), 0, 0, 0, 1, mh, 1); }
      for (let k = 0; k < 1 + (rnd() * 2 | 0); k++) add(tankGeo, 'tank', x + rr(-w / 3, w / 3), h + 0.9, z + rr(-d / 3, d / 3));
      add(box1, 'concrete', x + rr(-w / 4, w / 4), h + 1.1, z + rr(-d / 4, d / 4), 0, 0, 0, 2.2, 2.2, 2.4);
      add(box1, 'metal', x, h + 0.25, z - d / 2 + 0.1, 0, 0, 0, w, 0.5, 0.15); add(box1, 'metal', x, h + 0.25, z + d / 2 - 0.1, 0, 0, 0, w, 0.5, 0.15);
    }
    addCollider(x, z, w, d, 0, h);
    mapRects.push({ x, z, w, d, rot: 0, kind: 'b' });
    buildings.push({ x, z, w, d, h, x0, x1, z0, z1 });
  };
  const facesFor = (x0, x1, z0, z1, b) => {
    const f = [];
    if (Math.abs(x0 - (b.x0 + SWW)) < 0.1 && b.x0 > -84) f.push('x-');
    if (Math.abs(x1 - (b.x1 - SWW)) < 0.1 && b.x1 < 84) f.push('x+');
    if (Math.abs(z0 - (b.z0 + SWW)) < 0.1 && b.z0 > -84) f.push('z-');
    if (Math.abs(z1 - (b.z1 - SWW)) < 0.1 && b.z1 < 84) f.push('z+');
    return f;
  };
  const alleys = [];
  const cityBlock = (b, opts = {}) => {
    const ix0 = b.x0 > -84 ? b.x0 + SWW : b.x0, ix1 = b.x1 < 84 ? b.x1 - SWW : b.x1;
    const iz0 = b.z0 > -84 ? b.z0 + SWW : b.z0, iz1 = b.z1 < 84 ? b.z1 - SWW : b.z1;
    const ax = (ix0 + ix1) / 2 + rr(-3, 3), az = (iz0 + iz1) / 2 + rr(-3, 3), AW = 2.2;
    const splitX = (ix1 - ix0) > 24, splitZ = (iz1 - iz0) > 24;
    const xs = splitX ? [[ix0, ax - AW], [ax + AW, ix1]] : [[ix0, ix1]];
    const zs = splitZ ? [[iz0, az - AW], [az + AW, iz1]] : [[iz0, iz1]];
    if (splitX) alleys.push({ x0: ax - AW, x1: ax + AW, z0: iz0, z1: iz1 });
    if (splitZ) alleys.push({ x0: ix0, x1: ix1, z0: az - AW, z1: az + AW });
    for (const [x0, x1] of xs) for (const [z0, z1] of zs) {
      if (opts.skip && opts.skip(x0, x1, z0, z1)) continue;
      const wide = (x1 - x0) >= (z1 - z0), len = wide ? x1 - x0 : z1 - z0;
      const cuts = len > 12 && rnd() < 0.75 ? [0, rr(0.4, 0.6), 1] : [0, 1];
      for (let i = 0; i < cuts.length - 1; i++) {
        let a0 = cuts[i] * len; const a1 = cuts[i + 1] * len; if (i > 0) a0 += 0.6;
        const bx0 = wide ? x0 + a0 : x0, bx1 = wide ? x0 + a1 : x1, bz0 = wide ? z0 : z0 + a0, bz1 = wide ? z1 : z0 + a1;
        const edge = b.x0 === -84 || b.x1 === 84 || b.z0 === -84 || b.z1 === 84;
        building(bx0, bx1, bz0, bz1, edge ? rr(12, 26) : rr(8, 20), facesFor(bx0, bx1, bz0, bz1, b));
      }
    }
  };
  function ruinLot(x0, x1, z0, z1) {
    const x = (x0 + x1) / 2, z = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    add(tiledBox(w, 4.5, 0.4, 6), 'facD', x, 2.25, z1 - 0.2, 0, 0, 0.04); addCollider(x, z1 - 0.2, w, 0.4, 0, 4.5);
    add(tiledBox(0.4, 6, d * 0.6, 6), 'facD', x1 - 0.2, 3, z + d * 0.2); addCollider(x1 - 0.2, z + d * 0.2, 0.4, d * 0.6, 0, 6);
    add(tiledBox(w * 0.4, 2.2, 0.4, 6), 'facD', x0 + w * 0.2, 1.1, z0 + 0.2, 0, 0, -0.06); addCollider(x0 + w * 0.2, z0 + 0.2, w * 0.4, 0.4, 0, 2.2);
    for (let k = 0; k < 6; k++) { const s = rr(1.2, 2.6), px = x + rr(-w / 3, w / 3), pz = z + rr(-d / 3, d / 3); add(box1, 'rubble', px, s * 0.3, pz, rr(0, 3), rr(-.3, .3), rr(-.3, .3), s, s * 0.6, s); addCollider(px, pz, s * 0.8, s * 0.8, 0, s * 0.5); }
    for (let k = 0; k < 30; k++) { const s = rr(0.2, 0.7); add(box1, 'rubble', x + rr(-w / 2, w / 2), s * 0.2, z + rr(-d / 2, d / 2), rr(0, 3), rr(-.5, .5), rr(-.5, .5), s, s * 0.5, s * 0.8); }
    for (let k = 0; k < 5; k++) add(box1, 'metal', x + rr(-w / 3, w / 3), rr(0.3, 1.5), z + rr(-d / 3, d / 3), rr(0, 3), rr(-.8, .8), rr(-.8, .8), 0.12, 0.12, rr(2, 4));
    mapRects.push({ x, z, w, d, rot: 0, kind: 'r' });
  }
  for (const b of blocks) {
    if (b.special === 'plaza') continue;
    if (b.special === 'gas') { cityBlock(b, { skip: (x0, x1) => x1 > -30 }); continue; }
    if (b.x0 === 9 && b.z0 === 9) {
      let first = true;
      cityBlock(b, { skip: (x0, x1, z0, z1) => { if (first && x0 > 20 && z0 > 20) { first = false; ruinLot(x0, x1, z0, z1); return true; } return false; } });
      continue;
    }
    cityBlock(b);
  }

  // ---------------------------------------------------------------- props: helpers
  const jerseyGeo = (() => {
    const s = new THREE.Shape(); const p = [[-0.3, 0], [0.3, 0], [0.3, 0.08], [0.12, 0.3], [0.08, 0.82], [-0.08, 0.82], [-0.12, 0.3], [-0.3, 0.08]];
    s.moveTo(p[0][0], p[0][1]); p.slice(1).forEach(q => s.lineTo(q[0], q[1])); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 2.9, bevelEnabled: false }); g.translate(0, 0, -1.45); g.rotateY(PI / 2);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.6, uv.getY(i) * 0.6);
    return g;
  })();
  const jersey = (x, z, ry, mk = true) => { add(jerseyGeo, 'concrete', x, 0, z, ry); if (rnd() < 0.5) add(flat, 'stripe', x, 0.835, z, ry, 0, 0, 2.6, 1, 0.14); addCollider(x, z, 2.9, 0.6, ry, 0.85); if (mk) mapRects.push({ x, z, w: 2.9, d: 0.6, rot: ry, kind: 'c' }); };
  const sandbagGeo = new THREE.SphereGeometry(0.5, 7, 5);
  const sandbags = (x, z, ry, n = 4) => {
    const c = Math.cos(ry), s = Math.sin(ry);
    for (let row = 0; row < 3; row++) for (let i = 0; i < n - (row === 2 ? 1 : 0); i++) {
      const t = (i - (n - 1) / 2) * 0.62 + (row % 2) * 0.3;
      add(sandbagGeo, 'sand', x + c * t, 0.13 + row * 0.24, z - s * t, ry + rr(-.1, .1), 0, 0, 0.66, 0.28, 0.4);
    }
    addCollider(x, z, n * 0.62, 0.5, ry, 0.75); mapRects.push({ x, z, w: n * 0.62, d: 0.5, rot: ry, kind: 'c' });
  };
  const sawhorse = (x, z, ry) => {
    const c = Math.cos(ry), s = Math.sin(ry);
    add(box1, 'stripe', x, 0.85, z, ry, 0, 0, 1.8, 0.22, 0.05);
    for (const t of [-0.75, 0.75]) for (const k of [-1, 1]) add(box1, 'wood', x + c * t + s * k * 0.15, 0.42, z - s * t + c * k * 0.15, ry, k * 0.3, 0, 0.06, 0.9, 0.06);
    addCollider(x, z, 1.8, 0.4, ry, 0.9);
  };
  const fence = (x, z, len, ry) => {
    const g = plane.clone(); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 1.2, uv.getY(i) * 2.2 / 1.2);
    add(g, 'fence', x, 1.1, z, ry, 0, 0, len, 2.2, 1);
    const c = Math.cos(ry), s = Math.sin(ry);
    for (let t = -len / 2; t <= len / 2 + 0.01; t += 2.5) add(box1, 'metal', x + c * t, 1.15, z - s * t, 0, 0, 0, 0.07, 2.3, 0.07);
    addCollider(x, z, len, 0.15, ry, 2.2); mapRects.push({ x, z, w: len, d: 0.15, rot: ry, kind: 'c' });
  };
  const dumpster = (x, z, ry) => { add(box1, 'dumpster', x, 0.6, z, ry, 0, 0, 1.9, 1.15, 1.1); add(box1, 'dumpster', x, 1.22, z, ry, rnd() < .5 ? -0.5 : 0, 0, 1.95, 0.06, 1.15); addCollider(x, z, 1.9, 1.1, ry, 1.25); mapRects.push({ x, z, w: 1.9, d: 1.1, rot: ry, kind: 'c' }); };

  // ---------------------------------------------------------------- vehicles
  const carInfo = [], fires = [], neons = [];
  const flameGeo = new THREE.ConeGeometry(0.28, 0.9, 9, 1, true);
  const flameTex = canvasTex(64, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let k = 0; k < 7; k++) { // licking tongues: vertical gradient strips
      const x = k * 9 + Math.random() * 4, top = 10 + Math.random() * 50;
      const gr = g.createLinearGradient(0, h, 0, top); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(x - 6, h); g.quadraticCurveTo(x - 4 + Math.random() * 8, (h + top) / 2, x + 3, top); g.quadraticCurveTo(x + 8, (h + top) / 2, x + 12, h); g.fill();
    }
  }, false);
  const flameMat = new THREE.MeshBasicMaterial({ map: flameTex, color: 0xff6a20, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const flameMat2 = new THREE.MeshBasicMaterial({ map: flameTex, color: 0xffc860, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const glowT = glowTexW();
  const fireGlowMat = new THREE.SpriteMaterial({ map: glowT, color: 0xff7a30, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const addFire = (x, y, z, big = false) => {
    let f1;
    if (big) { // cluster of tongues spread over the car
      f1 = new THREE.Group(); f1.position.set(x, y + 0.45, z);
      for (let k = 0; k < 5; k++) { const m = new THREE.Mesh(flameGeo, flameMat); m.position.set(rr(-0.7, 0.7), rr(0, 0.2), rr(-0.5, 0.5)); m.scale.set(rr(1.2, 2.0), rr(1.0, 1.8), rr(1.2, 2.0)); m.rotation.y = rr(0, 6); m.position.y += 0.45 * m.scale.y; f1.add(m); }
      scene.add(f1);
    } else { f1 = new THREE.Mesh(flameGeo, flameMat); f1.position.set(x, y + 0.4, z); scene.add(f1); }
    const f2 = new THREE.Mesh(flameGeo, flameMat2); f2.position.set(x, y + 0.25, z); f2.scale.setScalar(big ? 1.4 : 0.6); scene.add(f2);
    const fg = new THREE.Sprite(fireGlowMat); fg.position.set(x, y + 0.5, z); fg.scale.setScalar(big ? 5 : 2.4); scene.add(fg);
    fires.push({ x, z, y, f1, f2, light: null, ph: rnd() * 10, big });
    mapRects.push({ x, z, w: big ? 1.6 : 0.8, d: big ? 1.6 : 0.8, rot: 0, kind: 'f' });
  };
  const headGlowMat = new THREE.SpriteMaterial({ map: glowT, color: 0xfff0c8, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  const beamTex = canvasTex(64, 128, (g, w, h) => { const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(255,240,200,.9)'); gr.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(w * 0.35, h); g.lineTo(w * 0.65, h); g.lineTo(w, 0); g.lineTo(0, 0); g.fill(); });
  const PALETTE = [0x8a8d92, 0xc8c8c4, 0x1a1b1e, 0x1f2a44, 0x5a1a1e, 0x22382c, 0xa89a7a, 0x55585e, 0x8a1c1c, 0x2a3a5a, 0x6a6458];
  const placeCar = (type, x, z, ry, o = {}) => {
    const opts = { seed: (rnd() * 1000) | 0, color: o.color ?? (type === 'police' || type === 'ambulance' ? 0xdcdcd8 : type === 'taxi' ? 0xc8a020 : type === 'bus' ? 0x8a8a84 : pick(PALETTE)), rust: o.rust ?? rr(0.05, 0.45), ...o };
    if (o.random !== false && !o.burnt) {
      if (opts.broken === undefined) opts.broken = rnd() < 0.45;
      if (opts.crashed === undefined) opts.crashed = rnd() < 0.3;
      if (opts.flat === undefined && rnd() < 0.35) opts.flat = [rnd() * 4 | 0];
      if (opts.doorOpen === undefined && rnd() < 0.2 && type !== 'bus' && type !== 'van' && type !== 'ambulance') opts.doorOpen = rnd() < .5 ? 1 : -1;
    }
    const car = buildCar(type, opts);
    const roll = o.roll || 0;
    const lean = opts.flat && opts.flat.length && !roll ? 0.035 * (opts.flat[0] % 2 ? -1 : 1) : 0;
    _m.compose(_v.set(x, roll === PI ? car.H + 0.02 : roll ? car.W / 2 : 0, z), _q.setFromEuler(_e.set(roll || lean, ry, 0, 'YXZ')), _s.set(1, 1, 1));
    for (const p of car.parts) { p.g.applyMatrix4(_m); pushGeo(p.g, p.m, x, z); }
    const h = roll === PI ? car.H : roll ? car.W : car.H, cw = roll && roll !== PI ? car.H : car.W;
    addCollider(x, z, car.L, cw, ry, Math.min(h, 2.2));
    mapRects.push({ x, z, w: car.L, d: cw, rot: ry, kind: 'v' });
    carInfo.push({ type, x, z, ry, L: car.L, W: car.W, H: car.H, burnt: !!opts.burnt, roll });
    const fx = Math.cos(ry), fz = -Math.sin(ry);
    if (opts.burnt && o.fire !== false) addFire(x + fx * car.L * 0.2, roll === PI ? 0.4 : 0.7, z + fz * car.L * 0.2, true);
    if (opts.lights && !roll) {
      const hx = car.L / 2 + 0.1, mat = opts.lights === 'flicker' ? headGlowMat.clone() : headGlowMat;
      for (const s of [-1, 1]) { const sp = new THREE.Sprite(mat); sp.position.set(x + fx * hx + Math.sin(ry) * s * car.W * 0.33, car.H < 2 ? 0.75 : 0.95, z + fz * hx + Math.cos(ry) * s * car.W * 0.33); sp.scale.setScalar(1.1); scene.add(sp); }
      const bm = new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });
      const bg = new THREE.PlaneGeometry(3.4, 7); bg.rotateX(-PI / 2);
      const beam = new THREE.Mesh(bg, bm); beam.rotation.y = ry - PI / 2; beam.position.set(x + fx * (hx + 3.5), 0.04, z + fz * (hx + 3.5)); beam.renderOrder = 1; scene.add(beam);
      if (opts.lights === 'flicker') neons.push({ mat: mats.headF, ph: rnd() * 9, mode: 'stutter' }, { mat, ph: 2, mode: 'stutter', max: 0.6 }, { mat: bm, ph: 2, mode: 'stutter', max: 0.18 });
    }
    return car;
  };
  // checkpoint on the north road (x=0, z≈-40): police, ambulance, barriers
  placeCar('police', -2.8, -38, 0.35, { lights: 'flicker', random: false, broken: true, doorOpen: 1, rust: 0.05 });
  placeCar('police', 3.4, -41.5, PI - 0.5, { random: false, rust: 0.08, tail: true });
  placeCar('ambulance', -1.5, -45.5, PI / 2 + 0.2, { random: false, broken: true, rust: 0.1, lights: true });
  for (const xx of [-4.6, -1.6, 1.4]) jersey(xx, -33.5, rr(-.08, .08));
  sandbags(4.4, -33.8, 0.1, 4); sawhorse(-5.0, -30.5, 0.3);
  // central intersection: pile-up + burning car
  placeCar('sedan', -3.6, 13.5, 0.2, { burnt: true, random: false });
  placeCar('taxi', 4.2, -12.6, PI + 0.4, { crashed: true, broken: true });
  placeCar('suv', 13.5, 3.2, 1.6, { flat: [0, 2], broken: true });
  placeCar('hatch', -14.5, -3.4, -1.3, { roll: PI, random: false, broken: true });
  // crashed bus across the east road
  placeCar('bus', 30, 1.0, 0.25, { random: false, broken: true, crashed: true, rust: 0.35, flat: [1] });
  placeCar('van', -30, -2.5, PI - 0.15, { roll: PI / 2, random: false, broken: true });
  // road-end barricades at the map bounds
  for (const r of ROADS) for (const s of [-1, 1]) {
    if (r === 0) { for (const [ax, az, ry] of [[0, s * 86, 0], [s * 86, 0, PI / 2]]) { jersey(ry ? ax : ax - 4.5, ry ? az - 4.5 : az, ry + 0.3); jersey(ry ? ax + s * 1.5 : ax + 4.8, ry ? az + 4.8 : az + s * 1.5, ry - 0.4); } continue; }
    for (const [ax, az, ry] of [[r, s * 82.5, 0], [s * 82.5, r, PI / 2]]) {
      for (let t = -5; t <= 5; t += 3.2) { const px = ry ? ax : ax + t, pz = ry ? az + t : az; jersey(px, pz, ry + rr(-.1, .1), false); }
      fence(ry ? ax + s * 1.2 : ax, ry ? az : az + s * 1.2, 12.5, ry);
      if (rnd() < 0.6) placeCar(pick(['sedan', 'suv', 'van', 'pickup']), ry ? ax - s * 3.6 : ax + rr(-2.5, 2.5), ry ? az + rr(-2.5, 2.5) : az - s * 3.6, ry ? rr(-.5, .5) : PI / 2 + rr(-.5, .5), { crashed: true });
    }
  }
  // parked / abandoned cars along curbs and in lanes
  const types = ['sedan', 'sedan', 'hatch', 'hatch', 'suv', 'pickup', 'van', 'taxi', 'sedan'];
  const carOk = (x, z, r = 3.4) => free(x, z, 1.0) && !carInfo.some(c => Math.hypot(c.x - x, c.z - z) < r) && Math.hypot(x, z - 4) > 7;
  for (const r of ROADS) for (let t = -78; t <= 78; t += rr(8, 13)) {
    if (ROADS.some(q => Math.abs(t - q) < 11)) continue;
    for (const lane of [-1, 1]) {
      if (rnd() < 0.5) continue;
      const curbSide = rnd() < 0.65, off = curbSide ? lane * 4.6 : lane * rr(1, 2.5);
      const dirRot = lane > 0 ? 0 : PI, jitter = curbSide ? rr(-.06, .06) : rr(-.7, .7);
      const mk = () => ({ roll: !curbSide && rnd() < 0.12 ? (rnd() < 0.5 ? PI : PI / 2) : 0, burnt: !curbSide && rnd() < 0.1, lights: rnd() < 0.07 ? 'flicker' : false, tail: rnd() < 0.1 });
      if (carOk(r + off, t)) placeCar(pick(types), r + off, t, PI / 2 + dirRot + jitter, mk());
      if (carOk(t, r + off)) placeCar(pick(types), t, r + off, dirRot + jitter, mk());
    }
  }

  // ---------------------------------------------------------------- plaza + parking lot (NE inner block)
  {
    const fx = 18.5, fz = -28;
    add(new THREE.CylinderGeometry(3.2, 3.3, 0.6, 20), 'concrete', fx, 0.3, fz);
    const water = new THREE.CircleGeometry(2.9, 20); water.rotateX(-PI / 2); add(water, 'water', fx, 0.55, fz);
    add(new THREE.CylinderGeometry(0.6, 0.8, 1.6, 10), 'concrete', fx, 1.1, fz);
    const statue = new THREE.LatheGeometry([[0, 0], [0.32, 0], [0.3, 0.6], [0.22, 1.1], [0.3, 1.4], [0.18, 1.7], [0.2, 1.9], [0, 2.05]].map(p => new THREE.Vector2(p[0], p[1])), 10);
    add(statue, 'statue', fx, 1.9, fz); add(box1, 'statue', fx + 0.35, 3.2, fz, 0, 0, -0.9, 0.9, 0.12, 0.12);
    addCollider(fx, fz, 5.6, 5.6, PI / 4, 0.6); addCollider(fx, fz, 5.6, 5.6, 0, 0.6);
    mapRects.push({ x: fx, z: fz, w: 6.4, d: 6.4, rot: 0, kind: 'c' });
    for (const [px, pz] of [[12.5, -15], [24, -15], [12.5, -41], [24, -41], [24.5, -21]]) {
      add(tiledBox(2.6, 0.7, 1.2, 1.5), 'concrete', px, 0.35, pz); for (let k = 0; k < 3; k++) add(sandbagGeo, 'bush', px + (k - 1) * 0.8, 0.85, pz, rr(0, 3), 0, 0, rr(.8, 1.2), rr(.6, .9), rr(.8, 1));
      addCollider(px, pz, 2.6, 1.2, 0, 0.7); mapRects.push({ x: px, z: pz, w: 2.6, d: 1.2, rot: 0, kind: 'c' });
    }
    for (const [px, pz, ry] of [[18.5, -21.5, 0], [18.5, -34.5, PI], [12, -28, PI / 2]]) { add(box1, 'wood', px, 0.45, pz, ry, 0, 0, 1.8, 0.08, 0.5); add(box1, 'metal', px, 0.22, pz, ry, 0, 0, 1.6, 0.44, 0.08); }
    for (let i = 0; i < 40; i++) add(plane, 'leaf', rr(10, 27), 0.11, rr(-46, -10), rr(0, 6), -PI / 2, 0, 0.18, 0.12, 1);
    add(tiledBox(2.6, 2.4, 2, 4), 'shop0', 25.5, 1.2, -36); add(box1, 'awning', 25.5, 2.55, -36, 0, 0, 0, 3, 0.1, 2.4); addCollider(25.5, -36, 2.6, 2, 0, 2.4); mapRects.push({ x: 25.5, z: -36, w: 2.6, d: 2, rot: 0, kind: 'b' });
    for (let row = 0; row < 3; row++) {
      const pz = -40 + row * 11;
      for (let i = 0; i <= 6; i++) add(flat, 'line', 30.5 + i * 2.6, 0.105, pz, 0, 0, 0, 0.12, 1, 5);
      for (let i = 0; i < 6; i++) {
        if (rnd() < 0.35) continue;
        placeCar(pick(['sedan', 'hatch', 'suv', 'sedan', 'pickup']), 31.8 + i * 2.6, pz + rr(-.2, .2), (rnd() < .5 ? PI / 2 : -PI / 2) + rr(-.12, .12), { lights: rnd() < 0.08 ? 'flicker' : false });
      }
    }
    add(tiledBox(2, 2.5, 2, 4), 'facC', 30, 1.25, -12.8); add(box1, 'metal', 30, 2.6, -12.8, 0, 0, 0, 2.4, 0.15, 2.4); addCollider(30, -12.8, 2, 2, 0, 2.5);
    add(box1, 'stripe', 33, 1.0, -12.8, 0, 0, 0.5, 3, 0.1, 0.1);
    mapRects.push({ x: 30, z: -12.8, w: 2, d: 2, rot: 0, kind: 'b' });
  }
  // ---------------------------------------------------------------- gas station (SW inner block corner)
  {
    const gx = -19.5, gz = 19.5;
    add(box1, 'white', gx, 5.0, gz, 0, 0, 0, 14, 0.6, 9.5); add(box1, 'gasRed', gx, 5.0, gz, 0, 0, 0, 14.1, 0.25, 9.6);
    for (let i = 0; i < 6; i++) add(box1, i % 3 === 1 ? 'lampOff' : 'panelLit', gx - 5 + i * 2, 4.68, gz + (i % 2 ? 2 : -2), 0, 0, 0, 1.2, 0.03, 0.5);
    for (const [px, pz] of [[-5.5, -3.3], [5.5, -3.3], [-5.5, 3.3], [5.5, 3.3]]) { add(box1, 'white', gx + px, 2.35, gz + pz, 0, 0, 0, 0.45, 4.7, 0.45); addCollider(gx + px, gz + pz, 0.45, 0.45, 0, 4.7); }
    for (const px of [-2.5, 2.5]) {
      add(box1, 'concrete', gx + px, 0.12, gz, 0, 0, 0, 1.0, 0.24, 4.4);
      for (const pz of [-1.2, 1.2]) { add(box1, 'white', gx + px, 0.95, gz + pz, 0, 0, 0, 0.6, 1.5, 0.8); add(box1, 'gasRed', gx + px, 1.55, gz + pz, 0, 0, 0, 0.62, 0.3, 0.82); add(box1, 'metal', gx + px + 0.32, 1.0, gz + pz, 0, 0, 0, 0.04, 0.5, 0.2); }
      addCollider(gx + px, gz, 1.0, 4.4, 0, 1.6); mapRects.push({ x: gx + px, z: gz, w: 1, d: 4.4, rot: 0, kind: 'c' });
    }
    mapRects.push({ x: gx, z: gz, w: 14, d: 9.5, rot: 0, kind: 'g' });
    building(-24, -16, 30, 36, 4.2, ['x+', 'z-'], { fac: 'facC', ruined: false });
    placeCar('pickup', gx - 0.2, gz - 3.2, 0.05, { burnt: true, random: false });
    placeCar('hatch', gx - 4.5, gz + 6.2, 0.6, { doorOpen: 1, broken: true });
    placeCar('sedan', -14, 38, PI / 2 + 0.3, { broken: true });
    add(box1, 'metal', -11, 3.5, 11, 0, 0, 0, 0.3, 7, 0.3); addCollider(-11, 11, 0.3, 0.3, 0, 7);
    add(box1, 'white', -11, 7.2, 11, PI / 4, 0, 0, 2.6, 1.8, 0.3);
  }
  // ---------------------------------------------------------------- bus stop (west sidewalk of the main road)
  {
    const bx = -7.7, bz = 27;
    add(box1, 'glass', bx - 0.65, 1.3, bz, 0, 0, 0, 0.05, 1.9, 3.6); add(box1, 'metal', bx, 2.45, bz, 0, 0, 0.08, 1.6, 0.08, 3.9);
    for (const t of [-1.8, 1.8]) add(box1, 'metal', bx - 0.65, 1.2, bz + t, 0, 0, 0, 0.08, 2.4, 0.08);
    add(box1, 'wood', bx - 0.35, 0.45, bz, 0, 0, 0, 0.4, 0.06, 2.8); addCollider(bx - 0.5, bz, 0.5, 3.8, 0, 2.4);
    add(box1, 'metal', bx + 0.4, 1.4, bz + 2.4, 0, 0, 0, 0.07, 2.8, 0.07); add(plateUV(new THREE.BoxGeometry(0.04, 0.4, 0.8), 14), 'signEm', bx + 0.4, 2.7, bz + 2.4);
    mapRects.push({ x: bx - 0.5, z: bz, w: 0.6, d: 3.8, rot: 0, kind: 'c' });
  }
  // ---------------------------------------------------------------- v0.6 outer districts
  const gRects = [], dLamps = [];
  const DIST = buildDistricts({ THREE, add, addCollider, mapRects, tiledBox, box1, flat, plane, building, placeCar, sandbags, jersey, fence, sawhorse, addFire, rr, rnd, pick, mats, canvasTex, VC, VCD, gRects, lampSpots: dLamps, aoMat, dumpster, barrelGeo: new THREE.CylinderGeometry(0.32, 0.3, 0.9, 10), sandbagGeo, PI });
  // ---------------------------------------------------------------- street lamps (instanced heads/cones), traffic lights
  const lamps = [];
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, 5, 6);
  const lampSpots = [];
  for (const r of ROADS) for (let t = -78; t <= 78; t += 20) {
    if (ROADS.some(q => Math.abs(t - q) < 10)) continue;
    const s = (Math.round(t / 20) % 2) ? 1 : -1;
    lampSpots.push([r + s * 7.3, t, s, 'x'], [t, r + s * 7.3, s, 'z']);
  }
  for (const [px, pz] of [[11, -20], [44, -24], [44, -38]]) lampSpots.push([px, pz, 1, 'x']);
  lampSpots.push(...dLamps);
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.08, 0.2), new THREE.MeshBasicMaterial({ color: 0xffffff }), lampSpots.length);
  // volumetric-looking light cones: bright near the lamp, fading to the ground, with faint dust streaks
  const coneTex = canvasTex(64, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,.04)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'multiply'; for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(${150 + Math.random() * 105 | 0},${150 + Math.random() * 105 | 0},${150 + Math.random() * 105 | 0},1)`; g.fillRect(Math.random() * w, 0, 2 + Math.random() * 6, h); }
  }, false);
  const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(2.3, 4.8, 16, 1, true), new THREE.MeshBasicMaterial({ map: coneTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }), lampSpots.length);
  // warm light pools on the ground under each lamp
  const poolTex = canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false);
  const poolGeo = new THREE.PlaneGeometry(1, 1); poolGeo.rotateX(-PI / 2);
  const pools = new THREE.InstancedMesh(poolGeo, new THREE.MeshBasicMaterial({ map: poolTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }), lampSpots.length);
  const _c = new THREE.Color();
  let li = 0;
  for (const [px, pz, s, ax] of lampSpots) {
    if (!free(px, pz, 0.3)) continue;
    const bent = rnd() < 0.18, tilt = bent ? rr(0.2, 0.45) * (rnd() < .5 ? 1 : -1) : 0;
    const dx = ax === 'x' ? -s : 0, dz = ax === 'z' ? -s : 0;
    add(poleGeo, 'metal', px, 2.5, pz, 0, ax === 'z' ? tilt : 0, ax === 'x' ? tilt : 0);
    addCollider(px, pz, 0.3, 0.3, 0, 5);
    if (bent) continue;
    add(box1, 'metal', px + dx * 0.5, 4.95, pz + dz * 0.5, 0, 0, 0, ax === 'x' ? 1.1 : 0.12, 0.1, ax === 'z' ? 1.1 : 0.12);
    const hx = px + dx * 0.9, hz = pz + dz * 0.9;
    _m.compose(_v.set(hx, 4.86, hz), _q.setFromEuler(_e.set(0, ax === 'z' ? PI / 2 : 0, 0)), _s.set(1, 1, 1)); heads.setMatrixAt(li, _m);
    _m.compose(_v.set(hx, 2.45, hz), _q.identity(), _s.set(1, 1, 1)); cones.setMatrixAt(li, _m);
    _m.compose(_v.set(hx, 0.125, hz), _q.identity(), _s.set(9, 1, 9)); pools.setMatrixAt(li, _m);
    lamps.push({ i: li, x: hx, z: hz, light: null, ph: rnd() * 10, mode: rnd() < 0.25 ? 'dead' : rnd() < 0.5 ? 'stutter' : 'buzz' });
    li++;
  }
  heads.count = cones.count = pools.count = li;
  for (let i = 0; i < li; i++) { heads.setColorAt(i, _c.setRGB(1, 0.85, 0.62, THREE.SRGBColorSpace)); cones.setColorAt(i, _c.setRGB(0.05, 0.035, 0.022, THREE.SRGBColorSpace)); pools.setColorAt(i, _c.setRGB(0.3, 0.2, 0.1, THREE.SRGBColorSpace)); }
  // ---------------------------------------------------------------- v0.6 god-ray cones: sweeping searchlights on the checkpoint towers + light shafts
  const beamObjs = [];
  const beamMat = new THREE.MeshBasicMaterial({ map: coneTex, color: 0x3a3a30, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const beamGeo = new THREE.ConeGeometry(3.2, 26, 18, 1, true); beamGeo.translate(0, -13, 0);
  for (const b of DIST.beams) { const m = new THREE.Mesh(beamGeo, beamMat); m.position.set(b.x, b.y, b.z); m.userData.b = b; m.userData.ph = rnd() * 6; m.renderOrder = 2; scene.add(m); beamObjs.push(m);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: 0xfff0d0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })); sp.position.set(b.x, b.y, b.z); sp.scale.setScalar(2.2); scene.add(sp); }
  const shaftTex = canvasTex(64, 128, (g, w, h) => { const img = g.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const u = Math.abs(x / (w - 1) - 0.5) * 2, v = y / (h - 1), a = Math.pow(1 - u, 2.2) * (1 - v * 0.75) * Math.min(1, v * 6) * (0.75 + 0.25 * Math.sin(x * 0.9 + y * 0.05)), k = (y * w + x) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = 255 * a; img.data[k + 3] = 255; } g.putImageData(img, 0, 0); }, false);
  const shaftMat = new THREE.MeshBasicMaterial({ map: shaftTex, color: 0x14171c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  for (const [x, y, z, ry, w, h, tilt] of [[144, 2.4, -16, 0, 6, 5, 0.35], [-173, 2.8, -18, 0, 9, 5.6, 0.3], [24, 1.8, 148, PI / 2, 6, 3.6, 0.2]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), shaftMat); m.position.set(x, y, z); m.rotation.set(tilt, ry, 0); m.renderOrder = 2; scene.add(m);
    const m2 = m.clone(); m2.rotation.set(tilt, ry + PI / 2, 0); scene.add(m2);
  }
  // low ground mist (height fog): two scrolling sheets that follow the camera, fade with distance
  const mistTex = canvasTex(256, 256, (g, w, h) => { g.clearRect(0, 0, w, h); for (let i = 0; i < 90; i++) { const x = Math.random() * w, y = Math.random() * h, r = 20 + Math.random() * 50; for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) { const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); gr.addColorStop(0, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2); } } }, false);
  mistTex.repeat.set(3, 3);
  const mistMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { map: { value: mistTex }, off: { value: new THREE.Vector2() }, col: { value: new THREE.Color(0x4a4658) }, op: { value: 0.32 } },
    vertexShader: 'varying vec2 vUv; varying float vD; uniform vec2 off; void main(){ vec4 wp = modelMatrix*vec4(position,1.); vUv = wp.xz/22. + off; vec4 mv = viewMatrix*wp; vD = -mv.z; gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'uniform sampler2D map; uniform vec3 col; uniform float op; varying vec2 vUv; varying float vD; void main(){ float a = texture2D(map, vUv).a * op * smoothstep(1.5, 6., vD) * (1. - smoothstep(26., 48., vD)); gl_FragColor = vec4(col, a); }' });
  const mists = [0.35, 0.9].map((y, i) => { const g = new THREE.PlaneGeometry(110, 110); g.rotateX(-PI / 2); const m = new THREE.Mesh(g, i ? mistMat.clone() : mistMat); m.position.y = y; m.renderOrder = 3; m.frustumCulled = false; m.userData.world = false; scene.add(m); return m; });
  mists[1].material.uniforms = { ...mistMat.uniforms, off: { value: new THREE.Vector2() }, op: { value: 0.2 } };
  heads.frustumCulled = cones.frustumCulled = pools.frustumCulled = false; cones.renderOrder = 2; pools.renderOrder = 1; scene.add(heads, cones, pools);
  const setLamp = (l, v) => {
    if (l.mode === 'dead') v = 0.03;
    heads.setColorAt(l.i, _c.setRGB(v, 0.85 * v, 0.62 * v, THREE.SRGBColorSpace));
    const dd = Math.hypot(l.x - camPos.x, l.z - camPos.z) * 0.046, f = Math.exp(-dd * dd) * v;
    cones.setColorAt(l.i, _c.setRGB(0.085 * f, 0.06 * f, 0.036 * f, THREE.SRGBColorSpace));
    pools.setColorAt(l.i, _c.setRGB(0.42 * v, 0.27 * v, 0.13 * v, THREE.SRGBColorSpace));
    return v;
  };
  const lampsCommit = () => { heads.instanceColor.needsUpdate = true; cones.instanceColor.needsUpdate = true; pools.instanceColor.needsUpdate = true; };
  for (const r of ROADS) for (const q of ROADS) {
    for (const [sx, sz] of [[1, 1], [-1, -1]]) {
      const px = r + sx * 7.2, pz = q + sz * 7.2; if (!free(px, pz, 0.2) || Math.abs(px) > 80 || Math.abs(pz) > 80) continue;
      add(box1, 'metal', px, 2.3, pz, 0, 0, 0, 0.14, 4.6, 0.14);
      add(box1, 'metal', px - sx * 1.6, 4.5, pz, 0, 0, 0, 3.2, 0.1, 0.1);
      add(box1, 'carDark', px - sx * 3, 4.2, pz, 0, 0, 0, 0.3, 0.9, 0.32);
      add(box1, rnd() < 0.5 ? 'tailL' : 'tailOff', px - sx * 3, 4.48, pz + sz * 0.17, 0, 0, 0, 0.18, 0.18, 0.02);
      addCollider(px, pz, 0.25, 0.25, 0, 4.6);
    }
  }

  // ---------------------------------------------------------------- alleys: dumpsters, fire barrels, trash bags, crates, fences at dead ends
  const barrelGeo = new THREE.CylinderGeometry(0.32, 0.3, 0.9, 10);
  const firePos = [[6.2, 9.8], [-9.8, -6.5], [-6.3, 21], [10.4, -24]];
  for (const a of alleys) {
    const vertical = (a.z1 - a.z0) > (a.x1 - a.x0);
    const len = vertical ? a.z1 - a.z0 : a.x1 - a.x0, cx = (a.x0 + a.x1) / 2, cz = (a.z0 + a.z1) / 2;
    add(tiledBox(a.x1 - a.x0, 0.02, a.z1 - a.z0, 2), 'rubble', cx, 0.11, cz);
    for (let k = 0; k < 4; k++) {
      const t = rr(-len / 2 + 3, len / 2 - 3), side = rnd() < .5 ? -1 : 1;
      const px = vertical ? cx + side * 1.3 : cx + t, pz = vertical ? cz + t : cz + side * 1.3;
      const kind = rnd();
      if (kind < 0.3 && free(px, pz, 0.8)) dumpster(px, pz, vertical ? PI / 2 : 0);
      else if (kind < 0.42 && free(px, pz, 0.5)) firePos.push([px, pz]);
      else if (kind < 0.7) { for (let j = 0; j < 4; j++) add(sandbagGeo, 'bag', px + rr(-.5, .5), 0.25, pz + rr(-.5, .5), rr(0, 3), 0, 0, rr(.7, 1), rr(.55, .8), rr(.7, 1)); }
      else if (free(px, pz, 0.6)) { add(box1, 'crate', px, 0.4, pz, rr(0, 1), 0, 0, 0.8, 0.8, 0.8); if (rnd() < .5) add(box1, 'crate', px + 0.1, 1.1, pz, rr(0, 1), 0, 0, 0.6, 0.6, 0.6); addCollider(px, pz, 0.9, 0.9, 0, 1.2); }
    }
    if (vertical && (a.z0 <= -84 || a.z1 >= 84)) fence(cx, a.z0 <= -84 ? -83.4 : 83.4, a.x1 - a.x0, 0);
    if (!vertical && (a.x0 <= -84 || a.x1 >= 84)) fence(a.x0 <= -84 ? -83.4 : 83.4, cz, a.z1 - a.z0, PI / 2);
  }
  for (const [x, z] of firePos) { add(barrelGeo, 'rust', x, 0.45, z); addCollider(x, z, 0.65, 0.65, 0, 0.9); addFire(x, 0.9, z); }
  for (let i = 0; i < 30; i++) {
    const r = pick(ROADS), t = rr(-76, 76), off = rr(-4, 4), along = rnd() < .5;
    const x = along ? r + off : t, z = along ? t : r + off;
    if (!free(x, z, 1.5) || Math.hypot(x, z - 4) < 8) continue;
    const k = rnd(), ry = (along ? 0 : PI / 2) + rr(-.4, .4);
    if (k < 0.45) jersey(x, z, ry); else if (k < 0.75) sandbags(x, z, ry, 4); else sawhorse(x, z, ry);
  }

  // ---------------------------------------------------------------- debris, trash, blood, puddles (detail meshes)
  const coneGeoT = new THREE.ConeGeometry(0.2, 0.55, 8), coneBand = new THREE.CylinderGeometry(0.125, 0.15, 0.08, 8);
  const tyreGeo = new THREE.TorusGeometry(0.32, 0.12, 6, 12), canGeo = new THREE.CylinderGeometry(0.3, 0.26, 0.85, 10);
  const paperGeo = new THREE.PlaneGeometry(0.28, 0.2), trashGeo = new THREE.SphereGeometry(0.35, 6, 4);
  const bloodGeo = new THREE.PlaneGeometry(2, 2); bloodGeo.rotateX(-PI / 2);
  const puddleGeo = new THREE.CircleGeometry(1, 16); puddleGeo.rotateX(-PI / 2);
  const OUT_AREAS = AREAS.filter(a => a.k !== 'station');
  for (let i = 0; i < 2100; i++) {
    const A = i < 750 ? OUT_AREAS[0] : pick(OUT_AREAS), x = rr(A.x0 + 1, A.x1 - 1), z = rr(A.z0 + 1, A.z1 - 1);
    if (!free(x, z, 0.4) || Math.hypot(x, z - 4) < 3) continue;
    const road = onRoad(x, z) && groundY(x, z) < 0.05, t = rnd(), y0 = groundY(x, z);
    if (t < 0.22) { const s = rr(0.15, 0.6); add(box1, 'rubble', x, y0 + s * 0.25, z, rr(0, 3), rr(-.5, .5), rr(-.5, .5), s, s * 0.5, s * 0.7); }
    else if (t < 0.32) add(trashGeo, 'trash', x, y0 + 0.18, z, rr(0, 3), 0, 0, rr(.8, 1.4), 0.6, 1);
    else if (t < 0.4) add(box1, 'wood', x, y0 + 0.04, z, rr(0, 3), 0, rr(-.1, .1), rr(0.12, 0.2), 0.05, rr(0.9, 1.8));
    else if (t < 0.45 && road) { if (rnd() < 0.5) add(coneGeoT, 'cone', x, 0.2, z, rr(0, 6), PI / 2, 0); else { add(coneGeoT, 'cone', x, 0.3, z); add(coneBand, 'white', x, 0.3, z); } }
    else if (t < 0.5) add(tyreGeo, 'tireD', x, y0 + 0.12, z, rr(0, 3), PI / 2 + rr(-.1, .1), 0);
    else if (t < 0.55) { const fall = rnd() < 0.5; add(canGeo, 'can', x, y0 + (fall ? 0.3 : 0.43), z, rr(0, 6), fall ? PI / 2 : 0, 0); }
    else if (t < 0.75) { for (let k = 0; k < 3; k++) add(paperGeo, 'paper', x + rr(-.6, .6), y0 + 0.025, z + rr(-.6, .6), rr(0, 6), -PI / 2 + rr(-.15, .15), 0); }
    else if (t < 0.82) { for (let k = 0; k < 4; k++) add(box1, 'brick', x + rr(-.4, .4), y0 + 0.06, z + rr(-.4, .4), rr(0, 3), rr(-.3, .3), 0, 0.22, 0.08, 0.11); }
    else if (t < 0.92) add(bloodGeo, 'blood', x, y0 + 0.03, z, rr(0, 6), 0, 0, rr(.5, 1.4), 1, rr(.5, 1.4));
    else if (road) add(puddleGeo, 'puddle', x, 0.022, z, rr(0, 3), 0, 0, rr(0.8, 2.2), 1, rr(0.6, 1.6));
  }

  // ---------------------------------------------------------------- merge static geometry into chunked meshes (frustum + distance culling)
  const detailMeshes = [], chunkMeshes = [];
  const NOREC = ['blood', 'line', 'lineY', 'vcB', 'headF', 'sirenR', 'sirenB', 'signEm', 'puddle'];
  for (const [, b] of buckets) {
    const list = b.list;
    const needCol = list.some(g => g.attributes.color);
    for (const g of list) {
      if (needCol && !g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
      if (!needCol && g.attributes.color) g.deleteAttribute('color');
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      g.clearGroups(); g.morphAttributes = {};
    }
    const merged = mergeGeometries(list, false);
    list.forEach(g => g.dispose());
    if (!merged) { console.warn('merge failed', b.mat); continue; }
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mats[b.mat]);
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    mesh.receiveShadow = !NOREC.includes(b.mat);
    if (b.mat === 'blood' || b.mat === 'puddle' || b.mat.startsWith('line')) mesh.renderOrder = 1;
    scene.add(mesh);
    const c = merged.boundingSphere.center;
    const rec = { mesh, x: c.x, z: c.z, r: merged.boundingSphere.radius };
    (DETAIL.has(b.mat) ? detailMeshes : chunkMeshes).push(rec);
  }
  let glowObjs = null;
  const scanGlow = () => { glowObjs = []; scene.traverse(o => { if ((o.isSprite || (o.isMesh && o.material && o.material.blending === THREE.AdditiveBlending)) && !o.isInstancedMesh && o.userData.world !== false) { o.updateWorldMatrix(true, false); o.userData.wp = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); glowObjs.push(o); } }); };
  const cull = (cx, cz, detailDist, farDist) => {
    camPos.x = cx; camPos.z = cz;
    for (const o of glowObjs) o.visible = o.userData.q !== false && Math.hypot(o.userData.wp.x - cx, o.userData.wp.z - cz) < farDist * 0.85;
    for (const d of detailMeshes) d.mesh.visible = Math.hypot(d.x - cx, d.z - cz) - d.r < detailDist;
    for (const d of chunkMeshes) d.mesh.visible = Math.hypot(d.x - cx, d.z - cz) - d.r < farDist;
  };

  // ---------------------------------------------------------------- neon signs
  const spills = [];
  const spillTex = canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false);
  const neonSign = (text, glow, fill, x, y, z, ry, w = 3.2, h = 1.2, mode = 'stutter') => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 96; const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 96);
    g.font = `bold ${text.length > 4 ? 46 : 60}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = glow; g.shadowBlur = 18; g.fillStyle = fill; g.fillText(text, 128, 50); g.shadowBlur = 0; g.globalAlpha = 0.7; g.fillStyle = '#fff4f0'; g.fillText(text, 128, 50);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const nm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), nm); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m);
    const ph = rnd() * 9;
    neons.push({ mat: nm, ph, mode });
    // coloured spill: a glow on the wall around the sign and a pool on the pavement below it
    const col = new THREE.Color(glow);
    const wm = new THREE.MeshBasicMaterial({ map: spillTex, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w * 2.6, h * 4), wm); spills.push(wall); wall.position.set(x - Math.sin(ry) * 0.02, y - h * 0.3, z - Math.cos(ry) * 0.02); wall.rotation.y = ry; scene.add(wall);
    const gm = new THREE.MeshBasicMaterial({ map: spillTex, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.45, polygonOffset: true, polygonOffsetFactor: -3 });
    const gp = new THREE.Mesh(new THREE.PlaneGeometry(w * 2.2, 5), gm); spills.push(gp); gp.rotation.set(-PI / 2, 0, ry); gp.position.set(x + Math.sin(ry) * 2.4, 0.125, z + Math.cos(ry) * 2.4); scene.add(gp);
    neons.push({ mat: wm, ph, mode, max: 0.5 }, { mat: gm, ph, mode, max: 0.45 });
  };
  const near = (x, z) => buildings.slice().sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
  const signOn = (b, face, text, glow, fill, y, mode) => {
    const p = { 'x+': [b.x + b.w / 2 + 0.08, b.z, PI / 2], 'x-': [b.x - b.w / 2 - 0.08, b.z, -PI / 2], 'z+': [b.x, b.z + b.d / 2 + 0.08, 0], 'z-': [b.x, b.z - b.d / 2 - 0.08, PI] }[face];
    neonSign(text, glow, fill, p[0], y, p[1], p[2], 3.2, 1.2, mode);
  };
  signOn(near(-14, -14), 'x+', '藥局 24H', '#ff2040', '#ff6a7a', 4.6, 'stutter');
  signOn(near(14, 14), 'x-', '旅館', '#20c0ff', '#7adfff', 5.8, 'buzz');
  signOn(near(-14, -62), 'x+', 'KTV', '#c040ff', '#e0a0ff', 6.4, 'buzz');
  signOn(near(62, 14), 'x-', '當舖', '#ffb020', '#ffd070', 4.8, 'stutter');
  for (const n of DIST.neons) neonSign(...n);
  neonSign('加油站', '#ff3020', '#ff8070', -11 + 0.17, 7.2, 11 + 0.17, PI / 4, 2.4, 0.9, 'buzz');

  // ---------------------------------------------------------------- sky
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: {},
    vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'varying vec3 vp; void main(){ float h = normalize(vp).y; vec3 base = vec3(0.067,0.063,0.086); vec3 glow = vec3(0.32,0.09,0.06); float g = exp(-abs(h-0.02)*9.0); vec3 c = mix(base, glow, g*0.55); c = mix(c, vec3(0.04,0.035,0.055), smoothstep(0.1,0.6,h)); gl_FragColor = vec4(c,1.); }'
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(70, 16, 10), skyMat); sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky);

  // ---------------------------------------------------------------- distant skyline silhouettes (follow the camera like the sky)
  const skyTex = canvasTex(2048, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (const [col, hmin, hmax, wmin, wmax, lit] of [['#17141e', 60, 150, 40, 110, 0.02], ['#0d0b12', 30, 200, 30, 90, 0.05]]) {
      for (let x = 0; x < w;) {
        const bw = wmin + Math.random() * (wmax - wmin), bh = hmin + Math.random() * (hmax - hmin), y = h - bh;
        g.fillStyle = col; g.fillRect(x, y, bw, bh);
        if (Math.random() < 0.3) g.fillRect(x + bw * 0.4, y - 20 - Math.random() * 30, 3, 30); // antenna
        if (Math.random() < 0.25) { g.fillRect(x + bw * 0.2, y - 14, bw * 0.5, 14); }
        for (let yy = y + 6; yy < h - 4; yy += 9) for (let xx = x + 4; xx < x + bw - 4; xx += 8) if (Math.random() < lit) { g.fillStyle = Math.random() < 0.7 ? 'rgba(255,170,90,.85)' : 'rgba(150,190,255,.7)'; g.fillRect(xx, yy, 4, 4); g.fillStyle = col; }
        if (Math.random() < 0.2) { g.fillStyle = '#ff2a20'; g.fillRect(x + bw * 0.4, y - 22, 3, 3); g.fillStyle = col; }
        x += bw + Math.random() * 6;
      }
    }
  });
  skyTex.wrapT = THREE.ClampToEdgeWrapping; skyTex.repeat.set(2, 1);
  const skyline = new THREE.Mesh(new THREE.CylinderGeometry(64, 64, 26, 48, 1, true), new THREE.MeshBasicMaterial({ map: skyTex, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide }));
  skyline.renderOrder = -0.5; skyline.frustumCulled = false; skyline.userData.world = false; scene.add(skyline);
  const smokeTex = canvasTex(128, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { const y = Math.random() * h, t = y / h, x = w / 2 + (Math.random() - 0.5) * (20 + 70 * (1 - t)) + Math.sin(y * 0.05) * 10, r = 10 + 26 * (1 - t) + Math.random() * 10; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(40,34,38,${0.35 + Math.random() * 0.3})`); gr.addColorStop(1, 'rgba(40,34,38,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  }, false);
  const smokes = new THREE.Group(); smokes.userData.world = false; scene.add(smokes);
  for (const a of [0.6, 2.3, 3.9, 5.2]) {
    const t = smokeTex.clone(); t.needsUpdate = true; t.wrapS = THREE.ClampToEdgeWrapping;
    const sm = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false, opacity: 0.9 })); sm.userData.world = false;
    sm.userData.smoke = true; sm.position.set(Math.sin(a) * 58, 14, Math.cos(a) * 58); sm.scale.set(12, 34, 1); sm.renderOrder = -0.4; smokes.add(sm);
    const fg = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexW(), color: 0xff6a28, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); fg.userData.world = false;
    fg.position.set(Math.sin(a) * 58, 0.5, Math.cos(a) * 58); fg.scale.set(16, 7, 1); fg.renderOrder = -0.4; smokes.add(fg);
  }
  // ---------------------------------------------------------------- rain (mid/high, toggle): streaks in a box around the camera
  const RAIN_MAX = 1400, rainPos = new Float32Array(RAIN_MAX * 6), rainV = new Float32Array(RAIN_MAX * 3);
  for (let i = 0; i < RAIN_MAX; i++) { rainV[i * 3] = (Math.random() - 0.5) * 30; rainV[i * 3 + 1] = Math.random() * 14; rainV[i * 3 + 2] = (Math.random() - 0.5) * 30; }
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0x9aa4c8, transparent: true, opacity: 0.32, depthWrite: false }));
  rain.frustumCulled = false; rain.visible = false; rain.userData.world = false; scene.add(rain);
  let rainOn = true, rainOk = false, rainN = 0, indoor = false, tickT = 0, mistOn = true;
  const setIndoor = (b) => { if (b !== indoor) { indoor = b; setRain(rainOn); } };
  const setRain = (on) => { rainOn = on; rain.visible = rainOn && rainOk && !indoor; groundP.reflectivity = rain.visible ? 0.45 : 0.32; groundP.shininess = rain.visible ? 70 : 55; };
  const tick = (dt, cam) => {
    tickT += dt;
    for (const m of beamObjs) { const b = m.userData.b, a = Math.sin(tickT * 0.35 + m.userData.ph) * 0.9; m.rotation.set(0.95 * Math.cos(a), 0, 0.95 * Math.sin(a), 'XZY'); }
    for (let i = 0; i < 2; i++) { const m = mists[i]; m.visible = mistOn && !indoor; m.position.x = cam.position.x; m.position.z = cam.position.z; m.material.uniforms.off.value.set(tickT * (i ? -0.006 : 0.01), tickT * 0.004); }
    skyline.position.set(cam.position.x, 10, cam.position.z); smokes.position.set(cam.position.x, 0, cam.position.z);
    for (const sm of smokes.children) if (sm.userData.smoke) sm.material.map.offset.y -= dt * 0.02;
    if (!rain.visible) return;
    const cx = cam.position.x, cz = cam.position.z, cy = cam.position.y;
    for (let i = 0; i < rainN; i++) {
      let y = rainV[i * 3 + 1] - dt * 16; if (y < 0) { y += 14; rainV[i * 3] = (Math.random() - 0.5) * 30; rainV[i * 3 + 2] = (Math.random() - 0.5) * 30; }
      rainV[i * 3 + 1] = y;
      const x = cx + rainV[i * 3], z = cz + rainV[i * 3 + 2], yy = cy - 4 + y, o = i * 6;
      rainPos[o] = x; rainPos[o + 1] = yy; rainPos[o + 2] = z; rainPos[o + 3] = x + 0.04; rainPos[o + 4] = yy - 0.55; rainPos[o + 5] = z + 0.02;
    }
    rainGeo.setDrawRange(0, rainN * 2); rainGeo.attributes.position.needsUpdate = true;
  };
  const setQuality = (key) => {
    const hi = key !== 'low';
    ground.material = hi ? groundP : groundL; groundP.bumpMap = key === 'high' ? groundP.userData.bm : null; groundP.needsUpdate = true;
    const bumpOn = key === 'high'; for (const k in mats) { const m = mats[k], b = m.userData.bump; if (b) { const want = bumpOn ? b[0] : null; if (m.bumpMap !== want) { m.bumpMap = want; m.bumpScale = b[1]; m.needsUpdate = true; } } }
    mats.puddle.envMap = hi ? envCube : null; mats.puddle.needsUpdate = true;
    mistOn = hi; smokes.visible = hi; pools.visible = hi; skyline.visible = hi; if (cones.material.map !== (hi ? coneTex : null)) { cones.material.map = hi ? coneTex : null; cones.material.needsUpdate = true; } rainOk = hi; for (const m of spills) m.userData.q = hi; rainN = key === 'high' ? RAIN_MAX : 700; setRain(rainOn);
  };
  // pavement height (sidewalk slabs are 0.1 m above the asphalt)
  function groundY(x, z) {
    for (const st of STAIRS) if (x > st.x0 && x < st.x1 && z > st.z0 && z < st.z1) return st.y(x);
    for (const b of blocks) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return 0.1;
    for (const r of gRects) if (x > r[0] && x < r[1] && z > r[2] && z < r[3]) return r[4];
    return 0;
  }

  // ---------------------------------------------------------------- districts: walkable areas, interiors, portals
  function inArea(x, z, pad = 0) { for (const a of AREAS) if (x > a.x0 + pad && x < a.x1 - pad && z > a.z0 + pad && z < a.z1 - pad) return a; return null; }
  function districtAt(x, z) { const a = inArea(x, z); if (!a) return 'downtown'; if (a.k === 'hospital' && z > 9) return 'garage'; return a.k; }
  function interiorAt(x, z) { for (const r of INTERIORS) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return r; return null; }
  function portalAt(x, z) { for (const p of PORTALS) if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1) return p; return null; }
  function clampXZ(p) {
    if (inArea(p.x, p.z, 0.25)) return p;
    let best = null, bd = 1e9;
    for (const a of AREAS) { const x = Math.max(a.x0 + 0.3, Math.min(a.x1 - 0.3, p.x)), z = Math.max(a.z0 + 0.3, Math.min(a.z1 - 0.3, p.z)), d = (x - p.x) ** 2 + (z - p.z) ** 2; if (d < bd) { bd = d; best = [x, z]; } }
    p.x = best[0]; p.z = best[1]; return p;
  }
  // ---------------------------------------------------------------- collision queries (oriented boxes) with a spatial hash
  const GC = 8, GO = 260, GN = Math.ceil(580 / GC);
  const grid = Array.from({ length: GN * GN }, () => []);
  for (const c of colliders) {
    for (let gx = Math.max(0, Math.floor((c.minX + GO) / GC)); gx <= Math.min(GN - 1, Math.floor((c.maxX + GO) / GC)); gx++)
      for (let gz = Math.max(0, Math.floor((c.minZ + GO) / GC)); gz <= Math.min(GN - 1, Math.floor((c.maxZ + GO) / GC)); gz++) grid[gx * GN + gz].push(c);
  }
  let stamp = 1; const out = [];
  const query = (x0, z0, x1, z1) => {
    stamp++; out.length = 0;
    const ax = Math.max(0, Math.floor((x0 + GO) / GC)), bx = Math.min(GN - 1, Math.floor((x1 + GO) / GC));
    const az = Math.max(0, Math.floor((z0 + GO) / GC)), bz = Math.min(GN - 1, Math.floor((z1 + GO) / GC));
    for (let gx = ax; gx <= bx; gx++) for (let gz = az; gz <= bz; gz++) for (const c of grid[gx * GN + gz]) if (c._s !== stamp) { c._s = stamp; out.push(c); }
    return out;
  };
  const resolveCircle = (p, r) => {
    const list = query(p.x - r, p.z - r, p.x + r, p.z + r).slice();
    for (const c of list) {
      const dx = p.x - c.x, dz = p.z - c.z;
      let lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
      const qx = Math.max(-c.hw, Math.min(c.hw, lx)), qz = Math.max(-c.hd, Math.min(c.hd, lz));
      const ex = lx - qx, ez = lz - qz, d2 = ex * ex + ez * ez;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); lx = qx + ex / d * r; lz = qz + ez / d * r; }
      else { const a = c.hw - Math.abs(lx), b = c.hd - Math.abs(lz); if (a < b) lx = Math.sign(lx || 1) * (c.hw + r); else lz = Math.sign(lz || 1) * (c.hd + r); }
      p.x = c.x + lx * c.c + lz * c.s; p.z = c.z - lx * c.s + lz * c.c;
    }
    clampXZ(p);
  };
  const inside = (x, z, pad = 0) => {
    for (const c of query(x - pad, z - pad, x + pad, z + pad)) {
      const dx = x - c.x, dz = z - c.z, lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
      if (Math.abs(lx) < c.hw + pad && Math.abs(lz) < c.hd + pad) return true;
    }
    return false;
  };
  const rayCast = (o, d, len, minH = 1.2) => {
    let best = len;
    const ex = o.x + d.x * len, ez = o.z + d.z * len;
    for (const c of query(Math.min(o.x, ex), Math.min(o.z, ez), Math.max(o.x, ex), Math.max(o.z, ez))) {
      if (c.h < minH) continue;
      const dx = o.x - c.x, dz = o.z - c.z;
      const ox = dx * c.c - dz * c.s, oz = dx * c.s + dz * c.c, vx = d.x * c.c - d.z * c.s, vz = d.x * c.s + d.z * c.c;
      let tmin = 0, tmax = best, ok = true;
      for (let k = 0; k < 3 && ok; k++) {
        const oo = k === 0 ? ox : k === 1 ? o.y : oz, dd = k === 0 ? vx : k === 1 ? d.y : vz;
        const mn = k === 0 ? -c.hw : k === 1 ? 0 : -c.hd, mx = k === 0 ? c.hw : k === 1 ? c.h : c.hd;
        if (Math.abs(dd) < 1e-7) { if (oo < mn || oo > mx) ok = false; }
        else { let t1 = (mn - oo) / dd, t2 = (mx - oo) / dd; if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) ok = false; }
      }
      if (ok && tmin < best) best = tmin;
    }
    return best;
  };

  // ---------------------------------------------------------------- navigation flow field (1 m grid, BFS from the player)
  // 1 m grid over every district (i = x + NO, j = z + NOZ); the BFS only expands within FLOW_R cells of the player
  const NO = 230, NOZ = 240, NN = 545, FLOW_R = 72;
  const blocked = new Uint8Array(NN * NN), dist = new Int16Array(NN * NN).fill(-1), queue = new Int32Array(NN * NN);
  for (let i = 0; i < NN; i++) for (let j = 0; j < NN; j++) {
    const x = i - NO + 0.5, z = j - NOZ + 0.5;
    blocked[i * NN + j] = (!inArea(x, z, 0.3) || inside(x, z, 0.4)) ? 1 : 0;
  }
  const cellOf = (x, z) => { const i = Math.floor(x + NO), j = Math.floor(z + NOZ); return (i < 0 || j < 0 || i >= NN || j >= NN) ? -1 : i * NN + j; };
  let flowTouched = [];
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const updateFlow = (px, pz) => {
    for (const k of flowTouched) dist[k] = -1; flowTouched = [];
    let s = cellOf(px, pz); if (s < 0) return;
    if (blocked[s]) {
      const si = s / NN | 0, sj = s % NN; let found = -1;
      for (let r = 1; r < 4 && found < 0; r++) for (const [a, b] of NB) { const ii = si + a * r, jj = sj + b * r; if (ii < 0 || jj < 0 || ii >= NN || jj >= NN) continue; const k = ii * NN + jj; if (!blocked[k]) { found = k; break; } }
      if (found < 0) return; s = found;
    }
    let h = 0, t = 0; queue[t++] = s; dist[s] = 0;
    const si = s / NN | 0, sj = s % NN;
    while (h < t) {
      const k = queue[h++], i = k / NN | 0, j = k % NN, dk = dist[k] + 1;
      for (let n = 0; n < 8; n++) {
        const a = i + NB[n][0], b = j + NB[n][1];
        if (a < 0 || b < 0 || a >= NN || b >= NN || Math.abs(a - si) > FLOW_R || Math.abs(b - sj) > FLOW_R) continue;
        const q = a * NN + b; if (blocked[q] || dist[q] >= 0) continue;
        if (n >= 4 && (blocked[a * NN + j] || blocked[i * NN + b])) continue;
        dist[q] = dk; queue[t++] = q;
      }
    }
    for (let q = 0; q < t; q++) flowTouched.push(queue[q]);
  };
  const flowDir = (x, z) => {
    const k = cellOf(x, z); if (k < 0) return null;
    const i = k / NN | 0, j = k % NN;
    let best = dist[k] >= 0 ? dist[k] : 32767, bi = -1, bj = -1;
    for (let n = 0; n < 8; n++) {
      const a = i + NB[n][0], b = j + NB[n][1]; if (a < 0 || b < 0 || a >= NN || b >= NN) continue;
      const q = a * NN + b; if (dist[q] < 0) continue;
      if (n >= 4 && (blocked[a * NN + j] || blocked[i * NN + b])) continue;
      if (dist[q] < best) { best = dist[q]; bi = a; bj = b; }
    }
    if (bi < 0) return null;
    return Math.atan2(bi - NO + 0.5 - x, bj - NOZ + 0.5 - z);
  };
  const flowDist = (x, z) => { const k = cellOf(x, z); return k < 0 ? -1 : dist[k]; };

  // spawn points: open cells across the whole map (roads, sidewalks, alleys, plaza)
  const spawnPoints = [];
  for (const A of AREAS) for (let x = A.x0 + 3; x <= A.x1 - 3; x += 4) for (let z = A.z0 + 3; z <= A.z1 - 3; z += 4) if (!inside(x, z, 1.0) && !portalAt(x, z) && !STAIRS.some(st => x > st.x0 - 2 && x < st.x1 + 2 && z > st.z0 - 2 && z < st.z1 + 2)) spawnPoints.push([x, z, A.k]);

  scene.traverse(o => { const m = o.material; if (m && !Array.isArray(m) && m.blending === THREE.AdditiveBlending) m.toneMapped = false; }); // glows keep their authored colour under ACES
  scanGlow();
  return { areas: AREAS, interiors: INTERIORS, portals: PORTALS, bossSpot: BOSS_SPOT, districtAt, interiorAt, setIndoor, inArea, clampXZ, portalAt, beams: DIST.beams, colliders, mapRects, fires, spawnPoints, sky, bounds: BOUND, lamps, setLamp, lampsCommit, neons, ground, splat, sirens: { r: mats.sirenR, b: mats.sirenB }, cull, resolveCircle, inside, rayCast, updateFlow, flowDir, flowDist, carInfo, buildings, groundY, setQuality, setRain, tick, rain, skyline, roads: ROADS, roadHalf: RH, stats: { chunks: chunkMeshes.length, details: detailMeshes.length, colliders: colliders.length, cars: carInfo.length } };
}

// blood splatter texture (white, tinted by material colour)
export function makeSplatTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,1)';
  const blob = (x, y, r) => { g.beginPath(); for (let i = 0; i <= 14; i++) { const a = i / 14 * Math.PI * 2, rr = r * (0.75 + Math.random() * 0.4); i ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill(); };
  g.globalAlpha = 0.9; blob(64, 64, 30);
  g.globalAlpha = 0.7; for (let i = 0; i < 9; i++) { const a = Math.random() * 7, d = 26 + Math.random() * 24; blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 4 + Math.random() * 9); }
  g.globalAlpha = 0.8; for (let i = 0; i < 26; i++) { const a = Math.random() * 7, d = 34 + Math.random() * 28; g.beginPath(); g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 1 + Math.random() * 2.5, 0, 7); g.fill(); }
  g.globalAlpha = 0.5; g.lineCap = 'round'; g.strokeStyle = '#fff'; for (let i = 0; i < 5; i++) { const a = Math.random() * 7; g.lineWidth = 2 + Math.random() * 3; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function glowTexW() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
