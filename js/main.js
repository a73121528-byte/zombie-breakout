import * as THREE from 'three';
import { Sfx } from './audio.js?v=20261005c';
import { buildWorld } from './world.js?v=20261005c';
import { buildHeroine, buildZombie, buildBoss, buildGuns, getGlowTex, setCharDetail, applyCharBump, buildMachete, starGeo, glowSprite } from './characters.js?v=20261005c';
import { loadHeroGLB, buildRiggedHeroine, HERO_GLB } from './heroRig.js?v=20261005c';
import { WEAPONS, WEAPON_ORDER, PARTS, PART_KEYS, GUN_PART_KEYS, gunStats, meleeMul } from './weapons.js?v=20261005c';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const lerpAng = (a, b, t) => a + angDiff(a, b) * t;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const vibrate = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { } };
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

// ---------------------------------------------------------------- graphics quality
const QUALITY = {
  low: { label: '低', prCap: 1.0, prMin: 0.6, shadow: 0, embers: 0, fog: 0, parts: 0.55, lamps: 0, fires: 1, grain: false, detail: 22, far: 52 },
  mid: { label: '中', prCap: 1.35, prMin: 0.7, shadow: 512, embers: 70, fog: 4, parts: 0.8, lamps: 1, fires: 2, grain: true, detail: 34, far: 66 },
  high: { label: '高', prCap: 2.0, prMin: 0.8, shadow: 1024, embers: 140, fog: 8, parts: 1, lamps: 2, fires: 3, grain: true, detail: 48, far: 85 },
};
let qSetting = 'auto';
try { qSetting = localStorage.getItem('zb_quality') || 'auto'; } catch (e) { }
if (qSetting !== 'auto' && !QUALITY[qSetting]) qSetting = 'auto';
function detectQuality(gl) {
  const ua = navigator.userAgent || '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || matchMedia('(pointer:coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 4;
  let gpu = '';
  try { const ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) { }
  if (/SwiftShader|llvmpipe|Software|Mali-4|Mali-T[67]|Adreno \(TM\) [345]\d\d|PowerVR SGX/i.test(gpu)) return 'low';
  if (!mobile) return cores >= 4 ? 'high' : 'mid';
  if (cores <= 4 || mem <= 3) return 'low';
  if (/Adreno \(TM\) (7[3-9]\d|8\d\d)|Apple GPU|Mali-G7[1-9]|Mali-G[0-9]{3}|Immortalis/i.test(gpu) && mem >= 6) return 'high';
  return 'mid';
}

// ---------------------------------------------------------------- renderer
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const AUTO_Q = detectQuality(renderer.getContext());
let Q = QUALITY[qSetting === 'auto' ? AUTO_Q : qSetting] || QUALITY.mid;
let pixelRatio = Math.min(window.devicePixelRatio || 1, Q.prCap);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.PCFShadowMap;
const FOG = 0x15131b;
const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.FogExp2(FOG, 0.046);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 80);

scene.add(new THREE.HemisphereLight(0x6e6890, 0x2c2226, 1.8));
const moon = new THREE.DirectionalLight(0xa49ad0, 1.5); moon.position.set(-20, 30, 10); scene.add(moon); scene.add(moon.target);
moon.shadow.camera.left = -13; moon.shadow.camera.right = 13; moon.shadow.camera.top = 13; moon.shadow.camera.bottom = -13;
moon.shadow.camera.near = 1; moon.shadow.camera.far = 70; moon.shadow.bias = -0.0012; moon.shadow.normalBias = 0.03;
const rimLight = new THREE.DirectionalLight(0x7a88d8, 1.3); scene.add(rimLight); scene.add(rimLight.target); // cool moonlight rim from behind the subjects
const W = buildWorld(scene);
const BOUND = W.bounds;
const bossLight = new THREE.PointLight(0xffc040, 0, 10, 1.6); bossLight.position.set(0, -50, 0); scene.add(bossLight);
const fillLight = new THREE.PointLight(0x9a8cc0, 9, 18, 1.2); scene.add(fillLight);
const muzzleLight = new THREE.PointLight(0xffb060, 0, 9, 1.5); muzzleLight.position.set(0, -50, 0); scene.add(muzzleLight);

function onResize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1.3 ? 70 : 62;
  camera.updateProjectionMatrix();
}
addEventListener('resize', onResize); onResize();

// ---------------------------------------------------------------- collision helpers
const resolveCircle = (p, r) => W.resolveCircle(p, r);
const insideCollider = (x, z, pad = 0) => W.inside(x, z, pad);
// ray vs oriented-box colliders (with height). minH: ignore colliders lower than this
const rayCast = (o, d, len, minH = 1.2) => W.rayCast(o, d, len, minH);
// pooled dynamic lights, re-assigned to the nearest fires / street lamps
const fireLights = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xff7a30, 0, 16, 1.6); l.position.set(0, -50, 0); scene.add(l); return l; });
const lampLights = [0, 1].map(() => { const l = new THREE.PointLight(0xffb878, 0, 13, 1.5); l.position.set(0, -50, 0); scene.add(l); return l; });
function assignLights() {
  const px = P.pos.x, pz = P.pos.z;
  const byD = (a, b) => ((a.x - px) ** 2 + (a.z - pz) ** 2) - ((b.x - px) ** 2 + (b.z - pz) ** 2);
  W.fires.forEach(f => f.light = null); W.lamps.forEach(l => l.light = null);
  const fs = W.fires.slice().sort(byD); fireLights.forEach((L, i) => { const f = fs[i]; if (!f) { L.intensity = 0; return; } f.light = L; L.position.set(f.x, (f.y || 0.9) + (f.big ? 1.4 : 0.9), f.z); L.distance = f.big ? 20 : 16; });
  const ls = W.lamps.filter(l => l.mode !== 'dead').sort(byD); lampLights.forEach((L, i) => { const l = ls[i]; if (!l) { L.intensity = 0; return; } l.light = L; L.position.set(l.x, 4.4, l.z); });
}

// ---------------------------------------------------------------- player
let hero = buildHeroine(); // v0.4 procedural heroine; replaced by the rigged GLB once loaded (fallback if it fails)
scene.add(hero.root);
const guns = buildGuns();
for (const k in guns) hero.gunMount.add(guns[k].g);
const blobGeo = new THREE.CircleGeometry(1, 16); blobGeo.rotateX(-Math.PI / 2);
const blobTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,.85)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity: 0.6, depthWrite: false });
const heroBlob = new THREE.Mesh(blobGeo, blobMat); heroBlob.scale.setScalar(0.5); heroBlob.position.y = 0.025; scene.add(heroBlob);

const P = {
  pos: new THREE.Vector3(), facing: Math.PI, hp: 100, maxHp: 100, st: 100, maxSt: 100, stDelay: 0,
  state: 'move', t: 0, combo: 0, comboWin: 0, queued: false, hitDone: 0, invuln: 0, skillCd: 0,
  gy: 0, lean: 0, dodgeDir: new THREE.Vector3(), kb: new THREE.Vector3(), runPhase: 0, run: 0, lock: null, attackHeld: false, attackHoldT: 0,
};
const SKILL_CD = 8, DODGE_COST = 25;
const ATK = [
  { dur: 0.42, hit: 0.15, dmg: 18, range: 2.5, arc: 1.25, knock: 3.5, lunge: 3.0 },
  { dur: 0.42, hit: 0.15, dmg: 20, range: 2.5, arc: 1.25, knock: 3.5, lunge: 3.0 },
  { dur: 0.62, hit: 0.27, dmg: 36, range: 2.9, arc: 1.0, knock: 7.5, lunge: 5.0 },
];
// weapon inventory
const INV = {
  owned: {}, cur: 'machete', ammo: {}, parts: {}, reloading: false, reloadT: 0, reloadMax: 1, fireCd: 0, aimT: 0, recoil: 0, camKick: 0, collected: 0, emptyWarn: 0,
};
function resetInventory() {
  INV.owned = { machete: true }; INV.cur = 'machete'; INV.ammo = {}; INV.parts = {}; INV.collected = 0;
  for (const k of WEAPON_ORDER) INV.parts[k] = {};
  INV.reloading = false; INV.fireCd = 0; INV.aimT = 0; INV.recoil = 0;
  refreshWeaponVisuals();
}
const isGun = id => WEAPONS[id].kind === 'gun';
function refreshWeaponVisuals() {
  const cur = INV.cur, gunOut = isGun(cur) && P.state !== 'skill';
  hero.weapon.visible = !gunOut; hero.holster.visible = gunOut;
  for (const k in guns) {
    const g = guns[k]; g.g.visible = gunOut && k === cur;
    const p = INV.parts[k] || {};
    g.A.extMag.visible = !!p.extMag; g.A.scope.visible = !!p.scope; g.A.suppressor.visible = !!p.suppressor;
    g.A.stabilizer.visible = !!p.stabilizer; g.A.ap.visible = !!p.apAmmo; g.A.speed.visible = !!p.speedLoader;
    g.muzzle.position.z = g.baseMuzzle + (p.suppressor ? g.supLen : 0);
    if (g.mag) g.mag.visible = !p.extMag;
  }
}

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
const teleMat = new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const teleGeo = new THREE.CircleGeometry(1, 40); teleGeo.rotateX(-Math.PI / 2);
const tele = new THREE.Mesh(teleGeo, teleMat); tele.position.y = 0.06; scene.add(tele);
const lockRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
lockRing.visible = false; scene.add(lockRing);

// ---- instanced particles: one draw call for opaque bits, one for additive glow
const PMAX = 360;
const PART_GEO = new THREE.BoxGeometry(1, 1, 1);
const pMeshN = new THREE.InstancedMesh(PART_GEO, new THREE.MeshBasicMaterial({ color: 0xffffff }), PMAX);
const pMeshA = new THREE.InstancedMesh(PART_GEO, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), PMAX);
const _c3 = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
for (const m of [pMeshN, pMeshA]) { m.frustumCulled = false; for (let i = 0; i < PMAX; i++) { m.setMatrixAt(i, ZERO); m.setColorAt(i, new THREE.Color(1, 1, 1)); } m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); fxGroup.add(m); }
const PKIND = {
  blood: { add: false, cols: [0x7a0a10, 0x5a060a, 0x9a1018], g: 14, stretch: 1 },
  dust: { add: false, cols: [0x3a3840, 0x4a464e], g: 10, stretch: 1 },
  brass: { add: false, cols: [0xd0a040], g: 14, stretch: 1, bounce: true },
  spark: { add: true, cols: [0xffd060, 0xffb040, 0xfff0b0], g: 9, stretch: 5 },
  acid: { add: true, cols: [0x7aff3a, 0x50d020], g: 12, stretch: 1 },
  ember: { add: true, cols: [0xff7a30, 0xffa050], g: -0.5, stretch: 1 },
};
const parts = { N: [], A: [] };
for (const k of ['N', 'A']) for (let i = 0; i < PMAX; i++) parts[k].push({ i, life: 0, max: 1, s: 0.1, pos: new THREE.Vector3(), v: new THREE.Vector3(), rot: new THREE.Euler(), kind: null, col: new THREE.Color() });
const pIdx = { N: 0, A: 0 }, pDirty = { N: false, A: false };
const _pm = new THREE.Matrix4(), _pq = new THREE.Quaternion(), _ps = new THREE.Vector3(), _pz = new THREE.Vector3(0, 0, 1), _pd = new THREE.Vector3();
function burst(pos, n, kind = 'blood', speed = 4, size = 0.09, up = 3, dir = null) {
  const K = PKIND[kind], key = K.add ? 'A' : 'N', mesh = K.add ? pMeshA : pMeshN;
  n = Math.max(1, Math.round(n * Q.parts));
  for (let i = 0; i < n; i++) {
    const p = parts[key][pIdx[key]++ % PMAX];
    p.kind = K; p.pos.copy(pos);
    p.v.set((Math.random() - .5) * speed, Math.random() * up + (kind === 'spark' ? 0.5 : 1), (Math.random() - .5) * speed);
    if (dir) p.v.addScaledVector(dir, speed * (0.5 + Math.random()));
    p.life = p.max = (kind === 'spark' ? 0.18 : 0.45) + Math.random() * (kind === 'spark' ? 0.2 : 0.4); p.s = size * (0.6 + Math.random() * 0.8);
    p.rot.set(Math.random() * 3, Math.random() * 3, 0);
    p.col.setHex(K.cols[(Math.random() * K.cols.length) | 0]);
    mesh.setColorAt(p.i, p.col); mesh.instanceColor.needsUpdate = true;
  }
}
function updateParts(dt) {
  for (const key of ['N', 'A']) {
    const mesh = key === 'A' ? pMeshA : pMeshN; let any = false;
    for (const p of parts[key]) {
      if (p.life <= 0) continue;
      p.life -= dt; any = true;
      if (p.life <= 0) { mesh.setMatrixAt(p.i, ZERO); continue; }
      const K = p.kind;
      p.v.y -= K.g * dt; p.pos.addScaledVector(p.v, dt);
      if (p.pos.y < 0.03) { p.pos.y = 0.03; if (K.bounce && Math.abs(p.v.y) > 1) { p.v.y *= -0.35; p.v.x *= 0.5; p.v.z *= 0.5; } else p.v.set(0, 0, 0); }
      const f = Math.min(1, p.life / p.max * 2), s = p.s * f;
      if (K.stretch > 1) {
        const sp = p.v.length(); _pd.copy(p.v).divideScalar(sp || 1); _pq.setFromUnitVectors(_pz, _pd);
        _ps.set(s * 0.35, s * 0.35, s * Math.min(K.stretch, 1 + sp * 0.4));
      } else { _pq.setFromEuler(p.rot); _ps.set(s, s, s); }
      if (K.add) mesh.setColorAt(p.i, _c3.copy(p.col).multiplyScalar(f));
      _pm.compose(p.pos, _pq, _ps); mesh.setMatrixAt(p.i, _pm);
    }
    if (any) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
  }
}

// ---- blood decals (instanced, splatter texture)
const DMAX = 48;
const decalGeo = new THREE.PlaneGeometry(2, 2); decalGeo.rotateX(-Math.PI / 2);
const decalMesh = new THREE.InstancedMesh(decalGeo, new THREE.MeshBasicMaterial({ map: W.splat, color: 0x4a060a, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }), DMAX);
decalMesh.frustumCulled = false; for (let i = 0; i < DMAX; i++) decalMesh.setMatrixAt(i, ZERO); fxGroup.add(decalMesh);
let decalIdx = 0;
function addDecal(x, z, s) {
  _pq.setFromAxisAngle(_v3.set(0, 1, 0), Math.random() * TAU);
  _ps.set(s * (0.7 + Math.random() * .5), 1, s * (0.7 + Math.random() * .5));
  _pm.compose(_v3.set(x, 0.035 + (decalIdx % 7) * 0.0015, z), _pq, _ps);
  decalMesh.setMatrixAt(decalIdx++ % DMAX, _pm); decalMesh.instanceMatrix.needsUpdate = true;
}
const _v3 = new THREE.Vector3();

// ---- bullet tracers (instanced additive streaks that travel)
const TMAX = 40;
const tracerGeo = new THREE.BoxGeometry(1, 1, 1); tracerGeo.translate(0, 0, -0.5);
const tracerMesh = new THREE.InstancedMesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), TMAX);
tracerMesh.frustumCulled = false; for (let i = 0; i < TMAX; i++) { tracerMesh.setMatrixAt(i, ZERO); tracerMesh.setColorAt(i, new THREE.Color(1, 0.8, 0.4)); } fxGroup.add(tracerMesh);
const tracers = []; for (let i = 0; i < TMAX; i++) tracers.push({ i, life: 0, a: new THREE.Vector3(), b: new THREE.Vector3(), len: 0, head: 0, col: new THREE.Color() });
let tIdx = 0;
function addTracer(a, b, color = 0xffc070) {
  const t = tracers[tIdx++ % TMAX]; t.a.copy(a); t.b.copy(b); t.len = a.distanceTo(b); t.head = 0; t.life = 1; t.col.setHex(color);
}
function updateTracers(dt) {
  let any = false;
  for (const t of tracers) {
    if (t.life <= 0) continue; any = true;
    t.head += dt * 160;
    const tail = Math.max(0, t.head - 5);
    if (tail >= t.len) { t.life = 0; tracerMesh.setMatrixAt(t.i, ZERO); continue; }
    const h = Math.min(t.head, t.len);
    _pd.subVectors(t.b, t.a).divideScalar(t.len || 1);
    _v3.copy(t.a).addScaledVector(_pd, h);
    _pq.setFromUnitVectors(_pz, _pd);
    _ps.set(0.045, 0.045, Math.max(0.05, h - tail));
    _pm.compose(_v3, _pq, _ps); tracerMesh.setMatrixAt(t.i, _pm);
    tracerMesh.setColorAt(t.i, t.col);
  }
  if (any) { tracerMesh.instanceMatrix.needsUpdate = true; tracerMesh.instanceColor.needsUpdate = true; }
}

// ---- muzzle flash
const flashTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.3, 'rgba(255,200,90,.8)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = gr; g.translate(32, 32);
  for (let i = 0; i < 7; i++) { g.rotate(TAU / 7); g.beginPath(); g.moveTo(-4, 0); g.lineTo(0, -30 - Math.random() * 2); g.lineTo(4, 0); g.fill(); }
  g.beginPath(); g.arc(0, 0, 13, 0, TAU); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const flashMat = new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
const muzzleFlash = new THREE.Group();
{ const pg = new THREE.PlaneGeometry(1, 1); for (let i = 0; i < 2; i++) { const m = new THREE.Mesh(pg, flashMat); m.rotation.z = i * Math.PI / 2; m.rotation.y = Math.PI / 2; m.position.z = 0.3; m.scale.set(0.65, 0.32, 1); muzzleFlash.add(m); } const f = new THREE.Mesh(pg, flashMat); f.scale.setScalar(0.45); muzzleFlash.add(f); muzzleFlash.userData.front = f; }
muzzleFlash.visible = false; scene.add(muzzleFlash);
let flashT = 0;

// ---- floating embers / ash (Points)
const EMAX = 140;
const emberGeo = new THREE.BufferGeometry();
const emberPos = new Float32Array(EMAX * 3), emberVel = new Float32Array(EMAX * 3);
for (let i = 0; i < EMAX; i++) { emberPos[i * 3] = (Math.random() - .5) * 30; emberPos[i * 3 + 1] = Math.random() * 8; emberPos[i * 3 + 2] = (Math.random() - .5) * 30; emberVel[i * 3] = (Math.random() - .5) * 0.4; emberVel[i * 3 + 1] = 0.2 + Math.random() * 0.5; emberVel[i * 3 + 2] = (Math.random() - .5) * 0.4; }
emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
const embers = new THREE.Points(emberGeo, new THREE.PointsMaterial({ color: 0xff8a40, size: 0.07, map: getGlowTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
embers.frustumCulled = false; scene.add(embers);

// ---- drifting ground fog sheets
const fogTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  for (let i = 0; i < 30; i++) { const x = 20 + Math.random() * 88, y = 20 + Math.random() * 88, r = 14 + Math.random() * 26; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
  return new THREE.CanvasTexture(c);
})();
const fogSheets = [];
{ const fg = new THREE.PlaneGeometry(14, 14); fg.rotateX(-Math.PI / 2);
  for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ map: fogTex, color: 0x8a82a8, transparent: true, opacity: 0.32, depthWrite: false })); m.position.set((Math.random() - .5) * 30, 0.25 + (i % 3) * 0.3, (Math.random() - .5) * 30); m.rotation.y = Math.random() * TAU; m.renderOrder = 1; scene.add(m); fogSheets.push({ m, vx: (Math.random() - .5) * 0.5, vz: (Math.random() - .5) * 0.5 }); } }

// health orbs
const orbGeo = new THREE.OctahedronGeometry(0.22, 0);
const orbMat = new THREE.MeshBasicMaterial({ color: 0xff2840 });
const orbs = [];
function dropOrb(x, z) { const m = new THREE.Mesh(orbGeo, orbMat); m.position.set(x, 0.6, z); scene.add(m); orbs.push({ m, t: 0 }); }

// ---- ammo + part pickups
const pickups = [];
const ammoBoxGeo = new THREE.BoxGeometry(0.34, 0.2, 0.22), ammoBandGeo = new THREE.BoxGeometry(0.35, 0.05, 0.225);
const ammoMat = new THREE.MeshLambertMaterial({ color: 0x4a5230, emissive: 0x141808 }), ammoBandMat = new THREE.MeshBasicMaterial({ color: 0xffc840 });
const partCoreGeo = new THREE.OctahedronGeometry(0.15, 0), partRingGeo = new THREE.TorusGeometry(0.22, 0.03, 4, 16);
const beamGeo = new THREE.CylinderGeometry(0.05, 0.12, 2.6, 8, 1, true); beamGeo.translate(0, 1.3, 0);
function dropPickup(kind, x, z, key = null) {
  const g = new THREE.Group(); g.position.set(x, 0.45, z);
  let color;
  if (kind === 'ammo') {
    g.add(new THREE.Mesh(ammoBoxGeo, ammoMat)); g.add(new THREE.Mesh(ammoBandGeo, ammoBandMat)); color = 0xffc840;
  } else {
    color = new THREE.Color(PARTS[key].color).getHex();
    const cm = new THREE.MeshBasicMaterial({ color }); g.add(new THREE.Mesh(partCoreGeo, cm));
    const ring = new THREE.Mesh(partRingGeo, new THREE.MeshBasicMaterial({ color: 0xe0e0e0 })); ring.rotation.x = Math.PI / 2; g.add(ring); g.userData.ring = ring;
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTex(), color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.setScalar(kind === 'ammo' ? 0.9 : 1.2); g.add(glow);
  const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.set(x, 0, z); scene.add(beam);
  scene.add(g);
  pickups.push({ kind, key, g, beam, t: 0, life: kind === 'ammo' ? 35 : 60, x, z });
}
function removePickup(i) { const p = pickups[i]; scene.remove(p.g); scene.remove(p.beam); p.g.traverse(o => o.material && o.material.dispose()); p.beam.material.dispose(); pickups.splice(i, 1); }

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
const toastsEl = $('toasts');
function toast(title, sub = '', color = '#ffd84a', icon = '✚') {
  while (toastsEl.childElementCount >= 3) toastsEl.firstElementChild.remove();
  const el = document.createElement('div'); el.className = 'toast';
  el.style.setProperty('--tc', color);
  el.innerHTML = `<i>${icon}</i><div><b></b><small></small></div>`;
  el.querySelector('b').textContent = title; el.querySelector('small').textContent = sub;
  toastsEl.appendChild(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3100);
}

// ---------------------------------------------------------------- zombies
const ZCFG = {
  walker: { hp: 45, walk: 0.9, chase: 2.0, dmg: 9, range: 1.5, detect: 16, r: 0.42, scale: 1.0, wind: 0.55, rec: 0.65, knockRes: 1, pitch: 1, h: 1.75 },
  runner: { hp: 28, walk: 1.6, chase: 4.8, dmg: 7, range: 1.4, detect: 24, r: 0.38, scale: 0.97, wind: 0.32, rec: 0.55, knockRes: 1.1, pitch: 1.4, h: 1.7 },
  brute: { hp: 210, walk: 0.8, chase: 1.6, dmg: 24, range: 2.4, detect: 18, r: 0.8, scale: 1.55, wind: 0.9, rec: 0.9, knockRes: 0.25, pitch: 0.6, h: 1.8 },
  spitter: { hp: 38, walk: 1.0, chase: 2.1, dmg: 10, range: 12, detect: 22, r: 0.42, scale: 1.0, wind: 0.6, rec: 0.6, knockRes: 1, pitch: 1.2, prefer: 8, h: 1.75 },
  armored: { hp: 110, walk: 0.8, chase: 1.75, dmg: 14, range: 1.6, detect: 18, r: 0.46, scale: 1.03, wind: 0.6, rec: 0.7, knockRes: 0.45, pitch: 0.8, h: 1.8 },
  boss: { hp: 1800, walk: 1.5, chase: 2.3, dmg: 26, range: 4.2, detect: 99, r: 1.85, scale: 1.18, wind: 0.85, rec: 0.9, knockRes: 0.03, pitch: 0.4, h: 5.0 },
};
const ZNAME = { walker: '行屍', runner: '疾行者', brute: '巨屍', spitter: '噴吐者', armored: '裝甲屍', boss: '融合巨獸' };
const zombies = [];
function applyShadowFlags(root) { root.traverse(o => { if (o.isMesh) o.castShadow = !!o.userData.cast && Q.shadow > 0; }); }
function spawnZombie(type, x, z) {
  const cfg = ZCFG[type];
  const rig = type === 'boss' ? buildBoss() : buildZombie(type);
  rig.root.scale.setScalar(cfg.scale);
  applyShadowFlags(rig.root);
  const blob = new THREE.Mesh(blobGeo, blobMat); blob.scale.setScalar(cfg.r * 1.4); blob.position.y = 0.022; scene.add(blob);
  const lift = new THREE.Group(); lift.add(rig.root); scene.add(lift);
  const hpMul = type === 'boss' ? 1 : 1 + Math.max(0, G.wave - 1) * 0.08;
  const z0 = {
    type, cfg, rig, blob, lift, gy: 0, hitK: 0, hitSide: 0, deadFwd: Math.random() < 0.55 ? 1 : -1, pos: new THREE.Vector3(x, 0, z), vel: new THREE.Vector3(), facing: Math.random() * TAU,
    hp: cfg.hp * hpMul, maxHp: cfg.hp * hpMul, state: 'rise', t: 0, hitDone: false, atkCd: 0.5 + Math.random(), spitCd: 1.5 + Math.random() * 2,
    wander: new THREE.Vector3(x, 0, z), aggroT: 1 + Math.random() * 3, groanT: 2 + Math.random() * 6, phase: Math.random() * 10,
    showHp: 0, flash: 0, alive: true, isBoss: type === 'boss', attack: 'melee', slamCd: 6, volleyCd: 4, summonCd: 14, speedNow: 0,
    armVar: Math.random() < 0.4, twitch: 0, twitchT: 0, deadSide: (Math.random() - 0.5) * 0.6,
  };
  z0.baseEm = rig.mats.map(m => m.emissive ? m.emissive.getHex() : null);
  rig.root.position.copy(z0.pos); rig.root.position.y = -2;
  zombies.push(z0);
  return z0;
}
function setFlash(z, on) {
  z.rig.mats.forEach((m, i) => { if (m.emissive) m.emissive.setHex(on ? 0x5a1010 : z.baseEm[i]); });
}
function removeZombie(z) {
  scene.remove(z.lift); scene.remove(z.blob);
  z.rig.mats.forEach(m => m.dispose());
  const i = zombies.indexOf(z); if (i >= 0) zombies.splice(i, 1);
}
function damageZombie(z, dmg, dirX, dirZ, knock, opts = {}) {
  if (!z.alive) return;
  let crit = false, weak = false, blocked = false;
  const toP = Math.atan2(P.pos.x - z.pos.x, P.pos.z - z.pos.z);
  const front = Math.abs(angDiff(z.facing, toP)) < 0.95;
  if (z.isBoss) { if (front) { weak = true; dmg *= 2.2; } if (opts.gun && opts.ap) dmg *= 1 + 0.15 * opts.ap; }
  else if (Math.random() < (opts.crit != null ? opts.crit : 0.12)) { crit = true; dmg *= opts.gun ? 2 : 1.6; }
  if (z.type === 'armored') {
    const guarding = front && z.state !== 'hurt' && z.state !== 'rise';
    const back = Math.abs(angDiff(z.facing, toP)) > 2.2;
    if (back) { weak = true; dmg *= 1.35; }
    else if (opts.gun) { if (opts.ap) dmg *= 1 + 0.25 * opts.ap; else { dmg *= guarding ? 0.3 : 0.65; blocked = guarding; } }
    else if (guarding && !opts.heavy) { dmg *= 0.5; blocked = true; }
  } else if (z.type === 'brute' && opts.gun && opts.ap) dmg *= 1 + 0.2 * opts.ap;
  dmg = Math.max(1, Math.round(dmg * (0.9 + Math.random() * 0.2)));
  z.hp -= dmg; z.showHp = 4; z.flash = 0.08; setFlash(z, true);
  z.hitK = Math.min(1.3, z.hitK + (blocked ? 0.35 : opts.gun ? 0.6 : 1)) * (z.isBoss ? 0.5 : 1); z.hitSide = Math.sign(angDiff(z.facing, toP)) || 1;
  const hpos = new THREE.Vector3(z.pos.x, (z.isBoss ? 3.2 : 1.5 * z.cfg.scale), z.pos.z);
  floatText(hpos, weak ? `弱點 ${dmg}` : blocked ? `格擋 ${dmg}` : String(dmg), weak || crit ? 'crit' : blocked ? 'block' : (dmg >= 30 ? 'heavy' : ''));
  const fxPos = opts.at || hpos.setY(z.isBoss ? 2.8 : 1.2 * z.cfg.scale);
  if (blocked) { burst(fxPos, 7, 'spark', 5, 0.06, 2); if (Math.random() < 0.6) Sfx.clank(); }
  else burst(fxPos, weak ? 10 : opts.gun ? 4 : 7, weak ? 'spark' : 'blood', opts.gun ? 3 : 5, opts.gun ? 0.06 : 0.09, 2, opts.dir || null);
  if (!opts.gun) { Sfx.hit(dmg >= 30); vibrate(12); hitStop = Math.max(hitStop, dmg >= 30 ? 0.07 : 0.035); shake = Math.max(shake, dmg >= 30 ? 0.25 : 0.12); }
  else { if (opts.heavyGun) hitStop = Math.max(hitStop, 0.02); if (Math.random() < 0.25) addDecal(z.pos.x + (Math.random() - .5), z.pos.z + (Math.random() - .5), 0.25 + Math.random() * 0.2); }
  if (z.hp <= 0) { killZombie(z); return; }
  if (!z.isBoss) {
    const k = knock * z.cfg.knockRes * (blocked ? 0.4 : 1);
    z.vel.set(dirX * k, 0, dirZ * k);
    if ((z.cfg.knockRes > 0.5 && !blocked) || knock > 6) { z.state = 'hurt'; z.t = 0; }
    z.aggroT = 0;
    if (z.state === 'wander') { z.state = 'chase'; z.t = 0; }
  }
}
function killZombie(z) {
  z.alive = false; z.state = 'dead'; z.t = 0; z.hp = 0;
  G.kills++;
  z.rig.glows.forEach(g => g.visible = false);
  addDecal(z.pos.x, z.pos.z, z.cfg.r * 2.0);
  burst(new THREE.Vector3(z.pos.x, 1, z.pos.z), 14, 'blood', 6, 0.11);
  Sfx.groan(z.cfg.pitch * 0.8, 0.25);
  if (P.lock === z) P.lock = null, pickLock(true);
  if (z.isBoss) { Sfx.roar(); setTimeout(() => G.mode === 'play' && victory(), 2600); G.bossDead = true; }
  else if (Math.random() < (P.hp < 40 ? 0.25 : 0.1)) dropOrb(z.pos.x, z.pos.z);
  rollDrops(z);
}
function rollDrops(z) {
  const elite = z.type === 'brute' || z.type === 'armored' || z.type === 'spitter';
  const hasGun = WEAPON_ORDER.some(k => INV.owned[k] && isGun(k) && isFinite(INV.ammo[k].res));
  const off = () => (Math.random() - .5) * 1.2;
  if (hasGun && Math.random() < (z.isBoss ? 1 : elite ? 0.7 : 0.35)) dropPickup('ammo', z.pos.x + off(), z.pos.z + off());
  G.partPity++;
  let nParts = 0;
  if (z.isBoss) nParts = 2;
  else if (Math.random() < (elite ? 0.45 : z.type === 'runner' ? 0.1 : 0.07) || G.partPity >= 6) nParts = 1;
  for (let i = 0; i < nParts; i++) { const key = choosePart(); if (key) { dropPickup('part', z.pos.x + off(), z.pos.z + off(), key); G.partPity = 0; } }
}
function choosePart() {
  const ownedGuns = WEAPON_ORDER.filter(k => INV.owned[k] && isGun(k));
  const cand = [];
  for (const k of PART_KEYS) {
    const d = PARTS[k];
    if (d.guns) { if (ownedGuns.some(g => (INV.parts[g][k] || 0) < d.max)) cand.push(k); }
    else if ((INV.parts.machete[k] || 0) < d.max) cand.push(k);
  }
  if (!cand.length) return null;
  return cand[(Math.random() * cand.length) | 0];
}
function equipPart(key) {
  const d = PARTS[key];
  let target = 'machete';
  if (d.guns) {
    const ownedGuns = WEAPON_ORDER.filter(k => INV.owned[k] && isGun(k) && (INV.parts[k][key] || 0) < d.max);
    if (!ownedGuns.length) { giveAmmo(); return; }
    // current gun first if it has the lowest level among candidates, else the lowest level gun
    ownedGuns.sort((a, b) => (INV.parts[a][key] || 0) - (INV.parts[b][key] || 0) || (b === INV.cur) - (a === INV.cur));
    target = ownedGuns[0];
  }
  const lv = (INV.parts[target][key] || 0) + 1;
  INV.parts[target][key] = lv; INV.collected++;
  refreshWeaponVisuals();
  toast(`獲得零件：${d.name}`, `已裝上 ${WEAPONS[target].name} · Lv${lv} · ${d.desc(lv)}`, d.color, d.icon);
  Sfx.part(); vibrate(20);
  lastHud = {};
}
function giveAmmo() {
  let any = false;
  for (const k of WEAPON_ORDER) if (INV.owned[k] && isGun(k) && isFinite(INV.ammo[k].res)) { INV.ammo[k].res += WEAPONS[k].ammoPick; any = true; }
  if (any) { floatText(new THREE.Vector3(P.pos.x, 2.1, P.pos.z), '+彈藥', 'ammo'); Sfx.pickup(); }
  lastHud = {};
}

function animZombie(z, dt) {
  const R = z.rig, cfg = z.cfg, T = z.type;
  const sp = z.speedNow;
  z.phase += dt * (2 + sp * (z.isBoss ? 1.6 : T === 'runner' ? 2.3 : T === 'brute' ? 2.0 : 2.6));
  const ph = z.phase;
  if (z.state === 'dead') return;
  const moving = sp > 0.1;
  const swing = clamp(sp / 2, 0.25, 1) * (T === 'runner' ? 1.2 : T === 'brute' ? 0.6 : 0.7);
  let legL = Math.sin(ph) * swing, legR = -Math.sin(ph) * swing;
  if ((T === 'walker' || T === 'spitter') && R.limp) { if (R.limp > 0) legL *= 0.5; else legR *= 0.5; }
  if (!moving) { legL *= 0.15; legR *= 0.15; }
  R.legL.rotation.x = legL; R.legR.rotation.x = legR;
  R.shinL.rotation.x = Math.max(0, -Math.sin(ph)) * swing * 1.3 + 0.05;
  R.shinR.rotation.x = Math.max(0, Math.sin(ph)) * swing * 1.3 + 0.05;
  const baseY = z.isBoss ? 2.1 : 0.92;
  const bounce = T === 'runner' ? 0.07 : T === 'brute' ? 0.06 : 0.04;
  const limpDip = R.limp && moving && !z.isBoss && T !== 'runner' ? Math.max(0, Math.sin(ph) * R.limp) * 0.06 : 0;
  R.body.position.y = baseY + Math.abs(Math.sin(ph)) * bounce * (z.isBoss ? 3 : 1) * (moving ? 1 : 0.3) - (T === 'brute' ? 0.03 : 0) - limpDip;
  z.hitK = Math.max(0, z.hitK - dt * 5);
  const hk = z.hitK > 0 ? Math.sin(Math.min(1, z.hitK) * Math.PI * 0.5) : 0;
  R.body.rotation.z = Math.sin(ph * 0.5) * (T === 'brute' ? 0.1 : 0.06) + (R.limp && T === 'walker' ? R.limp * 0.06 : 0);
  R.body.rotation.y = T === 'brute' ? Math.sin(ph) * 0.12 : 0;
  // idle arm poses by type
  let aLx = -1.35 + Math.sin(ph * 0.7) * 0.15, aRx = -1.25 + Math.cos(ph * 0.6) * 0.18, aLz = 0, aRz = 0, aLy = 0, aRy = 0;
  let foreL = -0.2, foreR = -0.2, torsoX = R.hunch, jaw = 0.2 + Math.sin(ph * 1.7) * 0.12;
  if (T === 'walker' && z.armVar) { aRx = -0.25 + Math.sin(ph) * 0.2 * swing; foreR = -0.1; }
  if (T === 'runner') { aLx = -0.4 - legL * 1.4; aRx = -0.4 - legR * 1.4; foreL = foreR = -1.0; aLz = 0.15; aRz = -0.15; torsoX = R.hunch + (moving ? 0.1 : -0.2); jaw = 0.45; }
  if (T === 'brute') { aLx = Math.sin(ph) * 0.4 - 0.25; aRx = -Math.sin(ph) * 0.4 - 0.25; aLz = 0.4; aRz = -0.4; foreL = foreR = -0.45; }
  if (T === 'spitter') { aLx = -0.35 + Math.sin(ph * 0.8) * 0.2; aRx = -0.3 - Math.sin(ph * 0.8) * 0.2; aLz = 0.15; aRz = -0.15; foreL = foreR = -0.3; }
  if (T === 'armored') { aLx = -1.2; aLy = -0.55; foreL = -0.75; aRx = -0.35 + Math.sin(ph) * 0.3 * swing; foreR = -0.5; }
  if (z.state === 'attack') {
    const w = cfg.wind;
    if (z.attack === 'spit') {
      const k = Math.min(1, z.t / w); torsoX = R.hunch - 0.5 * k; jaw = 0.2 + 0.6 * k; if (z.t > w) { torsoX = R.hunch + 0.5; jaw = 0.9; } aLx = aRx = -0.4;
      if (R.sac) R.sac.scale.setScalar(1 + (z.t < w ? k * 0.45 : 0));
    }
    else if (z.attack === 'slam') { const k = Math.min(1, z.t / 1.1); aLx = aRx = -2.9 * k; torsoX = R.hunch - 0.3 * k; if (z.t > 1.1) { aLx = aRx = -0.5; torsoX = R.hunch + 0.6; } }
    else if (T === 'armored') {
      if (z.t < w) { const k = z.t / w; aRx = lerp(-0.4, -2.7, k); foreR = -0.9 * k; torsoX = R.hunch - 0.15 * k; }
      else { const k = Math.min(1, (z.t - w) / 0.15); aRx = lerp(-2.7, -0.7, k); foreR = lerp(-0.9, -0.1, k); torsoX = R.hunch + 0.3 * k; }
    }
    else if (T === 'brute') {
      if (z.t < w) { const k = z.t / w; aLx = aRx = lerp(-0.3, -3.0, k); aLz = 0.2; aRz = -0.2; torsoX = R.hunch - 0.35 * k; }
      else { const k = Math.min(1, (z.t - w) / 0.12); aLx = aRx = lerp(-3.0, -0.4, k); torsoX = R.hunch + 0.55 * k; foreL = foreR = -0.2; }
    }
    else if (z.t < w) { const k = z.t / w; aLx = aRx = lerp(-1.3, -2.8, k); torsoX = R.hunch - 0.25 * k; jaw = 0.6; }
    else { const k = Math.min(1, (z.t - w) / 0.15); aLx = aRx = lerp(-2.8, -0.6, k); torsoX = R.hunch + 0.35 * k; foreL = foreR = -0.6 * k; jaw = 0.7; }
  } else if (z.state === 'hurt') { torsoX = R.hunch - 0.5 * Math.max(0, 1 - z.t / 0.35); }
  else if (z.state === 'rise') { torsoX = R.hunch + 0.6; aLx = -2.6; aRx = -2.4; }
  if (hk > 0) { torsoX -= hk * 0.55; aLx -= hk * 0.5; aRx -= hk * 0.35; aLz += hk * 0.3; aRz -= hk * 0.3; jaw = Math.max(jaw, 0.5 * hk); }
  if (T === 'walker' && z.twitch > 0.12) aRz -= z.twitch * 0.8; // spasm
  R.armL.rotation.set(aLx, aLy, aLz); R.armR.rotation.set(aRx, aRy, aRz);
  R.foreL.rotation.x = foreL; R.foreR.rotation.x = foreR;
  R.torso.rotation.x = lerp(R.torso.rotation.x, torsoX, damp(hk > 0 ? 40 : 18, dt));
  R.body.rotation.z += z.hitSide * hk * 0.18;
  // head: lolling for walkers, jerky twitch for runners
  z.twitchT -= dt; if (z.twitchT <= 0) { z.twitchT = 0.15 + Math.random() * (T === 'runner' ? 0.4 : 1.6); z.twitch = (Math.random() - 0.5) * (T === 'runner' ? 0.9 : 0.4); }
  R.head.rotation.z = lerp(R.head.rotation.z, Math.sin(ph * 0.33) * 0.22 + z.twitch + R.headTilt, damp(T === 'runner' ? 25 : 4, dt));
  R.head.rotation.x = Math.sin(ph * 0.5) * 0.1 - (T === 'runner' ? 0.35 : 0) - hk * 0.6;
  if (R.jaw) R.jaw.rotation.x = jaw;
  if (R.sacMat) { const pulse = 0.5 + 0.5 * Math.sin(G.time * 4 + z.phase); R.sacMat.emissiveIntensity = z.flash > 0 ? 1 : 0.7 + pulse * 0.6 + (z.state === 'attack' ? 0.8 : 0); if (R.sac && z.state !== 'attack') R.sac.scale.setScalar(1 + pulse * 0.08); }
  if (z.isBoss) {
    R.smallL.rotation.x = Math.sin(ph * 1.3) * 0.6; R.smallR.rotation.x = Math.cos(ph * 1.1) * 0.6;
    const hb = Math.pow(Math.max(0, Math.sin(G.time * 5.2)), 6), pulse = 0.85 + hb * 0.35 + Math.sin(G.time * 2.6) * 0.05; R.core.scale.setScalar(pulse);
    if (R.coreMat) R.coreMat.color.setRGB(1, 0.7 + 0.3 * hb, 0.2 + 0.4 * hb);
    if (R.veinMat) R.veinMat.color.setRGB(0.55 + 0.45 * hb, 0.25 + 0.4 * hb, 0.06 + 0.1 * hb);
    if (R.jaw) R.jaw.rotation.x = 0.15 + Math.max(0, Math.sin(ph * 0.4)) * 0.35 + (z.state === 'attack' ? 0.4 : 0);
  }
}
function zLOS(z) {
  z.losT = 0.3;
  const dx = P.pos.x - z.pos.x, dz = P.pos.z - z.pos.z, L = Math.hypot(dx, dz) || 1;
  _losO.set(z.pos.x, 0.6, z.pos.z); _losD.set(dx / L, 0, dz / L);
  z.los = W.rayCast(_losO, _losD, L, 0.4) >= L - 0.3;
  return z.los;
}
const _losO = new THREE.Vector3(), _losD = new THREE.Vector3();
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
        if (moveSpeed < 0) faceTo = toP;
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
      const RG = z.rig, base = z.isBoss ? 2.1 : 0.92, sc = base / 0.92, fwd = z.deadFwd;
      const kb = Math.min(1, z.t / 0.3), eb = kb * (2 - kb);                    // knees buckle
      const kf = clamp((z.t - 0.22) / 0.5, 0, 1), ef = kf * kf;                // then topple (accelerating)
      const bounce = kf >= 1 ? Math.max(0, Math.sin((z.t - 0.72) * 14)) * Math.exp(-(z.t - 0.72) * 8) * 0.12 : 0;
      RG.body.rotation.x = fwd * (Math.PI / 2 * 0.93 * ef - bounce);
      RG.body.rotation.z = z.deadSide * ef;
      RG.body.position.y = lerp(lerp(base, 0.62 * sc, eb), (fwd > 0 ? 0.2 : 0.24) * sc, ef);
      RG.shinL.rotation.x = lerp(RG.shinL.rotation.x, 1.4 * (1 - ef * 0.7), damp(12, dt)); RG.shinR.rotation.x = lerp(RG.shinR.rotation.x, 1.1 * (1 - ef * 0.5), damp(12, dt));
      RG.legL.rotation.x = lerp(RG.legL.rotation.x, -0.7 * eb * (1 - ef) + (fwd > 0 ? 0.1 : 0.4) * ef, damp(10, dt)); RG.legR.rotation.x = lerp(RG.legR.rotation.x, -0.4 * eb * (1 - ef) + 0.2 * ef, damp(10, dt));
      RG.torso.rotation.x = lerp(RG.torso.rotation.x, fwd > 0 ? 0.25 : -0.2, damp(6, dt));
      RG.head.rotation.x = lerp(RG.head.rotation.x, fwd > 0 ? -0.5 : 0.4, damp(6, dt)); RG.head.rotation.z = lerp(RG.head.rotation.z, z.deadSide * 1.6, damp(5, dt));
      RG.armL.rotation.x = lerp(RG.armL.rotation.x, fwd > 0 ? -2.8 : -0.4, damp(6, dt)); RG.armR.rotation.x = lerp(RG.armR.rotation.x, fwd > 0 ? -2.5 : 0.3, damp(5, dt));
      RG.armL.rotation.z = lerp(RG.armL.rotation.z, 0.6, damp(5, dt)); RG.armR.rotation.z = lerp(RG.armR.rotation.z, -0.5, damp(5, dt));
      if (RG.jaw) RG.jaw.rotation.x = lerp(RG.jaw.rotation.x, 0.7, damp(4, dt));
      if (kf >= 1 && !z.landed) { z.landed = true; burst(new THREE.Vector3(z.pos.x + Math.sin(z.facing) * fwd * 0.9 * sc, 0.15, z.pos.z + Math.cos(z.facing) * fwd * 0.9 * sc), z.isBoss ? 16 : 6, 'dust', 3, 0.15, 2); }
      if (z.t > 1.4) {
        const f = 1 - Math.min(1, (z.t - 1.4) / 1.0);
        if (!z.fading) { z.fading = true; z.rig.mats.forEach(m => { m.transparent = true; }); z.rig.root.traverse(o => { if (o.isMesh) o.castShadow = false; }); }
        z.rig.mats.forEach(m => m.opacity = f * (m.userData.op ?? 1));
        z.rig.root.position.y = -(1 - f) * 0.4;
        z.blob.visible = f > 0.3;
      }
      if (z.t > 2.5) { removeZombie(z); return; }
      break;
    }
  }
  if (z.state !== 'dead' && z.state !== 'rise') {
    // route around buildings/cars with the player-centred flow field when far or without line of sight
    if (z.state === 'chase' && moveSpeed > 0 && faceTo === toP && d > 2.2) {
      let useFlow = d > 7;
      if (!useFlow) { z.losT = (z.losT || 0) - dt; if (z.losT <= 0) zLOS(z); useFlow = !z.los; }
      if (useFlow) { const fd = W.flowDir(z.pos.x, z.pos.z); if (fd !== null) faceTo = fd; }
    }
    if (z.detourT > 0) { z.detourT -= dt; if (faceTo !== null && moveSpeed > 0) faceTo += z.detour * 1.25; }
    if (faceTo !== null) z.facing = lerpAng(z.facing, faceTo, damp(z.isBoss ? 3 : 7, dt));
    const px0 = z.pos.x, pz0 = z.pos.z;
    if (moveSpeed !== 0) {
      const dirA = moveSpeed < 0 ? toP : z.facing, s = Math.abs(moveSpeed) * (moveSpeed < 0 ? -1 : 1);
      z.pos.x += Math.sin(dirA) * s * dt; z.pos.z += Math.cos(dirA) * s * dt;
    }
    z.pos.addScaledVector(z.vel, dt); z.vel.multiplyScalar(Math.exp(-7 * dt));
    resolveCircle(z.pos, cfg.r);
    // simple unstuck steering: if we barely moved while trying to chase, slide around the obstacle
    if (moveSpeed > 0.5 && z.state === 'chase' && !z.isBoss) {
      const moved = Math.hypot(z.pos.x - px0, z.pos.z - pz0);
      z.stuckT = moved < moveSpeed * dt * 0.35 ? (z.stuckT || 0) + dt : Math.max(0, (z.stuckT || 0) - dt);
      if (z.stuckT > 0.4 && !(z.detourT > 0)) { z.detour = Math.random() < 0.5 ? 1 : -1; z.detourT = 1.4; z.stuckT = 0; }
    }
    const nd = Math.hypot(P.pos.x - z.pos.x, P.pos.z - z.pos.z), minD = cfg.r + 0.35;
    if (nd < minD && nd > 1e-4 && P.state !== 'dodge') { const push = (minD - nd); z.pos.x -= (P.pos.x - z.pos.x) / nd * push; z.pos.z -= (P.pos.z - z.pos.z) / nd * push; }
  }
  z.speedNow = lerp(z.speedNow, Math.abs(moveSpeed) + z.vel.length() * 0.3, damp(8, dt));
  z.groanT -= dt;
  if (z.groanT <= 0 && z.alive) { z.groanT = 4 + Math.random() * 8; if (d < 18) Sfx.groan(cfg.pitch, 0.12 * (1 - d / 20)); }
  z.rig.root.position.x = z.pos.x; z.rig.root.position.z = z.pos.z; z.rig.root.rotation.y = z.facing;
  z.blob.position.x = z.pos.x; z.blob.position.z = z.pos.z;
  const gyT = W.groundY(z.pos.x, z.pos.z); z.gy += (gyT - z.gy) * Math.min(1, dt * 12); z.lift.position.y = z.gy; z.blob.position.y = 0.022 + z.gy;
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
  if (isGun(INV.cur)) { tryFire(); return; }
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
  refreshWeaponVisuals();
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

function meleeHit(range, arc, dmg, knock, full = false, heavy = false) {
  const mm = meleeMul(INV.parts);
  range += mm.range; dmg *= mm.dmg;
  let hits = 0;
  for (const z of zombies) {
    if (!z.alive || z.state === 'rise') continue;
    const dx = z.pos.x - P.pos.x, dz = z.pos.z - P.pos.z, d = Math.hypot(dx, dz);
    if (d > range + z.cfg.r) continue;
    if (!full && Math.abs(angDiff(P.facing, Math.atan2(dx, dz))) > arc && d > z.cfg.r + 0.4) continue;
    const nx = d > 0 ? dx / d : 0, nz = d > 0 ? dz / d : 1;
    damageZombie(z, dmg, nx, nz, knock, { heavy }); hits++;
  }
  return hits;
}
function damagePlayer(dmg, fx, fz, src) {
  if (P.state === 'dead' || G.mode !== 'play') return;
  if (P.invuln > 0) { if (src !== 'puddle') floatText(new THREE.Vector3(P.pos.x, 1.9, P.pos.z), '閃避', 'heal'); return; }
  P.hp = Math.max(0, P.hp - dmg); P.hitN = (P.hitN || 0) + 1; // hitN: rigged heroine plays HitRecieve on every hit
  vignetteV = 1; shake = Math.max(shake, dmg > 15 ? 0.45 : 0.2);
  floatText(new THREE.Vector3(P.pos.x, 1.9, P.pos.z), '-' + dmg, 'me');
  // non-gory impact puff for the heroine
  burst(new THREE.Vector3(P.pos.x, 1.2, P.pos.z), 5, src === 'acid' || src === 'puddle' ? 'acid' : 'dust', 3, 0.07);
  Sfx.hurt(); vibrate(dmg > 15 ? [60, 30, 60] : 45);
  if (src !== 'puddle') {
    const dx = P.pos.x - fx, dz = P.pos.z - fz, d = Math.hypot(dx, dz) || 1;
    const k = dmg > 20 ? 9 : 4; P.kb.set(dx / d * k, 0, dz / d * k);
    if (dmg >= 9 && P.state !== 'skill') { P.state = 'hurt'; P.t = 0; }
  }
  if (P.hp <= 0) { P.state = 'dead'; P.t = 0; G.deadAt = G.time; P.lock = null; $('bLock').classList.remove('on'); }
}

// ---------------------------------------------------------------- guns
function camForwardYaw() { return Math.atan2(-Math.sin(CAM.yaw), -Math.cos(CAM.yaw)); }
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _hit = new THREE.Vector3(), _mz = new THREE.Vector3();
function hasLOS(z) {
  _o.set(P.pos.x, 1.3, P.pos.z); _d.set(z.pos.x - P.pos.x, 0, z.pos.z - P.pos.z); const L = _d.length(); _d.divideScalar(L || 1);
  return rayCast(_o, _d, L, 1.2) >= L - z.cfg.r;
}
// aim assist: lock target, else best zombie in a cone around the move / camera direction, else very close one
function acquireTarget(range) {
  if (P.lock && P.lock.alive && Math.hypot(P.lock.pos.x - P.pos.x, P.lock.pos.z - P.pos.z) < range + 4) return P.lock;
  const mv = moveVector();
  const ref = mv.len > 0.25 ? mv.ang : camForwardYaw();
  let best = null, bs = 1e9;
  for (const z of zombies) {
    if (!z.alive || z.state === 'rise') continue;
    const dx = z.pos.x - P.pos.x, dz = z.pos.z - P.pos.z, d = Math.hypot(dx, dz);
    if (d > range + z.cfg.r) continue;
    const a = Math.abs(angDiff(ref, Math.atan2(dx, dz)));
    if (a > 1.05 && d > 5) continue;
    if (!hasLOS(z)) continue;
    const score = d + a * 7 - (z.isBoss ? 3 : 0);
    if (score < bs) { bs = score; best = z; }
  }
  return best;
}
// bullet ray vs zombies (vertical cylinders) and world
function bulletRay(o, d, len) {
  let tWall = rayCast(o, d, len, 0.5);
  if (d.y < -1e-4) { const tg = -o.y / d.y; if (tg < tWall) tWall = tg; }
  let best = null, bt = tWall;
  const dl = Math.hypot(d.x, d.z);
  for (const z of zombies) {
    if (!z.alive || z.state === 'rise') continue;
    const r = z.cfg.r * 0.95, h = z.cfg.h * z.cfg.scale;
    const ox = o.x - z.pos.x, oz = o.z - z.pos.z;
    const a = d.x * d.x + d.z * d.z; if (a < 1e-8) continue;
    const b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c; if (disc < 0) continue;
    const sq = Math.sqrt(disc); let t = (-b - sq) / (2 * a); if (t < 0) t = (-b + sq) / (2 * a); if (t < 0 || t >= bt) continue;
    const y = o.y + d.y * t; if (y < 0 || y > h) continue;
    bt = t; best = z;
  }
  return { z: best, t: bt };
}
function tryFire() {
  const id = INV.cur; if (!isGun(id)) return;
  if (G.mode !== 'play' || INV.fireCd > 0 || INV.reloading) return;
  if (P.state !== 'move') return;
  const st = gunStats(id, INV.parts), A = INV.ammo[id];
  if (A.mag <= 0) {
    if (A.res > 0) startReload();
    else { Sfx.empty(); INV.fireCd = 0.35; if (INV.emptyWarn <= 0) { toast('彈藥耗盡', '擊殺喪屍可掉落彈藥 · 切換武器或使用開山刀', '#ff6a6a', '!'); INV.emptyWarn = 6; } }
    return;
  }
  A.mag--; INV.fireCd = st.rate; INV.aimT = 0.7; INV.recoil = Math.min(1.6, INV.recoil + st.recoil); INV.camKick = Math.min(1, INV.camKick + st.recoil * 0.5);
  const tgt = acquireTarget(st.range);
  let yaw, pitch = 0;
  _o.set(P.pos.x, 1.38, P.pos.z);
  if (tgt) {
    const ty = tgt.isBoss ? (tgt.rig.core.getWorldPosition(_hit).y) : 1.15 * tgt.cfg.scale;
    const dx = tgt.pos.x - P.pos.x, dz = tgt.pos.z - P.pos.z, hd = Math.hypot(dx, dz);
    yaw = Math.atan2(dx, dz); pitch = Math.atan2(ty - _o.y, Math.max(0.5, hd));
  } else { const mv = moveVector(); yaw = mv.len > 0.25 ? mv.ang : camForwardYaw(); pitch = -0.02; }
  P.facing = yaw;
  hero.root.rotation.y = yaw; hero.root.updateMatrixWorld(true);
  guns[id].muzzle.getWorldPosition(_mz);
  const hits = new Map();
  for (let i = 0; i < st.pellets; i++) {
    const yw = yaw + gauss() * st.spread, pt = pitch + gauss() * st.spread * 0.6;
    _d.set(Math.sin(yw) * Math.cos(pt), Math.sin(pt), Math.cos(yw) * Math.cos(pt));
    const r = bulletRay(_o, _d, st.range);
    _hit.copy(_o).addScaledVector(_d, r.t);
    addTracer(_mz, _hit, id === 'shotgun' ? 0xffb050 : 0xffe0a0);
    if (r.z) {
      const fall = r.t < st.range * 0.6 ? 1 : lerp(1, 0.5, (r.t - st.range * 0.6) / (st.range * 0.4));
      const e = hits.get(r.z) || { dmg: 0, n: 0, at: _hit.clone(), dir: _d.clone() }; e.dmg += st.dmg * fall; e.n++; hits.set(r.z, e);
    } else if (r.t < st.range - 0.01) {
      burst(_hit, 4, 'spark', 3, 0.05, 1.5); if (_hit.y < 0.1) burst(_hit, 2, 'dust', 1.5, 0.06, 1.2);
      if (Math.random() < 0.15) Sfx.ricochet();
    }
  }
  for (const [z, e] of hits) {
    damageZombie(z, e.dmg, e.dir.x, e.dir.z, st.knock * e.n / st.pellets + (st.pellets > 1 ? 1 : 0), { gun: true, crit: st.crit, ap: st.ap, at: e.at, dir: e.dir.multiplyScalar(-0.3), heavyGun: id === 'shotgun' });
  }
  // noise attracts wandering zombies
  for (const z of zombies) if (z.alive && z.state === 'wander' && Math.hypot(z.pos.x - P.pos.x, z.pos.z - P.pos.z) < st.noise) { z.state = 'chase'; z.t = 0; }
  // muzzle FX
  const sup = INV.parts[id].suppressor || 0;
  flashT = 0.05; muzzleFlash.visible = true; muzzleFlash.scale.setScalar((id === 'shotgun' ? 1.6 : id === 'rifle' ? 1.15 : 0.9) * (sup ? 0.45 : 1));
  muzzleFlash.rotation.z = Math.random() * TAU;
  muzzleLight.position.copy(_mz); muzzleLight.intensity = sup ? 6 : (id === 'shotgun' ? 30 : 18);
  burst(_mz, 1, 'brass', 1.5, 0.03, 2.5, _d.set(-Math.cos(yaw), 0, Math.sin(yaw)));
  Sfx.shot(id, sup); vibrate(id === 'shotgun' ? 25 : 8);
  shake = Math.max(shake, st.shake);
  if (A.mag === 0 && A.res > 0) setTimeout(() => { if (A.mag === 0) startReload(); }, 180);
  lastHud.ammo = null;
}
function startReload() {
  const id = INV.cur; if (!isGun(id) || INV.reloading) return;
  const st = gunStats(id, INV.parts), A = INV.ammo[id];
  if (A.mag >= st.mag || A.res <= 0) return;
  INV.reloading = true; INV.reloadT = INV.reloadMax = st.reload; Sfx.reload();
}
function updateGun(dt) {
  INV.fireCd = Math.max(0, INV.fireCd - dt); INV.aimT = Math.max(0, INV.aimT - dt); INV.emptyWarn -= dt;
  INV.recoil = Math.max(0, INV.recoil - dt * 6); INV.camKick = Math.max(0, INV.camKick - dt * 5);
  if (INV.reloading) {
    INV.reloadT -= dt;
    if (INV.reloadT <= 0) {
      const id = INV.cur, st = gunStats(id, INV.parts), A = INV.ammo[id];
      const n = Math.min(st.mag - A.mag, A.res); A.mag += n; A.res -= n; INV.reloading = false; Sfx.reloadDone(); lastHud.ammo = null;
    }
  }
  if (flashT > 0) {
    flashT -= dt;
    guns[INV.cur] && guns[INV.cur].muzzle.getWorldPosition(muzzleFlash.position);
    muzzleFlash.quaternion.setFromEuler(new THREE.Euler(0, P.facing, muzzleFlash.rotation.z, 'YXZ'));
    muzzleFlash.userData.front.lookAt(camera.position);
    if (flashT <= 0) { muzzleFlash.visible = false; }
  }
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 400);
  if (P.attackHeld && isGun(INV.cur) && G.mode === 'play') tryFire();
}
function cycleWeapon() {
  if (G.mode !== 'play' || P.state === 'skill') return;
  const owned = WEAPON_ORDER.filter(k => INV.owned[k]);
  if (owned.length < 2) { toast('尚無其他武器', '撐過屍潮即可解鎖槍械', '#aaa', '?'); return; }
  const i = owned.indexOf(INV.cur);
  switchWeapon(owned[(i + 1) % owned.length]);
}
function switchWeapon(id) {
  if (!INV.owned[id]) return;
  INV.cur = id; INV.reloading = false; INV.fireCd = 0.25; Sfx.swap();
  if (P.state === 'attack') { P.state = 'move'; P.t = 0; }
  refreshWeaponVisuals(); lastHud = {};
}
function unlockWeapon(id) {
  if (INV.owned[id]) return;
  INV.owned[id] = true;
  const W0 = WEAPONS[id];
  INV.ammo[id] = { mag: W0.mag, res: W0.infinite ? Infinity : W0.startAmmo };
  switchWeapon(id);
  toast(`解鎖武器：${W0.name}`, `點右側「武器」鍵切換 · 攻擊鍵射擊（自動瞄準）`, '#ff9a5a', '★');
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
bindBtn('bWeapon', cycleWeapon);
bindBtn('weaponHud', () => { if (G.mode === 'play') startReload(); });

addEventListener('keydown', e => {
  input.keys[e.code] = true;
  if (e.repeat) return;
  if (G.mode === 'play') {
    if (e.code === 'KeyJ') { P.attackHeld = true; doAttack(); }
    else if (e.code === 'KeyK' || e.code === 'Space') { doDodge(); e.preventDefault(); }
    else if (e.code === 'KeyL') doSkill();
    else if (e.code === 'Semicolon' || e.code === 'KeyQ' || e.code === 'Tab') { toggleLock(); e.preventDefault(); }
    else if (e.code === 'KeyE') cycleWeapon();
    else if (e.code === 'KeyR') startReload();
    else if (/^Digit[1-4]$/.test(e.code)) switchWeapon(WEAPON_ORDER[+e.code.slice(5) - 1]);
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
const CAM = { yaw: 0, pitch: 0.3, dist: 4.6, pivot: new THREE.Vector3(), curDist: 4.6, side: 0.6 };
function updateCamera(dt) {
  const sens = 0.0065;
  CAM.yaw -= input.camDX * sens; CAM.pitch = clamp(CAM.pitch + input.camDY * sens * 0.8, -0.2, 1.05);
  input.camDX = input.camDY = 0;
  const k = input.keys;
  if (k.ArrowLeft) CAM.yaw += 2.2 * dt; if (k.ArrowRight) CAM.yaw -= 2.2 * dt;
  if (k.ArrowUp) CAM.pitch = clamp(CAM.pitch - 1.2 * dt, -0.2, 1.05); if (k.ArrowDown) CAM.pitch = clamp(CAM.pitch + 1.2 * dt, -0.2, 1.05);
  const aiming = isGun(INV.cur) && INV.aimT > 0;
  let wantDist = aiming ? 4.1 : 4.6;
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
  CAM.side = lerp(CAM.side, aiming ? 0.75 : 0.6, damp(4, dt));
  const fx = -Math.sin(CAM.yaw), fz = -Math.cos(CAM.yaw), rx = Math.cos(CAM.yaw), rz = -Math.sin(CAM.yaw);
  const target = new THREE.Vector3(P.pos.x + rx * CAM.side, (P.state === 'dodge' ? 1.35 : 1.55), P.pos.z + rz * CAM.side);
  CAM.pivot.lerp(target, damp(14, dt));
  const cp = Math.cos(CAM.pitch), sp = Math.sin(CAM.pitch);
  const dir = new THREE.Vector3(-fx * cp, sp, -fz * cp);
  const hit = rayCast(CAM.pivot, dir, wantDist);
  const dist = Math.max(0.9, hit - 0.25);
  CAM.curDist = dist < CAM.curDist ? dist : lerp(CAM.curDist, dist, damp(4, dt));
  camera.position.copy(CAM.pivot).addScaledVector(dir, CAM.curDist + INV.camKick * 0.12);
  if (camera.position.y < 0.3) camera.position.y = 0.3;
  camera.lookAt(CAM.pivot.x + fx * 2, CAM.pivot.y - 0.15 + sp * 0.5 + INV.camKick * 0.06, CAM.pivot.z + fz * 2);
  if (shake > 0) {
    camera.position.x += (Math.random() - .5) * shake * 0.35; camera.position.y += (Math.random() - .5) * shake * 0.35;
    camera.rotation.z += (Math.random() - .5) * shake * 0.03;
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
  const gunOut = isGun(INV.cur);
  switch (P.state) {
    case 'move': {
      const aiming = gunOut && INV.aimT > 0;
      if (mv.len > 0.08) {
        if (!aiming) P.facing = lerpAng(P.facing, mv.ang, damp(14, dt));
        speed = 6.2 * mv.len * (aiming ? 0.78 : 1) * (INV.reloading ? 0.85 : 1);
        P.pos.x += mv.x / Math.max(mv.len, 1e-3) * speed * dt; P.pos.z += mv.z / Math.max(mv.len, 1e-3) * speed * dt;
      }
      P.moveAng = mv.ang;
      if (!gunOut && P.attackHeld && G.mode === 'play') { P.attackHoldT += dt; if (P.attackHoldT > 0.05) doAttack(); }
      break;
    }
    case 'attack': {
      const A = ATK[P.combo];
      if (P.t < A.hit) { const lz = A.lunge * (1 - P.t / A.hit); const tgt = nearestZombie(1.2, P.facing, 0.6); if (!tgt) { P.pos.x += Math.sin(P.facing) * lz * dt; P.pos.z += Math.cos(P.facing) * lz * dt; } }
      if (!P.hitDone && P.t >= A.hit) {
        P.hitDone = 1; meleeHit(A.range, A.arc, A.dmg, A.knock, false, P.combo === 2);
        trailT = 0.16; trail.rotation.set(0, 0, P.combo === 0 ? 0.35 : P.combo === 1 ? Math.PI - 0.35 : Math.PI / 2);
        trailPivot.rotation.y = P.facing; trailMat.color.setHex(P.combo === 2 ? 0xff6a6a : (INV.parts.machete.edge ? 0xe0b0ff : 0xffe0e0));
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
      if (P.hitDone === 0 && P.t >= 0.2) { P.hitDone = 1; meleeHit(4.0, 0, 34, 6, true, true); }
      if (P.hitDone === 1 && P.t >= 0.46) { P.hitDone = 2; meleeHit(4.2, 0, 34, 9, true, true); shake = 0.3; }
      if (P.t >= D) { P.state = 'move'; P.t = 0; refreshWeaponVisuals(); }
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
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i]; p.t += dt;
    const dx = P.pos.x - p.g.position.x, dz = P.pos.z - p.g.position.z, d = Math.hypot(dx, dz);
    if (d < 3.2 && P.state !== 'dead') { const sp = (3.4 - d) * 4 * dt; p.g.position.x += dx / d * sp; p.g.position.z += dz / d * sp; }
    p.g.position.y = 0.45 + Math.sin(p.t * 3) * 0.08; p.g.rotation.y += dt * 2.2;
    if (p.g.userData.ring) p.g.userData.ring.rotation.y += dt * 4;
    p.beam.position.x = p.g.position.x; p.beam.position.z = p.g.position.z;
    const blink = p.life - p.t < 5 ? (Math.sin(p.t * 20) > 0) : true; p.g.visible = blink;
    if (d < 0.85 && P.state !== 'dead') {
      if (p.kind === 'ammo') giveAmmo(); else equipPart(p.key);
      removePickup(i);
    } else if (p.t > p.life) removePickup(i);
  }
  P.gy += (W.groundY(P.pos.x, P.pos.z) - P.gy) * Math.min(1, dt * 14);
  hero.root.position.set(P.pos.x, P.gy, P.pos.z); hero.root.rotation.y = P.facing;
  heroBlob.position.set(P.pos.x, 0.025 + P.gy, P.pos.z);
  animateHero(dt);
}
const pony = { ax: [0, 0, 0], vx: [0, 0, 0], az: [0, 0, 0], vz: [0, 0, 0], lastFacing: 0, lastY: 0.95 };
function animateHero(dt) {
  if (hero.rigged) { animateRigged(dt); return; }
  const R = hero, t = G.time;
  const run = P.run;
  P.runPhase += dt * (4 + 7 * run);
  const ph = P.runPhase;
  const gunOut = isGun(INV.cur) && P.state !== 'skill';
  const twoHand = INV.cur === 'shotgun' || INV.cur === 'rifle';
  let bodyY = 0.95 + Math.sin(t * 2.2) * 0.008, bodyRX = 0, bodyRZ = 0, bodyRY = 0;
  let legL = 0, legR = 0, shinL = 0.05, shinR = 0.05, torsoX = 0.03, torsoY = 0, headX = 0, headY = 0;
  let armL = { x: 0.05, y: 0, z: 0.12 }, armR = { x: -0.25, y: 0, z: -0.12 };
  let foreL = -0.2, foreR = -0.45, weaponX = 0.35, skirtX = 0, gunPitch = 0.6, gunYaw = 0.3, gunAim = false;
  const turnRate = angDiff(P.leanFacing ?? P.facing, P.facing) / Math.max(dt, 1e-3); P.leanFacing = P.facing;
  P.lean = lerp(P.lean, clamp(-turnRate * 0.035 * run, -0.22, 0.22), damp(6, dt));
  if (P.state === 'move' || P.state === 'hurt') {
    // strafing: when aiming the legs run relative to the move direction
    let legDir = 1;
    if (gunOut && INV.aimT > 0 && run > 0.1 && P.moveAng != null) { const rel = angDiff(P.facing, P.moveAng); legDir = Math.cos(rel) >= -0.2 ? 1 : -1; bodyRY = clamp(rel * 0.35 * legDir, -0.6, 0.6); }
    legL = -Math.sin(ph) * 0.85 * run * legDir; legR = Math.sin(ph) * 0.85 * run * legDir;
    shinL = 0.05 + Math.max(0, Math.sin(ph)) * 1.25 * run; shinR = 0.05 + Math.max(0, -Math.sin(ph)) * 1.25 * run;
    bodyY += Math.abs(Math.cos(ph)) * 0.06 * run - 0.03 * run;
    torsoX = 0.03 + 0.2 * run; headX = -0.12 * run;
    armL.x = Math.sin(ph) * 0.8 * run + 0.05; foreL = -0.3 - 0.7 * run; armL.z = 0.12 + 0.08 * run;
    armR.x = -0.25 - Math.sin(ph) * 0.45 * run - 0.25 * run; foreR = -0.45 - 0.45 * run;
    bodyRZ = Math.sin(ph) * 0.03 * run + P.lean; torsoY = Math.sin(ph) * 0.14 * run;
    torsoX += 0.08 * run * run;
    skirtX = -0.2 * run + Math.sin(ph * 2) * 0.05 * run;
    weaponX = 0.35 + 0.4 * run;
    if (gunOut) {
      const aiming = INV.aimT > 0 || P.attackHeld;
      const rec = INV.recoil;
      if (INV.reloading) {
        const k = 1 - INV.reloadT / INV.reloadMax, bob = Math.sin(k * Math.PI);
        armR = { x: -0.95, y: 0.35, z: 0 }; foreR = -0.9; gunPitch = 0.2 + 0.5 * bob;
        armL = { x: -0.7 - 0.4 * bob, y: -0.5, z: 0 }; foreL = -1.3 + 0.3 * bob; headX = 0.25; torsoY = 0.15;
      } else if (aiming) {
        gunAim = true; gunPitch = -rec * 0.12;
        if (twoHand) {
          torsoY = -0.35; headY = 0.3;
          armR = { x: -1.2 - rec * 0.15, y: 0.55, z: 0 }; foreR = -0.75;
          armL = { x: -1.45 - rec * 0.1, y: -0.05, z: 0 }; foreL = -0.3;
        } else {
          torsoY = 0.0; headY = 0;
          armR = { x: -1.5 - rec * 0.22, y: 0.12, z: 0 }; foreR = -0.05;
          armL = { x: -1.4 - rec * 0.2, y: -0.55, z: 0 }; foreL = -0.35;
        }
        torsoX = 0.05 + 0.1 * run - rec * 0.05;
      } else {
        armR = { x: -0.55 - 0.15 * run, y: 0.15, z: -0.1 }; foreR = -0.75; gunPitch = 0.55; gunYaw = 0.35;
        if (twoHand) { armL = { x: -0.85, y: -0.5, z: 0 }; foreL = -1.0; }
      }
    }
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
    skirtX = -0.1; headY = -pose.ty * 0.5;
  } else if (P.state === 'dodge') {
    const k = Math.min(1, P.t / 0.5), s = Math.sin(k * Math.PI);
    bodyRX = k * TAU; bodyY = 0.95 - s * 0.42;
    legL = legR = -1.5 * s; shinL = shinR = 2.0 * s; torsoX = 0.7 * s; headX = 0.4 * s;
    armL = { x: -1.2 * s, y: 0, z: 0.2 }; armR = { x: -1.2 * s, y: 0, z: -0.2 }; foreL = foreR = -1.4 * s;
    skirtX = -0.6 * s; weaponX = 0.8;
  } else if (P.state === 'skill') {
    const k = Math.min(1, P.t / 0.72);
    armR = { x: -1.5, y: -1.55, z: 0 }; armL = { x: -1.3, y: 1.3, z: 0 }; foreR = -0.05; foreL = -0.3; weaponX = 1.5;
    legL = -0.5; legR = 0.5; shinL = 0.4; shinR = 0.4; bodyY = 0.85; torsoX = 0.25; skirtX = -0.5;
    bodyRZ = Math.sin(k * Math.PI) * 0.15;
  } else if (P.state === 'dead') {
    const k = Math.min(1, P.t / 0.8);
    bodyRX = -Math.PI / 2 * k * 0.95; bodyY = lerp(0.95, 0.22, k); shinL = 0.4 * k; legR = -0.3 * k;
    armL = { x: -2.5 * k, y: 0, z: 0.4 }; armR = { x: -2.2 * k, y: 0, z: -0.6 }; headX = -0.4 * k;
  }
  if (P.state === 'move') { // idle breathing + slow weight shift
    const breath = Math.sin(t * 1.7), idleK = Math.max(0, 1 - run * 2);
    torsoX += breath * 0.02 * idleK; headX -= breath * 0.014 * idleK; armL.z += breath * 0.025 * idleK; armR.z -= breath * 0.02 * idleK;
    bodyRZ += Math.sin(t * 0.6) * 0.02 * idleK; legL += Math.sin(t * 0.6) * 0.035 * idleK; legR -= Math.sin(t * 0.6) * 0.035 * idleK; headY += Math.sin(t * 0.37) * 0.08 * idleK;
  }
  const s = damp(P.state === 'attack' || P.state === 'skill' || P.state === 'dodge' || P.state === 'dead' ? 40 : (gunOut && INV.aimT > 0 ? 28 : 16), dt);
  R.body.position.y = lerp(R.body.position.y, bodyY, s);
  R.body.rotation.x = (P.state === 'dodge' || P.state === 'dead') ? bodyRX : lerp(R.body.rotation.x % TAU, 0, s);
  R.body.rotation.z = lerp(R.body.rotation.z, bodyRZ, s);
  R.legL.rotation.x = lerp(R.legL.rotation.x, legL, s); R.legR.rotation.x = lerp(R.legR.rotation.x, legR, s);
  R.legL.rotation.y = lerp(R.legL.rotation.y, bodyRY, s); R.legR.rotation.y = lerp(R.legR.rotation.y, bodyRY, s);
  R.shinL.rotation.x = lerp(R.shinL.rotation.x, shinL, s); R.shinR.rotation.x = lerp(R.shinR.rotation.x, shinR, s);
  R.torso.rotation.x = lerp(R.torso.rotation.x, torsoX, s); R.torso.rotation.y = lerp(R.torso.rotation.y, torsoY, s);
  R.head.rotation.x = lerp(R.head.rotation.x, headX, s); R.head.rotation.y = lerp(R.head.rotation.y, headY, s);
  R.armL.rotation.x = lerp(R.armL.rotation.x, armL.x, s); R.armL.rotation.y = lerp(R.armL.rotation.y, armL.y, s); R.armL.rotation.z = lerp(R.armL.rotation.z, armL.z, s);
  R.armR.rotation.x = lerp(R.armR.rotation.x, armR.x, s); R.armR.rotation.y = lerp(R.armR.rotation.y, armR.y, s); R.armR.rotation.z = lerp(R.armR.rotation.z, armR.z, s);
  R.foreL.rotation.x = lerp(R.foreL.rotation.x, foreL, s); R.foreR.rotation.x = lerp(R.foreR.rotation.x, foreR, s);
  R.weapon.rotation.x = lerp(R.weapon.rotation.x, weaponX, s);
  // orient the gun in world space (level toward the aim direction, or low-ready), independent of arm pose
  if (gunOut && (P.state === 'move' || P.state === 'hurt')) {
    R.root.updateMatrixWorld(true);
    R.foreR.getWorldQuaternion(_gq1).invert();
    _gq2.setFromEuler(_ge.set(gunPitch, P.facing + (gunAim ? 0 : gunYaw), 0, 'YXZ'));
    R.gunMount.quaternion.slerp(_gq1.multiply(_gq2), gunAim ? 1 : damp(20, dt));
  } else R.gunMount.rotation.set(1.2, 0, 0);
  R.skirt.rotation.x = lerp(R.skirt.rotation.x, skirtX, damp(8, dt));
  // ponytail spring chain
  const turn = angDiff(pony.lastFacing, P.facing) / Math.max(dt, 1e-3); pony.lastFacing = P.facing;
  const vy = (R.body.position.y - pony.lastY) / Math.max(dt, 1e-3); pony.lastY = R.body.position.y;
  for (let i = 0; i < 3; i++) {
    const tx = (i === 0 ? 0.3 : 0.12) + run * (0.5 - i * 0.12) + (P.state === 'skill' ? 0.9 : 0) - R.torso.rotation.x * (i === 0 ? 0.8 : 0) - R.head.rotation.x * (i === 0 ? 1 : 0);
    const tz = clamp(-turn * 0.03 * (i + 1), -0.8, 0.8);
    pony.vx[i] += ((tx - pony.ax[i]) * 70 - pony.vx[i] * 9) * dt - vy * 0.15 * (i + 1) * dt * 10;
    pony.vz[i] += ((tz - pony.az[i]) * 60 - pony.vz[i] * 8) * dt;
    pony.ax[i] += pony.vx[i] * dt; pony.az[i] += pony.vz[i] * dt;
    pony.ax[i] = clamp(pony.ax[i], -0.6, 2.2); pony.az[i] = clamp(pony.az[i], -1, 1);
    R.pony[i].rotation.x = pony.ax[i]; R.pony[i].rotation.z = pony.az[i];
  }
  // invulnerability shimmer
  R.mats.coat.emissive.setHex(P.invuln > 0 && P.state === 'dodge' ? 0x2a1040 : 0x050308);
  R.star.material.emissiveIntensity = 0.8 + Math.sin(t * 3) * 0.3;
}
const _gq1 = new THREE.Quaternion(), _gq2 = new THREE.Quaternion(), _ge = new THREE.Euler();
function lerpPose(a, b, k) { return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k), ty: lerp(a.ty, b.ty, k) }; }

// ---- rigged heroine (female_hooded.glb): clip state machine + crossfades, gun aim, hair / coat secondary motion
const SLASH_HIT = 0.47; // Sword_Slash: blade crosses the front at ~0.47 s (measured from the wrist path)
const _rq = new THREE.Quaternion(), _rq2 = new THREE.Quaternion(), _re = new THREE.Euler(), _rv = new THREE.Vector3();
function animateRigged(dt) {
  const R = hero, t = G.time, run = P.run, st = P.state;
  const gunOut = isGun(INV.cur) && st !== 'skill';
  const entered = st !== R.lastState || (st === 'attack' && P.combo !== R.lastCombo) || (st === 'attack' && P.t < R.lastT);
  R.lastState = st; R.lastCombo = P.combo; R.lastT = P.t;
  const shot = INV.recoil > (R.lastRecoil ?? 0) + 0.05; R.lastRecoil = INV.recoil;
  let gunAim = false;
  // light hits (no 'hurt' state) still flinch: short HitRecieve that overrides locomotion for ~0.3 s
  const hitNew = (P.hitN || 0) !== (R.lastHitN ?? (P.hitN || 0)); R.lastHitN = P.hitN || 0;
  R.flinch = Math.max(0, (R.flinch || 0) - dt);
  if (st === 'dead') { if (entered) R.play('Death', { once: true, fade: 0.12, restart: true }); }
  else if (st === 'hurt') { if (entered || hitNew) { R.play('HitRecieve', { once: true, fade: 0.06, ts: 1.6, restart: true }); R.flinch = 0.32; } }
  else if (st === 'move' && (hitNew || R.flinch > 0)) { if (hitNew) { R.play(Math.random() < 0.5 ? 'HitRecieve' : 'HitRecieve_2', { once: true, fade: 0.05, ts: 1.8, start: 0.05, restart: true }); R.flinch = 0.3; } }
  else if (st === 'dodge') { if (entered) R.play('Roll', { once: true, fade: 0.05, ts: 1.55 / 0.5, start: 0.08, restart: true }); }
  else if (st === 'attack') {
    if (entered) {
      const A = ATK[P.combo], start = P.combo === 2 ? 0 : 0.12, ts = (SLASH_HIT - start) / A.hit;
      R.play('Sword_Slash', { once: true, fade: P.combo ? 0.05 : 0.08, ts, start, restart: true });
    }
  } else if (st === 'skill') { if (entered) R.play('Sword_Slash', { once: true, fade: 0.06, ts: 1.15 / 0.72, start: 0.1, restart: true }); }
  else { // move
    const moving = run > 0.07;
    const loco = () => {
      if (!moving) R.play(gunOut ? 'Idle_Gun' : 'Idle', { fade: 0.25 });
      else if (run < 0.55) R.play('Walk', { fade: 0.2, ts: clamp(run / 0.3, 0.75, 1.7) });
      else R.play('Run', { fade: 0.18, ts: clamp(run / 0.85, 0.8, 1.3) });
    };
    if (gunOut) {
      const aiming = INV.aimT > 0 || P.attackHeld;
      if (INV.reloading && !moving) R.play('Interact', { fade: 0.15, ts: 1.58 / Math.max(0.6, INV.reloadMax) });
      else if (aiming) {
        gunAim = true;
        if (moving) R.play('Run_Shoot', { fade: 0.15, ts: clamp(run / 0.8, 0.7, 1.25) });
        else if (shot) R.play('Gun_Shoot', { once: true, fade: 0.04, restart: true, ts: 1.4 });
        else if (R.anim.name !== 'Gun_Shoot' || R.anim.cur.time >= R.clips.Gun_Shoot.duration - 0.05) R.play('Idle_Gun_Pointing', { fade: 0.15 });
      } else loco();
    } else loco();
  }
  R.mixer.update(dt);
  R.root.updateMatrixWorld(true);
  // gun: level toward the aim direction (or low-ready) in world space, independent of the clip's hand pose
  if (gunOut && st === 'move' || gunOut && st === 'hurt') {
    R.grip.getWorldQuaternion(_rq).invert();
    _rq2.setFromEuler(_re.set(gunAim ? -INV.recoil * 0.12 : 0.55, P.facing + (gunAim ? 0 : 0.35), 0, 'YXZ'));
    R.gunMount.quaternion.slerp(_rq.multiply(_rq2), gunAim ? 1 : damp(20, dt));
  } else R.gunMount.quaternion.identity();
  // coat tails trail behind with speed (+ a little flutter)
  const skirtX = st === 'dodge' ? 0.5 : st === 'skill' ? 0.6 : 0.32 * run + Math.sin(t * 9) * 0.03 * run;
  R.skirt.rotation.x = lerp(R.skirt.rotation.x, skirtX, damp(8, dt));
  const skY = st === 'dodge' ? 0.45 : st === 'dead' ? 0.7 : 1; R.skirt.scale.y = lerp(R.skirt.scale.y, skY, damp(st === 'dodge' ? 30 : 8, dt));
  // ponytail: spring chain hanging in world space (yaw = facing) so it reacts to turns / speed
  const turn = angDiff(pony.lastFacing, P.facing) / Math.max(dt, 1e-3); pony.lastFacing = P.facing;
  R.ponyBase.parent.getWorldPosition(_rv); const vy = (_rv.y - pony.lastY) / Math.max(dt, 1e-3); pony.lastY = _rv.y;
  for (let i = 0; i < 3; i++) {
    const tx = (i === 0 ? 0.22 : 0.1) + run * (0.55 - i * 0.12) + (st === 'skill' ? 0.9 : 0) + (st === 'dodge' ? 0.2 : 0);
    const tz = clamp(-turn * 0.03 * (i + 1), -0.8, 0.8);
    pony.vx[i] += ((tx - pony.ax[i]) * 70 - pony.vx[i] * 9) * dt - clamp(vy, -6, 6) * 0.15 * (i + 1) * dt * 10;
    pony.vz[i] += ((tz - pony.az[i]) * 60 - pony.vz[i] * 8) * dt;
    pony.ax[i] += pony.vx[i] * dt; pony.az[i] += pony.vz[i] * dt;
    pony.ax[i] = clamp(pony.ax[i], -0.4, 2.2); pony.az[i] = clamp(pony.az[i], -1, 1);
    if (i === 0) { // base: undo the head's world rotation, hang from root yaw; while rolling / dead follow the head
      // (world-hanging hair would poke into the ground when she is upside down or lying)
      R.ponyFollow = lerp(R.ponyFollow || 0, st === 'dodge' || st === 'dead' ? 1 : 0, damp(st === 'dodge' ? 25 : 6, dt));
      R.ponyBase.parent.getWorldQuaternion(_rq).invert();
      _rq2.setFromEuler(_re.set(0, P.facing, 0, 'YXZ'));
      R.ponyBase.quaternion.copy(_rq.multiply(_rq2)).slerp(_rq2.identity(), R.ponyFollow);
    }
    R.pony[i].rotation.set(pony.ax[i], 0, pony.az[i]);
  }
  // invulnerability shimmer + star twinkle
  const em = P.invuln > 0 && st === 'dodge' ? 0x140a20 : 0x050308; // subtle i-frame shimmer
  for (const m of R.mats.shimmer) m.emissive.setHex(em);
  R.star.material.emissiveIntensity = 0.8 + Math.sin(t * 3) * 0.3;
}

// ---------------------------------------------------------------- waves
const G = { mode: 'menu', time: 0, playTime: 0, kills: 0, wave: 0, phase: 'idle', phaseT: 0, queue: [], spawnT: 0, boss: null, bossDead: false, deadAt: 0, partPity: 0 };
const MAX_WAVE = 5;
function waveList(n) {
  const L = [];
  const push = (t, c) => { for (let i = 0; i < c; i++) L.push(t); };
  if (n === 1) push('walker', 8);
  if (n === 2) { push('walker', 8); push('runner', 4); }
  if (n === 3) { push('walker', 8); push('runner', 3); push('brute', 1); push('armored', 1); }
  if (n === 4) { push('walker', 6); push('runner', 4); push('spitter', 3); push('brute', 1); push('armored', 2); }
  if (n === 5) { push('walker', 8); push('runner', 5); push('spitter', 3); push('brute', 2); push('armored', 3); }
  for (let i = L.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0;[L[i], L[j]] = [L[j], L[i]]; }
  return L;
}
function spawnAtEdge(type) {
  // zombies emerge anywhere on the big map, out of sight, at a walkable distance, then home in via the flow field
  const fx = -Math.sin(CAM.yaw), fz = -Math.cos(CAM.yaw);
  const pad = type === 'boss' ? 2.2 : 0.8;
  const cands = [];
  for (const [x, z] of W.spawnPoints) {
    const dx = x - P.pos.x, dz = z - P.pos.z, d = Math.hypot(dx, dz);
    if (d < 13 || d > 48) continue;
    const fd = W.flowDist(x, z);
    const inView = (dx * fx + dz * fz) / (d || 1) > 0.45;
    cands.push({ x, z, score: (d < 17 ? 40 : 0) + (d > 34 ? (d - 34) * 3 : 0) + (fd < 0 ? 400 : fd > 55 ? (fd - 55) * 2 : 0) + (inView && d < 26 ? 25 : 0) + Math.random() * 30 });
  }
  cands.sort((a, b) => a.score - b.score);
  for (const c of cands.slice(0, 40)) {
    for (let tries = 0; tries < 4; tries++) {
      const x = clamp(c.x + (Math.random() - .5) * 3, -BOUND + 1, BOUND - 1), z = clamp(c.z + (Math.random() - .5) * 3, -BOUND + 1, BOUND - 1);
      if (!insideCollider(x, z, pad)) { const zz = spawnZombie(type, x, z); zz.aggroT = 0.3 + Math.random() * 1.2; return zz; }
    }
  }
  return spawnZombie(type, P.pos.x > 0 ? P.pos.x - 20 : P.pos.x + 20, P.pos.z);
}
function startWave(n) {
  G.wave = n; G.queue = waveList(n); G.phase = 'fight'; G.spawnT = 0;
  banner(`第 ${n} 波<small>${n === MAX_WAVE ? '最後一波 · 撐住！' : '屍潮來襲'}</small>`, 2.4); Sfx.wave();
  for (const k of WEAPON_ORDER) if (WEAPONS[k].unlockWave === n) setTimeout(() => G.mode === 'play' && unlockWeapon(k), 900);
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
// static map layer rendered once (2 px per metre)
const MAP_PX = 2, MAP_R = 96;
const mapLayer = document.createElement('canvas'); mapLayer.width = mapLayer.height = MAP_R * 2 * MAP_PX;
{
  const c = mapLayer.getContext('2d');
  c.fillStyle = '#2a282e'; c.fillRect(0, 0, mapLayer.width, mapLayer.height);
  c.setTransform(MAP_PX, 0, 0, MAP_PX, MAP_R * MAP_PX, MAP_R * MAP_PX);
  const col = { blk: '#45424a', p: '#5a5348', b: '#77727c', r: '#5a4a40', c: '#2c2a30', v: '#8a3a30', g: '#6a3030', f: '#ff7a30' };
  const order = ['blk', 'p', 'g', 'b', 'r', 'c', 'v', 'f'];
  for (const k of order) for (const r of W.mapRects) {
    if (r.kind !== k) continue;
    c.save(); c.translate(r.x, r.z); c.rotate(-r.rot); c.fillStyle = col[k] || '#3e3b42';
    if (k === 'b') { c.fillRect(-r.w / 2, -r.d / 2, r.w, r.d); c.strokeStyle = '#2a282e'; c.lineWidth = 0.5; c.strokeRect(-r.w / 2, -r.d / 2, r.w, r.d); }
    else c.fillRect(-r.w / 2, -r.d / 2, r.w, r.d);
    c.restore();
  }
  c.fillStyle = 'rgba(150,140,110,.35)'; for (const r of W.roads) for (let t = -84; t < 84; t += 6) { c.fillRect(r - 0.2, t, 0.4, 3); c.fillRect(t, r - 0.2, 3, 0.4); }
  c.strokeStyle = 'rgba(200,30,40,.85)'; c.lineWidth = 1; c.strokeRect(-BOUND, -BOUND, BOUND * 2, BOUND * 2);
  c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(-MAP_R, -MAP_R, MAP_R * 2, MAP_R - BOUND); c.fillRect(-MAP_R, BOUND, MAP_R * 2, MAP_R - BOUND); c.fillRect(-MAP_R, -BOUND, MAP_R - BOUND, BOUND * 2); c.fillRect(BOUND, -BOUND, MAP_R - BOUND, BOUND * 2);
}
function mapDots(c, scaleDot) {
  for (const z of zombies) {
    if (!z.alive) continue;
    c.fillStyle = z.isBoss ? '#ffd84a' : z.type === 'armored' ? '#6aa0ff' : '#ff2a2a';
    c.beginPath(); c.arc(z.pos.x, z.pos.z, (z.isBoss ? 2.4 : 1.2) * scaleDot, 0, TAU); c.fill();
  }
  for (const o of orbs) { c.fillStyle = '#ff8090'; c.fillRect(o.m.position.x - .7 * scaleDot, o.m.position.z - .7 * scaleDot, 1.4 * scaleDot, 1.4 * scaleDot); }
  for (const p of pickups) { c.fillStyle = p.kind === 'ammo' ? '#ffc840' : (PARTS[p.key].color); c.fillRect(p.g.position.x - .8 * scaleDot, p.g.position.z - .8 * scaleDot, 1.6 * scaleDot, 1.6 * scaleDot); }
}
function drawMinimap() {
  const c = mm, S = 120, sc = 1.6, R = S / 2;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, S, S);
  c.save();
  c.translate(R, R); c.rotate(CAM.yaw); c.scale(sc, sc); c.translate(-P.pos.x, -P.pos.z);
  c.drawImage(mapLayer, -MAP_R, -MAP_R, MAP_R * 2, MAP_R * 2);
  mapDots(c, 1);
  c.translate(P.pos.x, P.pos.z); c.rotate(-P.facing);
  c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, 2.6); c.lineTo(1.6, -1.6); c.lineTo(0, -0.6); c.lineTo(-1.6, -1.6); c.closePath(); c.fill();
  c.restore();
  c.fillStyle = 'rgba(255,255,255,0.07)'; c.beginPath(); c.moveTo(R, R); c.arc(R, R, R, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); c.fill();
  // off-screen zombie indicators on the rim
  const cy = Math.cos(CAM.yaw), sy = Math.sin(CAM.yaw);
  for (const z of zombies) {
    if (!z.alive) continue;
    const dx = z.pos.x - P.pos.x, dz = z.pos.z - P.pos.z, d = Math.hypot(dx, dz);
    if (d * sc < R - 6) continue;
    const rx = dx * cy - dz * sy, rz = dx * sy + dz * cy, a = Math.atan2(rz, rx);
    c.fillStyle = z.isBoss ? '#ffd84a' : d < 40 ? 'rgba(255,60,60,.95)' : 'rgba(255,60,60,.5)';
    c.save(); c.translate(R + Math.cos(a) * (R - 5), R + Math.sin(a) * (R - 5)); c.rotate(a);
    c.beginPath(); c.moveTo(4, 0); c.lineTo(-3, 3); c.lineTo(-3, -3); c.closePath(); c.fill(); c.restore();
  }
  // compass: north (−z) letter on the rim
  const nx = R + Math.sin(CAM.yaw) * (R - 9), ny = R - Math.cos(CAM.yaw) * (R - 9);
  c.fillStyle = 'rgba(10,8,10,.75)'; c.beginPath(); c.arc(nx, ny, 7, 0, TAU); c.fill();
  c.fillStyle = '#ffd84a'; c.font = 'bold 10px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('北', nx, ny + 0.5);
}
// full map overlay (tap the minimap)
const bigMap = $('bigMap'), bigCtx = bigMap ? bigMap.getContext('2d') : null;
let bigOpen = false;
function toggleBigMap(v = !bigOpen) { bigOpen = v; if (bigMap) $('bigMapWrap').classList.toggle('hidden', !v); if (v) drawBigMap(); }
function drawBigMap() {
  if (!bigCtx) return;
  const S = bigMap.width, k = S / (MAP_R * 2);
  bigCtx.setTransform(1, 0, 0, 1, 0, 0); bigCtx.clearRect(0, 0, S, S);
  bigCtx.drawImage(mapLayer, 0, 0, S, S);
  bigCtx.setTransform(k, 0, 0, k, S / 2, S / 2);
  mapDots(bigCtx, 1.6);
  bigCtx.translate(P.pos.x, P.pos.z); bigCtx.rotate(-P.facing);
  bigCtx.fillStyle = '#fff'; bigCtx.strokeStyle = '#000'; bigCtx.lineWidth = 0.6; bigCtx.beginPath(); bigCtx.moveTo(0, 4.2); bigCtx.lineTo(2.6, -2.6); bigCtx.lineTo(0, -1); bigCtx.lineTo(-2.6, -2.6); bigCtx.closePath(); bigCtx.fill(); bigCtx.stroke();
  bigCtx.setTransform(1, 0, 0, 1, 0, 0); bigCtx.fillStyle = '#ffd84a'; bigCtx.font = 'bold 16px sans-serif'; bigCtx.textAlign = 'center'; bigCtx.fillText('北 N', S / 2, 18);
}
$('minimapWrap').addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); toggleBigMap(); });
if ($('bigMapWrap')) $('bigMapWrap').addEventListener('pointerdown', e => { e.stopPropagation(); toggleBigMap(false); });
const hpFill = $('hpFill'), hpGhost = $('hpGhost'), stFill = $('stFill'), cdEl = $('skillCd'), cdTxt = $('skillCdText'), bSkill = $('bSkill');
const waveText = $('waveText'), killText = $('killText'), lockMark = $('lockMark'), bossFill = $('bossFill');
const wName = $('wName'), wMag = $('wMag'), wRes = $('wRes'), wRel = $('wRelFill'), wHud = $('weaponHud'), wParts = $('wParts'), bWeaponTxt = $('bWeaponTxt'), bAttackTxt = $('bAttackTxt');
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
  // weapon HUD
  const id = INV.cur, gun = isGun(id);
  setIf('wname', id, v => { wName.textContent = WEAPONS[v].name; wHud.dataset.w = v; bAttackTxt.textContent = gun ? '射擊' : '攻擊'; });
  const owned = WEAPON_ORDER.filter(k => INV.owned[k]);
  setIf('wbtn', owned.length + id, () => { const nx = owned[(owned.indexOf(id) + 1) % owned.length]; bWeaponTxt.textContent = owned.length > 1 ? '→' + WEAPONS[nx].short : '武器'; $('bWeapon').classList.toggle('dim', owned.length < 2); });
  if (gun) {
    const st = gunStats(id, INV.parts), A = INV.ammo[id];
    setIf('ammo', A.mag + '/' + A.res + '/' + st.mag, () => { wMag.textContent = A.mag; wRes.textContent = '/ ' + (isFinite(A.res) ? A.res : '∞'); wHud.classList.toggle('low', A.mag <= Math.ceil(st.mag * 0.25)); wHud.classList.toggle('empty', A.mag === 0 && A.res === 0); });
    setIf('rel', INV.reloading ? Math.round((1 - INV.reloadT / INV.reloadMax) * 20) : -1, v => { wHud.classList.toggle('reloading', v >= 0); wRel.style.width = (v < 0 ? 0 : v * 5) + '%'; });
  } else {
    setIf('ammo', 'melee', () => { wMag.textContent = '∞'; wRes.textContent = ''; wHud.classList.remove('low', 'empty', 'reloading'); wRel.style.width = '0%'; });
  }
  setIf('wparts', id + JSON.stringify(INV.parts[id] || {}), () => {
    const p = INV.parts[id] || {}; wParts.innerHTML = '';
    for (const k in p) { const s = document.createElement('span'); s.style.color = PARTS[k].color; s.textContent = PARTS[k].icon + (p[k] > 1 ? p[k] : ''); s.title = PARTS[k].name; wParts.appendChild(s); }
  });
  if (++mmFrame % 2 === 0) drawMinimap();
  if (bigOpen && mmFrame % 6 === 0) drawBigMap();
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
  if (P.lock && P.lock.alive) {
    const L = P.lock, s = toScreen(_tmp.set(L.pos.x, L.isBoss ? 3.0 : 1.25 * L.cfg.scale, L.pos.z));
    lockMark.style.display = s.vis ? 'block' : 'none'; lockMark.style.left = s.x + 'px'; lockMark.style.top = s.y + 'px';
    lockRing.visible = true; lockRing.position.set(L.pos.x, 0.05, L.pos.z); lockRing.scale.setScalar(L.cfg.r * 1.6);
  } else { lockMark.style.display = 'none'; lockRing.visible = false; if (P.lock) { P.lock = null; $('bLock').classList.remove('on'); } }
}
const _tmp = new THREE.Vector3();

// ---------------------------------------------------------------- FX update
function flick(mode, t, ph) {
  if (mode === 'stutter') { const c = Math.sin(t * 1.3 + ph) + Math.sin(t * 3.7 + ph * 2); return c > 1.25 ? (Math.random() < 0.5 ? 0.05 : 1) : (c < -1.6 ? 0.1 : 1); }
  return 0.82 + Math.sin(t * 50 + ph) * 0.08 + (Math.random() < 0.02 ? -0.6 : 0);
}
let worldT = 0;
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
    const s = 0.85 + fl * 0.18;
    f.f1.scale.y = (f.big ? 0.75 : 1) * s * 1.1; f.f1.rotation.y += dt * 2;
    if (f.f2) f.f2.scale.y = 0.6 * (0.9 + fl * 0.3);
    if (f.light) f.light.intensity = (f.big ? 22 : 16) + fl * 6;
    if (Math.abs(f.x - P.pos.x) < 30 && Math.abs(f.z - P.pos.z) < 30 && Math.random() < dt * (f.big ? 6 : 3)) burst(new THREE.Vector3(f.x, f.big ? 2.6 : 1.5, f.z), 1, 'spark', 0.6, 0.04, 2.5);
  }
  for (const l of W.lamps) {
    const v = W.setLamp(l, flick(l.mode === 'dead' ? 'buzz' : l.mode, G.time, l.ph));
    if (l.light) l.light.intensity = 14 * v;
  }
  W.lampsCommit();
  for (const n of W.neons) n.mat.opacity = flick(n.mode, G.time * 0.9, n.ph) * (n.max || 1);
  { const on = Math.floor(G.time * 5) % 2 === 0; W.sirens.r.color.setHex(on ? 0xff2020 : 0x2a0404); W.sirens.b.color.setHex(on ? 0x08081a : 0x2a5aff); }
  worldT -= dt;
  if (worldT <= 0) { worldT = 0.3; W.updateFlow(P.pos.x, P.pos.z); assignLights(); W.cull(camera.position.x, camera.position.z, Q.detail, Q.far); }
  if (G.boss && G.boss.alive) {
    G.boss.rig.core.getWorldPosition(bossLight.position);
    bossLight.intensity = 10 + Math.sin(G.time * 6) * 3;
  } else bossLight.intensity = Math.max(0, bossLight.intensity - dt * 10);
  W.sky.position.copy(camera.position);
  W.tick(dt, camera);
  { const dx = P.pos.x - camera.position.x, dz = P.pos.z - camera.position.z, L = Math.hypot(dx, dz) || 1; rimLight.target.position.set(P.pos.x, 0.8, P.pos.z); rimLight.position.set(P.pos.x + dx / L * 10, 7, P.pos.z + dz / L * 10); }
  fillLight.position.set(camera.position.x, camera.position.y + 1.2, camera.position.z);
  // shadow camera follows the heroine
  if (Q.shadow) { moon.target.position.set(P.pos.x, 0, P.pos.z); moon.position.set(P.pos.x - 20, 30, P.pos.z + 10); }
  // embers drift around the camera
  if (Q.embers) {
    const cx = P.pos.x, cz = P.pos.z;
    for (let i = 0; i < Q.embers; i++) {
      const j = i * 3;
      emberPos[j] += (emberVel[j] + Math.sin(G.time + i) * 0.2) * dt; emberPos[j + 1] += emberVel[j + 1] * dt; emberPos[j + 2] += emberVel[j + 2] * dt;
      const ex = emberPos[j] - camera.position.x, ey = emberPos[j + 1] - camera.position.y, ez = emberPos[j + 2] - camera.position.z;
      if (emberPos[j + 1] > 9 || Math.abs(emberPos[j] - cx) > 16 || Math.abs(emberPos[j + 2] - cz) > 16 || ex * ex + ey * ey + ez * ez < 9) { emberPos[j] = cx + (Math.random() - .5) * 30; emberPos[j + 1] = Math.random() * 1.5; emberPos[j + 2] = cz + (Math.random() - .5) * 30; }
    }
    emberGeo.attributes.position.needsUpdate = true;
  }
  for (let i = 0; i < Q.fog; i++) {
    const f = fogSheets[i]; f.m.position.x += f.vx * dt; f.m.position.z += f.vz * dt; f.m.rotation.y += dt * 0.02;
    if (Math.abs(f.m.position.x - P.pos.x) > 18) f.m.position.x = P.pos.x - Math.sign(f.m.position.x - P.pos.x) * 16;
    if (Math.abs(f.m.position.z - P.pos.z) > 18) f.m.position.z = P.pos.z - Math.sign(f.m.position.z - P.pos.z) * 16;
  }
  updateTracers(dt);
}

// ---------------------------------------------------------------- quality apply
function applyQuality(setting) {
  qSetting = setting; try { localStorage.setItem('zb_quality', setting); } catch (e) { }
  const key = setting === 'auto' ? AUTO_Q : setting; Q = QUALITY[key];
  document.body.dataset.q = key;
  pixelRatio = Math.min(window.devicePixelRatio || 1, Q.prCap); renderer.setPixelRatio(pixelRatio); onResize();
  const shadowOn = Q.shadow > 0;
  renderer.shadowMap.enabled = shadowOn; renderer.shadowMap.type = Q.shadow >= 1024 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  moon.castShadow = shadowOn;
  if (shadowOn) { moon.shadow.mapSize.set(Q.shadow, Q.shadow); if (moon.shadow.map) { moon.shadow.map.dispose(); moon.shadow.map = null; } }
  hero.root.traverse(o => { if (o.isMesh) o.castShadow = shadowOn && o.userData.cast !== false; });
  const det = key !== 'low', cb = key === 'high'; setCharDetail(cb); applyCharBump([hero.mats.coat, hero.mats.coatSide], cb);
  for (const z of zombies) applyCharBump(z.rig.mats, cb);
  W.setQuality(key); rimLight.visible = det;
  for (const z of zombies) applyShadowFlags(z.rig.root);
  fireLights.forEach((l, i) => l.visible = i < Q.fires);
  lampLights.forEach((l, i) => l.visible = i < Q.lamps);
  worldT = 0;
  emberGeo.setDrawRange(0, Q.embers); embers.visible = Q.embers > 0;
  fogSheets.forEach((f, i) => f.m.visible = i < Q.fog);
  scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); });
  renderQualityUI(); if (typeof renderRainUI === 'function') try { renderRainUI(); } catch (e) { }
}
function qLabel() { return qSetting === 'auto' ? `自動（${QUALITY[AUTO_Q].label}）` : QUALITY[qSetting].label; }
function renderQualityUI() {
  document.querySelectorAll('[data-q]').forEach(b => b.classList.toggle('on', b.dataset.q === qSetting));
  const mq = $('btnQuality'); if (mq) mq.textContent = '畫質：' + qLabel();
  const qi = $('qInfo'); if (qi) qi.textContent = `目前：${qLabel()} · 解析度 ${pixelRatio.toFixed(2)}x${Q.shadow ? ' · 即時陰影' : ''}`;
}
document.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => applyQuality(b.dataset.q)));
let rainSetting = true; try { rainSetting = localStorage.getItem('zb_rain') !== '0'; } catch (e) { }
function renderRainUI() { const b = $('btnRain'); if (b) { b.textContent = '雨：' + (rainSetting ? '開' : '關') + (Q === QUALITY.low ? '（低畫質無效）' : ''); b.classList.toggle('on', rainSetting); } }
W.setRain(rainSetting);
if ($('btnRain')) $('btnRain').addEventListener('click', () => { rainSetting = !rainSetting; try { localStorage.setItem('zb_rain', rainSetting ? '1' : '0'); } catch (e) { } W.setRain(rainSetting); renderRainUI(); });
$('btnQuality').addEventListener('click', () => { const order = ['auto', 'low', 'mid', 'high']; applyQuality(order[(order.indexOf(qSetting) + 1) % order.length]); });

// ---------------------------------------------------------------- pause: weapons & parts panel
function renderUpgradePanel() {
  const el = $('upgradeList'); el.innerHTML = '';
  for (const id of WEAPON_ORDER) {
    const W0 = WEAPONS[id], owned = !!INV.owned[id], p = INV.parts[id] || {};
    const row = document.createElement('div'); row.className = 'wrow' + (owned ? '' : ' locked') + (INV.cur === id ? ' cur' : '');
    let stats;
    if (W0.kind === 'melee') { const m = meleeMul(INV.parts); stats = `傷害 ×${m.dmg.toFixed(1)} · 三段連擊 · 迴旋斬`; }
    else { const st = gunStats(id, INV.parts); stats = owned ? `傷害 ${Math.round(st.dmg)}${st.pellets > 1 ? '×' + st.pellets : ''} · 射速 ${(1 / st.rate).toFixed(1)}/秒 · 彈匣 ${st.mag} · 彈藥 ${INV.ammo[id].mag}/${isFinite(INV.ammo[id].res) ? INV.ammo[id].res : '∞'}` : `第 ${W0.unlockWave} 波解鎖`; }
    const slots = (W0.kind === 'melee' ? ['edge'] : GUN_PART_KEYS).map(k => {
      const lv = p[k] || 0, d = PARTS[k];
      return `<span class="slot${lv ? ' has' : ''}" style="--pc:${d.color}" title="${d.name}"><i>${d.icon}</i>${d.name}${lv ? `<b>Lv${lv}</b>` : ''}</span>`;
    }).join('');
    row.innerHTML = `<div class="wh"><b>${W0.name}</b>${INV.cur === id ? '<em>使用中</em>' : ''}<small>${stats}</small></div><div class="slots">${slots}</div>`;
    el.appendChild(row);
  }
  const lg = $('partLegend');
  const have = PART_KEYS.filter(k => WEAPON_ORDER.some(w => (INV.parts[w] || {})[k]));
  lg.innerHTML = `<div class="lgh">已收集零件 ${INV.collected} 個${have.length ? '' : ' · 擊殺喪屍（尤其精英）會掉落零件，自動裝上'}</div>` +
    have.map(k => { const d = PARTS[k]; const where = WEAPON_ORDER.filter(w => (INV.parts[w] || {})[k]).map(w => `${WEAPONS[w].short} Lv${INV.parts[w][k]}`).join('、'); return `<div class="lg"><i style="color:${d.color}">${d.icon}</i><b>${d.name}</b><span>${where}</span><small>${d.desc(1)}</small></div>`; }).join('');
}

// ---------------------------------------------------------------- game flow
function clearWorld() {
  for (const z of zombies.slice()) removeZombie(z);
  for (const p of projectiles) scene.remove(p.m); projectiles.length = 0;
  for (const p of puddles) { scene.remove(p.m); p.m.material.dispose(); } puddles.length = 0;
  for (const o of orbs) scene.remove(o.m); orbs.length = 0;
  for (let i = pickups.length - 1; i >= 0; i--) removePickup(i);
  for (let i = 0; i < DMAX; i++) decalMesh.setMatrixAt(i, ZERO); decalMesh.instanceMatrix.needsUpdate = true;
  for (const k of ['N', 'A']) { const m = k === 'A' ? pMeshA : pMeshN; for (const p of parts[k]) { p.life = 0; m.setMatrixAt(p.i, ZERO); } m.instanceMatrix.needsUpdate = true; }
  for (const t of tracers) { t.life = 0; tracerMesh.setMatrixAt(t.i, ZERO); } tracerMesh.instanceMatrix.needsUpdate = true;
  teleMat.opacity = 0; muzzleFlash.visible = false;
}
function resetGame() {
  clearWorld();
  Object.assign(P, { hp: P.maxHp, st: P.maxSt, stDelay: 0, state: 'move', t: 0, combo: 0, comboWin: 0, queued: false, invuln: 0, skillCd: 0, lock: null, attackHeld: false, run: 0 });
  P.pos.set(0, 0, 4); P.kb.set(0, 0, 0); P.facing = Math.PI;
  CAM.yaw = 0; CAM.pitch = 0.3; CAM.pivot.set(0, 1.5, 4);
  hero.body.rotation.set(0, 0, 0); if (hero.rigged) { hero.resetAnim(); hero.lastState = null; }
  Object.assign(G, { time: 0, playTime: 0, kills: 0, wave: 0, phase: 'intro', phaseT: 0, queue: [], boss: null, bossDead: false, partPity: 3 });
  resetInventory();
  $('bossBar').classList.add('hidden'); $('bLock').classList.remove('on');
  lastHud = {};
  banner('喪屍突圍<small>擊退屍潮 · 活下去</small>', 2.2);
  setTimeout(() => { if (G.mode === 'play' && G.phase === 'intro') startWave(1); }, 2300);
}
function show(id, on) { $(id).classList.toggle('hidden', !on); }
function startGame() {
  Sfx.unlock();
  tryFullscreen();
  show('menu', false); show('help', false); show('end', false); show('pause', false); show('hud', true); show('post', true);
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
function pauseGame() { if (G.mode !== 'play') return; G.mode = 'paused'; renderUpgradePanel(); renderQualityUI(); show('pause', true); input.keys = {}; P.attackHeld = false; }
function resumeGame() { if (G.mode !== 'paused') return; G.mode = 'play'; show('pause', false); clock.getDelta(); }
function toMenu() { G.mode = 'menu'; clearWorld(); show('pause', false); show('end', false); show('hud', false); show('post', false); show('menu', true); renderQualityUI(); }
function fmtTime(s) { s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function endScreen(win) {
  G.mode = win ? 'win' : 'dead';
  $('end').classList.toggle('win', win);
  $('endTitle').textContent = win ? '突圍成功' : '你倒下了';
  $('endSub').textContent = win ? '融合巨獸已被擊倒，星璃殺出了一條血路。' : '屍潮吞噬了一切……';
  $('stTime').textContent = fmtTime(G.playTime); $('stKills').textContent = G.kills;
  $('stWave').textContent = G.phase === 'boss' ? `${MAX_WAVE}（首領）` : String(Math.max(1, G.wave));
  $('stParts').textContent = INV.collected;
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

// film grain for the CSS post overlay (generated, no network)
(() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const id = g.createImageData(128, 128);
  for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255 | 0; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
  g.putImageData(id, 0, 0);
  $('grain').style.backgroundImage = `url(${c.toDataURL()})`;
})();

// ---------------------------------------------------------------- main loop + adaptive resolution
const clock = new THREE.Clock();
let perfAcc = 0, perfFrames = 0, perfCheckT = 0;
const FPS = { acc: 0, n: 0, value: 0, samples: [] };
function frame() {
  requestAnimationFrame(frame);
  const rawDt = clock.getDelta();
  let dt = Math.min(rawDt, 0.05);
  if (G.mode === 'menu') return;
  if (G.mode === 'paused') { renderer.render(scene, camera); return; }
  FPS.acc += rawDt; FPS.n++; if (FPS.acc >= 1) { FPS.value = FPS.n / FPS.acc; FPS.samples.push(Math.round(FPS.value)); if (FPS.samples.length > 120) FPS.samples.shift(); FPS.acc = 0; FPS.n = 0; }
  perfAcc += dt; perfFrames++; perfCheckT += dt;
  if (perfCheckT > 3) {
    const avg = perfAcc / perfFrames;
    if (avg > 1 / 40 && pixelRatio > Q.prMin) { pixelRatio = Math.max(Q.prMin, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); onResize(); }
    else if (avg < 1 / 58 && pixelRatio < Math.min(window.devicePixelRatio || 1, Q.prCap)) { pixelRatio = Math.min(Q.prCap, pixelRatio + 0.25); renderer.setPixelRatio(pixelRatio); onResize(); }
    perfAcc = perfFrames = perfCheckT = 0;
  }
  if (hitStop > 0) { hitStop -= dt; dt *= 0.08; }
  G.time += dt;
  if (G.mode === 'play' || G.mode === 'dead' || G.mode === 'win') {
    if (G.mode === 'play' && P.state !== 'dead') G.playTime += dt;
    updateGun(dt);
    updatePlayer(dt);
    for (let i = zombies.length - 1; i >= 0; i--) if (zombies[i]) updateZombie(zombies[i], dt);
    separateZombies();
    updateProjectiles(dt);
    if (G.mode === 'play') updateWaves(dt);
    updateParts(dt);
    updateCamera(dt);
    updateFx(dt);
    updateHud(dt);
    if (G.mode === 'play' && P.state === 'dead' && P.t > 1.8) endScreen(false);
  }
  renderer.render(scene, camera);
}
// warm-up: compile shaders with representative objects so first spawn doesn't stutter
resetInventory();
applyQuality(qSetting);
(function warm() {
  const tmp = ['walker', 'runner', 'brute', 'spitter', 'armored'].map(t => buildZombie(t)).concat([buildBoss()]);
  tmp.forEach((r, i) => { r.root.position.set(i * 3 - 6, 0, -5); scene.add(r.root); });
  dropPickup('ammo', 0, -3); dropPickup('part', 1, -3, 'scope');
  for (const k in guns) guns[k].g.visible = true;
  camera.position.set(0, 2, 6); camera.lookAt(0, 1, 0);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  tmp.forEach(r => { scene.remove(r.root); r.mats.forEach(m => m.dispose()); });
  for (let i = pickups.length - 1; i >= 0; i--) removePickup(i);
  refreshWeaponVisuals();
})();
// ---- rigged heroine: load the GLB behind the loading screen; menu becomes usable when done (fallback: v0.4 procedural)
function swapHero(R) {
  scene.remove(hero.root);
  for (const k in guns) {
    const g = guns[k].g; R.gunMount.add(g);
    // Quaternius hands are big: scale the guns up and push them forward so the slide/barrel clears the fingers
    if (R.rigged) { g.scale.setScalar(k === 'pistol' ? 1.45 : 1.15); g.position.set(0, -0.012, k === 'pistol' ? 0.06 : 0.035); }
  }
  hero = R; scene.add(R.root);
  R.root.position.set(P.pos.x, P.gy, P.pos.z); R.root.rotation.y = P.facing;
  applyQuality(qSetting);
  refreshWeaponVisuals();
  try { renderer.compile(scene, camera); } catch (e) { }
}
function setLoad(k, label) {
  const bar = $('ldBar'), pct = $('ldPct'), txt = $('ldTxt');
  if (bar) bar.style.width = Math.round(k * 100) + '%';
  if (pct) pct.textContent = Math.round(k * 100) + '%';
  if (txt && label) txt.textContent = label;
}
(async function bootHero() {
  setLoad(0.05, '載入角色模型…');
  let fake = 0.05, curK = 0; const tick = setInterval(() => { fake = Math.min(0.85, fake + 0.03); setLoad(Math.max(fake, curK)); }, 120);
  try {
    if (/[?&]hero=proc/.test(location.search)) throw new Error('procedural forced by URL');
    const gltf = await loadHeroGLB(HERO_GLB + '?v=20261005c', k => { curK = 0.1 + k * 0.8; setLoad(curK); });
    setLoad(0.92, '組裝星璃…');
    swapHero(buildRiggedHeroine(gltf, { buildMachete, starGeo, glowSprite }));
    window.__heroMode = 'rigged';
  } catch (e) {
    console.warn('rigged heroine unavailable, using procedural fallback:', e && e.message ? e.message : e);
    window.__heroMode = 'procedural';
  }
  clearInterval(tick);
  setLoad(1, '準備完成');
  await new Promise(r => setTimeout(r, 180));
  $('loading').classList.add('hidden');
})();
frame();

// debug/test hook
window.__zb = { scene, acquireTarget, bulletRay, rayCast, W, G, P, INV, zombies, pickups, spawnZombie, spawnAtEdge, damagePlayer, damageZombie, killZombie, startWave, unlockWeapon, switchWeapon, equipPart, dropPickup, applyQuality, CAM, FPS, get hero() { return hero; }, camera, renderer, pauseGame, resumeGame, get pixelRatio() { return pixelRatio; }, get flashT() { return flashT; }, freeze() { G.mode = 'paused'; }, unfreeze() { G.mode = 'play'; clock.getDelta(); }, tryFire, renderUpgradePanel, get Q() { return Q; }, AUTO_Q };
