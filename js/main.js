import * as THREE from 'three';
import { Sfx } from './audio.js';
import { buildWorld } from './world.js';
import { buildHeroine, buildZombie, buildBoss } from './characters.js';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const lerpAng = (a, b, t) => a + angDiff(a, b) * t;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const vibrate = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { } };

// ---------------------------------------------------------------- renderer
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const MAX_PR = 1.5;
let pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PR);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight, false);
const FOG = 0x15131b;
const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.FogExp2(FOG, 0.048);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 95);

scene.add(new THREE.HemisphereLight(0x6a6488, 0x2a2024, 1.7));
const moon = new THREE.DirectionalLight(0xa49ad0, 1.25); moon.position.set(-20, 30, 10); scene.add(moon);
const W = buildWorld(scene);
const BOUND = W.bounds;
// boss light (pre-allocated so shader light count stays constant)
const bossLight = new THREE.PointLight(0xffc040, 0, 10, 1.6); bossLight.position.set(0, -50, 0); scene.add(bossLight);
// soft fill light that follows the camera so characters read against the dark street
const fillLight = new THREE.PointLight(0x9a8cc0, 7, 16, 1.2); scene.add(fillLight);

function onResize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1.3 ? 70 : 62;
  camera.updateProjectionMatrix();
}
addEventListener('resize', onResize); onResize();

// ---------------------------------------------------------------- collision helpers
function resolveCircle(p, r) {
  for (const c of W.colliders) {
    const cx = clamp(p.x, c.minX, c.maxX), cz = clamp(p.z, c.minZ, c.maxZ);
    let dx = p.x - cx, dz = p.z - cz; const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-6) { const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.z = cz + dz / d * r; }
      else { // inside: push along smallest axis
        const l = p.x - c.minX, rr = c.maxX - p.x, t = p.z - c.minZ, b = c.maxZ - p.z; const m = Math.min(l, rr, t, b);
        if (m === l) p.x = c.minX - r; else if (m === rr) p.x = c.maxX + r; else if (m === t) p.z = c.minZ - r; else p.z = c.maxZ + r;
      }
    }
  }
  p.x = clamp(p.x, -BOUND, BOUND); p.z = clamp(p.z, -BOUND, BOUND);
}
function insideCollider(x, z, pad = 0) { return W.colliders.some(c => x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad); }
// ray (origin o, dir d normalized, len) vs AABB colliders with height -> nearest t
function rayCast(o, d, len) {
  let best = len;
  for (const c of W.colliders) {
    if (c.h < 1.2) continue;
    let tmin = 0, tmax = best;
    const ax = [[o.x, d.x, c.minX, c.maxX], [o.y, d.y, 0, c.h], [o.z, d.z, c.minZ, c.maxZ]];
    let ok = true;
    for (const [oo, dd, mn, mx] of ax) {
      if (Math.abs(dd) < 1e-6) { if (oo < mn || oo > mx) { ok = false; break; } }
      else { let t1 = (mn - oo) / dd, t2 = (mx - oo) / dd; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) { ok = false; break; } }
    }
    if (ok && tmin < best) best = tmin;
  }
  return best;
}

// ---------------------------------------------------------------- player
const hero = buildHeroine();
scene.add(hero.root);
const blobGeo = new THREE.CircleGeometry(1, 16); blobGeo.rotateX(-Math.PI / 2);
const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false });
const heroBlob = new THREE.Mesh(blobGeo, blobMat); heroBlob.scale.setScalar(0.45); heroBlob.position.y = 0.025; scene.add(heroBlob);

const P = {
  pos: new THREE.Vector3(), facing: Math.PI, hp: 100, maxHp: 100, st: 100, maxSt: 100, stDelay: 0,
  state: 'move', t: 0, combo: 0, comboWin: 0, queued: false, hitDone: 0, invuln: 0, skillCd: 0,
  dodgeDir: new THREE.Vector3(), kb: new THREE.Vector3(), runPhase: 0, run: 0, lock: null, attackHeld: false, attackHoldT: 0,
};
const SKILL_CD = 8, DODGE_COST = 25;
const ATK = [
  { dur: 0.42, hit: 0.15, dmg: 18, range: 2.5, arc: 1.25, knock: 3.5, lunge: 3.0 },
  { dur: 0.42, hit: 0.15, dmg: 20, range: 2.5, arc: 1.25, knock: 3.5, lunge: 3.0 },
  { dur: 0.62, hit: 0.27, dmg: 36, range: 2.9, arc: 1.0, knock: 7.5, lunge: 5.0 },
];

// ---------------------------------------------------------------- FX
const fxGroup = new THREE.Group(); scene.add(fxGroup);
const trailMat = new THREE.MeshBasicMaterial({ color: 0xffe0e0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
const trailGeo = new THREE.RingGeometry(0.7, 2.3, 20, 1, Math.PI / 2 - 1.2, 2.4); trailGeo.rotateX(Math.PI / 2);
const trailPivot = new THREE.Group(); scene.add(trailPivot);
const trail = new THREE.Mesh(trailGeo, trailMat); trailPivot.add(trail);
let trailT = 0;
const ringMat = new THREE.MeshBasicMaterial({ color: 0xb04aff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
const ringGeo = new THREE.RingGeometry(0.85, 1, 40); ringGeo.rotateX(-Math.PI / 2);
const skillRing = new THREE.Mesh(ringGeo, ringMat); skillRing.position.y = 0.1; scene.add(skillRing);
const spinMat = new THREE.MeshBasicMaterial({ color: 0xff3050, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
const spinGeo = (() => { const a = new THREE.RingGeometry(2.6, 3.7, 24, 1, 0, 1.4); const b = new THREE.RingGeometry(2.6, 3.7, 24, 1, Math.PI, 1.4); const g = mergeGeometries([a, b]); g.rotateX(-Math.PI / 2); return g; })();
const spinDisc = new THREE.Mesh(spinGeo, spinMat); scene.add(spinDisc);
let skillFxT = -1;
// telegraph for boss slam
const teleMat = new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const teleGeo = new THREE.CircleGeometry(1, 40); teleGeo.rotateX(-Math.PI / 2);
const tele = new THREE.Mesh(teleGeo, teleMat); tele.position.y = 0.06; scene.add(tele);
// lock-on ground ring
const lockRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
lockRing.visible = false; scene.add(lockRing);

// particles
const PART_GEO = new THREE.BoxGeometry(1, 1, 1);
const partMats = {
  blood: new THREE.MeshBasicMaterial({ color: 0x8a0a10 }),
  acid: new THREE.MeshBasicMaterial({ color: 0x7aff3a }),
  spark: new THREE.MeshBasicMaterial({ color: 0xffd060 }),
  dust: new THREE.MeshLambertMaterial({ color: 0x3a3840 }),
};
const parts = [];
for (let i = 0; i < 140; i++) { const m = new THREE.Mesh(PART_GEO, partMats.blood); m.visible = false; fxGroup.add(m); parts.push({ m, v: new THREE.Vector3(), life: 0, max: 1, s: 0.1 }); }
let partIdx = 0;
function burst(pos, n, kind = 'blood', speed = 4, size = 0.09, up = 3) {
  for (let i = 0; i < n; i++) {
    const p = parts[partIdx++ % parts.length];
    p.m.material = partMats[kind]; p.m.visible = true; p.m.position.copy(pos);
    p.v.set((Math.random() - .5) * speed, Math.random() * up + 1, (Math.random() - .5) * speed);
    p.life = p.max = 0.45 + Math.random() * 0.4; p.s = size * (0.6 + Math.random() * 0.8);
    p.m.scale.setScalar(p.s); p.m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
  }
}
function updateParts(dt) {
  for (const p of parts) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.m.visible = false; continue; }
    p.v.y -= 14 * dt; p.m.position.addScaledVector(p.v, dt);
    if (p.m.position.y < 0.03) { p.m.position.y = 0.03; p.v.set(0, 0, 0); }
    p.m.scale.setScalar(p.s * Math.min(1, p.life / p.max * 2));
  }
}
// blood decals
const decalMat = new THREE.MeshBasicMaterial({ color: 0x2a0204, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
const decals = [];
for (let i = 0; i < 24; i++) { const m = new THREE.Mesh(blobGeo, decalMat); m.visible = false; m.position.y = 0.035; fxGroup.add(m); decals.push(m); }
let decalIdx = 0;
function addDecal(x, z, s) { const m = decals[decalIdx++ % decals.length]; m.visible = true; m.position.x = x; m.position.z = z; m.scale.set(s * (0.8 + Math.random() * .5), 1, s * (0.8 + Math.random() * .5)); m.rotation.y = Math.random() * 3; }

// health orbs
const orbGeo = new THREE.OctahedronGeometry(0.22, 0);
const orbMat = new THREE.MeshBasicMaterial({ color: 0xff2840 });
const orbs = [];
function dropOrb(x, z) { const m = new THREE.Mesh(orbGeo, orbMat); m.position.set(x, 0.6, z); scene.add(m); orbs.push({ m, t: 0 }); }

// acid projectiles & puddles
const acidMat = new THREE.MeshBasicMaterial({ color: 0x8aff40 });
const acidGeo = new THREE.SphereGeometry(0.2, 8, 6);
const puddleMat = new THREE.MeshBasicMaterial({ color: 0x4cff2a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const projectiles = [], puddles = [];
function launchAcid(from, target, speedT = 1.0, big = false) {
  const m = new THREE.Mesh(acidGeo, acidMat); m.position.copy(from); if (big) m.scale.setScalar(1.8); scene.add(m);
  const g = 14, T = speedT;
  const v = new THREE.Vector3((target.x - from.x) / T, (0.05 - from.y + 0.5 * g * T * T) / T, (target.z - from.z) / T);
  projectiles.push({ m, v, g, big });
  Sfx.spit();
}
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    pr.v.y -= pr.g * dt; pr.m.position.addScaledVector(pr.v, dt);
    if (Math.random() < 0.5) burst(pr.m.position, 1, 'acid', 0.5, 0.06, 0.2);
    if (pr.m.position.y <= 0.05) {
      const x = pr.m.position.x, z = pr.m.position.z;
      scene.remove(pr.m); projectiles.splice(i, 1);
      const pm = new THREE.Mesh(blobGeo, puddleMat.clone()); pm.position.set(x, 0.04, z); const r = pr.big ? 2.2 : 1.5; pm.scale.set(r, 1, r); scene.add(pm);
      puddles.push({ m: pm, r, life: 6, tick: 0 });
      burst(new THREE.Vector3(x, 0.2, z), 10, 'acid', 4, 0.08, 2);
      Sfx.splash();
      if (Math.hypot(P.pos.x - x, P.pos.z - z) < r * 0.9) damagePlayer(pr.big ? 14 : 10, x, z, 'acid');
    }
  }
  for (let i = puddles.length - 1; i >= 0; i--) {
    const pd = puddles[i]; pd.life -= dt; pd.tick -= dt;
    pd.m.material.opacity = Math.min(0.5, pd.life * 0.25) * (0.85 + Math.sin(G.time * 8 + i) * 0.15);
    if (pd.life <= 0) { scene.remove(pd.m); pd.m.material.dispose(); puddles.splice(i, 1); continue; }
    if (pd.tick <= 0 && Math.hypot(P.pos.x - pd.m.position.x, P.pos.z - pd.m.position.z) < pd.r * 0.85) { pd.tick = 0.5; damagePlayer(4, pd.m.position.x, pd.m.position.z, 'puddle'); }
  }
}

// ---------------------------------------------------------------- HUD helpers
const floaters = $('floaters');
const _v = new THREE.Vector3();
function toScreen(v) {
  _v.copy(v).project(camera);
  return { x: (_v.x * 0.5 + 0.5) * innerWidth, y: (-_v.y * 0.5 + 0.5) * innerHeight, vis: _v.z < 1 && _v.z > -1 };
}
function floatText(pos, text, cls = '') {
  const s = toScreen(pos); if (!s.vis) return;
  if (floaters.childElementCount > 26) floaters.firstElementChild.remove();
  const el = document.createElement('div'); el.className = 'dmg ' + cls; el.textContent = text;
  el.style.left = (s.x + (Math.random() - .5) * 30) + 'px'; el.style.top = s.y + 'px';
  el.addEventListener('animationend', () => el.remove());
  floaters.appendChild(el);
}
const hpbarsEl = $('hpbars');
const hpBars = [];
for (let i = 0; i < 14; i++) { const d = document.createElement('div'); d.className = 'ehb'; d.innerHTML = '<i></i>'; hpbarsEl.appendChild(d); hpBars.push({ el: d, fill: d.firstChild, shown: false }); }
let bannerTimer = 0;
function banner(html, dur = 2.2) { const b = $('banner'); b.innerHTML = html; b.classList.add('show'); bannerTimer = dur; }
let vignetteV = 0, shake = 0, hitStop = 0;

// ---------------------------------------------------------------- zombies
const ZCFG = {
  walker: { hp: 45, walk: 0.9, chase: 2.0, dmg: 9, range: 1.5, detect: 16, r: 0.42, scale: 1.0, wind: 0.55, rec: 0.65, knockRes: 1, pitch: 1 },
  runner: { hp: 28, walk: 1.6, chase: 4.8, dmg: 7, range: 1.4, detect: 24, r: 0.38, scale: 0.97, wind: 0.32, rec: 0.55, knockRes: 1.1, pitch: 1.4 },
  brute: { hp: 210, walk: 0.8, chase: 1.6, dmg: 24, range: 2.4, detect: 18, r: 0.8, scale: 1.55, wind: 0.9, rec: 0.9, knockRes: 0.25, pitch: 0.6 },
  spitter: { hp: 38, walk: 1.0, chase: 2.1, dmg: 10, range: 12, detect: 22, r: 0.42, scale: 1.0, wind: 0.6, rec: 0.6, knockRes: 1, pitch: 1.2, prefer: 8 },
  boss: { hp: 1800, walk: 1.5, chase: 2.3, dmg: 26, range: 3.8, detect: 99, r: 1.7, scale: 1.0, wind: 0.85, rec: 0.9, knockRes: 0.03, pitch: 0.4 },
};
const ZNAME = { walker: '行屍', runner: '疾行者', brute: '巨屍', spitter: '噴吐者', boss: '融合巨獸' };
const zombies = [];
function spawnZombie(type, x, z) {
  const cfg = ZCFG[type];
  const rig = type === 'boss' ? buildBoss() : buildZombie(type);
  rig.root.scale.setScalar(cfg.scale);
  const blob = new THREE.Mesh(blobGeo, blobMat); blob.scale.setScalar(cfg.r * 1.3); blob.position.y = 0.022; scene.add(blob);
  scene.add(rig.root);
  const hpMul = type === 'boss' ? 1 : 1 + Math.max(0, G.wave - 1) * 0.08;
  const z0 = {
    type, cfg, rig, blob, pos: new THREE.Vector3(x, 0, z), vel: new THREE.Vector3(), facing: Math.random() * TAU,
    hp: cfg.hp * hpMul, maxHp: cfg.hp * hpMul, state: 'rise', t: 0, hitDone: false, atkCd: 0.5 + Math.random(), spitCd: 1.5 + Math.random() * 2,
    wander: new THREE.Vector3(x, 0, z), aggroT: 1 + Math.random() * 3, groanT: 2 + Math.random() * 6, phase: Math.random() * 10,
    showHp: 0, flash: 0, alive: true, isBoss: type === 'boss', attack: 'melee', slamCd: 6, volleyCd: 4, summonCd: 14, speedNow: 0,
  };
  z0.baseEm = rig.mats.map(m => m.emissive ? m.emissive.getHex() : null);
  rig.root.position.copy(z0.pos); rig.root.position.y = -2;
  zombies.push(z0);
  return z0;
}
function setFlash(z, on) {
  z.rig.mats.forEach((m, i) => { if (m.emissive) m.emissive.setHex(on ? 0x4a0c0c : z.baseEm[i]); });
}
function removeZombie(z) {
  scene.remove(z.rig.root); scene.remove(z.blob);
  z.rig.mats.forEach(m => m.dispose());
  const i = zombies.indexOf(z); if (i >= 0) zombies.splice(i, 1);
}
function damageZombie(z, dmg, dirX, dirZ, knock, opts = {}) {
  if (!z.alive) return;
  let crit = false, weak = false;
  if (z.isBoss) {
    const toP = Math.atan2(P.pos.x - z.pos.x, P.pos.z - z.pos.z);
    if (Math.abs(angDiff(z.facing, toP)) < 0.75) { weak = true; dmg *= 2.2; }
  } else if (Math.random() < 0.12) { crit = true; dmg *= 1.6; }
  dmg = Math.round(dmg * (0.9 + Math.random() * 0.2));
  z.hp -= dmg; z.showHp = 4; z.flash = 0.1; setFlash(z, true);
  const hpos = new THREE.Vector3(z.pos.x, (z.isBoss ? 3.2 : 1.5 * z.cfg.scale), z.pos.z);
  floatText(hpos, weak ? `弱點 ${dmg}` : String(dmg), weak || crit ? 'crit' : (dmg >= 30 ? 'heavy' : ''));
  burst(hpos.setY(z.isBoss ? 2.8 : 1.2 * z.cfg.scale), weak ? 10 : 7, weak ? 'spark' : 'blood', 5, 0.09);
  Sfx.hit(dmg >= 30); vibrate(12);
  hitStop = Math.max(hitStop, dmg >= 30 ? 0.07 : 0.035); shake = Math.max(shake, dmg >= 30 ? 0.25 : 0.12);
  if (z.hp <= 0) { killZombie(z); return; }
  if (!z.isBoss) {
    const k = knock * z.cfg.knockRes;
    z.vel.set(dirX * k, 0, dirZ * k);
    if (z.cfg.knockRes > 0.5 || knock > 6) { z.state = 'hurt'; z.t = 0; }
    z.aggroT = 0;
  }
}
function killZombie(z) {
  z.alive = false; z.state = 'dead'; z.t = 0; z.hp = 0;
  G.kills++;
  addDecal(z.pos.x, z.pos.z, z.cfg.r * 2.2);
  burst(new THREE.Vector3(z.pos.x, 1, z.pos.z), 14, 'blood', 6, 0.11);
  Sfx.groan(z.cfg.pitch * 0.8, 0.25);
  if (P.lock === z) P.lock = null, pickLock(true);
  if (z.isBoss) { Sfx.roar(); setTimeout(() => G.mode === 'play' && victory(), 2600); G.bossDead = true; }
  else if (Math.random() < (P.hp < 40 ? 0.25 : 0.1)) dropOrb(z.pos.x, z.pos.z);
}
function animZombie(z, dt) {
  const R = z.rig, cfg = z.cfg;
  const sp = z.speedNow;
  z.phase += dt * (2 + sp * (z.isBoss ? 1.6 : 2.6));
  const ph = z.phase, swing = clamp(sp / 2, 0.25, 1) * (z.type === 'runner' ? 1.1 : 0.7);
  if (z.state === 'dead') return;
  R.legL.rotation.x = Math.sin(ph) * swing * (sp > 0.1 ? 1 : 0.15);
  R.legR.rotation.x = -Math.sin(ph) * swing * (sp > 0.1 ? 1 : 0.15);
  R.shinL.rotation.x = Math.max(0, -Math.sin(ph)) * swing * 1.2;
  R.shinR.rotation.x = Math.max(0, Math.sin(ph)) * swing * 1.2;
  R.body.position.y = (z.isBoss ? 2.1 : 0.92) + Math.abs(Math.sin(ph)) * 0.04 * (z.isBoss ? 3 : 1);
  R.body.rotation.z = Math.sin(ph * 0.5) * 0.06;
  let armX = -1.35 + Math.sin(ph * 0.7) * 0.15, armX2 = -1.25 + Math.cos(ph * 0.6) * 0.18;
  let torsoX = R.hunch, foreX = -0.2;
  if (z.state === 'attack') {
    const w = cfg.wind;
    if (z.attack === 'spit') { const k = Math.min(1, z.t / w); torsoX = R.hunch - 0.5 * k; if (z.t > w) torsoX = R.hunch + 0.5; armX = armX2 = -0.4; }
    else if (z.attack === 'slam') { const k = Math.min(1, z.t / 1.1); armX = armX2 = -2.9 * k; torsoX = R.hunch - 0.3 * k; if (z.t > 1.1) { armX = armX2 = -0.5; torsoX = R.hunch + 0.6; } }
    else if (z.t < w) { const k = z.t / w; armX = armX2 = lerp(-1.3, -2.8, k); torsoX = R.hunch - 0.25 * k; }
    else { const k = Math.min(1, (z.t - w) / 0.15); armX = armX2 = lerp(-2.8, -0.6, k); torsoX = R.hunch + 0.35 * k; foreX = -0.6 * k; }
  } else if (z.state === 'hurt') { torsoX = R.hunch - 0.5 * Math.max(0, 1 - z.t / 0.35); }
  else if (z.state === 'rise') { torsoX = R.hunch + 0.6; armX = -2.6; armX2 = -2.4; }
  R.armL.rotation.x = armX; R.armR.rotation.x = armX2;
  R.foreL.rotation.x = foreX; R.foreR.rotation.x = foreX;
  R.torso.rotation.x = torsoX;
  R.head.rotation.z = Math.sin(ph * 0.33) * 0.25; R.head.rotation.x = Math.sin(ph * 0.5) * 0.1;
  if (z.isBoss) {
    R.smallL.rotation.x = Math.sin(ph * 1.3) * 0.6; R.smallR.rotation.x = Math.cos(ph * 1.1) * 0.6;
    const pulse = 0.85 + Math.sin(G.time * 6) * 0.15; R.core.scale.setScalar(pulse);
  }
}
function updateZombie(z, dt) {
  const cfg = z.cfg;
  const dx = P.pos.x - z.pos.x, dz = P.pos.z - z.pos.z, d = Math.hypot(dx, dz);
  const toP = Math.atan2(dx, dz);
  let moveSpeed = 0, faceTo = null;
  z.t += dt;
  if (z.flash > 0) { z.flash -= dt; if (z.flash <= 0) setFlash(z, false); }
  if (z.showHp > 0) z.showHp -= dt;
  z.atkCd -= dt; z.spitCd -= dt;
  const playerDead = P.state === 'dead';
  switch (z.state) {
    case 'rise': {
      const dur = z.isBoss ? 2.2 : 0.9;
      const k = Math.min(1, z.t / dur);
      z.rig.root.position.y = -(z.isBoss ? 4.5 : 1.8 * cfg.scale) * (1 - k);
      if (Math.random() < 0.3) burst(new THREE.Vector3(z.pos.x, 0.1, z.pos.z), 1, 'dust', 2, 0.15, 2);
      if (k >= 1) { z.state = d < cfg.detect ? 'chase' : 'wander'; z.t = 0; if (z.isBoss) Sfx.roar(); }
      faceTo = toP;
      break;
    }
    case 'wander': {
      z.aggroT -= dt;
      const wx = z.wander.x - z.pos.x, wz = z.wander.z - z.pos.z;
      if (Math.hypot(wx, wz) < 0.5 || z.t > 5) { z.t = 0; z.wander.set(clamp(z.pos.x + (Math.random() - .5) * 10, -BOUND, BOUND), 0, clamp(z.pos.z + (Math.random() - .5) * 10, -BOUND, BOUND)); }
      faceTo = Math.atan2(wx, wz); moveSpeed = cfg.walk;
      if (!playerDead && (d < cfg.detect || z.aggroT <= 0)) { z.state = 'chase'; z.t = 0; if (Math.random() < 0.6) Sfx.groan(cfg.pitch, 0.15); }
      break;
    }
    case 'chase': {
      if (playerDead) { z.state = 'wander'; z.t = 0; break; }
      faceTo = toP;
      if (z.type === 'spitter') {
        if (d < cfg.prefer - 2) { moveSpeed = -cfg.chase; }
        else if (d > cfg.range - 1) moveSpeed = cfg.chase;
        else { moveSpeed = 0.6; faceTo = toP + Math.PI / 2 * Math.sign(Math.sin(z.phase * 0.2)); }
        if (z.spitCd <= 0 && d < cfg.range) { z.state = 'attack'; z.attack = 'spit'; z.t = 0; z.hitDone = false; z.spitCd = 3 + Math.random() * 1.5; }
        if (moveSpeed < 0) faceTo = toP; // backpedal while facing
      } else if (z.isBoss) {
        moveSpeed = d > cfg.range - 0.5 ? cfg.chase : 0;
        z.slamCd -= dt; z.volleyCd -= dt; z.summonCd -= dt;
        if (z.summonCd <= 0) { z.summonCd = 16; for (let i = 0; i < 2; i++) spawnAtEdge(Math.random() < 0.5 ? 'walker' : 'runner'); }
        if (z.slamCd <= 0 && d < 7) { z.state = 'attack'; z.attack = 'slam'; z.t = 0; z.hitDone = false; z.slamCd = 7; }
        else if (z.volleyCd <= 0 && d > 8) { z.state = 'attack'; z.attack = 'spit'; z.t = 0; z.hitDone = false; z.volleyCd = 5.5; }
        else if (d < cfg.range && z.atkCd <= 0) { z.state = 'attack'; z.attack = 'melee'; z.t = 0; z.hitDone = false; }
      } else {
        moveSpeed = d > cfg.range * 0.8 ? cfg.chase : 0;
        if (d < cfg.range && z.atkCd <= 0) { z.state = 'attack'; z.attack = 'melee'; z.t = 0; z.hitDone = false; }
      }
      if (z.type !== 'spitter' && Math.random() < dt * 0.15) Sfx.groan(cfg.pitch, 0.12);
      break;
    }
    case 'attack': {
      const w = z.attack === 'slam' ? 1.1 : cfg.wind;
      if (z.t < w) faceTo = toP;
      if (z.attack === 'slam') {
        tele.position.x = z.pos.x; tele.position.z = z.pos.z;
        const k = Math.min(1, z.t / w); tele.scale.setScalar(5.5 * k); teleMat.opacity = 0.15 + 0.25 * k * (0.7 + 0.3 * Math.sin(G.time * 30));
      }
      if (!z.hitDone && z.t >= w) {
        z.hitDone = true;
        if (z.attack === 'melee') {
          const ang = Math.abs(angDiff(z.facing, toP));
          if (d < cfg.range + 0.35 && ang < 1.1) damagePlayer(cfg.dmg, z.pos.x, z.pos.z, z.type);
        } else if (z.attack === 'spit') {
          const head = new THREE.Vector3(z.pos.x + Math.sin(z.facing) * 0.4, z.isBoss ? 3.8 : 1.6, z.pos.z + Math.cos(z.facing) * 0.4);
          if (z.isBoss) for (let k = -1; k <= 1; k++) { const off = new THREE.Vector3(P.pos.x + k * 2.2, 0, P.pos.z + (Math.random() - .5) * 2); launchAcid(head, off, 1.15, true); }
          else { const lead = new THREE.Vector3(P.pos.x + (Math.random() - .5), 0, P.pos.z + (Math.random() - .5)); launchAcid(head, lead, 1.0); }
        } else if (z.attack === 'slam') {
          teleMat.opacity = 0; Sfx.slam(); shake = 0.6; vibrate(40);
          burst(new THREE.Vector3(z.pos.x, 0.2, z.pos.z), 24, 'dust', 10, 0.2, 4);
          if (d < 5.5) damagePlayer(32, z.pos.x, z.pos.z, 'slam');
        }
      }
      if (z.t >= w + cfg.rec) { z.state = 'chase'; z.t = 0; z.atkCd = 0.6 + Math.random() * 0.8; teleMat.opacity = 0; }
      break;
    }
    case 'hurt': {
      if (z.t > 0.38) { z.state = 'chase'; z.t = 0; }
      break;
    }
    case 'dead': {
      const k = Math.min(1, z.t / 0.6);
      z.rig.body.rotation.x = -Math.PI / 2 * k * 0.95;
      z.rig.body.position.y = lerp(z.isBoss ? 2.1 : 0.92, z.isBoss ? 0.8 : 0.25, k);
      if (z.t > 1.4) {
        const f = 1 - Math.min(1, (z.t - 1.4) / 1.0);
        if (!z.fading) { z.fading = true; z.rig.mats.forEach(m => { m.transparent = true; }); }
        z.rig.mats.forEach(m => m.opacity = f);
        z.rig.root.position.y = -(1 - f) * 0.4;
        z.blob.material = blobMat; z.blob.visible = f > 0.3;
      }
      if (z.t > 2.5) { removeZombie(z); return; }
      break;
    }
  }
  // knockback / movement
  if (z.state !== 'dead' && z.state !== 'rise') {
    if (faceTo !== null) z.facing = lerpAng(z.facing, faceTo, damp(z.isBoss ? 3 : 7, dt));
    if (moveSpeed !== 0) {
      const dirA = moveSpeed < 0 ? toP : z.facing, s = Math.abs(moveSpeed) * (moveSpeed < 0 ? -1 : 1);
      z.pos.x += Math.sin(dirA) * s * dt; z.pos.z += Math.cos(dirA) * s * dt;
    }
    z.pos.addScaledVector(z.vel, dt); z.vel.multiplyScalar(Math.exp(-7 * dt));
    resolveCircle(z.pos, cfg.r);
    // keep off the player
    const nd = Math.hypot(P.pos.x - z.pos.x, P.pos.z - z.pos.z), minD = cfg.r + 0.35;
    if (nd < minD && nd > 1e-4 && P.state !== 'dodge') { const push = (minD - nd); z.pos.x -= (P.pos.x - z.pos.x) / nd * push; z.pos.z -= (P.pos.z - z.pos.z) / nd * push; }
  }
  z.speedNow = lerp(z.speedNow, Math.abs(moveSpeed) + z.vel.length() * 0.3, damp(8, dt));
  z.groanT -= dt;
  if (z.groanT <= 0 && z.alive) { z.groanT = 4 + Math.random() * 8; if (d < 18) Sfx.groan(cfg.pitch, 0.12 * (1 - d / 20)); }
  z.rig.root.position.x = z.pos.x; z.rig.root.position.z = z.pos.z; z.rig.root.rotation.y = z.facing;
  z.blob.position.x = z.pos.x; z.blob.position.z = z.pos.z;
  animZombie(z, dt);
}
function separateZombies() {
  for (let i = 0; i < zombies.length; i++) {
    const a = zombies[i]; if (!a.alive || a.state === 'rise') continue;
    for (let j = i + 1; j < zombies.length; j++) {
      const b = zombies[j]; if (!b.alive || b.state === 'rise') continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d2 = dx * dx + dz * dz, m = a.cfg.r + b.cfg.r;
      if (d2 < m * m && d2 > 1e-6) {
        const d = Math.sqrt(d2), push = (m - d) * 0.5, nx = dx / d, nz = dz / d;
        const wa = a.isBoss ? 0.05 : 1, wb = b.isBoss ? 0.05 : 1;
        a.pos.x -= nx * push * wa; a.pos.z -= nz * push * wa; b.pos.x += nx * push * wb; b.pos.z += nz * push * wb;
      }
    }
  }
}

// ---------------------------------------------------------------- player actions
function nearestZombie(maxD, fromAngle = null, maxAng = Math.PI) {
  let best = null, bd = maxD;
  for (const z of zombies) {
    if (!z.alive || z.state === 'rise') continue;
    const d = Math.hypot(z.pos.x - P.pos.x, z.pos.z - P.pos.z) - z.cfg.r;
    if (fromAngle !== null && Math.abs(angDiff(fromAngle, Math.atan2(z.pos.x - P.pos.x, z.pos.z - P.pos.z))) > maxAng) continue;
    if (d < bd) { bd = d; best = z; }
  }
  return best;
}
function faceTargetForAttack() {
  const mv = moveVector();
  let t = P.lock && P.lock.alive ? P.lock : null;
  if (!t) t = mv.len > 0.2 ? (nearestZombie(4.5, mv.ang, 1.2) || null) : nearestZombie(4.5);
  if (t) P.facing = Math.atan2(t.pos.x - P.pos.x, t.pos.z - P.pos.z);
  else if (mv.len > 0.2) P.facing = mv.ang;
}
function startAttack(idx) {
  P.state = 'attack'; P.t = 0; P.combo = idx; P.hitDone = 0; P.queued = false;
  faceTargetForAttack();
  Sfx.swing(idx);
}
function doAttack() {
  if (G.mode !== 'play') return;
  if (P.state === 'attack') { P.queued = true; return; }
  if (P.state === 'move') startAttack(P.comboWin > 0 ? (P.combo + 1) % 3 : 0);
}
function doDodge() {
  if (G.mode !== 'play') return;
  if (P.state === 'dodge' || P.state === 'dead' || P.state === 'skill') return;
  if (P.state === 'attack' && P.t < ATK[P.combo].hit) return;
  if (P.st < DODGE_COST) { flashStamina(); return; }
  P.st -= DODGE_COST; P.stDelay = 0.7;
  const mv = moveVector();
  const a = mv.len > 0.2 ? mv.ang : P.facing + Math.PI * (P.lock ? 1 : 0);
  P.dodgeDir.set(Math.sin(a), 0, Math.cos(a));
  P.facing = a; P.state = 'dodge'; P.t = 0; P.invuln = 0.38;
  Sfx.dodge();
}
function doSkill() {
  if (G.mode !== 'play') return;
  if (P.skillCd > 0 || P.state === 'dead' || P.state === 'dodge' || P.state === 'skill') return;
  P.state = 'skill'; P.t = 0; P.hitDone = 0; P.skillCd = SKILL_CD; P.invuln = 0.55;
  skillFxT = 0; Sfx.skill(); vibrate(20);
}
function pickLock(auto = false) {
  const z = nearestZombie(22);
  P.lock = z;
  $('bLock').classList.toggle('on', !!z);
}
function toggleLock() {
  if (G.mode !== 'play') return;
  if (P.lock) { P.lock = null; $('bLock').classList.remove('on'); return; }
  pickLock();
}
let stFlashT = 0;
function flashStamina() { stFlashT = 0.6; }

function meleeHit(range, arc, dmg, knock, full = false) {
  let hits = 0;
  for (const z of zombies) {
    if (!z.alive || z.state === 'rise') continue;
    const dx = z.pos.x - P.pos.x, dz = z.pos.z - P.pos.z, d = Math.hypot(dx, dz);
    if (d > range + z.cfg.r) continue;
    if (!full && Math.abs(angDiff(P.facing, Math.atan2(dx, dz))) > arc && d > z.cfg.r + 0.4) continue;
    const nx = d > 0 ? dx / d : 0, nz = d > 0 ? dz / d : 1;
    damageZombie(z, dmg, nx, nz, knock); hits++;
  }
  return hits;
}
function damagePlayer(dmg, fx, fz, src) {
  if (P.state === 'dead' || G.mode !== 'play') return;
  if (P.invuln > 0) { if (src !== 'puddle') floatText(new THREE.Vector3(P.pos.x, 1.9, P.pos.z), '閃避', 'heal'); return; }
  P.hp = Math.max(0, P.hp - dmg);
  vignetteV = 1; shake = Math.max(shake, dmg > 15 ? 0.45 : 0.2);
  floatText(new THREE.Vector3(P.pos.x, 1.9, P.pos.z), '-' + dmg, 'me');
  burst(new THREE.Vector3(P.pos.x, 1.2, P.pos.z), 5, src === 'acid' || src === 'puddle' ? 'acid' : 'blood', 3, 0.07);
  Sfx.hurt(); vibrate(dmg > 15 ? [60, 30, 60] : 45);
  if (src !== 'puddle') {
    const dx = P.pos.x - fx, dz = P.pos.z - fz, d = Math.hypot(dx, dz) || 1;
    const k = dmg > 20 ? 9 : 4; P.kb.set(dx / d * k, 0, dz / d * k);
    if (dmg >= 9 && P.state !== 'skill') { P.state = 'hurt'; P.t = 0; }
  }
  if (P.hp <= 0) { P.state = 'dead'; P.t = 0; G.deadAt = G.time; P.lock = null; $('bLock').classList.remove('on'); }
}

// ---------------------------------------------------------------- input
const input = { jx: 0, jy: 0, keys: {}, camDX: 0, camDY: 0 };
const joy = { id: null, ox: 0, oy: 0, base: $('joyBase'), knob: $('joyKnob') };
const camPtr = { id: null, lx: 0, ly: 0 };
const JOY_R = 50;
function joyDefaultPos() { joy.base.style.left = ''; joy.base.style.top = ''; }
canvas.addEventListener('pointerdown', e => {
  if (G.mode !== 'play') return;
  e.preventDefault();
  Sfx.unlock();
  const leftSide = e.clientX < innerWidth * 0.45 && e.pointerType !== 'mouse';
  if (leftSide && joy.id === null) {
    joy.id = e.pointerId;
    joy.ox = clamp(e.clientX, 70, innerWidth * 0.45); joy.oy = clamp(e.clientY, 70, innerHeight - 70);
    joy.base.style.left = joy.ox + 'px'; joy.base.style.top = joy.oy + 'px'; joy.base.classList.add('active');
    updateJoy(e.clientX, e.clientY);
  } else if (camPtr.id === null) {
    camPtr.id = e.pointerId; camPtr.lx = e.clientX; camPtr.ly = e.clientY;
  } else return;
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { }
}, { passive: false });
function updateJoy(x, y) {
  let dx = x - joy.ox, dy = y - joy.oy; const d = Math.hypot(dx, dy);
  if (d > JOY_R) { dx = dx / d * JOY_R; dy = dy / d * JOY_R; }
  joy.knob.style.transform = `translate(${dx}px,${dy}px)`;
  const m = Math.min(1, d / JOY_R);
  const dead = 0.12;
  if (m < dead) { input.jx = input.jy = 0; return; }
  input.jx = (dx / JOY_R) * ((m - dead) / (1 - dead)) / m; input.jy = -(dy / JOY_R) * ((m - dead) / (1 - dead)) / m;
}
canvas.addEventListener('pointermove', e => {
  if (e.pointerId === joy.id) updateJoy(e.clientX, e.clientY);
  else if (e.pointerId === camPtr.id) {
    input.camDX += e.clientX - camPtr.lx; input.camDY += e.clientY - camPtr.ly;
    camPtr.lx = e.clientX; camPtr.ly = e.clientY;
  }
}, { passive: true });
function endPtr(e) {
  if (e.pointerId === joy.id) { joy.id = null; input.jx = input.jy = 0; joy.knob.style.transform = ''; joy.base.classList.remove('active'); joyDefaultPos(); }
  if (e.pointerId === camPtr.id) camPtr.id = null;
}
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr); canvas.addEventListener('lostpointercapture', endPtr);
canvas.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('touchmove', e => { if (G.mode === 'play') e.preventDefault(); }, { passive: false });

function bindBtn(id, onDown, onUp) {
  const el = $(id);
  el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); Sfx.unlock(); el.classList.add('pressed'); onDown && onDown(); try { el.setPointerCapture(e.pointerId); } catch (_) { } });
  const up = e => { el.classList.remove('pressed'); onUp && onUp(); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  el.addEventListener('contextmenu', e => e.preventDefault());
}
bindBtn('bAttack', () => { P.attackHeld = true; P.attackHoldT = 0; doAttack(); }, () => { P.attackHeld = false; });
bindBtn('bDodge', doDodge);
bindBtn('bSkill', doSkill);
bindBtn('bLock', toggleLock);

addEventListener('keydown', e => {
  input.keys[e.code] = true;
  if (e.repeat) return;
  if (G.mode === 'play') {
    if (e.code === 'KeyJ') { P.attackHeld = true; doAttack(); }
    else if (e.code === 'KeyK' || e.code === 'Space') { doDodge(); e.preventDefault(); }
    else if (e.code === 'KeyL') doSkill();
    else if (e.code === 'Semicolon' || e.code === 'KeyQ' || e.code === 'Tab') { toggleLock(); e.preventDefault(); }
    else if (e.code === 'Escape' || e.code === 'KeyP') pauseGame();
  } else if (G.mode === 'paused' && (e.code === 'Escape' || e.code === 'KeyP')) resumeGame();
});
addEventListener('keyup', e => { input.keys[e.code] = false; if (e.code === 'KeyJ') P.attackHeld = false; });
addEventListener('blur', () => { input.keys = {}; P.attackHeld = false; });

const _mv = { x: 0, z: 0, len: 0, ang: 0 };
function moveVector() {
  let jx = input.jx, jy = input.jy;
  const k = input.keys;
  const kx = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0), ky = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
  if (kx || ky) { const l = Math.hypot(kx, ky); jx = kx / l; jy = ky / l; }
  const fx = -Math.sin(CAM.yaw), fz = -Math.cos(CAM.yaw), rx = Math.cos(CAM.yaw), rz = -Math.sin(CAM.yaw);
  _mv.x = rx * jx + fx * jy; _mv.z = rz * jx + fz * jy;
  _mv.len = Math.min(1, Math.hypot(_mv.x, _mv.z));
  _mv.ang = Math.atan2(_mv.x, _mv.z);
  return _mv;
}

// ---------------------------------------------------------------- camera
const CAM = { yaw: 0, pitch: 0.3, dist: 4.6, pivot: new THREE.Vector3(), curDist: 4.6 };
function updateCamera(dt) {
  const sens = 0.0065;
  CAM.yaw -= input.camDX * sens; CAM.pitch = clamp(CAM.pitch + input.camDY * sens * 0.8, -0.2, 1.05);
  input.camDX = input.camDY = 0;
  const k = input.keys;
  if (k.ArrowLeft) CAM.yaw += 2.2 * dt; if (k.ArrowRight) CAM.yaw -= 2.2 * dt;
  if (k.ArrowUp) CAM.pitch = clamp(CAM.pitch - 1.2 * dt, -0.2, 1.05); if (k.ArrowDown) CAM.pitch = clamp(CAM.pitch + 1.2 * dt, -0.2, 1.05);
  let wantDist = 4.6;
  if (P.lock && P.lock.alive) {
    const L = P.lock, dx = L.pos.x - P.pos.x, dz = L.pos.z - P.pos.z;
    if (Math.hypot(dx, dz) > 26) { P.lock = null; $('bLock').classList.remove('on'); }
    else {
      CAM.yaw = lerpAng(CAM.yaw, Math.atan2(-dx, -dz), damp(5, dt));
      CAM.pitch = lerp(CAM.pitch, L.isBoss ? 0.12 : 0.26, damp(2, dt));
      if (L.isBoss) wantDist = 6.5;
    }
  }
  if (G.boss && G.boss.alive && !P.lock) wantDist = 5.6;
  const fx = -Math.sin(CAM.yaw), fz = -Math.cos(CAM.yaw), rx = Math.cos(CAM.yaw), rz = -Math.sin(CAM.yaw);
  const target = new THREE.Vector3(P.pos.x + rx * 0.6, (P.state === 'dodge' ? 1.35 : 1.55), P.pos.z + rz * 0.6);
  CAM.pivot.lerp(target, damp(14, dt));
  const cp = Math.cos(CAM.pitch), sp = Math.sin(CAM.pitch);
  const dir = new THREE.Vector3(-fx * cp, sp, -fz * cp);
  const hit = rayCast(CAM.pivot, dir, wantDist);
  const dist = Math.max(0.9, hit - 0.25);
  CAM.curDist = dist < CAM.curDist ? dist : lerp(CAM.curDist, dist, damp(4, dt));
  camera.position.copy(CAM.pivot).addScaledVector(dir, CAM.curDist);
  if (camera.position.y < 0.3) camera.position.y = 0.3;
  camera.lookAt(CAM.pivot.x + fx * 2, CAM.pivot.y - 0.15 + sp * 0.5, CAM.pivot.z + fz * 2);
  if (shake > 0) {
    camera.position.x += (Math.random() - .5) * shake * 0.35; camera.position.y += (Math.random() - .5) * shake * 0.35;
    shake = Math.max(0, shake - dt * 1.8);
  }
}

// ---------------------------------------------------------------- player update + animation
function updatePlayer(dt) {
  const mv = moveVector();
  P.invuln = Math.max(0, P.invuln - dt);
  P.skillCd = Math.max(0, P.skillCd - dt);
  P.comboWin = Math.max(0, P.comboWin - dt);
  if (P.state !== 'dodge') { P.stDelay -= dt; if (P.stDelay <= 0) P.st = Math.min(P.maxSt, P.st + 28 * dt); }
  P.t += dt;
  let speed = 0;
  switch (P.state) {
    case 'move': {
      if (mv.len > 0.08) {
        P.facing = lerpAng(P.facing, mv.ang, damp(14, dt));
        speed = 6.2 * mv.len;
        P.pos.x += mv.x / Math.max(mv.len, 1e-3) * speed * dt; P.pos.z += mv.z / Math.max(mv.len, 1e-3) * speed * dt;
      }
      if (P.attackHeld && G.mode === 'play') { P.attackHoldT += dt; if (P.attackHoldT > 0.05) doAttack(); }
      break;
    }
    case 'attack': {
      const A = ATK[P.combo];
      if (P.t < A.hit) { const lz = A.lunge * (1 - P.t / A.hit); const tgt = nearestZombie(1.2, P.facing, 0.6); if (!tgt) { P.pos.x += Math.sin(P.facing) * lz * dt; P.pos.z += Math.cos(P.facing) * lz * dt; } }
      if (!P.hitDone && P.t >= A.hit) {
        P.hitDone = 1; meleeHit(A.range, A.arc, A.dmg, A.knock);
        trailT = 0.16; trail.rotation.set(0, 0, P.combo === 0 ? 0.35 : P.combo === 1 ? Math.PI - 0.35 : Math.PI / 2);
        trailPivot.rotation.y = P.facing; trailMat.color.setHex(P.combo === 2 ? 0xff6a6a : 0xffe0e0);
      }
      if (P.attackHeld) P.queued = true;
      if (P.queued && P.t >= A.dur * 0.62 && P.combo < 2) { startAttack(P.combo + 1); break; }
      if (P.t >= A.dur) { P.state = 'move'; P.t = 0; P.comboWin = P.combo < 2 ? 0.35 : 0; }
      break;
    }
    case 'dodge': {
      const D = 0.5, k = P.t / D;
      speed = 11.5 * Math.pow(Math.max(0, 1 - k), 0.6);
      P.pos.addScaledVector(P.dodgeDir, speed * dt);
      if (k >= 1) { P.state = 'move'; P.t = 0; }
      break;
    }
    case 'skill': {
      const D = 0.72;
      P.facing += dt * (TAU * 2.2 / D);
      if (mv.len > 0.1) { P.pos.x += mv.x * 2.5 * dt; P.pos.z += mv.z * 2.5 * dt; }
      if (P.hitDone === 0 && P.t >= 0.2) { P.hitDone = 1; meleeHit(4.0, 0, 34, 6, true); }
      if (P.hitDone === 1 && P.t >= 0.46) { P.hitDone = 2; meleeHit(4.2, 0, 34, 9, true); shake = 0.3; }
      if (P.t >= D) { P.state = 'move'; P.t = 0; }
      break;
    }
    case 'hurt': if (P.t > 0.32) { P.state = 'move'; P.t = 0; } break;
    case 'dead': break;
  }
  P.pos.addScaledVector(P.kb, dt); P.kb.multiplyScalar(Math.exp(-8 * dt));
  resolveCircle(P.pos, 0.38);
  P.run = lerp(P.run, P.state === 'move' ? speed / 6.2 : 0, damp(10, dt));
  // pickups
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i]; o.t += dt; o.m.rotation.y += dt * 3; o.m.position.y = 0.6 + Math.sin(o.t * 3) * 0.12;
    if (Math.hypot(o.m.position.x - P.pos.x, o.m.position.z - P.pos.z) < 1.1 && P.state !== 'dead') {
      const heal = Math.min(18, P.maxHp - P.hp); P.hp += heal; Sfx.pickup();
      floatText(new THREE.Vector3(P.pos.x, 2, P.pos.z), '+' + Math.round(heal), 'heal');
      scene.remove(o.m); orbs.splice(i, 1);
    } else if (o.t > 25) { scene.remove(o.m); orbs.splice(i, 1); }
  }
  hero.root.position.set(P.pos.x, 0, P.pos.z); hero.root.rotation.y = P.facing;
  heroBlob.position.x = P.pos.x; heroBlob.position.z = P.pos.z;
  animateHero(dt);
}
function animateHero(dt) {
  const R = hero, t = G.time;
  const run = P.run;
  P.runPhase += dt * (4 + 7 * run);
  const ph = P.runPhase;
  // neutral
  let bodyY = 0.95 + Math.sin(t * 2.2) * 0.008, bodyRX = 0, bodyRZ = 0;
  let legL = 0, legR = 0, shinL = 0.05, shinR = 0.05, torsoX = 0.03, torsoY = 0, headX = 0;
  let armL = { x: 0.05, y: 0, z: 0.12 }, armR = { x: -0.25, y: 0, z: -0.12 };
  let foreL = -0.2, foreR = -0.45, weaponX = 0.35, hairX = 0.1, skirtX = 0;
  if (P.state === 'move' || P.state === 'hurt') {
    legL = -Math.sin(ph) * 0.85 * run; legR = Math.sin(ph) * 0.85 * run;
    shinL = 0.05 + Math.max(0, Math.sin(ph)) * 1.2 * run; shinR = 0.05 + Math.max(0, -Math.sin(ph)) * 1.2 * run;
    bodyY += Math.abs(Math.cos(ph)) * 0.06 * run - 0.03 * run;
    torsoX = 0.03 + 0.22 * run; headX = -0.12 * run;
    armL.x = Math.sin(ph) * 0.8 * run + 0.05; foreL = -0.3 - 0.6 * run;
    armR.x = -0.25 - Math.sin(ph) * 0.45 * run - 0.25 * run; foreR = -0.45 - 0.4 * run;
    bodyRZ = Math.sin(ph) * 0.03 * run; torsoY = Math.sin(ph) * 0.12 * run;
    hairX = 0.1 + 0.5 * run + Math.sin(ph * 2) * 0.06 * run; skirtX = -0.18 * run + Math.sin(ph * 2) * 0.04 * run;
    weaponX = 0.35 + 0.4 * run;
    if (P.state === 'hurt') { const k = Math.max(0, 1 - P.t / 0.32); torsoX = -0.35 * k; headX = -0.3 * k; armL.x = -0.6 * k; }
  } else if (P.state === 'attack') {
    const A = ATK[P.combo], tt = P.t;
    const wind = A.hit * 0.55;
    const kWind = Math.min(1, tt / wind), kStrike = clamp((tt - wind) / (A.hit - wind + 0.08), 0, 1), kRec = clamp((tt - A.hit - 0.08) / (A.dur - A.hit - 0.08), 0, 1);
    const ease = x => 1 - Math.pow(1 - x, 3);
    let from, to;
    if (P.combo === 0) { from = { x: -1.45, y: -1.9, z: 0, ty: -0.6 }; to = { x: -1.35, y: 1.1, z: 0, ty: 0.55 }; }
    else if (P.combo === 1) { from = { x: -1.2, y: 1.2, z: 0, ty: 0.55 }; to = { x: -1.55, y: -1.6, z: 0, ty: -0.5 }; }
    else { from = { x: -3.0, y: -0.25, z: 0, ty: -0.15 }; to = { x: -0.55, y: -0.15, z: 0, ty: 0.1 }; }
    const rest = { x: -0.5, y: 0, z: -0.1, ty: 0 };
    let pose;
    if (tt < wind) pose = lerpPose(rest, from, ease(kWind));
    else if (kRec <= 0) pose = lerpPose(from, to, ease(kStrike));
    else pose = lerpPose(to, rest, kRec);
    armR = { x: pose.x, y: pose.y, z: pose.z }; torsoY = pose.ty; foreR = -0.15; weaponX = 1.35;
    torsoX = P.combo === 2 ? (tt < wind ? -0.15 : 0.35) : 0.12;
    legL = -0.45; legR = 0.35; shinL = 0.25; shinR = 0.35; bodyY = 0.9;
    armL = { x: -0.4, y: 0.4, z: 0.4 }; foreL = -0.8;
    hairX = 0.25 + Math.abs(torsoY) * 0.3; skirtX = -0.1;
  } else if (P.state === 'dodge') {
    const k = Math.min(1, P.t / 0.5), s = Math.sin(k * Math.PI);
    bodyRX = k * TAU; bodyY = 0.95 - s * 0.42;
    legL = legR = -1.5 * s; shinL = shinR = 2.0 * s; torsoX = 0.7 * s; headX = 0.4 * s;
    armL = { x: -1.2 * s, y: 0, z: 0.2 }; armR = { x: -1.2 * s, y: 0, z: -0.2 }; foreL = foreR = -1.4 * s;
    hairX = 0.3 + 0.8 * s; skirtX = -0.6 * s; weaponX = 0.8;
  } else if (P.state === 'skill') {
    const k = Math.min(1, P.t / 0.72);
    armR = { x: -1.5, y: -1.55, z: 0 }; armL = { x: -1.3, y: 1.3, z: 0 }; foreR = -0.05; foreL = -0.3; weaponX = 1.5;
    legL = -0.5; legR = 0.5; shinL = 0.4; shinR = 0.4; bodyY = 0.85; torsoX = 0.25; hairX = 1.1; skirtX = -0.5;
    bodyRZ = Math.sin(k * Math.PI) * 0.15;
  } else if (P.state === 'dead') {
    const k = Math.min(1, P.t / 0.8);
    bodyRX = -Math.PI / 2 * k * 0.95; bodyY = lerp(0.95, 0.22, k); shinL = 0.4 * k; legR = -0.3 * k;
    armL = { x: -2.5 * k, y: 0, z: 0.4 }; armR = { x: -2.2 * k, y: 0, z: -0.6 }; headX = -0.4 * k;
  }
  const s = damp(P.state === 'attack' || P.state === 'skill' || P.state === 'dodge' || P.state === 'dead' ? 40 : 16, dt);
  R.body.position.y = lerp(R.body.position.y, bodyY, s);
  R.body.rotation.x = (P.state === 'dodge' || P.state === 'dead') ? bodyRX : lerp(R.body.rotation.x % TAU, 0, s);
  R.body.rotation.z = lerp(R.body.rotation.z, bodyRZ, s);
  R.legL.rotation.x = lerp(R.legL.rotation.x, legL, s); R.legR.rotation.x = lerp(R.legR.rotation.x, legR, s);
  R.shinL.rotation.x = lerp(R.shinL.rotation.x, shinL, s); R.shinR.rotation.x = lerp(R.shinR.rotation.x, shinR, s);
  R.torso.rotation.x = lerp(R.torso.rotation.x, torsoX, s); R.torso.rotation.y = lerp(R.torso.rotation.y, torsoY, s);
  R.head.rotation.x = lerp(R.head.rotation.x, headX, s);
  R.armL.rotation.x = lerp(R.armL.rotation.x, armL.x, s); R.armL.rotation.y = lerp(R.armL.rotation.y, armL.y, s); R.armL.rotation.z = lerp(R.armL.rotation.z, armL.z, s);
  R.armR.rotation.x = lerp(R.armR.rotation.x, armR.x, s); R.armR.rotation.y = lerp(R.armR.rotation.y, armR.y, s); R.armR.rotation.z = lerp(R.armR.rotation.z, armR.z, s);
  R.foreL.rotation.x = lerp(R.foreL.rotation.x, foreL, s); R.foreR.rotation.x = lerp(R.foreR.rotation.x, foreR, s);
  R.weapon.rotation.x = lerp(R.weapon.rotation.x, weaponX, s);
  R.hair.rotation.x = lerp(R.hair.rotation.x, hairX, damp(8, dt)); R.hairTip.rotation.x = lerp(R.hairTip.rotation.x, hairX * 0.5, damp(6, dt));
  R.skirt.rotation.x = lerp(R.skirt.rotation.x, skirtX, damp(8, dt));
  // invulnerability shimmer
  R.mats.coat.emissive.setHex(P.invuln > 0 && P.state === 'dodge' ? 0x2a1040 : 0x07050a);
}
function lerpPose(a, b, k) { return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k), ty: lerp(a.ty, b.ty, k) }; }

// ---------------------------------------------------------------- waves
const G = { mode: 'menu', time: 0, playTime: 0, kills: 0, wave: 0, phase: 'idle', phaseT: 0, queue: [], spawnT: 0, boss: null, bossDead: false, deadAt: 0 };
const MAX_WAVE = 5;
function waveList(n) {
  const L = [];
  const push = (t, c) => { for (let i = 0; i < c; i++) L.push(t); };
  if (n === 1) push('walker', 6);
  if (n === 2) { push('walker', 6); push('runner', 3); }
  if (n === 3) { push('walker', 6); push('runner', 3); push('brute', 1); }
  if (n === 4) { push('walker', 6); push('runner', 4); push('spitter', 3); push('brute', 1); }
  if (n === 5) { push('walker', 8); push('runner', 5); push('spitter', 3); push('brute', 2); }
  for (let i = L.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0;[L[i], L[j]] = [L[j], L[i]]; }
  return L;
}
function spawnAtEdge(type) {
  const fx = -Math.sin(CAM.yaw), fz = -Math.cos(CAM.yaw);
  const cands = W.spawnPoints.map(([x, z]) => {
    const dx = x - P.pos.x, dz = z - P.pos.z, d = Math.hypot(dx, dz);
    const inView = (dx * fx + dz * fz) / (d || 1) > 0.5;
    return { x, z, score: (d > 13 ? 0 : 100) + (d > 25 ? 25 : 0) + (inView && d < 20 ? 15 : 0) + Math.random() * 30 };
  }).sort((a, b) => a.score - b.score);
  for (const c of cands) {
    for (let tries = 0; tries < 6; tries++) {
      const x = clamp(c.x + (Math.random() - .5) * 4, -BOUND + 1, BOUND - 1), z = clamp(c.z + (Math.random() - .5) * 4, -BOUND + 1, BOUND - 1);
      if (!insideCollider(x, z, type === 'boss' ? 2 : 0.8)) { const zz = spawnZombie(type, x, z); zz.aggroT = 0.5 + Math.random() * 2; return zz; }
    }
  }
  return spawnZombie(type, 0, -30);
}
function startWave(n) {
  G.wave = n; G.queue = waveList(n); G.phase = 'fight'; G.spawnT = 0;
  banner(`第 ${n} 波<small>${n === MAX_WAVE ? '最後一波 · 撐住！' : '屍潮來襲'}</small>`, 2.4); Sfx.wave();
  for (let i = 0; i < 3 && G.queue.length; i++) spawnAtEdge(G.queue.shift());
}
function updateWaves(dt) {
  G.phaseT += dt;
  if (G.phase === 'fight') {
    G.spawnT -= dt;
    const alive = zombies.filter(z => z.alive).length;
    if (G.queue.length && G.spawnT <= 0 && alive < 14) { spawnAtEdge(G.queue.shift()); G.spawnT = 0.9 + Math.random() * 0.6; }
    if (!G.queue.length && alive === 0) {
      if (G.wave >= MAX_WAVE) { G.phase = 'preboss'; G.phaseT = 0; banner('⚠ 首領來襲<small>融合巨獸 正在逼近…</small>', 3); Sfx.roar(); }
      else { G.phase = 'break'; G.phaseT = 0; banner(`第 ${G.wave} 波 清除<small>稍作喘息…</small>`, 2.2); P.hp = Math.min(P.maxHp, P.hp + 15); }
    }
  } else if (G.phase === 'break') {
    if (G.phaseT > 3.5) startWave(G.wave + 1);
  } else if (G.phase === 'preboss') {
    if (G.phaseT > 3) {
      G.phase = 'boss'; G.boss = spawnAtEdge('boss');
      $('bossBar').classList.remove('hidden'); shake = 0.5;
    }
  }
}

// ---------------------------------------------------------------- HUD update
const mm = $('minimap').getContext('2d');
let mmFrame = 0;
function drawMinimap() {
  const c = mm, S = 120, sc = 1.9; // px per meter
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, S, S);
  c.fillStyle = 'rgba(28,26,30,0.9)'; c.fillRect(0, 0, S, S);
  c.save();
  c.translate(S / 2, S / 2); c.rotate(CAM.yaw); c.scale(sc, sc); c.translate(-P.pos.x, -P.pos.z);
  // roads
  c.fillStyle = 'rgba(70,66,72,0.6)'; c.fillRect(-7, -40, 14, 80); c.fillRect(-40, -7, 80, 14);
  for (const r of W.mapRects) {
    c.save(); c.translate(r.x, r.z); c.rotate(-r.rot);
    c.fillStyle = r.kind === 'b' ? '#5c5860' : r.kind === 'f' ? '#ff7a30' : '#3e3b42';
    c.fillRect(-r.w / 2, -r.d / 2, r.w, r.d); c.restore();
  }
  c.strokeStyle = 'rgba(150,20,30,.7)'; c.lineWidth = 0.6; c.strokeRect(-BOUND, -BOUND, BOUND * 2, BOUND * 2);
  for (const z of zombies) {
    if (!z.alive) continue;
    c.fillStyle = z.isBoss ? '#ffd84a' : '#ff2a2a';
    c.beginPath(); c.arc(z.pos.x, z.pos.z, z.isBoss ? 2.2 : 1.1, 0, TAU); c.fill();
  }
  for (const o of orbs) { c.fillStyle = '#ff8090'; c.fillRect(o.m.position.x - .6, o.m.position.z - .6, 1.2, 1.2); }
  // player
  c.translate(P.pos.x, P.pos.z); c.rotate(-P.facing);
  c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, 2.6); c.lineTo(1.6, -1.6); c.lineTo(0, -0.6); c.lineTo(-1.6, -1.6); c.closePath(); c.fill();
  c.restore();
  // view cone hint
  c.fillStyle = 'rgba(255,255,255,0.06)'; c.beginPath(); c.moveTo(S / 2, S / 2); c.arc(S / 2, S / 2, 60, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); c.fill();
}
const hpFill = $('hpFill'), hpGhost = $('hpGhost'), stFill = $('stFill'), cdEl = $('skillCd'), cdTxt = $('skillCdText'), bSkill = $('bSkill');
const waveText = $('waveText'), killText = $('killText'), lockMark = $('lockMark'), bossFill = $('bossFill');
let lastHud = {};
function setIf(key, v, fn) { if (lastHud[key] !== v) { lastHud[key] = v; fn(v); } }
function updateHud(dt) {
  const hpP = Math.round(P.hp / P.maxHp * 1000) / 10;
  setIf('hp', hpP, v => { hpFill.style.width = v + '%'; hpGhost.style.width = v + '%'; });
  setIf('st', Math.round(P.st), v => stFill.style.width = (v / P.maxSt * 100) + '%');
  stFlashT -= dt;
  setIf('stlow', P.st < DODGE_COST || stFlashT > 0, v => stFill.parentElement.classList.toggle('low', v));
  const cdP = Math.round(P.skillCd / SKILL_CD * 100) / 100;
  setIf('cd', cdP, v => { cdEl.style.setProperty('--p', v); cdTxt.textContent = v > 0 ? Math.ceil(P.skillCd) : ''; bSkill.classList.toggle('ready', v <= 0); });
  setIf('wave', G.phase === 'boss' || G.phase === 'preboss' ? '首領戰' : `第 ${G.wave} 波 / ${MAX_WAVE}`, v => waveText.textContent = v);
  setIf('kills', G.kills, v => killText.textContent = '擊殺 ' + v);
  setIf('lowhp', P.hp / P.maxHp < 0.3 && P.state !== 'dead', v => $('lowhp').style.opacity = v ? 1 : 0);
  vignetteV = Math.max(0, vignetteV - dt * 2.2);
  setIf('vig', Math.round(vignetteV * 20) / 20, v => $('vignette').style.opacity = v);
  if (G.boss) setIf('boss', Math.max(0, Math.round(G.boss.hp / G.boss.maxHp * 1000) / 10), v => bossFill.style.width = v + '%');
  if (bannerTimer > 0) { bannerTimer -= dt; if (bannerTimer <= 0) $('banner').classList.remove('show'); }
  if (++mmFrame % 2 === 0) drawMinimap();
  // enemy hp bars
  let bi = 0;
  for (const z of zombies) {
    if (bi >= hpBars.length) break;
    if (!z.alive || z.isBoss || z.showHp <= 0 || z.hp >= z.maxHp) continue;
    const s = toScreen(_tmp.set(z.pos.x, 2.05 * z.cfg.scale, z.pos.z));
    if (!s.vis) continue;
    const hb = hpBars[bi++];
    if (!hb.shown) { hb.el.style.display = 'block'; hb.shown = true; }
    hb.el.style.transform = `translate(${s.x | 0}px,${s.y | 0}px)`;
    hb.fill.style.width = (z.hp / z.maxHp * 100) + '%';
  }
  for (; bi < hpBars.length; bi++) if (hpBars[bi].shown) { hpBars[bi].el.style.display = 'none'; hpBars[bi].shown = false; }
  // lock marker
  if (P.lock && P.lock.alive) {
    const L = P.lock, s = toScreen(_tmp.set(L.pos.x, L.isBoss ? 3.0 : 1.25 * L.cfg.scale, L.pos.z));
    lockMark.style.display = s.vis ? 'block' : 'none'; lockMark.style.left = s.x + 'px'; lockMark.style.top = s.y + 'px';
    lockRing.visible = true; lockRing.position.set(L.pos.x, 0.05, L.pos.z); lockRing.scale.setScalar(L.cfg.r * 1.6);
  } else { lockMark.style.display = 'none'; lockRing.visible = false; if (P.lock) { P.lock = null; $('bLock').classList.remove('on'); } }
}
const _tmp = new THREE.Vector3();

// ---------------------------------------------------------------- FX update
function updateFx(dt) {
  if (trailT > 0) {
    trailT -= dt; trailPivot.position.set(P.pos.x, 1.05, P.pos.z);
    trailMat.opacity = Math.max(0, trailT / 0.16) * 0.75;
    trail.scale.setScalar(1 + (0.16 - trailT) * 1.5);
  } else trailMat.opacity = 0;
  if (skillFxT >= 0) {
    skillFxT += dt; const k = skillFxT / 0.75;
    skillRing.position.x = P.pos.x; skillRing.position.z = P.pos.z; skillRing.scale.setScalar(0.5 + k * 4.2);
    ringMat.opacity = Math.max(0, 1 - k) * 0.9;
    spinDisc.position.set(P.pos.x, 0.9, P.pos.z); spinDisc.rotation.y += dt * 25; spinMat.opacity = Math.max(0, Math.sin(Math.min(1, k) * Math.PI)) * 0.5;
    if (k >= 1) { skillFxT = -1; ringMat.opacity = 0; spinMat.opacity = 0; }
  }
  for (const f of W.fires) {
    const fl = Math.sin(G.time * 13 + f.ph) * 0.5 + Math.sin(G.time * 23 + f.ph * 2) * 0.3 + Math.random() * 0.2;
    const s = (f.big ? 1 : 1) * (0.85 + fl * 0.18);
    f.f1.scale.y = (f.big ? 1.6 : 1) * s * 1.1; f.f1.rotation.y += dt * 2;
    if (f.f2) f.f2.scale.y = 0.6 * (0.9 + fl * 0.3);
    if (f.light) f.light.intensity = 16 + fl * 6;
    if (Math.random() < dt * 3) burst(new THREE.Vector3(f.x, f.big ? 2.6 : 1.5, f.z), 1, 'spark', 0.6, 0.04, 2.5);
  }
  if (G.boss && G.boss.alive) {
    G.boss.rig.core.getWorldPosition(bossLight.position); bossLight.position.z += 0;
    bossLight.intensity = 10 + Math.sin(G.time * 6) * 3;
  } else bossLight.intensity = Math.max(0, bossLight.intensity - dt * 10);
  W.sky.position.copy(camera.position);
  fillLight.position.set(camera.position.x, camera.position.y + 1.2, camera.position.z);
}

// ---------------------------------------------------------------- game flow
function clearWorld() {
  for (const z of zombies.slice()) removeZombie(z);
  for (const p of projectiles) scene.remove(p.m); projectiles.length = 0;
  for (const p of puddles) { scene.remove(p.m); p.m.material.dispose(); } puddles.length = 0;
  for (const o of orbs) scene.remove(o.m); orbs.length = 0;
  for (const d of decals) d.visible = false;
  for (const p of parts) { p.life = 0; p.m.visible = false; }
  teleMat.opacity = 0;
}
function resetGame() {
  clearWorld();
  Object.assign(P, { hp: P.maxHp, st: P.maxSt, stDelay: 0, state: 'move', t: 0, combo: 0, comboWin: 0, queued: false, invuln: 0, skillCd: 0, lock: null, attackHeld: false, run: 0 });
  P.pos.set(0, 0, 4); P.kb.set(0, 0, 0); P.facing = Math.PI;
  CAM.yaw = 0; CAM.pitch = 0.3; CAM.pivot.set(0, 1.5, 4);
  hero.body.rotation.set(0, 0, 0);
  Object.assign(G, { time: 0, playTime: 0, kills: 0, wave: 0, phase: 'intro', phaseT: 0, queue: [], boss: null, bossDead: false });
  $('bossBar').classList.add('hidden'); $('bLock').classList.remove('on');
  lastHud = {};
  banner('喪屍突圍<small>擊退屍潮 · 活下去</small>', 2.2);
  setTimeout(() => { if (G.mode === 'play' && G.phase === 'intro') startWave(1); }, 2300);
}
function show(id, on) { $(id).classList.toggle('hidden', !on); }
function startGame() {
  Sfx.unlock();
  tryFullscreen();
  show('menu', false); show('help', false); show('end', false); show('pause', false); show('hud', true);
  G.mode = 'play';
  resetGame();
}
function tryFullscreen() {
  const coarse = matchMedia('(pointer:coarse)').matches;
  if (!coarse) return;
  const el = document.documentElement;
  try {
    const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : (el.webkitRequestFullscreen && el.webkitRequestFullscreen());
    if (p && p.then) p.then(() => { try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => { }); } catch (e) { } }).catch(() => { });
  } catch (e) { }
}
function pauseGame() { if (G.mode !== 'play') return; G.mode = 'paused'; show('pause', true); input.keys = {}; P.attackHeld = false; }
function resumeGame() { if (G.mode !== 'paused') return; G.mode = 'play'; show('pause', false); clock.getDelta(); }
function toMenu() { G.mode = 'menu'; clearWorld(); show('pause', false); show('end', false); show('hud', false); show('menu', true); }
function fmtTime(s) { s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function endScreen(win) {
  G.mode = win ? 'win' : 'dead';
  $('end').classList.toggle('win', win);
  $('endTitle').textContent = win ? '突圍成功' : '你死了';
  $('endSub').textContent = win ? '融合巨獸已被擊倒，星璃殺出了一條血路。' : '屍潮吞噬了一切……';
  $('stTime').textContent = fmtTime(G.playTime); $('stKills').textContent = G.kills;
  $('stWave').textContent = G.phase === 'boss' ? `${MAX_WAVE}（首領）` : String(Math.max(1, G.wave));
  show('end', true); show('hud', false);
}
function victory() { Sfx.win(); endScreen(true); }

$('btnStart').addEventListener('click', startGame);
$('btnHelp').addEventListener('click', () => { show('help', true); });
$('btnHelpBack').addEventListener('click', () => show('help', false));
$('btnPause').addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); pauseGame(); });
$('btnResume').addEventListener('click', resumeGame);
$('btnRestart').addEventListener('click', () => { show('pause', false); G.mode = 'play'; resetGame(); });
$('btnToMenu').addEventListener('click', toMenu);
$('btnEndRestart').addEventListener('click', startGame);
$('btnEndMenu').addEventListener('click', toMenu);
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

// ---------------------------------------------------------------- main loop + adaptive resolution
const clock = new THREE.Clock();
let perfAcc = 0, perfFrames = 0, perfCheckT = 0;
function frame() {
  requestAnimationFrame(frame);
  let dt = Math.min(clock.getDelta(), 0.05);
  if (G.mode === 'menu') return;
  if (G.mode === 'paused') { renderer.render(scene, camera); return; }
  perfAcc += dt; perfFrames++; perfCheckT += dt;
  if (perfCheckT > 3) {
    const avg = perfAcc / perfFrames;
    if (avg > 1 / 40 && pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); onResize(); }
    else if (avg < 1 / 58 && pixelRatio < Math.min(window.devicePixelRatio || 1, MAX_PR)) { pixelRatio = Math.min(MAX_PR, pixelRatio + 0.25); renderer.setPixelRatio(pixelRatio); onResize(); }
    perfAcc = perfFrames = perfCheckT = 0;
  }
  if (hitStop > 0) { hitStop -= dt; dt *= 0.08; }
  G.time += dt;
  if (G.mode === 'play' || G.mode === 'dead' || G.mode === 'win') {
    if (G.mode === 'play' && P.state !== 'dead') G.playTime += dt;
    updatePlayer(dt);
    for (let i = zombies.length - 1; i >= 0; i--) if (zombies[i]) updateZombie(zombies[i], dt);
    separateZombies();
    updateProjectiles(dt);
    if (G.mode === 'play') updateWaves(dt);
    updateParts(dt);
    updateFx(dt);
    updateCamera(dt);
    updateHud(dt);
    if (G.mode === 'play' && P.state === 'dead' && P.t > 1.8) endScreen(false);
  }
  renderer.render(scene, camera);
}
// warm-up: compile shaders with representative objects so first spawn doesn't stutter
(function warm() {
  const tmp = [buildZombie('walker'), buildZombie('spitter'), buildBoss()];
  tmp.forEach((r, i) => { r.root.position.set(i * 3, 0, -5); scene.add(r.root); });
  camera.position.set(0, 2, 4); camera.lookAt(0, 1, 0);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  tmp.forEach(r => { scene.remove(r.root); r.mats.forEach(m => m.dispose()); });
})();
$('loading').classList.add('hidden');
frame();

// debug/test hook
window.__zb = { G, P, zombies, spawnZombie, spawnAtEdge, damagePlayer, damageZombie, killZombie, startWave, CAM, get pixelRatio() { return pixelRatio; } };
