// v0.6 outer districts: hospital (east), parking garage (east-south), mall plaza (west), subway (south) with an
// underground station section, and the military checkpoint (north). Everything is fed into the same chunked
// merge buckets as downtown, so only nearby chunks are drawn.
import * as THREE from 'three';

export const AREAS = [
  { k: 'downtown', x0: -84, x1: 84, z0: -84, z1: 84, name: '市中心' },
  { k: 'hospital', x0: 84, x1: 224, z0: -64, z1: 64, name: '仁心醫院' },
  { k: 'mall', x0: -224, x1: -84, z0: -64, z1: 64, name: '星港百貨廣場' },
  { k: 'subway', x0: -64, x1: 64, z0: 84, z1: 214, name: '地鐵站前' },
  { k: 'checkpoint', x0: -64, x1: 64, z0: -234, z1: -84, name: '外環軍事檢查哨' },
  { k: 'station', x0: -40, x1: 40, z0: 262, z1: 300, name: '地鐵月台（地下）' },
];
// enterable interiors: camera is kept below the ceiling while the player is inside
export const INTERIORS = [
  { k: 'hospital', x0: 124.4, x1: 163.6, z0: -29.6, z1: -12.4, ceil: 4.6, name: '醫院大廳' },
  { k: 'garage', x0: 118.4, x1: 177.6, z0: 16.4, z1: 49.6, ceil: 2.95, name: '停車場 B 區' },
  { k: 'mall', x0: -205.4, x1: -140.6, z0: -55.4, z1: -14.4, ceil: 5.2, name: '百貨一樓' },
  { k: 'station', x0: -40, x1: 40, z0: 262, z1: 300, ceil: 3.9, name: '地鐵月台' },
  { k: 'pavilion', x0: 14, x1: 32, z0: 140, z1: 156, ceil: 3.3, name: '地鐵出入口' },
];
// stairs: subway entrance (surface, going down) and station stairs (going up)
export const STAIRS = [
  { x0: 18, x1: 30, z0: 144, z1: 152, y: x => -Math.min(2.2, Math.max(0, (x - 18) * 0.2)) },
  { x0: -40, x1: -31, z0: 266, z1: 274, y: x => Math.min(1.6, Math.max(0, (-31 - x) * 0.25)) },
];
export const PORTALS = [
  { x0: 26.5, x1: 31, z0: 144, z1: 152, to: [-28.5, 270, Math.PI / 2], label: '進入地鐵站' },
  { x0: -40, x1: -35.5, z0: 266, z1: 274, to: [15.5, 148, -Math.PI / 2], label: '返回地面' },
];
export const HOLES = [[18, 30, 144, 152]];
export const BOSS_SPOT = [0, -196];

export function buildDistricts(A) {
  const { THREE: T, add, addCollider, mapRects, tiledBox, box1, flat, plane, building, placeCar, sandbags, jersey, fence, sawhorse, addFire, rr, rnd, pick, mats, canvasTex, VC, VCD, gRects, lampSpots, dumpster, barrelGeo, sandbagGeo, PI } = A;
  const neons = [], beams = [];
  const L = o => new T.MeshLambertMaterial(o);
  // ------------------------------------------------ extra colours / materials
  Object.assign(VC, { olive: 0x3a4028, oliveD: 0x262a1c, contR: 0x5a2420, contB: 0x1e3446, contG: 0x2e4430, steel: 0x4a4a50, white2: 0xb8b6ae, redX: 0xa01818, bench: 0x3a3430, yellowL: 0xa08018 });
  Object.assign(VCD, { chair: 0x2a3a4a, gurney: 0x9a9a98, sheetW: 0xb0aca0, rail: 0x6a6a70, ballast: 0x1a1816 });
  const tileTex = (a, b, n = 8, grout = '#2a2a2c') => canvasTex(128, 128, (g, w, h) => { g.fillStyle = grout; g.fillRect(0, 0, w, h); const s = w / n; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = (Math.random() - 0.5) * 14 | 0; g.fillStyle = (x + y) % 2 ? a : b; g.fillRect(x * s + 1, y * s + 1, s - 2, s - 2); g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 100})`; g.fillRect(x * s + 1, y * s + 1, s - 2, s - 2); } for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(40,20,14,${Math.random() * 0.25})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 3 + Math.random() * 12, 0, 7); g.fill(); } });
  mats.floorTile = L({ map: tileTex('#8a8a86', '#7a7a78', 8), color: 0x9a9a98 });
  mats.floorGran = L({ map: tileTex('#5a5654', '#4e4a48', 4, '#222'), color: 0x9a96a0 });
  mats.metroWall = L({ map: canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#9a9890'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 16) { const v = Math.random() * 20 | 0; g.fillStyle = `rgb(${160 + v},${158 + v},${150 + v})`; g.fillRect(x + 1, y + 1, 14, 6); } g.fillStyle = '#1a4a8a'; g.fillRect(0, 60, w, 14); g.fillStyle = '#c8a020'; g.fillRect(0, 76, w, 3); for (let i = 0; i < 14; i++) { const x = Math.random() * w; const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(30,22,16,.4)'); gr.addColorStop(1, 'rgba(30,22,16,0)'); g.fillStyle = gr; g.fillRect(x, 0, 2 + Math.random() * 6, h); } g.fillStyle = 'rgba(110,8,10,.7)'; for (let i = 0; i < 5; i++) { const x = Math.random() * w, y = 80 + Math.random() * 40; g.fillRect(x, y, 2, 10 + Math.random() * 20); g.fillRect(x - 3, y, 10, 4); } }), color: 0xa0a0a0 });
  mats.ceilPanel = L({ map: canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#4a4a4c'; g.fillRect(0, 0, w, h); g.fillStyle = '#2a2a2c'; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h); for (let i = 0; i < 300; i++) { g.fillStyle = 'rgba(20,20,20,.3)'; g.fillRect(Math.random() * w, Math.random() * h, 1, 1); } }), color: 0x8a8a8c });
  mats.curtain = new T.MeshPhongMaterial({ map: canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#0a0e14'; g.fillRect(0, 0, w, h); const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, 'rgba(70,90,120,.35)'); gr.addColorStop(1, 'rgba(10,14,20,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#3a3e44'; g.fillRect(0, 0, w, 4); g.fillRect(0, 0, 4, h); g.fillRect(62, 0, 3, h); for (let k = 0; k < 3; k++) { if (Math.random() < 0.5) continue; g.fillStyle = 'rgba(170,180,195,.4)'; const x = Math.random() * w, y = Math.random() * h; for (let j = 0; j < 8; j++) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - .5) * 60, y + (Math.random() - .5) * 60); g.lineTo(x + (Math.random() - .5) * 8, y + (Math.random() - .5) * 8); g.fill(); } } if (Math.random() < 0.5) { g.fillStyle = 'rgba(120,70,30,.5)'; g.fillRect(8, 8, 50, 50); } }), color: 0x9aa4b0, specular: 0x2a3038, shininess: 40 });
  mats.psd = new T.MeshPhongMaterial({ color: 0x334050, specular: 0xaab4c8, shininess: 100, transparent: true, opacity: 0.28, depthWrite: false, side: T.DoubleSide });
  mats.trainWin = new T.MeshBasicMaterial({ color: 0x6a7a68 });
  mats.ledBoard = new T.MeshBasicMaterial({ map: canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#050505'; g.fillRect(0, 0, w, h); g.font = 'bold 44px "Noto Sans TC",sans-serif'; g.textAlign = 'center'; g.fillStyle = '#ff2a20'; g.fillText('緊急疏散', 128, 52); g.font = 'bold 26px "Noto Sans TC",sans-serif'; g.fillStyle = '#ffb020'; g.fillText('請前往北方檢查哨', 128, 96); for (let y = 0; y < h; y += 3) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, y, w, 1); } }), color: 0xb0b0b0 });
  mats.helipad = new T.MeshBasicMaterial({ map: canvasTex(128, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(200,190,150,.9)'; g.lineWidth = 6; g.beginPath(); g.arc(64, 64, 56, 0, 7); g.stroke(); g.fillStyle = 'rgba(200,190,150,.9)'; g.fillRect(38, 30, 12, 68); g.fillRect(78, 30, 12, 68); g.fillRect(38, 58, 52, 12); }), transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  mats.redCross = new T.MeshBasicMaterial({ map: canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#d8d4cc'; g.fillRect(0, 0, w, h); g.fillStyle = '#b01010'; g.fillRect(24, 8, 16, 48); g.fillRect(8, 24, 48, 16); }), color: 0x9a9a9a });
  const textMat = (txt, fg, bg, w = 256, h = 64, size = 40) => new T.MeshBasicMaterial({ map: canvasTex(w, h, (g) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.font = `bold ${size}px "Noto Sans TC",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = fg; g.fillText(txt, w / 2, h / 2 + 2); for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(Math.random() * w, Math.random() * h, 4, 2); } }), color: 0xa0a0a0 });
  mats.sgReg = textMat('掛號 · 批價', '#fff', '#1a5a3a'); mats.sgER = textMat('急診 EMERGENCY', '#fff', '#a01818', 256, 64, 30);
  mats.sgMetro = textMat('星港站 Xinggang', '#fff', '#1a4a8a', 256, 64, 32); mats.sgDir = textMat('往 外環 →', '#fff', '#203040');
  mats.sgPark = textMat('P 停車場 B 區', '#fff', '#1a3a8a'); mats.sgMil = textMat('軍事管制區 禁止進入', '#ffd020', '#2a2a1a', 256, 64, 26);
  mats.sgMall = textMat('B1 美食街 ↓  2F 女裝 ↑', '#fff', '#3a2a1a', 256, 64, 24);
  for (const k of ['floorTile', 'floorGran', 'metroWall', 'ceilPanel']) mats[k].userData.bump = [mats[k].map, 0.5];
  if (A.aoMat) for (const k of ['metroWall', 'curtain', 'floorGran']) A.aoMat(mats[k]);

  const R = (x0, x1, z0, z1) => ({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 });
  const slab = (x0, x1, z0, z1, key, y = 0.1, T0 = 1.5) => { const r = R(x0, x1, z0, z1); add(tiledBox(r.w, 0.1, r.d, T0), key, r.x, y - 0.05, r.z); gRects.push([x0, x1, z0, z1, y]); };
  // wall box with collider + minimap rect
  const wall = (x0, x1, z0, z1, h, key, y0 = 0, col = true, kind = 'b', T0 = 6) => { const r = R(x0, x1, z0, z1); add(tiledBox(r.w, h, r.d, T0, T0), key, r.x, y0 + h / 2, r.z); if (col) addCollider(r.x, r.z, r.w, r.d, 0, y0 + h); if (kind) mapRects.push({ x: r.x, z: r.z, w: r.w, d: r.d, rot: 0, kind }); };
  const signP = (m, x, y, z, ry, w = 2.6, h = 0.65) => add(plane, m, x, y, z, ry, 0, 0, w, h, 1);
  const panelLights = (x0, x1, z0, z1, y, step = 6, dead = 0.3) => { for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) add(box1, rnd() < dead ? 'lampOff' : 'panelLit', x, y, z, 0, 0, 0, 1.4, 0.04, 0.35); };
  // row of buildings filling a strip; faces = street-facing sides
  const row = (x0, x1, z0, z1, faces, hmin, hmax, opt = {}) => {
    const alongX = (x1 - x0) >= (z1 - z0), len = alongX ? x1 - x0 : z1 - z0;
    let t = 0;
    while (t < len - 0.5) {
      const seg = Math.min(len - t, rr(10, 18)); const a0 = t, a1 = len - (t + seg) < 6 ? len : t + seg;
      if (alongX) building(x0 + a0, x0 + a1, z0, z1, rr(hmin, hmax), faces, opt); else building(x0, x1, z0 + a0, z0 + a1, rr(hmin, hmax), faces, opt);
      t = a1;
    }
  };
  const roadLamps = (axis, c, t0, t1) => { for (let t = t0; t <= t1; t += 22) { const s = (Math.round(t / 22) % 2) ? 1 : -1; lampSpots.push(axis === 'x' ? [c + s * 7.3, t, s, 'x'] : [t, c + s * 7.3, s, 'z']); } };
  const roadLines = (axis, t0, t1) => { for (let t = t0; t < t1; t += 4) for (const o of [-0.12, 0.12]) { if (axis === 'z') add(flat, 'lineY', o, 0.02, t, 0, 0, 0, 0.12, 1, 2); else add(flat, 'lineY', t, 0.02, o, 0, 0, 0, 2, 1, 0.12); } };
  const types = ['sedan', 'hatch', 'suv', 'pickup', 'van', 'taxi', 'sedan'];
  const roadCars = (axis, t0, t1) => { for (let t = t0; t <= t1; t += rr(9, 15)) for (const lane of [-1, 1]) { if (rnd() < 0.45) continue; const off = rnd() < 0.6 ? lane * 4.4 : lane * rr(1, 2.4), ry = (axis === 'z' ? PI / 2 : 0) + (lane > 0 ? 0 : PI) + rr(-.4, .4); const x = axis === 'z' ? off : t, z = axis === 'z' ? t : off; placeCar(pick(types), x, z, ry, { burnt: rnd() < 0.08, lights: rnd() < 0.06 ? 'flicker' : false }); } };
  const debrisPile = (x, z, n = 6) => { for (let k = 0; k < n; k++) { const s = rr(0.3, 1.2); add(box1, 'rubble', x + rr(-1.5, 1.5), s * 0.25, z + rr(-1.5, 1.5), rr(0, 3), rr(-.4, .4), rr(-.4, .4), s, s * 0.5, s * 0.8); } };
  const barrelFire = (x, z) => { add(barrelGeo, 'rust', x, 0.45, z); addCollider(x, z, 0.65, 0.65, 0, 0.9); addFire(x, 0.9, z); };
  const tent = (x, z, w, d, ry, key = 'olive', cross = false) => {
    const g = new T.CylinderGeometry(1, 1, 1, 3, 1, false); g.rotateZ(PI / 2); g.rotateY(PI / 2);
    add(g, key, x, 1.0, z, ry, 0, 0, d, 1.6, w * 0.6); addCollider(x, z, w, d, ry, 2.0); mapRects.push({ x, z, w, d, rot: ry, kind: 'c' });
    if (cross) add(plane, 'redCross', x + Math.sin(ry) * (d / 2 + 0.02), 1.1, z + Math.cos(ry) * (d / 2 + 0.02), ry, 0, 0, 0.8, 0.8, 1);
  };
  const container = (x, z, ry, stack = 1) => { for (let s = 0; s < stack; s++) { add(tiledBox(6, 2.5, 2.4, 2.4), pick(['contR', 'contB', 'contG', 'rust']), x, 1.25 + s * 2.55, z, ry + (s ? rr(-.06, .06) : 0)); } addCollider(x, z, 6, 2.4, ry, 2.5 * stack); mapRects.push({ x, z, w: 6, d: 2.4, rot: ry, kind: 'c' }); };
  const gurney = (x, z, ry, body = false) => { add(box1, 'gurney', x, 0.8, z, ry, 0, 0, 0.7, 0.08, 1.9); for (const a of [-0.3, 0.3]) for (const b of [-0.85, 0.85]) add(box1, 'rail', x + Math.cos(ry) * a + Math.sin(ry) * b, 0.4, z - Math.sin(ry) * a + Math.cos(ry) * b, 0, 0, 0, 0.04, 0.8, 0.04); if (body) add(box1, 'sheetW', x, 0.95, z, ry, 0, 0, 0.5, 0.22, 1.7); addCollider(x, z, 0.75, 1.95, ry, 0.95); };
  const chairs = (x, z, n, ry) => { const c = Math.cos(ry), s = Math.sin(ry); for (let i = 0; i < n; i++) { const t = (i - (n - 1) / 2) * 0.6; if (rnd() < 0.12) continue; add(box1, 'chair', x + c * t, 0.45, z - s * t, ry + (rnd() < 0.15 ? rr(-.6, .6) : 0), 0, 0, 0.5, 0.08, 0.5); add(box1, 'chair', x + c * t + s * 0.25, 0.75, z - s * t + c * 0.25, ry, -0.15, 0, 0.5, 0.55, 0.06); } add(box1, 'metal', x, 0.22, z, ry, 0, 0, n * 0.6, 0.06, 0.3); addCollider(x, z, n * 0.6, 0.7, ry, 0.9); };
  const pillar = (x, z, h, key = 'concrete', s = 0.8) => { add(tiledBox(s, h, s, 2), key, x, h / 2, z); addCollider(x, z, s, s, 0, h); mapRects.push({ x, z, w: s, d: s, rot: 0, kind: 'c' }); };
  const deadTree = (x, z) => { const h = rr(3.5, 5.5); add(new T.CylinderGeometry(0.1, 0.2, h, 6), 'wood', x, h / 2, z, 0, rr(-.08, .08), rr(-.08, .08)); for (let k = 0; k < 5; k++) add(new T.CylinderGeometry(0.03, 0.07, rr(1.2, 2.2), 4), 'wood', x + rr(-.5, .5), h * rr(0.55, 0.95), z + rr(-.5, .5), rr(0, 6), rr(0.5, 1.1), 0); add(new T.CylinderGeometry(0.8, 0.8, 0.5, 10), 'concrete', x, 0.25, z); addCollider(x, z, 1.6, 1.6, 0, 0.6); mapRects.push({ x, z, w: 1.6, d: 1.6, rot: 0, kind: 'c' }); };

  // ================================================== EAST: hospital + parking garage  x 84..224, z -64..64
  slab(84, 224, 6, 9, 'sidewalk'); slab(84, 224, -9, -6, 'sidewalk');
  roadLines('x', 92, 200); roadLamps('z', 0, 96, 206); roadCars('x', 96, 196);
  row(84, 224, 52, 64, ['z-'], 10, 24); row(84, 224, -64, -52, ['z+'], 10, 24);
  row(212, 224, -52, 52, ['x-'], 14, 26);
  for (const x of [204, 207.5]) for (let t = -5; t <= 5; t += 3.2) jersey(x, t + (x > 205 ? 1.6 : 0), PI / 2 + rr(-.1, .1));
  slab(84, 212, -52, -9, 'paving', 0.1, 2); slab(84, 212, 9, 52, 'lot', 0.1, 24);
  // hospital tower + lobby annex
  building(120, 176, -52, -30, 26, [], { fac: 'facC', ruined: false });
  building(96, 118, -50, -36, 16, ['x+'], { fac: 'facE' });
  building(178, 206, -50, -34, 14, ['x-', 'z+'], { fac: 'facE' });
  {
    const x0 = 124, x1 = 164, z0 = -30, z1 = -12, H = 5;
    slab(x0, x1, z0, z1, 'floorTile', 0.12, 2);
    wall(x0, x0 + 0.6, z0, z1, H, 'facC'); wall(x1 - 0.6, x1, z0, z1, H, 'facC');
    wall(x0, 138, z1 - 0.6, z1, H, 'facC'); wall(150, x1, z1 - 0.6, z1, H, 'facC');
    add(box1, 'glass', 144, H - 0.75, z1 - 0.3, 0, 0, 0, 12, 1.5, 0.3); // transom over the doors
    for (const x of [139, 149]) { add(box1, 'metal', x, 1.7, z1 - 0.3, 0, 0, 0, 0.12, 3.4, 0.25); }
    add(box1, 'glassBroken', 140.5, 1.6, z1 + 0.6, 0, 0, 0.9, 1.4, 3, 0.05); // fallen door panel
    add(box1, 'concrete', (x0 + x1) / 2, H + 0.2, (z0 + z1) / 2, 0, 0, 0, x1 - x0 + 0.4, 0.4, z1 - z0 + 0.4); // roof
    add(box1, 'ceilPanel', (x0 + x1) / 2, H - 0.36, (z0 + z1) / 2, 0, 0, 0, x1 - x0 - 1.2, 0.04, z1 - z0 - 1.2);
    panelLights(x0 + 1, x1 - 1, z0 + 1, z1 - 1, H - 0.4, 5, 0.35);
    add(box1, 'gasRed', 144, H + 0.6, z1 + 0.25, 0, 0, 0, 13, 0.7, 0.2);
    // canopy over the drop-off
    add(box1, 'white2', 144, 4.2, z1 + 4, 0, 0, 0, 16, 0.3, 7); for (const x of [137, 151]) { add(box1, 'white2', x, 2.05, z1 + 7, 0, 0, 0, 0.4, 4.1, 0.4); addCollider(x, z1 + 7, 0.4, 0.4, 0, 4.1); }
    // interior: reception, waiting rows, gurneys, pillars, signs
    add(tiledBox(10, 1.1, 1.2, 2), 'white2', 144, 0.65, -25); add(box1, 'wood', 144, 1.22, -25, 0, 0, 0, 10.2, 0.06, 1.4); addCollider(144, -25, 10, 1.2, 0, 1.2);
    signP('sgReg', 144, 3.4, -29.38, 0, 4, 1);
    for (const x of [134, 154]) pillar(x, -21, H, 'white2', 0.9);
    for (let i = 0; i < 3; i++) { chairs(130, -22 + i * 2.2, 6, PI); chairs(158, -22 + i * 2.2, 6, PI); }
    gurney(136.5, -15.5, 0.4, true); gurney(152, -17, -1.1); gurney(128, -27.5, PI / 2, true); gurney(160.5, -27, 0.2);
    for (const [x, z] of [[133, -17], [155, -25], [146, -20]]) { add(box1, 'rail', x, 0.9, z, 0, 0, 0, 0.04, 1.8, 0.04); add(box1, 'sheetW', x, 1.7, z, 0, 0, 0, 0.15, 0.25, 0.05); }
    signP('sgER', 160, 3.2, -12.95, PI, 3.2, 0.8);
    add(plane, 'redCross', 144, 7.5, -29.9, 0, 0, 0, 3.4, 3.4, 1);
    debrisPile(128, -15, 4); debrisPile(158, -14, 3);
    mapRects.push({ x: 144, z: -21, w: 40, d: 18, rot: 0, kind: 'i' });
    neons.push(['急診室', '#ff2030', '#ff7080', 144, 4.6, z1 + 7.6, 0, 3.6, 1.1, 'stutter']);
    neons.push(['仁心醫院', '#40ffb0', '#b0ffe0', 148, 20, -29.85, 0, 6.5, 2.0, 'buzz']);
  }
  placeCar('ambulance', 132, -5.5, 0.15, { random: false, broken: true, lights: 'flicker' });
  placeCar('ambulance', 156, -3.5, PI + 0.4, { random: false, broken: true, rust: 0.2 });
  placeCar('police', 118, 3.2, 2.6, { random: false, broken: true, doorOpen: 1 });
  tent(104, -20, 6, 4, 0, 'white2', true); tent(112, -20, 6, 4, 0.1, 'white2', true); tent(190, -22, 6, 4, -0.2, 'white2', true);
  for (const [x, z, r] of [[102, -14, 0.3], [109, -15, -0.6], [192, -15, 1.2], [118, -13, 2.1]]) gurney(x, z, r, rnd() < 0.6);
  sandbags(124, -10, 0, 5); sandbags(164, -10.5, 0.1, 5); barrelFire(108, -12); barrelFire(196, -30);
  // parking garage: 3 decks, ground deck enterable
  {
    const x0 = 118, x1 = 178, z0 = 16, z1 = 50, H = 3.3;
    slab(x0, x1, z0, z1, 'concrete', 0.12, 3);
    wall(x0, x1, z1 - 0.6, z1, H * 3 + 1, 'concrete');
    wall(x0, x0 + 0.6, z0, z1, H, 'concrete'); wall(x1 - 0.6, x1, z0, z1, H, 'concrete');
    wall(x0, 142, z0, z0 + 0.6, H, 'concrete'); wall(154, x1, z0, z0 + 0.6, H, 'concrete');
    for (let lv = 1; lv <= 3; lv++) { add(box1, 'concrete', (x0 + x1) / 2, lv * H, (z0 + z1) / 2, 0, 0, 0, x1 - x0, 0.35, z1 - z0); if (lv < 3 || true) { add(box1, 'concrete', (x0 + x1) / 2, lv * H + 0.6, z0 + 0.3, 0, 0, 0, x1 - x0, 1.0, 0.3); add(box1, 'concrete', x0 + 0.3, lv * H + 0.6, (z0 + z1) / 2, 0, 0, 0, 0.3, 1.0, z1 - z0); add(box1, 'concrete', x1 - 0.3, lv * H + 0.6, (z0 + z1) / 2, 0, 0, 0, 0.3, 1.0, z1 - z0); } }
    for (let lv = 1; lv < 3; lv++) for (let x = x0 + 4; x < x1; x += 8) add(box1, 'concrete', x, lv * H + 1.7, z0 + 0.3, 0, 0, 0, 0.6, 2.0, 0.6);
    add(box1, 'yellowL', (x0 + x1) / 2, H - 0.25, z0 - 0.02, 0, 0, 0, x1 - x0, 0.25, 0.04);
    for (let x = x0 + 8; x < x1 - 2; x += 8) for (const z of [27, 39]) pillar(x, z, H, 'concrete', 0.7);
    panelLights(x0 + 1, x1 - 1, z0 + 1, z1 - 1, H - 0.2, 6, 0.45);
    for (const zz of [20.5, 45.5]) for (let x = x0 + 2.6; x < x1 - 2; x += 2.6) add(flat, 'line', x, 0.13, zz, 0, 0, 0, 0.12, 1, 4.6);
    for (const zz of [20.5, 45.5]) for (let x = x0 + 3.9; x < x1 - 3; x += 2.6) if (rnd() < 0.45) placeCar(pick(['sedan', 'hatch', 'suv', 'sedan']), x, zz, (zz > 30 ? PI / 2 : -PI / 2) + rr(-.1, .1), { lights: rnd() < 0.08 ? 'flicker' : false });
    placeCar('sedan', 136, 33, 0.3, { burnt: true, random: false }); placeCar('van', 160, 33.5, 2.9, { broken: true });
    // pay booth + boom barrier
    add(tiledBox(1.6, 2.4, 1.6, 2), 'white2', 140, 1.2, 13.5); addCollider(140, 13.5, 1.6, 1.6, 0, 2.4); add(box1, 'stripe', 147, 1.0, 13.5, 0, 0, -0.5, 6, 0.12, 0.12);
    signP('sgPark', 148, H + 1.4, z0 - 0.05, PI, 4.2, 1.0);
    neons.push(['P 停車場', '#3a80ff', '#a0c8ff', 130, 4.6, z0 - 0.4, PI, 3.6, 1.1, 'buzz']);
    mapRects.push({ x: 148, z: 33, w: 60, d: 34, rot: 0, kind: 'i' });
    debrisPile(170, 30, 4);
  }
  building(96, 114, 20, 46, 12, ['z-', 'x+'], {}); building(184, 206, 16, 46, 15, ['z-', 'x-'], {});
  for (const [x, z] of [[100, 12], [190, 12], [206, -12]]) dumpster(x, z, rr(-.3, .3));

  // ================================================== WEST: mall plaza  x -224..-84, z -64..64
  slab(-224, -84, 6, 9, 'sidewalk'); slab(-224, -84, -9, -6, 'sidewalk');
  roadLines('x', -200, -92); roadLamps('z', 0, -206, -96); roadCars('x', -196, -100);
  row(-224, -84, 52, 64, ['z-'], 10, 22); row(-224, -84, -64, -56, ['z+'], 10, 20);
  row(-224, -212, -56, 52, ['x+'], 12, 24);
  for (const x of [-204, -207.5]) for (let t = -5; t <= 5; t += 3.2) jersey(x, t + (x < -205 ? 1.6 : 0), PI / 2 + rr(-.1, .1));
  slab(-212, -84, 9, 52, 'paving', 0.1, 2); slab(-212, -84, -56, -9, 'paving', 0.1, 2);
  {
    const x0 = -206, x1 = -140, z0 = -56, z1 = -14, H = 22, G = 5.6;
    slab(x0, x1, z0, z1, 'floorGran', 0.12, 2);
    wall(x0, x1, z0, z0 + 0.6, H, 'facD'); wall(x0, x0 + 0.6, z0, z1, H, 'facD'); wall(x1 - 0.6, x1, z0, z1, H, 'curtain', 0, true, 'b', 4);
    // front: glass storefronts at street level with two entrances, curtain wall above
    for (const [a, b] of [[x0, -182], [-164, x1]]) { wall(a, b, z1 - 0.5, z1, G, 'curtain', 0, true, 'b', 4); }
    add(tiledBox(x1 - x0, H - G, 0.5, 4), 'curtain', (x0 + x1) / 2, G + (H - G) / 2, z1 - 0.25);
    add(box1, 'metal', -173, G - 0.3, z1 + 1.4, 0, 0, 0, 20, 0.25, 3.2);
    add(box1, 'concrete', (x0 + x1) / 2, G, (z0 + z1) / 2, 0, 0, 0, x1 - x0, 0.4, z1 - z0);
    add(box1, 'concrete', (x0 + x1) / 2, H, (z0 + z1) / 2, 0, 0, 0, x1 - x0 + 0.6, 0.5, z1 - z0 + 0.6);
    add(box1, 'ceilPanel', (x0 + x1) / 2, G - 0.22, (z0 + z1) / 2, 0, 0, 0, x1 - x0 - 1.4, 0.04, z1 - z0 - 1.4);
    panelLights(x0 + 1, x1 - 1, z0 + 1, z1 - 1, G - 0.26, 6, 0.5);
    for (let x = x0 + 9; x < x1 - 4; x += 11) for (const z of [-24, -42]) pillar(x, z, G, 'floorGran', 1.0);
    // shops along the back wall: shutters + shop signs
    for (let x = x0 + 5; x < x1 - 4; x += 8) { add(tiledBox(7.4, 3.6, 0.2, 4, 4), pick(['shop0', 'shop1', 'shop2']), x, 1.8, z0 + 0.75); }
    // escalators (static, broken) + kiosks + mannequins + fallen signage
    for (const xx of [-178, -170]) { add(box1, 'steel', xx, 2.6, -36, 0, -0.62, 0, 1.4, 0.35, 9.5); add(box1, 'metal', xx - 0.75, 3.1, -36, 0, -0.62, 0, 0.1, 1.0, 9.5); add(box1, 'metal', xx + 0.75, 3.1, -36, 0, -0.62, 0, 0.1, 1.0, 9.5); addCollider(xx, -36, 1.8, 8, 0, 2.4); }
    for (const [x, z] of [[-195, -30], [-160, -33], [-150, -46], [-188, -46]]) { add(tiledBox(2.6, 1.1, 1.6, 2), 'wood', x, 0.65, z); add(box1, 'awning2', x, 2.4, z, 0, 0, 0, 3, 0.1, 2); for (const s of [-1, 1]) add(box1, 'metal', x + s * 1.3, 1.6, z, 0, 0, 0, 0.06, 1.8, 0.06); addCollider(x, z, 2.6, 1.6, 0, 1.2); }
    for (let i = 0; i < 8; i++) { const x = rr(-200, -146), z = rr(-50, -18); add(new T.CylinderGeometry(0.12, 0.16, 1.1, 6), 'white2', x, 1.0, z, rr(0, 3), rnd() < 0.4 ? PI / 2 : 0, 0); add(new T.SphereGeometry(0.13, 6, 5), 'white2', x, 1.7, z); }
    add(box1, 'signs', -172, 0.4, -27, 0.4, -1.3, 0, 6, 1.6, 0.1);
    signP('sgMall', -174, 4.5, -31.2, 0, 4.4, 1);
    add(box1, 'ledBoard', -173, 13, z1 + 0.05, 0, 0, 0, 14, 7, 0.1);
    neons.push(['星港百貨', '#ff40a0', '#ffb0d8', -173, 18.5, z1 + 0.35, 0, 9, 2.6, 'buzz']);
    mapRects.push({ x: -173, z: -35, w: 66, d: 42, rot: 0, kind: 'i' });
    debrisPile(-160, -20, 5); debrisPile(-196, -38, 4);
  }
  // plaza south of the road: planters, dead trees, benches, refugee camp, burnt bus
  for (let x = -196; x < -100; x += 16) for (const z of [20, 40]) deadTree(x + rr(-2, 2), z + rr(-2, 2));
  for (const [x, z] of [[-130, 30], [-160, 30], [-188, 30]]) { add(new T.CylinderGeometry(3, 3.2, 0.6, 18), 'concrete', x, 0.3, z); addCollider(x, z, 6, 6, 0, 0.6); mapRects.push({ x, z, w: 6, d: 6, rot: 0, kind: 'c' }); }
  for (let i = 0; i < 6; i++) tent(-200 + i * 7, 48, 5, 3.5, PI + rr(-.2, .2), i % 2 ? 'olive' : 'awning2');
  placeCar('bus', -150, 14, 0.12, { random: false, burnt: true, rust: 0.5 }); placeCar('police', -118, 18, 1.3, { random: false, lights: 'flicker', broken: true });
  for (const [x, z] of [[-110, 44], [-176, 18], [-140, -10.5]]) barrelFire(x, z);
  for (let i = 0; i < 10; i++) { const x = rr(-205, -95), z = rr(12, 50); add(box1, 'crate', x, 0.4, z, rr(0, 3), 0, 0, 0.8, 0.8, 0.8); }

  // ================================================== SOUTH: subway  x -64..64, z 84..214
  slab(6, 9, 84, 214, 'sidewalk'); slab(-9, -6, 84, 214, 'sidewalk');
  roadLines('z', 92, 200); roadLamps('x', 0, 96, 206); roadCars('z', 96, 196);
  row(52, 64, 84, 214, ['x-'], 10, 24); row(-64, -52, 84, 214, ['x+'], 10, 24); row(-52, 52, 204, 214, ['z-'], 12, 26);
  for (const z of [196, 199.5]) for (let t = -5; t <= 5; t += 3.2) jersey(t + (z > 198 ? 1.6 : 0), z, rr(-.1, .1));
  slab(9, 52, 84, 204, 'paving', 0.1, 2); slab(-52, -9, 84, 204, 'sidewalk');
  row(-52, -18, 96, 108, ['z-', 'x+'], 8, 18); row(-52, -18, 124, 136, ['x+'], 8, 16); row(-52, -18, 168, 190, ['x+', 'z-'], 10, 20);
  row(30, 52, 100, 124, ['x-'], 10, 18); row(36, 52, 170, 196, ['x-'], 10, 20);
  // entrance pavilion (glass canopy) with the stair going down
  {
    const x0 = 14, x1 = 32, z0 = 140, z1 = 156, H = 3.6;
    gRects.push([x0, x1, z0, z1, 0.1]);
    add(tiledBox(4, 0.1, z1 - z0, 1.5), 'floorGran', 16, 0.05, (z0 + z1) / 2);
    add(tiledBox(14, 0.1, 4, 1.5), 'floorGran', 25, 0.05, 142); add(tiledBox(14, 0.1, 4, 1.5), 'floorGran', 25, 0.05, 154);
    wall(x1 - 0.5, x1, z0, z1, H, 'metroWall'); wall(x0 + 2, x1, z0, z0 + 0.5, H, 'metroWall'); wall(x0 + 2, x1, z1 - 0.5, z1, H, 'metroWall');
    add(box1, 'glass', (x0 + x1) / 2, H + 0.1, (z0 + z1) / 2, 0, 0, 0, x1 - x0 + 1, 0.2, z1 - z0 + 1);
    add(box1, 'steel', (x0 + x1) / 2, H - 0.15, (z0 + z1) / 2, 0, 0, 0, x1 - x0, 0.25, 0.3);
    // stair well: steps going down, dark pit walls
    for (let i = 0; i < 12; i++) add(box1, 'concrete', 18.5 + i, -0.1 - i * 0.2 - 0.1, 148, 0, 0, 0, 1.02, 0.2 + 0.01, 8);
    add(box1, 'carDark', 24, -2.2, 143.9, 0, 0, 0, 12, 4.6, 0.2); add(box1, 'carDark', 24, -2.2, 152.1, 0, 0, 0, 12, 4.6, 0.2); add(box1, 'carDark', 30.1, -2.2, 148, 0, 0, 0, 0.2, 4.6, 8.4);
    add(box1, 'metroWall', 24, -1.2, 144.05, 0, 0, 0, 12, 2.4, 0.02); add(box1, 'metroWall', 24, -1.2, 151.95, 0, 0, 0, 12, 2.4, 0.02);
    for (const z of [143.8, 152.2]) { add(box1, 'steel', 24, 1.0, z, 0, 0, 0, 12, 0.08, 0.08); for (let x = 18.5; x <= 30; x += 2.3) add(box1, 'steel', x, 0.5, z, 0, 0, 0, 0.06, 1.0, 0.06); addCollider(24, z, 12.4, 0.3, 0, 1.0); }
    addCollider(30.4, 148, 0.4, 8.4, 0, 3);
    signP('sgMetro', 14.2, 3.0, 148, -PI / 2, 4.4, 1.1);
    neons.push(['M 捷運', '#20a0ff', '#a0e0ff', 13.9, 4.6, 148, -PI / 2, 3.2, 1.2, 'buzz']);
    mapRects.push({ x: 23, z: 148, w: 18, d: 16, rot: 0, kind: 'm' });
  }
  // elevated viaduct pillars + deck over the street (visual landmark)
  for (let z = 100; z < 200; z += 18) { for (const x of [-12, 12]) pillar(x, z, 9, 'concrete', 1.4); add(box1, 'concrete', 0, 9.4, z, 0, 0, 0, 26, 1.2, 2); }
  add(tiledBox(18, 1.0, 106, 4), 'concrete', 0, 10.4, 150);
  for (const [x, z] of [[24, 112], [30, 180], [-24, 150], [-14, 120]]) barrelFire(x, z);
  for (let i = 0; i < 4; i++) { const z = rr(110, 190); tent(-28 - rr(0, 10), z, 5, 3.5, PI / 2, 'olive'); }
  placeCar('bus', 4, 132, PI / 2 - 0.3, { random: false, broken: true, crashed: true });
  sandbags(18, 132, 0.2, 5); sandbags(18, 164, -0.2, 5);
  // underground station section (sealed box, reached through the portal)
  {
    const x0 = -40, x1 = 40, z0 = 262, z1 = 300, H = 4.2;
    slab(x0, x1, z0, 292, 'floorGran', 0.1, 2); add(tiledBox(x1 - x0, 0.1, 8, 2), 'ballast', 0, 0.02, 296);
    wall(x0 - 0.6, x0, z0, z1, H, 'metroWall', 0, true, 'u'); wall(x1, x1 + 0.6, z0, z1, H, 'metroWall', 0, true, 'u');
    wall(x0, x1, z0 - 0.6, z0, H, 'metroWall', 0, true, 'u', 6); wall(x0, x1, z1, z1 + 0.6, H, 'carDark', 0, true, 'u');
    add(box1, 'ceilPanel', 0, H, (z0 + z1) / 2, 0, 0, 0, x1 - x0 + 1.2, 0.3, z1 - z0 + 1.2);
    panelLights(x0 + 2, x1 - 2, z0 + 1, 290, H - 0.2, 5, 0.4);
    for (let x = -32; x <= 32; x += 8) pillar(x, 277, H, 'metroWall', 0.9);
    // platform screen doors
    for (let x = -38; x < 38; x += 4) { add(box1, 'metal', x, 1.25, 292, 0, 0, 0, 0.12, 2.5, 0.2); add(box1, 'metal', x + 2, 2.65, 292, 0, 0, 0, 4, 0.3, 0.25); if (rnd() < 0.85) add(box1, 'psd', x + 2, 1.25, 292, 0, 0, 0, 3.8, 2.4, 0.04); }
    addCollider(0, 292, 80, 0.3, 0, 2.6); add(flat, 'lineY', 0, 0.13, 291.2, 0, 0, 0, 78, 1, 0.25);
    for (const x of [-36, 36]) for (const s of [-0.75, 0.75]) add(box1, 'rail', x / 1e9 + 0, 0.12, 296 + s, 0, 0, 0, 80, 0.1, 0.08);
    // train stopped at the platform: carriage boxes with dim windows
    for (const cx of [-21, 0, 21]) { add(tiledBox(20, 3.0, 3.0, 4), 'white2', cx, 1.8, 296.2); add(box1, 'contB', cx, 1.0, 294.68, 0, 0, 0, 20, 0.3, 0.02); for (let w = -8; w <= 8; w += 2.6) add(box1, rnd() < 0.3 ? 'carDark' : 'trainWin', cx + w, 2.1, 294.68, 0, 0, 0, 1.8, 0.9, 0.02); }
    for (const x of [-26, -10, 10, 26]) { add(box1, 'bench', x, 0.45, 286.5, 0, 0, 0, 2.4, 0.08, 0.5); addCollider(x, 286.5, 2.4, 0.5, 0, 0.5); }
    for (let x = -24; x <= 24; x += 12) { add(box1, 'metal', x, 3.6, 284, 0, 0, 0, 0.05, 0.8, 0.05); signP('sgDir', x, 3.0, 284, 0, 2.2, 0.55); signP('sgDir', x, 3.0, 284.01, PI, 2.2, 0.55); }
    // ticket gates near the stairs + vending machines + stalled escalator stub
    for (const z of [263, 265.2, 267.4, 272.6, 274.8, 277]) { add(box1, 'steel', -29, 0.5, z, 0, 0, 0, 1.6, 1.0, 0.3); addCollider(-29, z, 1.6, 0.3, 0, 1.0); }
    for (const x of [-12, -8]) { add(box1, 'contR', x, 0.95, 262.5, 0, 0, 0, 1.2, 1.9, 0.8); add(box1, 'panelLit', x, 1.2, 262.92, 0, 0, 0, 0.9, 0.8, 0.02); addCollider(x, 262.5, 1.2, 0.8, 0, 1.9); }
    for (let i = 0; i < 9; i++) add(box1, 'concrete', -31.5 - i, 0.1 + i * 0.22, 270, 0, 0, 0, 1.02, 0.22, 8);
    add(box1, 'carDark', -36, 3, 270, 0, 0, 0, 8, 2.4, 8);
    signP('sgMetro', 0, 3.2, 262.05, 0, 5, 1.25);
    debrisPile(6, 270, 5); debrisPile(-18, 284, 3); add(box1, 'ceilPanel', 14, 0.3, 268, 0.6, 0.3, 0.2, 2.4, 0.05, 1.2);
    mapRects.push({ x: 0, z: 281, w: 80, d: 38, rot: 0, kind: 'u' });
  }

  // ================================================== NORTH: military checkpoint  x -64..64, z -234..-84
  slab(6, 9, -150, -84, 'sidewalk'); slab(-9, -6, -150, -84, 'sidewalk');
  roadLines('z', -146, -92); roadLamps('x', 0, -146, -96); roadCars('z', -140, -100);
  row(52, 64, -150, -84, ['x-'], 10, 22); row(-64, -52, -150, -84, ['x+'], 10, 22);
  row(14, 52, -110, -94, ['x-', 'z+'], 8, 16); row(-52, -14, -112, -92, ['x+', 'z+'], 8, 16);
  slab(9, 52, -150, -84, 'sidewalk'); slab(-52, -9, -150, -84, 'sidewalk');
  // the wall line with a staggered gate
  wall(-64, -10, -153, -151, 6, 'concrete', 0, true, 'b', 3); wall(10, 64, -153, -151, 6, 'concrete', 0, true, 'b', 3);
  for (const x of [-10, 10]) { add(box1, 'oliveD', x, 3.5, -152, 0, 0, 0, 2.6, 7, 2.6); addCollider(x, -152, 2.6, 2.6, 0, 7); }
  for (let x = -60; x < 62; x += 3) add(new T.TorusGeometry(0.35, 0.03, 4, 10), 'rail', x, 6.3, -152, 0, 0, 0, 1, 1, 1);
  jersey(-4, -146, 0.1); jersey(2.5, -149, -0.05); jersey(-3.5, -156, 0.05); jersey(3.8, -158.5, 0);
  add(box1, 'stripe', 0, 1.1, -152, 0, 0, 0.12, 9, 0.15, 0.15);
  signP('sgMil', -18, 3.2, -150.95, 0, 6, 1.5); signP('sgMil', 18, 3.2, -150.95, 0, 6, 1.5);
  // guard towers with searchlights
  for (const [x, z] of [[-16, -146], [16, -146], [-44, -200], [44, -200]]) {
    for (const a of [-1, 1]) for (const b of [-1, 1]) add(box1, 'oliveD', x + a * 1.2, 3.5, z + b * 1.2, 0, 0, 0, 0.18, 7, 0.18);
    add(box1, 'olive', x, 7.3, z, 0, 0, 0, 3.2, 0.25, 3.2); add(box1, 'sand', x, 7.9, z, 0, 0, 0, 3.0, 1.0, 3.0); add(box1, 'oliveD', x, 9.2, z, 0, 0, 0, 3.4, 0.15, 3.4);
    for (const a of [-1, 1]) for (const b of [-1, 1]) add(box1, 'oliveD', x + a * 1.5, 8.6, z + b * 1.5, 0, 0, 0, 0.1, 1.2, 0.1);
    add(box1, 'lightOff', x, 8.7, z + 1.5, 0, 0, 0, 0.6, 0.5, 0.5); addCollider(x, z, 2.8, 2.8, 0, 9);
    mapRects.push({ x, z, w: 3, d: 3, rot: 0, kind: 'c' });
    beams.push({ x, y: 8.7, z: z + 1.6, tx: x * 0.4 + rr(-6, 6), tz: z + (z > -170 ? 16 : 14) });
  }
  // inside the perimeter: staging yard, containers, sandbag bunkers, tents, trucks, helipad
  slab(-60, 60, -230, -153, 'lot', 0.1, 24);
  wall(-64, 64, -234, -230, 7, 'concrete', 0, true, 'b', 3); wall(-64, -60, -230, -153, 7, 'concrete', 0, true, 'b', 3); wall(60, 64, -230, -153, 7, 'concrete', 0, true, 'b', 3);
  for (const [x, z, r, s] of [[-50, -170, 0, 2], [-50, -178, 0.05, 1], [48, -168, PI / 2, 2], [48, -186, PI / 2, 1], [-30, -222, 0, 2], [-22, -222, 0, 1], [30, -224, 0, 2], [52, -214, PI / 2, 3], [-52, -214, PI / 2, 2]]) container(x, z, r, s);
  for (const [x, z, r] of [[-20, -164, 0.2], [22, -166, -0.3], [-8, -180, 1.4], [12, -212, 0.6], [-26, -206, 2.6]]) sandbags(x, z, r, 6);
  for (const [x, z, r] of [[-32, -170, 0], [-32, -184, 0], [34, -176, PI / 2], [34, -190, PI / 2]]) tent(x, z, 7, 5, r, 'olive', rnd() < 0.4);
  for (const [t, x, z, r] of [['pickup', -14, -170, 0.6], ['van', 18, -184, -1.2], ['pickup', 8, -168, 2.2], ['van', -40, -196, 0.1], ['suv', 26, -206, 1.0]]) placeCar(t, x, z, r, { color: 0x3a4028, random: false, broken: rnd() < 0.5, rust: 0.2, burnt: t === 'van' && x > 0 });
  placeCar('police', -6, -142, 2.6, { random: false, lights: 'flicker' });
  roadLamps('x', 0, -224, -160); for (const z of [-170, -192, -214]) { lampSpots.push([-24, z, 1, 'x'], [24, z, -1, 'x']); }
  add(flat, 'helipad', 0, 0.12, -196, 0, 0, 0, 16, 1, 16);
  for (const [x, z] of [[-6, -186], [6, -206], [-38, -158], [40, -158]]) barrelFire(x, z);
  for (let i = 0; i < 4; i++) fence(-40 + i * 26, -228, 22, 0);
  sawhorse(-6, -134, 0.3); sawhorse(6, -128, -0.2); sandbags(-8, -120, 0.1, 4); sandbags(8, -114, -0.1, 4);
  neons.push(['外環檢查哨', '#ffb020', '#ffe0a0', 0, 7.8, -150.8, 0, 6, 1.4, 'stutter']);
  return { neons, beams };
}
