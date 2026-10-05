// Procedural vehicles: extruded side profiles, greenhouse glass, wheels with rims, lights, plates, damage variants.
// buildCar(type, opt) returns { parts:[{g, m}], L, W, H } in car-local space (length along +x = front, width along z).
import * as THREE from 'three';

const PI = Math.PI;
function arc(pts, cx, cy, r, bb, n = 7) {
  pts.push([cx + r, bb], [cx + r, cy]);
  for (let i = 1; i < n; i++) { const a = i / n * PI; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  pts.push([cx - r, cy], [cx - r, bb]);
}
function shapeOf(pts) { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath(); return s; }
function extrude(pts, depth, bevel = 0, seg = 2) {
  const d = Math.max(0.01, depth - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shapeOf(pts), { depth: d, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelOffset: -bevel * 0.7, bevelSegments: seg, curveSegments: 3 });
  g.translate(0, 0, -d / 2);
  return g;
}
function box(w, h, d, x, y, z) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }
// thin slab lying along segment p1->p2 (profile space), offset outward by off, spanning depth across z
function slab(p1, p2, thick, depth, off = 0, inset = 0) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1], L = Math.hypot(dx, dy);
  const g = new THREE.BoxGeometry(L - inset * 2, thick, depth);
  const nx = dy / L, ny = -dx / L; // right-hand normal
  g.rotateZ(Math.atan2(dy, dx));
  g.translate((p1[0] + p2[0]) / 2 + nx * off, (p1[1] + p2[1]) / 2 + ny * off, 0);
  return g;
}
const _c = new THREE.Color(), _r = new THREE.Color(0x5a3420), _d = new THREE.Color(0x2a2622);
function paintGeo(g, hex, rust, seed) {
  const n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose();
  const p = n.attributes.position, col = new Float32Array(p.count * 3);
  const base = new THREE.Color(hex);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nz = Math.sin(x * 2.3 + seed) * Math.sin(y * 3.7 + seed * 1.7) * Math.sin(z * 2.9 + seed * 0.6);
    _c.copy(base).multiplyScalar(0.9 + 0.1 * Math.sin(x * 7 + z * 5 + seed));
    if (nz > 1 - rust * 1.6) _c.lerp(_r, Math.min(1, (nz - (1 - rust * 1.6)) * 4));
    if (y < 0.55) _c.lerp(_d, (0.55 - y) * 1.1); // road grime low on the body
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return n;
}
function dent(g, L, amt, seed) {
  const p = g.attributes.position, start = L / 2 - 0.9;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); if (x < start) continue;
    const k = (x - start) / 0.9, y = p.getY(i), z = p.getZ(i);
    p.setX(i, x - k * k * amt * (0.65 + 0.35 * Math.sin(z * 6 + y * 4 + seed)));
    p.setY(i, y - k * amt * 0.25 * (0.5 + 0.5 * Math.sin(z * 3.1 + seed)));
    p.setZ(i, z * (1 - k * 0.04));
  }
  g.computeVertexNormals();
}
// plate atlas: 4x4 slots, 128x64 each
export function plateUV(g, slot) {
  const col = slot % 4, row = slot / 4 | 0, uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + uv.getX(i)) / 4, 1 - (row + 1 - uv.getY(i)) / 4);
  return g;
}
export function makePlateAtlas() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  const font = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  for (let s = 0; s < 16; s++) {
    const x = (s % 4) * 128, y = (s / 4 | 0) * 64;
    g.save(); g.translate(x, y);
    if (s < 10) {
      g.fillStyle = s === 3 ? '#c8a020' : '#d8d6cc'; g.fillRect(2, 2, 124, 60); g.strokeStyle = '#222'; g.lineWidth = 3; g.strokeRect(5, 5, 118, 54);
      g.fillStyle = '#1a1a1a'; g.font = 'bold 30px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const t = L[(s * 7) % 23] + L[(s * 3 + 5) % 23] + L[(s * 11 + 2) % 23] + '-' + String(1000 + ((s * 7919) % 9000));
      g.fillText(t, 64, 34);
      g.fillStyle = 'rgba(70,50,30,.35)'; for (let k = 0; k < 30; k++) g.fillRect(Math.random() * 128, Math.random() * 64, 3, 2);
    } else if (s === 10) { g.fillStyle = '#f2f2ee'; g.fillRect(0, 0, 128, 64); g.fillStyle = '#1d3f9a'; g.font = `bold 34px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('警察', 64, 26); g.font = 'bold 14px sans-serif'; g.fillText('POLICE', 64, 52); }
    else if (s === 11) { g.fillStyle = '#f2f2ee'; g.fillRect(0, 0, 128, 64); g.fillStyle = '#c01818'; g.font = `bold 32px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('救護車', 64, 34); }
    else if (s === 12) { g.fillStyle = '#f2f2ee'; g.fillRect(0, 0, 128, 64); g.fillStyle = '#c01818'; g.fillRect(52, 8, 24, 48); g.fillRect(40, 20, 48, 24); }
    else if (s === 13) { g.fillStyle = '#111'; g.fillRect(0, 0, 128, 64); g.fillStyle = '#ff9a20'; g.font = `bold 30px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('307 市府', 64, 34); }
    else if (s === 14) { g.fillStyle = '#e8e4d8'; g.fillRect(0, 0, 128, 64); g.fillStyle = '#1a6a3a'; g.font = `bold 28px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('公車站', 64, 34); }
    else { g.fillStyle = '#c8a020'; g.fillRect(0, 0, 128, 64); g.fillStyle = '#111'; g.font = `bold 30px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TAXI', 64, 34); }
    g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2; return t;
}

const SPECS = {
  sedan: { L: 4.6, W: 1.8, wr: 0.33, fx: 1.38, rx: -1.38, bb: 0.3,
    lower: bb => { const p = [[2.25, bb + 0.02]]; arc(p, 1.38, 0.34, 0.43, bb); arc(p, -1.38, 0.34, 0.43, bb); p.push([-2.25, bb + 0.02], [-2.32, 0.5], [-2.3, 0.8], [-2.2, 0.98], [-1.55, 1.02], [-1.3, 1.02], [1.05, 1.0], [1.5, 0.95], [2.1, 0.86], [2.3, 0.72], [2.32, 0.5]); return p; },
    gh: [[-1.35, 0.98], [-0.85, 1.42], [0.4, 1.44], [1.12, 0.96]], head: [2.28, 0.72, 0.6], tail: [-2.28, 0.86, 0.62], bumpY: 0.42 },
  hatch: { L: 3.9, W: 1.72, wr: 0.31, fx: 1.2, rx: -1.2, bb: 0.3,
    lower: bb => { const p = [[1.92, bb + 0.02]]; arc(p, 1.2, 0.32, 0.41, bb); arc(p, -1.2, 0.32, 0.41, bb); p.push([-1.93, bb + 0.02], [-1.97, 0.55], [-1.95, 0.98], [-1.85, 1.0], [0.9, 0.98], [1.35, 0.92], [1.8, 0.82], [1.95, 0.68], [1.97, 0.5]); return p; },
    gh: [[-1.9, 0.97], [-1.74, 1.43], [0.3, 1.46], [0.95, 0.95]], head: [1.92, 0.7, 0.56], tail: [-1.95, 0.9, 0.6], bumpY: 0.42 },
  suv: { L: 4.7, W: 1.9, wr: 0.4, fx: 1.45, rx: -1.45, bb: 0.42,
    lower: bb => { const p = [[2.3, bb + 0.03]]; arc(p, 1.45, 0.41, 0.5, bb); arc(p, -1.45, 0.41, 0.5, bb); p.push([-2.3, bb + 0.03], [-2.35, 0.7], [-2.33, 1.15], [-2.2, 1.2], [1.2, 1.2], [2.05, 1.1], [2.33, 0.95], [2.35, 0.6]); return p; },
    gh: [[-2.27, 1.17], [-2.17, 1.84], [0.55, 1.86], [1.25, 1.17]], head: [2.3, 0.95, 0.66], tail: [-2.33, 1.05, 0.7], bumpY: 0.55 },
  pickup: { L: 5.2, W: 1.9, wr: 0.4, fx: 1.65, rx: -1.55, bb: 0.45,
    lower: bb => { const p = [[2.6, bb + 0.03]]; arc(p, 1.65, 0.41, 0.5, bb); arc(p, -1.55, 0.41, 0.5, bb); p.push([-2.6, bb + 0.03], [-2.62, 0.7], [-2.6, 1.12], [-2.5, 1.15], [1.25, 1.15], [2.2, 1.08], [2.55, 0.92], [2.6, 0.6]); return p; },
    gh: [[-0.6, 1.12], [-0.5, 1.8], [0.55, 1.82], [1.3, 1.13]], head: [2.57, 0.92, 0.66], tail: [-2.6, 1.0, 0.75], bumpY: 0.55, bed: [-2.48, -0.7] },
  van: { L: 5.3, W: 2.0, wr: 0.38, fx: 1.85, rx: -1.75, bb: 0.4,
    lower: bb => { const p = [[2.65, bb + 0.03]]; arc(p, 1.85, 0.39, 0.48, bb); arc(p, -1.75, 0.39, 0.48, bb); p.push([-2.65, bb + 0.03], [-2.68, 0.7], [-2.67, 2.32], [-2.55, 2.44], [1.2, 2.44], [1.36, 2.36], [2.05, 1.3], [2.5, 1.15], [2.65, 0.95], [2.68, 0.6]); return p; },
    van: true, head: [2.64, 0.95, 0.7], tail: [-2.67, 1.1, 0.85], bumpY: 0.52 },
  bus: { L: 10.6, W: 2.5, wr: 0.5, fx: 3.5, rx: -3.1, bb: 0.42,
    lower: bb => { const p = [[5.3, bb + 0.03]]; arc(p, 3.5, 0.5, 0.6, bb); arc(p, -3.1, 0.5, 0.6, bb); p.push([-5.3, bb + 0.03], [-5.33, 2.92], [-5.2, 3.06], [5.1, 3.06], [5.3, 2.88], [5.33, 0.6]); return p; },
    bus: true, head: [5.33, 0.75, 0.95], tail: [-5.33, 0.9, 1.0], bumpY: 0.5 },
};

export function buildCar(type, o = {}) {
  const base = type === 'police' ? 'sedan' : type === 'ambulance' ? 'van' : type === 'taxi' ? 'sedan' : type;
  const S = SPECS[base];
  const seed = o.seed || 1, parts = [];
  const color = o.burnt ? 0x1d1a18 : (o.color ?? 0x8a8d92), rust = o.burnt ? 0.75 : (o.rust ?? 0.2);
  const P = (g, m) => parts.push({ g: m === 'paint' ? paintGeo(g, g.userData.col ?? color, g.userData.rust ?? rust, seed) : g, m });
  const W = S.W, L = S.L;
  const glass = o.burnt ? 'carDark' : (o.broken ? 'glassBroken' : 'glass');
  // --- lower body
  const body = extrude(S.lower(S.bb), W, 0.07);
  if (o.crashed) dent(body, L, 0.38, seed);
  P(body, 'paint');
  // under-body wheel wells (hide see-through arches)
  for (const ax of [S.fx, S.rx]) parts.push({ g: box(S.wr * 2.3, S.wr * 1.3, W - 0.5, ax, S.wr + 0.15, 0), m: 'carDark' });
  let H = 1.5, ghTop;
  if (S.gh) {
    const gh = S.gh; ghTop = gh[2][1];
    parts.push({ g: extrude(gh, W * 0.84, 0), m: glass });
    // roof slab + pillars
    const r0 = gh[1], r1 = gh[2];
    const roof = extrude([[r0[0] - 0.06, r0[1] - 0.05], [r0[0] + 0.03, r0[1] + 0.05], [r1[0] - 0.02, r1[1] + 0.05], [r1[0] + 0.1, r1[1] - 0.05]], W * 0.88, 0.035);
    P(roof, 'paint');
    const zp = W * 0.42 + 0.012;
    for (const s of [-1, 1]) {
      const a = slab(gh[3], gh[2], 0.075, 0.05, 0.0); a.translate(0, 0, s * zp); P(a, 'paint');
      const c = slab(gh[0], gh[1], 0.12, 0.05, 0.0); c.translate(0, 0, s * zp); P(c, 'paint');
      const bx = (gh[0][0] + gh[3][0]) / 2 - 0.15;
      const b = box(0.08, ghTop - gh[0][1], 0.05, bx, (ghTop + gh[0][1]) / 2, s * zp); P(b, 'paint');
      // side mirror
      parts.push({ g: box(0.1, 0.11, 0.17, gh[3][0] - 0.12, gh[3][1] + 0.08, s * (W / 2 + 0.09)), m: 'carDark' });
      parts.push({ g: box(0.06, 0.03, 0.12, gh[3][0] - 0.1, gh[3][1] + 0.03, s * (W / 2 + 0.02)), m: 'carDark' });
      // door seams
      parts.push({ g: box(0.012, gh[0][1] - S.bb - 0.15, 0.01, bx, (gh[0][1] + S.bb) / 2 + 0.03, s * (W / 2 + 0.003)), m: 'carDark' });
      parts.push({ g: box(0.012, gh[0][1] - S.bb - 0.15, 0.01, gh[3][0] - 0.05, (gh[0][1] + S.bb) / 2 + 0.03, s * (W / 2 + 0.003)), m: 'carDark' });
    }
    H = ghTop + 0.06;
    if (S.bed) { // open pickup bed
      parts.push({ g: box(S.bed[1] - S.bed[0], 0.02, W - 0.22, (S.bed[0] + S.bed[1]) / 2, 1.165, 0), m: 'carDark' });
      if (!o.burnt && seed % 2) parts.push({ g: box(0.8, 0.5, 0.7, -1.6, 1.4, 0.3), m: 'crate' });
    }
  } else if (S.van) {
    // windshield slab + cab side windows + rear side windows (thin solids spanning width so both sides show)
    parts.push({ g: slab([1.36, 2.33], [2.03, 1.33], 0.04, W * 0.86, 0.02, 0.06), m: glass });
    parts.push({ g: extrude([[1.05, 1.4], [1.05, 2.2], [1.3, 2.26], [1.93, 1.4]], W + 0.012, 0), m: glass });
    if (type !== 'ambulance') parts.push({ g: extrude([[-2.35, 1.45], [-2.35, 2.15], [0.8, 2.15], [0.8, 1.45]], W + 0.012, 0), m: glass });
    for (const s of [-1, 1]) {
      parts.push({ g: box(0.1, 0.11, 0.2, 1.75, 1.62, s * (W / 2 + 0.1)), m: 'carDark' });
      parts.push({ g: box(0.012, 1.7, 0.01, 0.98, 1.25, s * (W / 2 + 0.003)), m: 'carDark' });
    }
    parts.push({ g: box(0.02, 0.62, 0.7, -2.68, 1.85, 0.42), m: glass }, { g: box(0.02, 0.62, 0.7, -2.68, 1.85, -0.42), m: glass });
    H = 2.46; ghTop = 2.44;
  } else if (S.bus) {
    parts.push({ g: extrude([[-4.95, 1.55], [-4.95, 2.6], [4.55, 2.6], [4.55, 1.55]], W + 0.012, 0), m: glass });
    for (let x = -4.95; x <= 4.6; x += 1.32) for (const s of [-1, 1]) { const b = box(0.12, 1.08, 0.04, x, 2.07, s * (W / 2 + 0.012)); b.userData.col = color; P(b, 'paint'); }
    parts.push({ g: box(0.04, 1.45, W * 0.9, 5.34, 1.95, 0), m: glass });
    parts.push({ g: box(0.04, 1.2, 1.0, -5.34, 2.1, 0), m: glass });
    parts.push({ g: box(0.9, 1.9, 0.03, 3.9, 1.4, W / 2 + 0.012), m: glass }); // door
    parts.push({ g: plateUV(box(0.03, 0.26, 1.2, 5.345, 2.82, 0), 13), m: 'signEm' });
    const stripe = box(L - 0.4, 0.16, W + 0.02, 0, 1.2, 0); stripe.userData.col = 0x1a5a3a; stripe.userData.rust = 0.1; P(stripe, 'paint');
    H = 3.08; ghTop = 3.06;
  }
  // --- liveries
  if (type === 'police' || type === 'ambulance') {
    const sy = type === 'police' ? 0.72 : 1.05, len = type === 'police' ? L - 0.5 : L - 0.6;
    const st = box(len, type === 'police' ? 0.1 : 0.16, W + 0.016, 0, sy, 0); st.userData.col = type === 'police' ? 0x1d3f9a : 0xc01818; st.userData.rust = 0.05; P(st, 'paint');
    for (const s of [-1, 1]) {
      const d = plateUV(new THREE.PlaneGeometry(type === 'police' ? 0.75 : 1.1, type === 'police' ? 0.38 : 0.55), type === 'police' ? 10 : 11);
      if (s < 0) d.rotateY(PI); d.translate(type === 'police' ? 0.15 : -0.9, type === 'police' ? 0.9 : 1.55, s * (W / 2 + 0.02)); parts.push({ g: d, m: 'plate' });
    }
    if (type === 'ambulance') { const d = plateUV(new THREE.PlaneGeometry(0.5, 0.5), 12); d.rotateY(-PI / 2); d.translate(-2.69, 1.4, 0); parts.push({ g: d, m: 'plate' }); }
    // light bar
    const top = ghTop + 0.04, bx = type === 'police' ? (S.gh[1][0] + S.gh[2][0]) / 2 : 1.0;
    parts.push({ g: box(0.32, 0.06, W * 0.7, bx, top + 0.03, 0), m: 'carDark' });
    parts.push({ g: box(0.26, 0.11, W * 0.32, bx, top + 0.11, -W * 0.17), m: 'sirenR' });
    parts.push({ g: box(0.26, 0.11, W * 0.32, bx, top + 0.11, W * 0.17), m: 'sirenB' });
  }
  if (type === 'taxi') { const t = plateUV(box(0.18, 0.16, 0.5, (S.gh[1][0] + S.gh[2][0]) / 2, ghTop + 0.12, 0), 15); parts.push({ g: t, m: 'signEm' }); }
  // --- wheels
  const tireG = new THREE.CylinderGeometry(S.wr, S.wr, 0.26, 14); tireG.rotateX(PI / 2);
  const rimG = new THREE.CylinderGeometry(S.wr * 0.6, S.wr * 0.6, 0.03, 10); rimG.rotateX(PI / 2);
  const hubG = new THREE.CylinderGeometry(S.wr * 0.18, S.wr * 0.18, 0.05, 6); hubG.rotateX(PI / 2);
  const wz = W / 2 - 0.13;
  let wi = 0;
  for (const ax of [S.fx, S.rx]) for (const s of [-1, 1]) {
    const flat = o.burnt || (o.flat && o.flat.includes(wi)); wi++;
    if (o.missingWheel === wi - 1) continue;
    const y = flat ? S.wr * 0.78 : S.wr;
    if (!o.burnt) { const t = tireG.clone(); if (flat) t.scale(1, 0.8, 1.05); t.translate(ax, y, s * wz); parts.push({ g: t, m: 'tire' }); }
    const rr = rimG.clone(); rr.translate(ax, o.burnt ? S.wr * 0.62 : y, s * (wz + 0.125)); parts.push({ g: rr, m: o.burnt ? 'carDark' : 'rim' });
    const hb = hubG.clone(); hb.translate(ax, o.burnt ? S.wr * 0.62 : y, s * (wz + 0.15)); parts.push({ g: hb, m: 'chrome' });
  }
  // --- lights, bumpers, grille, plates
  const [hx, hy, hz] = S.head, [tx, ty, tz] = S.tail;
  const headM = o.burnt ? 'carDark' : (o.lights === 'flicker' ? 'headF' : o.lights ? 'headL' : 'lightOff');
  const tailM = o.burnt ? 'carDark' : (o.tail ? 'tailL' : 'tailOff');
  for (const s of [-1, 1]) {
    parts.push({ g: box(0.08, 0.13, 0.34, hx - 0.02, hy, s * hz), m: headM });
    parts.push({ g: box(0.06, 0.14, 0.3, tx + 0.01, ty, s * tz), m: tailM });
  }
  const fb = S.bumpY;
  parts.push({ g: box(0.2, 0.2, W + 0.04, hx + 0.03, fb, 0), m: o.burnt ? 'carDark' : 'bumper' });
  parts.push({ g: box(0.2, 0.2, W + 0.04, tx - 0.03, fb, 0), m: o.burnt ? 'carDark' : 'bumper' });
  if (!S.bus) parts.push({ g: box(0.05, 0.13, hz * 2 - 0.42, hx - 0.01, hy - 0.02, 0), m: 'carDark' });
  if (!o.burnt) {
    const pslot = o.plate ?? (seed % 10);
    const pf = plateUV(new THREE.PlaneGeometry(0.4, 0.14), pslot); pf.rotateY(PI / 2); pf.translate(hx + 0.135, fb, 0); parts.push({ g: pf, m: 'plate' });
    const pr = plateUV(new THREE.PlaneGeometry(0.4, 0.14), pslot); pr.rotateY(-PI / 2); pr.translate(tx - 0.135, fb + (S.bus ? 0 : 0.0), 0); parts.push({ g: pr, m: 'plate' });
  }
  // --- open door (front-left or front-right)
  if (o.doorOpen && S.gh) {
    const gh = S.gh, s = o.doorOpen, xa = gh[3][0] - 0.05, xb = (gh[0][0] + gh[3][0]) / 2 - 0.15, len = xa - xb;
    const lowY = S.bb + 0.12, belt = gh[0][1];
    const door = new THREE.Group();
    const panel = box(len, belt - lowY, 0.07, -len / 2, (belt + lowY) / 2, 0); panel.userData.col = color;
    const win = box(len * 0.92, ghTop - belt - 0.06, 0.02, -len / 2 + 0.02, (ghTop + belt) / 2 - 0.02, 0);
    const ang = s * (0.85 + (seed % 3) * 0.15);
    const m = new THREE.Matrix4().makeRotationY(ang).premultiply(new THREE.Matrix4().makeTranslation(xa, 0, s * (W / 2 + 0.04)));
    panel.applyMatrix4(m); win.applyMatrix4(m); P(panel, 'paint'); parts.push({ g: win, m: glass });
    const hole = new THREE.PlaneGeometry(len, ghTop - lowY - 0.05); if (s < 0) hole.rotateY(PI); hole.translate(xa - len / 2, (ghTop + lowY) / 2, s * (W / 2 + 0.006)); parts.push({ g: hole, m: 'carDark' });
    void door;
  }
  return { parts, L, W, H, wr: S.wr };
}
export const CAR_TYPES = Object.keys(SPECS);
