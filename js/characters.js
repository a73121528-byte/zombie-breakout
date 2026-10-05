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
  torus: (r, t, a = Math.PI * 2) => cached(`tor${r}_${t}_${a}`, () => new THREE.TorusGeometry(r, t, 5, 14, a)),
  lathe: (key, pts, segs = 12, ps = 0, pl = Math.PI * 2) => cached('lat' + key, () => new THREE.LatheGeometry(V2(pts), segs, ps, pl)),
};
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _c = new THREE.Color();

class Kit {
  constructor(rng = Math.random) { this.lists = new Map(); this.rng = rng; }
  // add(parent, geo, color, [x,y,z], [sx,sy,sz], [rx,ry,rz], jitter)
  add(parent, geo, color, p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0], jit = 0.04) {
    const g = geo.index ? geo.clone() : geo.clone();
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
  skin: 0xe3cfc4, lip: 0xa0545c, eye: 0x2a1838, hair: 0x5a2f8c, hairHi: 0x7a48b8, hairDk: 0x3a1c60, glove: 0x16141a, belt: 0x2c1c14,
};
export function buildHeroine() {
  const leather = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 38, specular: 0x2a2630, emissive: 0x050308 });
  const coatSide = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 30, specular: 0x222026, side: THREE.DoubleSide, emissive: 0x050308 });
  const kit = new Kit(seeded(7)), skirtKit = new Kit(seeded(9));
  const root = new THREE.Group();
  const body = grp(root, 'body', 0, 0.95, 0);
  const R = { root, body };
  // ---- legs
  for (const s of [1, -1]) {
    const leg = grp(body, '', 0.092 * s, -0.04, 0);
    kit.add(leg, GEO.cap(0.068, 0.3), HC.pants, [0, -0.2, 0], [1, 1, 1.05]);
    const shin = grp(leg, '', 0, -0.43, 0);
    kit.add(shin, GEO.cap(0.058, 0.3), HC.boot, [0, -0.2, 0]);
    kit.add(shin, GEO.cyl(0.068, 0.064, 12, true), HC.bronze, [0, -0.04, 0], [1, 0.05, 1]);
    kit.add(shin, GEO.cyl(0.068, 0.068, 12, true), HC.boot, [0, -0.07, 0], [1, 0.06, 1.05]);
    kit.add(shin, GEO.sph(), HC.boot, [0, -0.44, 0.045], [0.058, 0.048, 0.125]);
    kit.add(shin, GEO.box(), 0x060606, [0, -0.485, 0.04], [0.11, 0.025, 0.24]);
    kit.add(shin, GEO.box(), HC.bronze, [0.0, -0.28, 0.055], [0.03, 0.02, 0.02]); // buckle
    R[s > 0 ? 'legL' : 'legR'] = leg; R[s > 0 ? 'shinL' : 'shinR'] = shin;
  }
  // ---- long coat skirt (open at front), separate double-sided mesh so it can flutter
  const skirtPivot = grp(body, 'skirt', 0, 0.04, 0); R.skirt = skirtPivot;
  const skirtProf = [[0.155, 0.02], [0.175, -0.12], [0.215, -0.34], [0.26, -0.6], [0.275, -0.68]];
  skirtKit.add(skirtPivot, GEO.lathe('skirt', skirtProf, 16, 0.55, Math.PI * 2 - 1.1), HC.coat, [0, 0, 0], [1, 1, 0.82]);
  skirtKit.add(skirtPivot, GEO.lathe('hem', [[0.272, -0.62], [0.279, -0.69]], 16, 0.55, Math.PI * 2 - 1.1), HC.bronze, [0, 0, 0], [1.01, 1, 0.83]);
  // back slit fold
  skirtKit.add(skirtPivot, GEO.box(), HC.coatHi, [0, -0.38, -0.205], [0.012, 0.56, 0.01]);
  // ---- torso
  const torso = grp(body, 'torso', 0, 0, 0); R.torso = torso;
  kit.add(torso, GEO.sph(), HC.pants, [0, 0.0, 0], [0.15, 0.1, 0.11]);
  const torsoProf = [[0.001, -0.02], [0.142, -0.01], [0.146, 0.08], [0.128, 0.19], [0.15, 0.31], [0.168, 0.4], [0.162, 0.47], [0.115, 0.53], [0.06, 0.56], [0.001, 0.565]];
  kit.add(torso, GEO.lathe('htorso', torsoProf, 14), HC.coat, [0, 0, 0], [1, 1, 0.72]);
  kit.add(torso, GEO.sph(), HC.inner, [0, 0.36, 0.088], [0.055, 0.15, 0.03]);       // inner top in the V
  kit.add(torso, GEO.cyl(0.148, 0.148, 16, true), HC.belt, [0, 0.085, 0], [1, 0.045, 0.74]);
  kit.add(torso, GEO.box(), HC.bronzeHi, [0, 0.085, 0.108], [0.045, 0.035, 0.012]);  // buckle
  for (const s of [1, -1]) {
    kit.add(torso, GEO.box(), HC.bronze, [0.045 * s, 0.3, 0.112], [0.014, 0.42, 0.01], [0.06, 0, -0.16 * s]); // lapel trim
    kit.add(torso, GEO.box(), HC.coatHi, [0.07 * s, 0.33, 0.108], [0.05, 0.34, 0.012], [0.06, 0, -0.2 * s]);  // lapel
    kit.add(torso, GEO.sph(), HC.coat, [0.158 * s, 0.47, 0], [0.075, 0.06, 0.08]);     // shoulder
    kit.add(torso, GEO.box(), HC.bronze, [0.158 * s, 0.505, 0], [0.07, 0.008, 0.07], [0, 0, 0.3 * s]); // shoulder seam
    kit.add(torso, GEO.box(), HC.belt, [0.11 * s, 0.03, 0.06], [0.04, 0.07, 0.03]);   // belt pouch
  }
  // hood lying on the back + collar
  kit.add(torso, GEO.cyl(0.085, 0.118, 14, true), HC.coat, [0, 0.54, -0.005], [1, 0.07, 0.95]);
  kit.add(torso, GEO.sph(), HC.coat, [0, 0.5, -0.115], [0.135, 0.12, 0.07], [0.3, 0, 0]);
  kit.add(torso, GEO.sph(), 0x0a090c, [0, 0.52, -0.095], [0.105, 0.085, 0.04], [0.3, 0, 0]);
  kit.add(torso, GEO.torus(0.12, 0.007, Math.PI), HC.bronze, [0, 0.52, -0.1], [1.05, 0.85, 1], [0.3 - Math.PI / 2, 0, 0]);
  // machete holstered on the back (shown when a gun is out)
  const holster = grp(torso, 'holster', -0.07, 0.46, -0.135); holster.rotation.set(Math.PI / 2, 0, 0.55, 'ZYX'); R.holster = holster;
  // ---- head
  const head = grp(torso, 'head', 0, 0.555, 0.005); R.head = head;
  kit.add(head, GEO.cap(0.038, 0.06), HC.skin, [0, 0.045, 0]);
  kit.add(head, GEO.sph(14, 10), HC.skin, [0, 0.175, 0.012], [0.094, 0.114, 0.102]);
  kit.add(head, GEO.sph(), HC.skin, [0, 0.118, 0.04], [0.064, 0.052, 0.068]);       // jaw/chin
  kit.add(head, GEO.sph(), HC.skin, [0, 0.165, 0.108], [0.012, 0.016, 0.014]);      // nose
  kit.add(head, GEO.sph(), HC.lip, [0, 0.126, 0.098], [0.022, 0.008, 0.01]);
  for (const s of [1, -1]) {
    kit.add(head, GEO.sph(), 0xf0e8ee, [0.035 * s, 0.19, 0.092], [0.02, 0.011, 0.01]);
    kit.add(head, GEO.sph(), HC.eye, [0.035 * s, 0.19, 0.099], [0.011, 0.011, 0.006]);
    kit.add(head, GEO.box(), HC.hairDk, [0.037 * s, 0.215, 0.098], [0.032, 0.006, 0.006], [0, 0, -0.15 * s]); // brows
  }
  // hair cap (tilted so the face stays open)
  kit.add(head, GEO.sphPart(0, 1.95), HC.hair, [0, 0.188, -0.004], [0.106, 0.124, 0.116], [-0.5, 0, 0]);
  kit.add(head, GEO.sph(), HC.hairDk, [0, 0.16, -0.05], [0.1, 0.12, 0.08]);
  // bangs
  for (let i = 0; i < 6; i++) {
    const x = -0.065 + i * 0.026;
    kit.add(head, GEO.cap(0.018, 0.075, 5), i % 2 ? HC.hairHi : HC.hair, [x, 0.228, 0.088 - Math.abs(x) * 0.25], [1.2, 1, 0.55], [-0.45, 0, (x > 0 ? 1 : -1) * 0.25 + (i - 2.5) * 0.04]);
  }
  for (const s of [1, -1]) { // long face-framing strands
    kit.add(head, GEO.cap(0.02, 0.2, 5), HC.hair, [0.084 * s, 0.11, 0.055], [1, 1, 0.6], [0.1, 0, 0.06 * s]);
    kit.add(head, GEO.cap(0.016, 0.12, 5), HC.hairHi, [0.07 * s, 0.02, 0.06], [1, 1, 0.6], [0.2, 0, 0.12 * s]);
  }
  // ponytail tie + star ornament
  kit.add(head, GEO.torus(0.03, 0.01), HC.bronzeHi, [0, 0.26, -0.105], [1, 1, 1], [1.2, 0, 0]);
  const star = new THREE.Mesh(starGeo(), new THREE.MeshLambertMaterial({ color: 0xffd36a, emissive: 0x8a5a10 }));
  star.position.set(-0.088, 0.262, 0.025); star.rotation.set(0, -1.2, 0.3); star.scale.setScalar(0.035); head.add(star);
  const starGlow = glowSprite(0xffc860, 0.12, 0.5); starGlow.position.copy(star.position); head.add(starGlow);
  // ponytail chain (3 segments, spring-animated in main)
  const pony = []; let parent = head, py = 0.26, pz = -0.12;
  const segLen = [0.2, 0.22, 0.22], segR = [0.05, 0.045, 0.032];
  for (let i = 0; i < 3; i++) {
    const g = grp(parent, 'pony' + i, 0, i === 0 ? py : -segLen[i - 1], i === 0 ? pz : 0);
    kit.add(g, GEO.cap(segR[i], segLen[i] - segR[i], 6), i === 1 ? HC.hair : HC.hair, [0, -segLen[i] / 2, 0], [1.15, 1, 0.75]);
    kit.add(g, GEO.cap(segR[i] * 0.45, segLen[i] * 0.8, 4), HC.hairHi, [segR[i] * 0.5, -segLen[i] / 2, segR[i] * 0.3], [1, 1, 1], [0, 0, 0.05]);
    pony.push(g); parent = g;
  }
  kit.add(pony[2], GEO.cone(6), HC.hairDk, [0, -0.25, 0], [0.025, 0.08, 0.02], [Math.PI, 0, 0]);
  pony[0].rotation.x = 0.35; R.pony = pony; R.hair = pony[0]; R.hairTip = pony[1];
  // ---- arms
  for (const s of [1, -1]) {
    const arm = grp(torso, '', 0.185 * s, 0.47, 0); arm.rotation.order = 'YXZ';
    kit.add(arm, GEO.cap(0.05, 0.19), HC.coat, [0, -0.13, 0]);
    const fore = grp(arm, '', 0, -0.275, 0);
    kit.add(fore, GEO.cap(0.044, 0.17), HC.coat, [0, -0.11, 0]);
    kit.add(fore, GEO.cyl(0.052, 0.05, 12, true), HC.bronze, [0, -0.2, 0], [1, 0.035, 1]);
    kit.add(fore, GEO.cyl(0.05, 0.052, 12, true), HC.coatHi, [0, -0.175, 0], [1, 0.03, 1]);
    kit.add(fore, GEO.sph(), HC.glove, [0, -0.255, 0.008], [0.036, 0.048, 0.032]);
    kit.add(fore, GEO.cap(0.012, 0.03, 4), HC.glove, [0, -0.25, 0.036], [1, 1, 1], [0.9, 0, 0]); // thumb
    R[s > 0 ? 'armL' : 'armR'] = arm; R[s > 0 ? 'foreL' : 'foreR'] = fore;
  }
  // ---- machete
  const weapon = grp(R.foreR, 'weapon', 0, -0.27, 0.012); R.weapon = weapon;
  weapon.add(buildMachete());
  const holstered = buildMachete(); holstered.scale.setScalar(0.95); R.holster.add(holstered); R.holster.visible = false;
  R.gunMount = grp(R.foreR, 'gunMount', 0, -0.265, 0.01);
  kit.build(leather); skirtKit.build(coatSide);
  R.mats = { coat: leather, coatSide, star: star.material };
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
  walker: { skin: [0x596152, 0x63634f, 0x535e4d], cloth: [0x3a4658, 0x4a3a2c, 0x45454a, 0x5a2a2a, 0x3e4a32], pants: [0x2a2c34, 0x3a3226, 0x26262a], eye: 0xd8d0a0, bulk: 1, thin: 1, hunch: 0.35 },
  runner: { skin: [0x6a5852, 0x62564e], cloth: [0x6a1a1e, 0x2a3a5a, 0x5a5a20], pants: [0x1e1e24, 0x2a2a30], eye: 0xff4a30, bulk: 0.86, thin: 0.78, hunch: 0.6 },
  brute: { skin: [0x52524a, 0x584e46], cloth: [0x3a3634, 0x2c3238], pants: [0x22232a], eye: 0xffa040, bulk: 1.5, thin: 1.3, hunch: 0.32 },
  spitter: { skin: [0x56644a, 0x4e5c44], cloth: [0x3c3e34, 0x4a4436], pants: [0x2a2c26], eye: 0x9cff60, bulk: 1.05, thin: 0.95, hunch: 0.22 },
  armored: { skin: [0x5a5e54], cloth: [0x1e2638], pants: [0x1a2030], eye: 0xff3a2a, bulk: 1.1, thin: 1.05, hunch: 0.15 },
};
const BLOOD = 0x4e060a, BLOOD2 = 0x2e0306, BONE = 0xbab098, MOUTH = 0x1a0606;
const zTemplates = new Map();
export function buildZombie(type, variant = (Math.random() * 3) | 0) {
  const key = type + variant;
  let T = zTemplates.get(key);
  if (!T) { T = makeZombieTemplate(type, variant); zTemplates.set(key, T); }
  return instantiate(T, type);
}
const BONES = ['body', 'torso', 'head', 'legL', 'legR', 'shinL', 'shinR', 'armL', 'armR', 'foreL', 'foreR', 'smallL', 'smallR', 'core', 'sac', 'jaw', 'shield'];
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
  const R = { root, type, hunch: T.hunch, mats, glows, limp: T.limp };
  for (const b of BONES) { const o = root.getObjectByName(b); if (o) R[b] = o; }
  R.sacMat = T.sacMat ? matMap.get(T.sacMat) : null;
  R.coreMat = T.coreMat ? matMap.get(T.coreMat) : null;
  return R;
}
function makeZombieTemplate(type, variant) {
  const S = ZSTYLE[type], rng = seeded(101 + variant * 977 + type.length * 31);
  const pick = a => a[(rng() * a.length) | 0];
  const skin = pick(S.skin), cloth = pick(S.cloth), pants = pick(S.pants);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x000000 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: S.eye });
  const kit = new Kit(rng), eyeKit = new Kit(rng);
  const root = new THREE.Group();
  const body = grp(root, 'body', 0, 0.92, 0);
  const b = S.bulk, t = S.thin;
  const T = { root, hunch: S.hunch, limp: rng() < 0.5 ? 1 : -1 };
  const bareFoot = rng() < 0.5;
  // ---- legs
  for (const s of [1, -1]) {
    const leg = grp(body, s > 0 ? 'legL' : 'legR', 0.1 * s * b, -0.03, 0);
    kit.add(leg, GEO.cap(0.072 * t, 0.29), pants, [0, -0.2, 0]);
    if (rng() < 0.5) kit.add(leg, GEO.sph(), skin, [0.02 * s, -0.3, 0.06 * t], [0.04, 0.06, 0.02]); // tear
    const shin = grp(leg, s > 0 ? 'shinL' : 'shinR', 0, -0.43, 0);
    const torn = s < 0 && type !== 'armored' && rng() < 0.7;
    kit.add(shin, GEO.cap(0.06 * t, 0.29), torn ? skin : pants, [0, -0.2, 0]);
    if (torn) kit.add(shin, GEO.cyl(0.07 * t, 0.066 * t, 8, true), pants, [0, -0.03, 0], [1, 0.08, 1]);
    if (type === 'armored') kit.add(shin, GEO.sph(), 0x121418, [0, -0.04, 0.05], [0.055, 0.07, 0.04]); // knee pad
    const foot = bareFoot && s > 0 ? skin : (type === 'armored' ? 0x0c0c0e : 0x1c1814);
    kit.add(shin, GEO.sph(), foot, [0, -0.44, 0.045], [0.06, 0.048, 0.12]);
    if (bareFoot && s > 0) kit.add(shin, GEO.sph(), BLOOD, [0, -0.46, 0.1], [0.04, 0.02, 0.04]);
  }
  // ---- torso
  const torso = grp(body, 'torso', 0, 0, 0); torso.rotation.x = S.hunch;
  kit.add(torso, GEO.sph(), pants, [0, 0, 0], [0.15 * b, 0.1, 0.11 * b]);
  const prof = type === 'brute'
    ? [[0.001, -0.02], [0.16, -0.01], [0.19, 0.1], [0.2, 0.22], [0.2, 0.34], [0.22, 0.44], [0.2, 0.52], [0.12, 0.58], [0.001, 0.6]]
    : [[0.001, -0.02], [0.142, -0.01], [0.145, 0.1], [0.14, 0.22], [0.16, 0.34], [0.17, 0.43], [0.158, 0.5], [0.1, 0.56], [0.001, 0.57]];
  kit.add(torso, GEO.lathe('ztorso' + (type === 'brute'), prof, 12), cloth, [0, 0, 0], [b * (type === 'brute' ? 1.05 : 1), 1, (type === 'brute' ? 0.85 : 0.72) * b]);
  // torn holes / wounds / blood
  for (let i = 0; i < 3; i++) {
    const a = (rng() - 0.5) * 2.2, y = 0.12 + rng() * 0.32, rr = 0.155 * b;
    kit.add(torso, GEO.sph(), i === 0 ? skin : (rng() < 0.6 ? BLOOD : skin), [Math.sin(a) * rr, y, Math.cos(a) * rr * 0.72], [0.04 + rng() * 0.04, 0.04 + rng() * 0.05, 0.02]);
  }
  if (type !== 'armored') {
    kit.add(torso, GEO.sph(), BLOOD2, [0.03, 0.4, 0.11 * b], [0.07, 0.09, 0.02]);        // chest gore stain
    kit.add(torso, GEO.box(), BONE, [-0.05 * b, 0.28, 0.115 * b], [0.07, 0.008, 0.01], [0, 0, 0.2]); // exposed ribs
    kit.add(torso, GEO.box(), BONE, [-0.05 * b, 0.25, 0.113 * b], [0.07, 0.008, 0.01], [0, 0, 0.2]);
    // hanging rags
    for (let i = 0; i < 4; i++) {
      const a = (rng() - 0.5) * 5;
      kit.add(torso, GEO.box(), cloth, [Math.sin(a) * 0.14 * b, -0.06 - rng() * 0.05, Math.cos(a) * 0.1 * b], [0.05 + rng() * 0.04, 0.12 + rng() * 0.1, 0.008], [rng() * 0.3, a, (rng() - 0.5) * 0.4]);
    }
  }
  if (type === 'brute') {
    for (const s of [1, -1]) kit.add(torso, GEO.sph(), skin, [0.24 * s, 0.5, 0], [0.16, 0.14, 0.15]);
    kit.add(torso, GEO.sph(), skin, [0, 0.14, 0.1], [0.19, 0.17, 0.15]);          // belly
    kit.add(torso, GEO.sph(), 0x5a4a44, [-0.1, 0.55, -0.15], [0.12, 0.1, 0.08]);   // tumour
    for (let i = 0; i < 4; i++) kit.add(torso, GEO.cone(5), BONE, [-0.15 + i * 0.1, 0.52 + (i % 2) * 0.04, -0.17], [0.025, 0.12, 0.025], [-0.8, 0, (i - 1.5) * 0.2]);
  }
  if (type === 'runner') { // hoodie hood
    kit.add(torso, GEO.sph(), cloth, [0, 0.55, -0.1], [0.13, 0.11, 0.08], [0.3, 0, 0]);
  }
  if (type === 'armored') {
    kit.add(torso, GEO.lathe('vest', [[0.001, 0.1], [0.165, 0.1], [0.172, 0.22], [0.182, 0.34], [0.182, 0.44], [0.13, 0.52], [0.001, 0.53]], 12), 0x14161b, [0, 0, 0], [1.08, 1, 0.82]);
    kit.add(torso, GEO.box(), 0xb8b8b0, [0, 0.36, 0.152], [0.2, 0.035, 0.01]);     // reflective stripe
    kit.add(torso, GEO.box(), 0x0c0c0e, [0.09, 0.2, 0.15], [0.06, 0.07, 0.03]);    // pouches
    kit.add(torso, GEO.box(), 0x0c0c0e, [-0.09, 0.2, 0.15], [0.06, 0.07, 0.03]);
    for (const s of [1, -1]) kit.add(torso, GEO.sph(), 0x121418, [0.2 * s, 0.49, 0], [0.09, 0.07, 0.09]);
    kit.add(torso, GEO.cyl(0.152, 0.152, 14, true), 0x0c0c0e, [0, 0.06, 0], [1.05, 0.05, 0.8]);
  }
  // ---- head
  const head = grp(torso, 'head', 0, 0.56, 0.035);
  const hs = type === 'brute' ? 0.85 : 1;
  kit.add(head, GEO.cap(0.042 * hs, 0.06), skin, [0, 0.04, 0]);
  kit.add(head, GEO.sph(12, 9), skin, [0, 0.17 * hs, 0.01], [0.098 * hs, 0.118 * hs, 0.108 * hs]);
  kit.add(head, GEO.sph(), skin, [0, 0.13 * hs, 0.06 * hs], [0.025, 0.02, 0.03]);
  kit.add(head, GEO.sph(), 0x2a1a1a, [0, 0.19 * hs, 0.085 * hs], [0.075 * hs, 0.03 * hs, 0.035]); // sunken sockets
  const jaw = grp(head, 'jaw', 0, 0.12 * hs, 0.02);
  kit.add(jaw, GEO.sph(), skin, [0, -0.02, 0.035], [0.066 * hs, 0.04, 0.07 * hs]);
  kit.add(jaw, GEO.sph(), BLOOD, [0, -0.035, 0.08 * hs], [0.05 * hs, 0.02, 0.02]);
  kit.add(head, GEO.sph(), MOUTH, [0, 0.11 * hs, 0.08 * hs], [0.045 * hs, 0.025, 0.02]);
  if (type !== 'armored' && rng() < 0.7) { // patchy hair
    kit.add(head, GEO.sphPart(0, 1.3), pick([0x1a1614, 0x3a2a1a, 0x5a5048]), [0, 0.19 * hs, -0.01], [0.105 * hs, 0.12 * hs, 0.115 * hs], [-0.4, rng() - 0.5, 0.2]);
  }
  if (type === 'runner') kit.add(head, GEO.sphPart(0, 1.7), cloth, [0, 0.18, -0.02], [0.118, 0.13, 0.125], [-0.7, 0, 0]);
  for (const s of [1, -1]) eyeKit.add(head, GEO.sph(6, 4), S.eye, [0.034 * s * hs, 0.19 * hs, 0.098 * hs], [0.017, 0.011, 0.008], [0, 0, 0], 0);
  const eg = glowSprite(S.eye, 0.15 * hs, 0.6); eg.position.set(0, 0.19 * hs, 0.115 * hs); head.add(eg);
  if (type === 'armored') {
    kit.add(head, GEO.sphPart(0, 1.75, 14, 8), 0x101216, [0, 0.19, -0.005], [0.122, 0.13, 0.13], [-0.25, 0, 0]);
    kit.add(head, GEO.box(), 0x0a0b0e, [0, 0.27, -0.03], [0.02, 0.03, 0.2]);
    const visor = new THREE.Mesh(GEO.sphPart(0, 0.95, 12, 5), new THREE.MeshPhongMaterial({ color: 0x1a2838, specular: 0x8899aa, shininess: 90, transparent: true, opacity: 0.7, depthWrite: false }));
    visor.scale.set(0.13, 0.135, 0.14); visor.position.set(0, 0.185, 0.0); visor.rotation.set(Math.PI / 2 + 0.12, 0, 0); visor.renderOrder = 2; head.add(visor);
  }
  if (type === 'spitter') {
    const sacMat = new THREE.MeshLambertMaterial({ color: 0x6aa030, emissive: 0x3a8a10, emissiveIntensity: 1 });
    const sac = new THREE.Group(); sac.name = 'sac'; sac.position.set(0, 0.03, 0.07); head.add(sac);
    const s1 = new THREE.Mesh(GEO.sph(10, 8), sacMat); s1.scale.set(0.12, 0.1, 0.11); sac.add(s1);
    const s2 = new THREE.Mesh(GEO.sph(8, 6), sacMat); s2.scale.set(0.07, 0.06, 0.06); s2.position.set(0.11, 0.38 - 0.59, 0.06); torso.add(s2); s2.position.set(0.1, 0.4, 0.11);
    const s3 = s2.clone(); s3.position.set(-0.08, 0.22, 0.12); s3.scale.set(0.05, 0.05, 0.04); torso.add(s3);
    const g = glowSprite(0x80ff40, 0.6, 0.6); g.position.set(0, 0, 0.06); sac.add(g);
    T.sacMat = sacMat;
    // veins
    for (let i = 0; i < 4; i++) kit.add(torso, GEO.box(), 0x3a6a1a, [(rng() - 0.5) * 0.2, 0.3 + rng() * 0.2, 0.118], [0.006, 0.08 + rng() * 0.06, 0.006], [0, 0, (rng() - 0.5) * 1.2]);
  }
  // ---- arms
  const armLen = type === 'runner' ? 1.12 : 1;
  for (const s of [1, -1]) {
    const arm = grp(torso, s > 0 ? 'armL' : 'armR', (0.2 * b + 0.01) * s, 0.47, 0); arm.rotation.order = 'YXZ';
    const sleeve = type === 'armored' || (s > 0 ? rng() < 0.8 : rng() < 0.4);
    kit.add(arm, GEO.cap(0.052 * b * t, 0.2 * armLen), sleeve ? cloth : skin, [0, -0.13 * armLen, 0]);
    if (!sleeve) kit.add(arm, GEO.sph(), BLOOD, [0, -0.15, 0.04 * b], [0.025, 0.05, 0.02]);
    const fore = grp(arm, s > 0 ? 'foreL' : 'foreR', 0, -0.28 * armLen, 0);
    kit.add(fore, GEO.cap(0.046 * b * t, 0.2 * armLen), type === 'armored' ? cloth : skin, [0, -0.12 * armLen, 0]);
    if (type === 'armored') kit.add(fore, GEO.cap(0.05 * b, 0.1), 0x121418, [0, -0.1, 0.01]);
    const hy = -0.25 * armLen;
    kit.add(fore, GEO.sph(), type === 'armored' ? 0x0c0c0e : skin, [0, hy - 0.01, 0.01], [0.04 * b, 0.05 * b, 0.03 * b]);
    for (let f = -1; f <= 1; f++) kit.add(fore, GEO.cap(0.009 * b, 0.05 * b, 4), type === 'armored' ? 0x0c0c0e : skin, [f * 0.018 * b, hy - 0.07 * b, 0.022], [1, 1, 1], [0.5, 0, f * 0.15]);
    if (type === 'brute') kit.add(fore, GEO.cap(0.075, 0.16), skin, [0, -0.12, 0]);
    if (type === 'armored' && s > 0) { // riot shield on the left forearm
      const sh = grp(fore, 'shield', 0, -0.12, 0.09);
      kit.add(sh, GEO.box(), 0x0c0d10, [0, 0, 0], [0.42, 0.72, 0.03]);
      kit.add(sh, GEO.box(), 0x556070, [0, 0.02, 0.012], [0.36, 0.62, 0.012], [0, 0, 0], 0);
      kit.add(sh, GEO.box(), 0xd8d8d0, [0, 0.2, 0.02], [0.3, 0.05, 0.004], [0, 0, 0], 0);
      kit.add(sh, GEO.box(), 0x0c0d10, [0, -0.15, 0.02], [0.36, 0.015, 0.004]);
    }
    if (type === 'armored' && s < 0) { // baton
      kit.add(fore, GEO.cyl(0.014, 0.014, 6), 0x0a0a0c, [0, hy - 0.02, 0.18], [1, 0.4, 1], [Math.PI / 2, 0, 0]);
    }
  }
  kit.build(mat); eyeKit.build(eyeMat, false);
  return T;
}

// ============================================================================
// BOSS: 融合巨獸 fused abomination with glowing chest core weak point
// ============================================================================
let bossTemplate = null;
export function buildBoss() {
  if (!bossTemplate) bossTemplate = makeBossTemplate();
  return instantiate(bossTemplate, 'boss');
}
function makeBossTemplate() {
  const FL = 0x6a5252, SN = 0x5a1a20, BN = 0xb8ac94, DK = 0x2a2224, rng = seeded(4242);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x000000 });
  const kit = new Kit(rng);
  const root = new THREE.Group();
  const body = grp(root, 'body', 0, 2.1, 0);
  const T = { root, hunch: 0.25 };
  for (const s of [1, -1]) {
    const leg = grp(body, s > 0 ? 'legL' : 'legR', 0.55 * s, 0, 0);
    kit.add(leg, GEO.cap(0.3, 0.6), FL, [0, -0.5, 0]);
    kit.add(leg, GEO.sph(), SN, [0.1 * s, -0.4, 0.2], [0.2, 0.3, 0.15]);
    const shin = grp(leg, s > 0 ? 'shinL' : 'shinR', 0, -1.02, 0);
    kit.add(shin, GEO.cap(0.24, 0.6), SN, [0, -0.45, 0]);
    kit.add(shin, GEO.sph(), BN, [0, -0.98, 0.12], [0.3, 0.12, 0.42]);
    for (let k = -1; k <= 1; k++) kit.add(shin, GEO.cone(5), BN, [k * 0.13, -1.0, 0.5], [0.05, 0.16, 0.05], [Math.PI / 2, 0, 0]);
  }
  const torso = grp(body, 'torso', 0, 0, 0); torso.rotation.x = 0.25;
  kit.add(torso, GEO.sph(14, 10), FL, [0, 0.4, 0], [0.7, 0.5, 0.55]);
  kit.add(torso, GEO.sph(14, 10), FL, [0, 1.2, 0], [0.95, 0.65, 0.62]);
  kit.add(torso, GEO.sph(), SN, [0.75, 1.45, -0.2], [0.5, 0.5, 0.45]);
  kit.add(torso, GEO.sph(), SN, [-0.8, 0.85, -0.25], [0.42, 0.38, 0.4]);
  kit.add(torso, GEO.sph(), FL, [-0.5, 1.6, -0.45], [0.55, 0.45, 0.5]);
  for (let i = 0; i < 9; i++) kit.add(torso, GEO.sph(), rng() < 0.5 ? SN : 0x7a5a58, [(rng() - 0.5) * 1.6, 0.4 + rng() * 1.3, (rng() - 0.3) * 0.9], [0.15 + rng() * 0.2, 0.15 + rng() * 0.2, 0.15 + rng() * 0.2]);
  for (let i = 0; i < 7; i++) kit.add(torso, GEO.cone(6), BN, [-0.75 + i * 0.25, 1.75 + (i % 2) * 0.12, -0.5], [0.08, 0.6 + (i % 3) * 0.2, 0.08], [-0.6, 0, (i - 3) * 0.15]);
  for (let i = 0; i < 4; i++) for (const s of [1, -1]) kit.add(torso, GEO.cap(0.04, 0.42, 4), BN, [0.28 * s, 0.9 + i * 0.17, 0.58 - Math.abs(i - 1.5) * 0.02], [1, 1, 1], [0, 0, Math.PI / 2 + s * (0.25 - i * 0.05)]);
  kit.add(torso, GEO.sph(), DK, [0, 1.15, 0.5], [0.34, 0.36, 0.12]);
  // weak point core
  const core = grp(torso, 'core', 0, 1.15, 0.56);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffd84a });
  const cm = new THREE.Mesh(GEO.sph(12, 10), coreMat); cm.scale.set(0.26, 0.26, 0.16); core.add(cm);
  const cg = glowSprite(0xffb020, 1.4, 0.7); core.add(cg);
  T.coreMat = coreMat;
  // heads
  const head = grp(torso, 'head', 0.1, 1.85, 0.25);
  kit.add(head, GEO.sph(12, 9), FL, [0, 0.25, 0], [0.3, 0.32, 0.3]);
  kit.add(head, GEO.sph(), MOUTH, [0, 0.1, 0.24], [0.2, 0.08, 0.08]);
  for (let k = -2; k <= 2; k++) kit.add(head, GEO.cone(4), BN, [k * 0.06, 0.15, 0.27], [0.015, 0.05, 0.015], [Math.PI, 0, 0]);
  const eyeKit = new Kit(rng);
  for (const s of [1, -1]) eyeKit.add(head, GEO.sph(6, 4), 0xffd84a, [0.12 * s, 0.33, 0.25], [0.045, 0.03, 0.02], [0, 0, 0], 0);
  const eg = glowSprite(0xffc040, 0.8, 0.6); eg.position.set(0, 0.33, 0.3); head.add(eg);
  const head2 = grp(torso, '', -0.75, 1.75, 0.1); head2.rotation.set(0.3, 0, 0.5);
  kit.add(head2, GEO.sph(), FL, [0, 0.15, 0], [0.2, 0.22, 0.2]);
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
