import * as THREE from 'three';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const SPH = new THREE.SphereGeometry(1, 10, 8);
const SPH_LO = new THREE.SphereGeometry(1, 8, 6);
const CONE = new THREE.ConeGeometry(1, 1, 6);

function box(parent, mat, w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(BOX, mat); m.scale.set(w, h, d); m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  parent.add(m); return m;
}
function sph(parent, mat, r, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, lo = false) {
  const m = new THREE.Mesh(lo ? SPH_LO : SPH, mat); m.scale.set(r * sx, r * sy, r * sz); m.position.set(x, y, z); parent.add(m); return m;
}
function grp(parent, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }
const L = (c, e = 0) => new THREE.MeshLambertMaterial({ color: c, emissive: e });

// ======================= HEROINE: 星璃 =======================
export function buildHeroine() {
  const M = {
    coat: L(0x2a2630, 0x07050a), trim: L(0x4a0d14), pants: L(0x26242c), boot: L(0x0e0d10),
    skin: L(0xd2c2bb, 0x1a1212), hair: L(0x4a2c6e, 0x140a22), blade: L(0xa4a6ad, 0x151518), blood: L(0x5e0a10),
    handle: L(0x2b1b12), belt: L(0x2a1a14),
  };
  const coatSide = new THREE.MeshLambertMaterial({ color: 0x2a2630, emissive: 0x07050a, side: THREE.DoubleSide });
  const root = new THREE.Group();
  const body = grp(root, 0, 0.95, 0);
  const R = { root, body };
  // legs
  for (const s of [1, -1]) {
    const leg = grp(body, 0.1 * s, -0.02, 0);
    box(leg, M.pants, 0.14, 0.46, 0.15, 0, -0.23, 0);
    const shin = grp(leg, 0, -0.46, 0);
    box(shin, M.boot, 0.125, 0.42, 0.135, 0, -0.21, 0);
    box(shin, M.boot, 0.13, 0.1, 0.25, 0, -0.42, 0.05);
    R[s > 0 ? 'legL' : 'legR'] = leg; R[s > 0 ? 'shinL' : 'shinR'] = shin;
  }
  // long coat skirt (open in front)
  const skirtGeo = new THREE.CylinderGeometry(0.19, 0.36, 0.8, 12, 1, true, 0.55, Math.PI * 2 - 1.1);
  const skirt = new THREE.Mesh(skirtGeo, coatSide); skirt.position.y = -0.39;
  const skirtPivot = grp(body, 0, 0.0, 0); skirtPivot.add(skirt); R.skirt = skirtPivot;
  // torso
  const torso = grp(body, 0, 0, 0); R.torso = torso;
  box(torso, M.coat, 0.3, 0.22, 0.2, 0, 0.1, 0);
  box(torso, M.belt, 0.31, 0.05, 0.21, 0, 0.02, 0);
  box(torso, M.coat, 0.37, 0.34, 0.22, 0, 0.36, 0);
  box(torso, M.trim, 0.02, 0.5, 0.012, 0.06, 0.3, 0.112);   // red trim / lapels
  box(torso, M.trim, 0.02, 0.5, 0.012, -0.06, 0.3, 0.112);
  box(torso, M.coat, 0.34, 0.11, 0.26, 0, 0.56, -0.01);     // collar
  box(torso, M.coat, 0.3, 0.22, 0.06, 0, 0.6, -0.13, -0.3); // hood fold
  // head
  const head = grp(torso, 0, 0.6, 0); R.head = head;
  box(head, M.skin, 0.07, 0.1, 0.07, 0, 0.04, 0);
  sph(head, M.skin, 0.112, 0, 0.17, 0.01, 1, 1.12, 1);
  sph(head, M.hair, 0.124, 0, 0.2, -0.015, 1.02, 1.0, 1.05);           // hair cap
  box(head, M.hair, 0.22, 0.06, 0.06, 0, 0.27, 0.08, 0.3);              // bangs
  box(head, M.hair, 0.05, 0.22, 0.05, 0.1, 0.13, 0.05);                 // side locks
  box(head, M.hair, 0.05, 0.22, 0.05, -0.1, 0.13, 0.05);
  const hairBack = grp(head, 0, 0.22, -0.08); R.hair = hairBack;
  box(hairBack, M.hair, 0.27, 0.5, 0.07, 0, -0.25, -0.02);
  const hairTip = grp(hairBack, 0, -0.5, -0.02); R.hairTip = hairTip;
  box(hairTip, M.hair, 0.22, 0.32, 0.05, 0, -0.15, 0);
  box(hairTip, M.hair, 0.12, 0.16, 0.04, 0.04, -0.36, 0);
  // arms
  for (const s of [1, -1]) {
    const arm = grp(torso, 0.23 * s, 0.5, 0); arm.rotation.order = 'YXZ';
    box(arm, M.coat, 0.115, 0.34, 0.12, 0, -0.16, 0);
    const fore = grp(arm, 0, -0.32, 0);
    box(fore, M.coat, 0.105, 0.26, 0.11, 0, -0.13, 0);
    box(fore, M.trim, 0.11, 0.035, 0.115, 0, -0.24, 0);
    box(fore, M.skin, 0.07, 0.09, 0.07, 0, -0.31, 0);
    R[s > 0 ? 'armL' : 'armR'] = arm; R[s > 0 ? 'foreL' : 'foreR'] = fore;
  }
  // machete in right hand
  const weapon = grp(R.foreR, 0, -0.32, 0.01); R.weapon = weapon;
  box(weapon, M.handle, 0.035, 0.035, 0.17, 0, 0, 0);
  box(weapon, M.blade, 0.03, 0.09, 0.025, 0, 0, 0.09);
  box(weapon, M.blade, 0.012, 0.075, 0.58, 0, 0.012, 0.39);
  box(weapon, M.blade, 0.012, 0.06, 0.1, 0, 0.03, 0.69, -0.45);
  box(weapon, M.blood, 0.014, 0.05, 0.26, 0, 0.0, 0.5);
  R.mats = M;
  return R;
}

// ======================= ZOMBIES =======================
const ZSTYLE = {
  walker: { skin: 0x7b8072, cloth: 0x37343a, pants: 0x2a2a30, eye: 0xc9c2a0, bulk: 1, thin: 1, hunch: 0.35 },
  runner: { skin: 0x8a7470, cloth: 0x4a1c1f, pants: 0x232228, eye: 0xff5a40, bulk: 0.85, thin: 0.8, hunch: 0.55 },
  brute: { skin: 0x6a6a64, cloth: 0x2b2a2e, pants: 0x1e1d22, eye: 0xd8c27a, bulk: 1.55, thin: 1.25, hunch: 0.3 },
  spitter: { skin: 0x76806a, cloth: 0x3a3a34, pants: 0x2a2b26, eye: 0x9cff60, bulk: 1.05, thin: 1, hunch: 0.25 },
};
export function buildZombie(type) {
  const S = ZSTYLE[type];
  const M = {
    skin: L(S.skin, 0x070707), cloth: L(S.cloth), pants: L(S.pants), blood: L(0x4a0508),
    eye: new THREE.MeshBasicMaterial({ color: S.eye }),
  };
  const root = new THREE.Group();
  const body = grp(root, 0, 0.92, 0);
  const R = { root, body, type };
  const b = S.bulk, t = S.thin;
  for (const s of [1, -1]) {
    const leg = grp(body, 0.11 * s * b, 0, 0);
    box(leg, M.pants, 0.14 * t, 0.46, 0.15 * t, 0, -0.23, 0);
    const shin = grp(leg, 0, -0.46, 0);
    box(shin, s > 0 ? M.pants : M.skin, 0.12 * t, 0.42, 0.13 * t, 0, -0.21, 0);
    box(shin, M.skin, 0.12, 0.07, 0.22, 0, -0.42, 0.04);
    R[s > 0 ? 'legL' : 'legR'] = leg; R[s > 0 ? 'shinL' : 'shinR'] = shin;
  }
  const torso = grp(body, 0, 0, 0); R.torso = torso; torso.rotation.x = S.hunch;
  R.hunch = S.hunch;
  box(torso, M.cloth, 0.32 * b, 0.24, 0.2 * b, 0, 0.1, 0);
  box(torso, M.cloth, 0.4 * b, 0.36, 0.24 * b, 0, 0.38, 0);
  box(torso, M.skin, 0.16 * b, 0.2, 0.02, 0.06, 0.3, 0.12 * b);    // torn shirt showing skin
  box(torso, M.blood, 0.14 * b, 0.12, 0.02, -0.08, 0.42, 0.125 * b);
  box(torso, M.cloth, 0.1, 0.18, 0.02, 0.12 * b, -0.08, 0.1 * b, 0, 0, 0.3); // hanging rag
  const head = grp(torso, 0, 0.6, 0.03); R.head = head;
  box(head, M.skin, 0.08, 0.1, 0.08, 0, 0.03, 0);
  box(head, M.skin, 0.2, 0.24, 0.21, 0, 0.17, 0.01);
  box(head, M.blood, 0.14, 0.06, 0.02, 0, 0.08, 0.115); // bloody jaw
  box(head, M.eye, 0.035, 0.02, 0.01, 0.05, 0.2, 0.118);
  box(head, M.eye, 0.035, 0.02, 0.01, -0.05, 0.2, 0.118);
  if (type === 'spitter') {
    const sac = new THREE.MeshLambertMaterial({ color: 0x5a8a2a, emissive: 0x2a5a08 }); M.sac = sac;
    sph(head, sac, 0.16, 0, 0.02, 0.08, 1, 0.8, 1, true);
    sph(torso, sac, 0.12, 0.12, 0.4, 0.12, 1, 1, 0.7, true);
  }
  if (type === 'brute') {
    box(torso, M.skin, 0.22, 0.2, 0.2, 0.3 * b * 0.7, 0.5, 0); // shoulder humps
    box(torso, M.skin, 0.22, 0.2, 0.2, -0.3 * b * 0.7, 0.5, 0);
  }
  for (const s of [1, -1]) {
    const arm = grp(torso, (0.22 * b + 0.02) * s, 0.5, 0);
    box(arm, s > 0 ? M.cloth : M.skin, 0.11 * b * t, 0.34, 0.11 * b * t, 0, -0.16, 0);
    const fore = grp(arm, 0, -0.32, 0);
    box(fore, M.skin, 0.1 * b * t, 0.3, 0.1 * b * t, 0, -0.15, 0);
    box(fore, M.skin, 0.08 * b, 0.1, 0.05 * b, 0, -0.33, 0);
    R[s > 0 ? 'armL' : 'armR'] = arm; R[s > 0 ? 'foreL' : 'foreR'] = fore;
  }
  R.mats = Object.values(M);
  return R;
}

// ======================= BOSS: fused abomination =======================
export function buildBoss() {
  const M = {
    flesh: L(0x5e4b4c, 0x0a0505), sinew: L(0x4c1218, 0x0a0000), bone: L(0xb0a590), dark: L(0x2a2224),
    eye: new THREE.MeshBasicMaterial({ color: 0xffd84a }),
    weak: new THREE.MeshBasicMaterial({ color: 0xffd84a }),
    glow: new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
  const root = new THREE.Group();
  const body = grp(root, 0, 2.1, 0);
  const R = { root, body, type: 'boss' };
  for (const s of [1, -1]) {
    const leg = grp(body, 0.55 * s, 0, 0);
    box(leg, M.flesh, 0.5, 1.1, 0.55, 0, -0.5, 0);
    const shin = grp(leg, 0, -1.05, 0);
    box(shin, M.sinew, 0.42, 1.0, 0.46, 0, -0.45, 0);
    box(shin, M.bone, 0.5, 0.15, 0.7, 0, -0.98, 0.1);
    R[s > 0 ? 'legL' : 'legR'] = leg; R[s > 0 ? 'shinL' : 'shinR'] = shin;
  }
  const torso = grp(body, 0, 0, 0); R.torso = torso; torso.rotation.x = 0.25; R.hunch = 0.25;
  box(torso, M.flesh, 1.3, 0.8, 0.9, 0, 0.35, 0);
  box(torso, M.flesh, 1.8, 1.1, 1.1, 0, 1.2, 0);
  box(torso, M.sinew, 0.9, 0.9, 0.8, 0.75, 1.45, -0.2, 0.2, 0.3, 0.3);   // fused mass
  box(torso, M.sinew, 0.7, 0.6, 0.7, -0.8, 0.8, -0.3, -0.3, 0.2, -0.2);
  sph(torso, M.flesh, 0.55, -0.5, 1.6, -0.45, 1, 0.8, 1, true);
  // bone spikes on back
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Mesh(CONE, M.bone); c.scale.set(0.12, 0.6 + (i % 3) * 0.2, 0.12);
    c.position.set(-0.6 + i * 0.25, 1.75 + (i % 2) * 0.1, -0.5); c.rotation.set(-0.6, 0, (i - 2.5) * 0.15); torso.add(c);
  }
  // ribs around the weak point
  for (let i = 0; i < 4; i++) box(torso, M.bone, 0.9, 0.06, 0.08, 0, 0.9 + i * 0.18, 0.56, 0, 0, (i % 2 ? 0.15 : -0.15));
  // weak point (glowing chest core)
  const core = grp(torso, 0, 1.15, 0.55); R.core = core;
  sph(core, M.weak, 0.26, 0, 0, 0, 1, 1, 0.6);
  sph(core, M.glow, 0.5, 0, 0, 0.05, 1, 1, 0.6, true);
  // heads
  const head = grp(torso, 0.1, 1.85, 0.25); R.head = head;
  box(head, M.flesh, 0.55, 0.6, 0.55, 0, 0.25, 0);
  box(head, M.sinew, 0.45, 0.15, 0.1, 0, 0.05, 0.28);
  box(head, M.eye, 0.09, 0.05, 0.02, 0.12, 0.35, 0.28);
  box(head, M.eye, 0.09, 0.05, 0.02, -0.12, 0.35, 0.28);
  const head2 = grp(torso, -0.75, 1.75, 0.1);
  box(head2, M.flesh, 0.35, 0.4, 0.35, 0, 0.15, 0, 0.3, 0, 0.5);
  box(head2, M.eye, 0.06, 0.04, 0.02, 0.05, 0.2, 0.18, 0.3, 0, 0.5);
  // 4 arms: 2 main huge, 2 small fused
  for (const s of [1, -1]) {
    const arm = grp(torso, 1.05 * s, 1.55, 0);
    box(arm, M.flesh, 0.45, 1.1, 0.45, 0, -0.5, 0);
    const fore = grp(arm, 0, -1.0, 0);
    box(fore, M.sinew, 0.5, 1.1, 0.5, 0, -0.5, 0);
    box(fore, M.bone, 0.6, 0.3, 0.35, 0, -1.1, 0.05);
    for (let k = -1; k <= 1; k++) { const c = new THREE.Mesh(CONE, M.bone); c.scale.set(0.06, 0.35, 0.06); c.position.set(k * 0.18, -1.35, 0.1); c.rotation.x = Math.PI; fore.add(c); }
    R[s > 0 ? 'armL' : 'armR'] = arm; R[s > 0 ? 'foreL' : 'foreR'] = fore;
    const small = grp(torso, 0.7 * s, 0.7, 0.35);
    box(small, M.sinew, 0.18, 0.7, 0.18, 0, -0.3, 0.1, -0.8, 0, 0.3 * s);
    R[s > 0 ? 'smallL' : 'smallR'] = small;
  }
  R.mats = [M.flesh, M.sinew, M.bone, M.dark, M.eye];
  return R;
}
