import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { clone as skClone } from 'three/addons/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { creaseNormals } from './heroRig.js?v=20261008a';

// ============================================================================
// v0.5 step3: rigged zombies on Quaternius CC0 zombie_a.glb / zombie_chubby.glb.
// One SkeletonUtils clone + AnimationMixer per instance (clips shared). The
// cartoon models are made creepier in code: smaller lifted head, hunched spine
// (pivot Object3Ds inserted into the bone chain, so the mixer never fights the
// offsets), tongue tucked in, glowing irises, and a skin shader that paints
// grey-green bruised skin, veins, blood and torn dark clothes from a generated
// detail texture (triplanar in bind-pose model space; per-vertex material class
// and body part are baked from the palette atlas + skin weights at load time).
// Gameplay (hit circles, weak points) stays in main.js and is mesh independent.
// ============================================================================
export const ZOMBIE_GLB = { a: 'assets/models/zombie_a.glb', chubby: 'assets/models/zombie_chubby.glb' };
const ZR = { ready: false, src: {}, tpl: {}, low: false, fine: true, glowSprite: null };
export const zombieRigReady = () => ZR.ready;

export function loadZombieModels(ver, onProgress) {
  const keys = Object.keys(ZOMBIE_GLB), prog = {};
  return Promise.all(keys.map(k => new Promise((res, rej) => {
    new GLTFLoader().load(ZOMBIE_GLB[k] + (ver ? '?v=' + ver : ''), g => res([k, g]), e => { if (e && e.total) { prog[k] = e.loaded / e.total; onProgress && onProgress(keys.reduce((s, q) => s + (prog[q] || 0), 0) / keys.length); } }, rej);
  }))).then(list => { for (const [k, g] of list) ZR.src[k] = prepSource(g, k); ZR.ready = true; return ZR; });
}
export function initZombieRig(opts) { Object.assign(ZR, opts); }
// quality hook: low = single-scale detail, no eye halos on new spawns
export function setZombieQuality(low) { ZR.low = low; ZR.fine = !low; }
export function applyZombieDetail(mats) {
  for (const m of mats) if (m.userData && m.userData.zskin) { const want = ZR.fine; if (!!m.defines.ZB_FINE !== want) { if (want) m.defines.ZB_FINE = 1; else delete m.defines.ZB_FINE; m.needsUpdate = true; } }
}

// ---------------------------------------------------------------- palette classes
// 0 skin, 1 dark skin (ears, brows, eyelids), 2 trousers/shorts, 3 belt/leather, 4 eye socket / dark,
// 5 teeth, 6 mouth flesh / tongue, 7 dirty shoe, 9 dark red
const PAL = {
  a: { '779850': 0, '64733f': 1, '252023': 1, '151515': 4, '989870': 5, '984871': 6, '823a3a': 6, '405464': 2, '674631': 3, 'b3b3b3': 7, '642226': 9, 'e8b871': 3 },
  chubby: { '5f6397': 0, '769751': 0, '141414': 4, '979770': 5, '977b28': 6, '974870': 6, '63503f': 2, '3f5363': 2 },
};
const PART = n => /Head|Tongue|Eyelid|Mouth/.test(n) ? 0 : /Hips|Abdomen|Torso|Neck|Body|Shoulder/.test(n) ? 1 : /UpperArm/.test(n) ? 2 : /LowerArm|Pinky|Middle|Index|Thumb/.test(n) ? 3 : /Leg/.test(n) ? 4 : 5;
function nearestClass(table, r, g, b) {
  let best = 0, bd = 1e9;
  for (const k in table) { const v = parseInt(k, 16), d = Math.abs((v >> 16) - r) + Math.abs(((v >> 8) & 255) - g) + Math.abs((v & 255) - b); if (d < bd) { bd = d; best = table[k]; } }
  return best;
}
function prepSource(gltf, key) {
  const scene = gltf.scene; scene.updateMatrixWorld(true);
  const clips = {}; for (const c of gltf.animations) clips[c.name] = c;
  let img = null; scene.traverse(o => { if (o.isMesh && !img && o.material.map) img = o.material.map.image; });
  let px = null, W = 0, H = 0;
  if (img) { W = img.width; H = img.height; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); px = g.getImageData(0, 0, W, H).data; }
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  const table = PAL[key];
  scene.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const geo = o.geometry; if (geo.attributes.zinf) return;
    creaseNormals(geo, 52); // v0.6: smooth shading on the low-poly zombie bodies
    const N = geo.attributes.position.count, uv = geo.attributes.uv, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, na = geo.attributes.normal;
    const zp = new Float32Array(N * 3), zn = new Float32Array(N * 3), zi = new Float32Array(N * 2);
    nm.getNormalMatrix(o.matrixWorld);
    for (let i = 0; i < N; i++) {
      o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
      zp[i * 3] = v.x; zp[i * 3 + 1] = v.y; zp[i * 3 + 2] = v.z;
      if (na) { n.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); zn[i * 3] = n.x; zn[i * 3 + 1] = n.y; zn[i * 3 + 2] = n.z; } else zn[i * 3 + 1] = 1;
      let cls = 0;
      if (px && uv) { const x = Math.min(W - 1, Math.max(0, Math.floor(uv.getX(i) * W))), y = Math.min(H - 1, Math.max(0, Math.floor(uv.getY(i) * H))), k = (y * W + x) * 4; cls = nearestClass(table, px[k], px[k + 1], px[k + 2]); }
      const ws4 = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)], is4 = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)]; let bi = is4[0], bw = ws4[0]; for (let j = 1; j < 4; j++) if (ws4[j] > bw) { bw = ws4[j]; bi = is4[j]; }
      const part = PART(o.skeleton.bones[bi].name);
      if (o.name === 'Eyelid') cls = 1;
      if (key === 'a' && cls === 4 && part === 5) cls = 7; // shoe sole
      if (key === 'a' && cls === 5 && part !== 0) cls = 3; // belt buckle
      zi[i * 2] = cls; zi[i * 2 + 1] = part;
    }
    geo.setAttribute('zpos', new THREE.BufferAttribute(zp, 3));
    geo.setAttribute('znrm', new THREE.BufferAttribute(zn, 3));
    geo.setAttribute('zinf', new THREE.BufferAttribute(zi, 2));
  });
  return { key, gltf, scene, clips };
}

// ---------------------------------------------------------------- detail texture (tileable, data channels)
// R veins, G mottling noise, B blood stains, A tear noise
let detTex = null;
function hash2(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(S, period, seed) {
  const out = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const fx = x / S * period, fy = y / S * period, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = hash2(ix % period, iy % period, seed), b = hash2((ix + 1) % period, iy % period, seed), c = hash2(ix % period, (iy + 1) % period, seed), d = hash2((ix + 1) % period, (iy + 1) % period, seed);
    out[y * S + x] = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  }
  return out;
}
function fbm(S, base, oct, seed) {
  const acc = new Float32Array(S * S); let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) { const n = vnoise(S, base << o, seed + o * 17); for (let i = 0; i < acc.length; i++) acc[i] += n[i] * amp; tot += amp; amp *= 0.5; }
  for (let i = 0; i < acc.length; i++) acc[i] /= tot;
  return acc;
}
function getDetailTex() {
  if (detTex) return detTex;
  const S = 256, rnd = (() => { let s = 9137; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })();
  const cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d', { willReadFrequently: true });
  const wrapDraw = fn => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.save(); g.translate(ox, oy); fn(); g.restore(); } };
  // veins: branching random walks
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S); g.lineCap = 'round';
  const vein = (x, y, a, len, w, depth) => {
    const pts = [[x, y]];
    for (let i = 0; i < len; i++) { a += (rnd() - 0.5) * 0.9; x += Math.cos(a) * 4; y += Math.sin(a) * 4; pts.push([x, y]); if (depth < 2 && rnd() < 0.09) vein(x, y, a + (rnd() < 0.5 ? 1 : -1) * (0.5 + rnd() * 0.6), len * 0.5 | 0, w * 0.65, depth + 1); }
    wrapDraw(() => { for (const [lw, al] of [[w * 2.6, 0.18], [w, 0.85]]) { g.strokeStyle = `rgba(255,255,255,${al})`; g.lineWidth = lw; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.stroke(); } });
  };
  for (let i = 0; i < 9; i++) vein(rnd() * S, rnd() * S, rnd() * 6.28, 14 + rnd() * 20 | 0, 1.1 + rnd() * 0.8, 0);
  const R = g.getImageData(0, 0, S, S).data;
  // blood: splats with droplets and drips
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 7; i++) {
    const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 26;
    wrapDraw(() => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.6, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); for (let k = 0; k <= 14; k++) { const a = k / 14 * 6.283, rr = r * (0.6 + rnd() * 0.5); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill();
      g.fillStyle = 'rgba(255,255,255,.9)'; for (let k = 0; k < 7; k++) { const a = rnd() * 6.283, d = r * (0.9 + rnd() * 0.9); g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 1 + rnd() * 2.5, 0, 6.283); g.fill(); }
      for (let k = 0; k < 3; k++) { const dx = x + (rnd() - 0.5) * r; g.fillRect(dx, y, 1.5 + rnd() * 2, r * (0.6 + rnd() * 1.4)); }
    });
  }
  const B = g.getImageData(0, 0, S, S).data;
  const G = fbm(S, 4, 5, 3), A = fbm(S, 4, 4, 41);
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) { data[i * 4] = R[i * 4]; data[i * 4 + 1] = Math.min(255, G[i] * 255); data[i * 4 + 2] = B[i * 4]; data[i * 4 + 3] = Math.min(255, A[i] * 255); }
  detTex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  detTex.wrapS = detTex.wrapT = THREE.RepeatWrapping; detTex.magFilter = THREE.LinearFilter; detTex.minFilter = THREE.LinearMipmapLinearFilter; detTex.generateMipmaps = true; detTex.needsUpdate = true;
  return detTex;
}

// ---------------------------------------------------------------- skin shader (Lambert + onBeforeCompile)
const VERT_HEAD = `attribute vec3 zpos;\nattribute vec3 znrm;\nattribute vec2 zinf;\nvarying vec3 vZPos;\nvarying vec3 vZN;\nflat varying float vZCls;\nflat varying float vZPart;\n`;
const FRAG_HEAD = `uniform sampler2D tDet;\nuniform vec3 uPal[10];\nuniform vec3 uSkin;\nuniform vec3 uCloth;\nuniform vec3 uPants;\nuniform vec3 uBlood;\nuniform vec3 uBruise;\nuniform vec4 uShirt;\nuniform vec4 uDet;\nvarying vec3 vZPos;\nvarying vec3 vZN;\nflat varying float vZCls;\nflat varying float vZPart;\n`;
const FRAG_BODY = `
{
  int cls = int(vZCls + 0.5); int part = int(vZPart + 0.5);
  vec3 P = vZPos * uDet.x + uDet.w;
  vec3 tw = pow(abs(normalize(vZN)), vec3(4.0)); tw /= (tw.x + tw.y + tw.z + 1e-4);
  vec4 D = texture2D(tDet, P.zy) * tw.x + texture2D(tDet, P.xz) * tw.y + texture2D(tDet, P.xy) * tw.z;
#ifdef ZB_FINE
  vec3 P2 = P * 0.29 + vec3(0.37, 0.11, 0.63);
  vec4 E = texture2D(tDet, P2.zy) * tw.x + texture2D(tDet, P2.xz) * tw.y + texture2D(tDet, P2.xy) * tw.z;
#else
  vec4 E = D.gbar;
#endif
  float blood = smoothstep(0.5, 0.8, E.b * 0.7 + D.b * 0.45) * uDet.y;
  vec3 col;
  if (cls <= 1) {
    vec3 s = uSkin * (cls == 1 ? 0.7 : 1.0);
    s *= 0.58 + 0.75 * D.g;
    s = mix(s, uBruise, smoothstep(0.45, 0.78, E.g) * 0.85);
    s = mix(s, s * vec3(1.15, 1.2, 0.85), smoothstep(0.55, 0.3, E.g) * 0.5);
    s *= 1.0 - D.r * 0.7;
    s = mix(s, vec3(0.05, 0.06, 0.1), D.r * 0.35);
    col = mix(s, uBlood, blood);
    if (uShirt.z > 0.5 && (part == 1 || part == 2) && vZPos.y > uShirt.x + (E.a - 0.5) * 0.1 && vZPos.y < uShirt.y) {
      float tm = E.a * 0.55 + D.a * 0.45;
      float keep = smoothstep(uShirt.w - 0.015, uShirt.w + 0.015, tm);
      vec3 c = uCloth * (0.62 + 0.55 * D.g) * (0.5 + 0.5 * smoothstep(uShirt.w, uShirt.w + 0.16, tm));
      c = mix(c, uBlood * 0.8, blood * 0.85);
      col = mix(col * (0.75 + 0.25 * smoothstep(uShirt.w - 0.08, uShirt.w - 0.015, tm)), c, keep);
    }
  } else if (cls == 2) {
    col = uPants * (0.62 + 0.55 * D.g);
    col = mix(col, uBlood * 0.75, blood * 0.8);
  } else {
    col = uPal[cls] * (0.8 + 0.4 * D.g);
    if (cls == 5) col = mix(col, uBlood, blood * 0.7);
  }
  diffuseColor.rgb *= col;
}
`;
const C = (h) => new THREE.Color(h);
function makeSkinMat(style, rnd) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x000000 });
  const jit = (h, k) => { const c = C(h); const hsl = {}; c.getHSL(hsl); return c.setHSL(hsl.h + (rnd() - 0.5) * 0.03 * k, hsl.s * (0.85 + rnd() * 0.3), hsl.l * (0.88 + rnd() * 0.24)); };
  const pick = a => a[(rnd() * a.length) | 0];
  const u = {
    tDet: { value: getDetailTex() },
    uPal: { value: [C(0), C(0), C(0), C(0x1e1712), C(0x080404), C(0x7a6f52), C(0x2e070a), C(0x3a3632), C(0), C(0x2a0e10)] },
    uSkin: { value: jit(pick(style.skin), 1) },
    uCloth: { value: jit(pick(style.cloth), 1) },
    uPants: { value: jit(pick(style.pants), 1) },
    uBlood: { value: C(style.blood || 0x3c0507) },
    uBruise: { value: C(style.bruise || 0x3b2a3a) },
    uShirt: { value: new THREE.Vector4(...(style.shirt || [0, 0, 0, 0.4])) },
    uDet: { value: new THREE.Vector4(style.detScale || 2.6, style.bloodAmt ?? 0.85, 0, rnd() * 10) },
  };
  m.userData.zskin = true; m.userData.u = u;
  if (ZR.fine) m.defines = { ZB_FINE: 1 }; else m.defines = {};
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, m.userData.u);
    sh.vertexShader = VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvZPos = zpos; vZN = znrm; vZCls = zinf.x; vZPart = zinf.y;');
    sh.fragmentShader = FRAG_HEAD + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + FRAG_BODY);
  };
  m.customProgramCacheKey = () => 'zbskin1';
  return m;
}

// ---------------------------------------------------------------- styles per type
const STYLE = {
  walker: { src: 'a', scale: 1.5, ns: [1, 1, 1], head: 0.76, lift: 0.05, hunch: 0.36, nod: -0.22, eye: 0xffe2a0, eyeR: 0.026,
    skin: [0x4e5a44, 0x535a44, 0x4a5642, 0x585a4a], cloth: [0x2a3040, 0x3a2e24, 0x2e2e32, 0x3e1e1e, 0x2c3426], pants: [0x262a34, 0x2e2a22, 0x232327], shirt: [0.47, 0.95, 1, 0.36], clipWalk: 'Walk' },
  runner: { src: 'a', scale: 1.5, ns: [0.8, 1.04, 0.84], head: 0.74, lift: 0.06, hunch: 0.5, nod: -0.4, eye: 0xff4a30, eyeR: 0.024,
    skin: [0x5e544e, 0x5a5048, 0x56504a], cloth: [0x4a1216, 0x1e2638, 0x2a2a18], pants: [0x1c1c22, 0x26262c], shirt: [0.47, 0.95, 1, 0.46], bloodAmt: 1.0, clipWalk: 'Walk' },
  spitter: { src: 'a', scale: 1.46, ns: [1.02, 1, 1.02], head: 0.76, lift: 0.04, hunch: 0.26, nod: -0.1, eye: 0x9cff60, eyeR: 0.026,
    skin: [0x56622e, 0x505c30, 0x5a6034], bruise: 0x4a5a2a, cloth: [0x34362c, 0x3e3a2e], pants: [0x26281f], shirt: [0.47, 0.95, 1, 0.3], blood: 0x2c3a08, bloodAmt: 0.7, clipWalk: 'Walk' },
  armored: { src: 'a', scale: 1.52, ns: [1.04, 1, 1.04], head: 0.76, lift: 0.05, hunch: 0.16, nod: -0.05, eye: 0xff3a2a, eyeR: 0.024,
    skin: [0x4c5446, 0x50504a], cloth: [0x161c2a], pants: [0x161a26], shirt: [0.47, 0.95, 1, 0.12], bloodAmt: 0.6, clipWalk: 'Walk' },
  brute: { src: 'chubby', scale: 1.7, ns: [1.12, 1, 1.1], head: 0.8, lift: 0.0, hunch: 0.22, nod: -0.12, eye: 0xffa040, eyeR: 0.03,
    skin: [0x3e4440, 0x423e3a, 0x3a403a], bruise: 0x2e2228, cloth: [0x26221e, 0x1e2226], pants: [0x231d18, 0x1e1e22], shirt: [0.7, 1.32, 1, 0.38], detScale: 2.2, clipWalk: 'Walk' },
  boss: { src: 'chubby', scale: 2.8, ns: [1.1, 1, 1.08], head: 0.8, lift: 0.0, hunch: 0.26, nod: -0.15, eye: 0xffd84a, eyeR: 0.034,
    skin: [0x4a3634, 0x46383a], bruise: 0x4a1a20, cloth: [0x1a1414], pants: [0x1e1814], shirt: [0, 0, 0, 0], blood: 0x4a0608, bloodAmt: 1.0, detScale: 1.9, clipWalk: 'Walk' },
};
export const RIG_TYPES = Object.keys(STYLE);

// ---------------------------------------------------------------- helpers
function boneMount(bone, name) {
  const g = new THREE.Group(); g.name = name || ''; bone.add(g);
  const bp = new THREE.Vector3(); bone.getWorldPosition(bp);
  const want = new THREE.Matrix4().makeTranslation(bp.x, bp.y, bp.z);
  new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(want).decompose(g.position, g.quaternion, g.scale);
  g.userData.origin = bp.clone();
  return g;
}
// merged vertex-coloured parts in a mount (positions given in model space)
function partsKit() {
  const L = [];
  const k = {
    add(geo, color, p, s = [1, 1, 1], r = [0, 0, 0]) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)));
      const c = new THREE.Color(color), n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(a)) g.deleteAttribute(a);
      L.push(g); return k;
    },
    build(mount, mat) {
      if (!L.length) return null;
      const geo = mergeGeometries(L, false); L.forEach(x => x.dispose()); L.length = 0;
      const o = mount.userData.origin; geo.translate(-o.x, -o.y, -o.z); geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.userData.cast = true; mount.add(m); return m;
    },
  };
  return k;
}
const GEO = {
  sph: new THREE.SphereGeometry(1, 12, 9), sphLo: new THREE.SphereGeometry(1, 8, 6), cone: new THREE.ConeGeometry(1, 1, 6), box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10), tor: new THREE.TorusGeometry(1, 0.18, 6, 16),
};
function seeded(s) { return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
// insert an Object3D between `bone` and its parent (rotations/scales on it never conflict with the mixer)
function insertPivot(bone, name) {
  const p = new THREE.Object3D(); p.name = name; const par = bone.parent;
  par.add(p); p.position.copy(bone.position); bone.position.set(0, 0, 0); par.remove(bone); p.add(bone);
  return p;
}
function localAxis(obj, worldAxis) { const q = new THREE.Quaternion(); obj.getWorldQuaternion(q); return worldAxis.clone().applyQuaternion(q.invert()).normalize(); }
// local quaternion that makes bone -> child point along worldDir (bind pose)
function aimBone(bone, child, worldDir) {
  bone.updateWorldMatrix(true, true);
  const a = new THREE.Vector3(), b = new THREE.Vector3(); bone.getWorldPosition(a); child.getWorldPosition(b);
  const rest = b.sub(a).normalize(), dq = new THREE.Quaternion().setFromUnitVectors(rest, worldDir.clone().normalize());
  const wq = new THREE.Quaternion(); bone.getWorldQuaternion(wq);
  const pq = new THREE.Quaternion(); bone.parent.getWorldQuaternion(pq);
  const local = pq.invert().multiply(dq.multiply(wq));
  bone.quaternion.copy(local); bone.updateWorldMatrix(false, true);
  return local.clone();
}
let crackTex = null;
function visorCrackTex() {
  if (crackTex) return crackTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = 'rgba(30,40,50,0.55)'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(170,180,190,0.55)'; g.lineWidth = 0.9;
  const cx = 80, cy = 56;
  for (let i = 0; i < 13; i++) { const a = i / 13 * 6.28 + Math.random() * 0.3; let x = cx, y = cy; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += Math.cos(a + (Math.random() - 0.5) * 0.6) * 9; y += Math.sin(a + (Math.random() - 0.5) * 0.6) * 9; g.lineTo(x, y); } g.stroke(); }
  for (let r = 5; r < 26; r += 7) { g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke(); }
  g.fillStyle = 'rgba(90,6,8,0.95)'; for (let i = 0; i < 10; i++) g.fillRect(16 + Math.random() * 90, 64 + Math.random() * 50, 2 + Math.random() * 2, 3 + Math.random() * 10);
  crackTex = new THREE.CanvasTexture(c); crackTex.colorSpace = THREE.SRGBColorSpace; return crackTex;
}

// ---------------------------------------------------------------- per-type template
function buildTemplate(type) {
  const S = STYLE[type], src = ZR.src[S.src];
  const root = skClone(src.scene); root.updateMatrixWorld(true);
  const bone = n => root.getObjectByName(n);
  const B = { head: bone('Head'), neck: bone('Neck'), torso: bone('Torso'), abdomen: bone('Abdomen'), hips: bone('Hips'), uaL: bone('UpperArmL'), laL: bone('LowerArmL'), handL: bone('Middle1L'), uaR: bone('UpperArmR'), laR: bone('LowerArmR') };
  root.traverse(o => { if (o.isSkinnedMesh) { o.frustumCulled = false; o.castShadow = true; o.userData.cast = true; o.userData.zskin = true; } });
  const T = { type, style: S, root, clips: src.clips, guard: null };
  const rng = seeded(77 + type.length * 131);
  const gearMats = [];
  const vc = (o = {}) => { const m = new THREE.MeshLambertMaterial({ vertexColors: true, ...o }); gearMats.push(m); return m; };
  const eyeMat = new THREE.MeshBasicMaterial({ color: S.eye });
  // ---- glowing irises in front of the eye sockets
  const headM = boneMount(B.head, 'zHeadMount');
  const eyePos = S.src === 'a' ? [[0.13, 0.9, 0.318], [-0.13, 0.9, 0.318]] : [[0.16, 1.4, 0.02], [-0.16, 1.4, 0.02]];
  for (const p of eyePos) {
    const e = new THREE.Mesh(GEO.sphLo, eyeMat); e.position.set(p[0], p[1], p[2]).sub(headM.userData.origin); e.scale.set(S.eyeR, S.eyeR * 0.75, S.eyeR * 0.6); e.userData.cast = false; headM.add(e);
    if (ZR.glowSprite) { const g = ZR.glowSprite(S.eye, S.eyeR * 7, 0.5); g.position.copy(e.position); g.position.z += 0.02; g.userData.zEyeGlow = true; headM.add(g); }
  }
  // ---- type extras
  if (type === 'spitter') {
    const sac = new THREE.Group(); sac.name = 'sac'; headM.add(sac);
    sac.position.set(0, 0.6, 0.24).sub(headM.userData.origin);
    const sacMat = new THREE.MeshPhongMaterial({ color: 0x4a7a22, emissive: 0x3cff40, emissiveIntensity: 0.9, transparent: true, opacity: 0.7, shininess: 90, specular: 0xccffaa, depthWrite: false });
    sacMat.userData.op = 0.7; sacMat.name = 'sac';
    const s1 = new THREE.Mesh(GEO.sph, sacMat); s1.scale.set(0.11, 0.095, 0.1); sac.add(s1);
    const s2 = new THREE.Mesh(GEO.sph, sacMat); s2.scale.set(0.065, 0.06, 0.06); s2.position.set(0.075, -0.035, 0.02); sac.add(s2);
    const s3 = new THREE.Mesh(GEO.sph, sacMat); s3.scale.set(0.05, 0.045, 0.05); s3.position.set(-0.07, -0.045, 0.03); sac.add(s3);
    const coreM = new THREE.MeshBasicMaterial({ color: 0xb8ff70 }); coreM.name = 'sacCore';
    const sc = new THREE.Mesh(GEO.sphLo, coreM); sc.scale.setScalar(0.04); sc.position.set(-0.01, -0.01, 0.02); sac.add(sc);
    if (ZR.glowSprite) { const gs = ZR.glowSprite(0x7aff40, 0.32, 0.35); gs.position.z = 0.05; sac.add(gs); }
    const vk = partsKit(); vk.add(GEO.sph, 0x1a3a0c, [0, 0.6 + 0.02, 0.24 - 0.02], [0.105, 0.085, 0.09]); // dark inner mass
    vk.build(headM, vc());
    T.sacMat = sacMat;
  }
  if (type === 'armored') {
    // riot helmet + cracked visor (head mount, shrinks with the head scale)
    const hk = partsKit(), navy = 0x1a2030, dark = 0x0c0e12;
    hk.add(new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.56), navy, [0, 0.95, 0.1], [0.36, 0.33, 0.37]);
    hk.add(GEO.tor, dark, [0, 0.93, 0.1], [0.36, 0.37, 0.4], [Math.PI / 2, 0, 0]);
    hk.add(GEO.box, 0xd8d4c8, [0, 1.15, -0.2], [0.18, 0.05, 0.05], [0.7, 0, 0]);
    hk.add(GEO.box, dark, [0.3, 0.8, 0.12], [0.03, 0.22, 0.06]); hk.add(GEO.box, dark, [-0.3, 0.8, 0.12], [0.03, 0.22, 0.06]);
    hk.build(headM, vc({ emissive: 0x020304 }));
    const visorMat = new THREE.MeshPhongMaterial({ map: visorCrackTex(), transparent: true, opacity: 0.85, shininess: 120, specular: 0xffffff, side: THREE.DoubleSide, depthWrite: false });
    visorMat.userData.op = 0.85; gearMats.push(visorMat);
    const vg = new THREE.SphereGeometry(1, 16, 8, Math.PI * 0.5 - Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.32, Math.PI * 0.3); // centred on +Z
    const visor = new THREE.Mesh(vg, visorMat); visor.position.set(0, 0.9, 0.12).sub(headM.userData.origin); visor.scale.set(0.38, 0.38, 0.4); visor.rotation.y = 0; headM.add(visor);
    // tactical vest (front + sides only: the back stays exposed = weak point)
    const torsoM = boneMount(B.torso, 'zTorsoMount'), vk = partsKit(), vest = 0x1c222c;
    const vgeo = new THREE.CylinderGeometry(1, 1.06, 1, 14, 1, true, -Math.PI * 0.72, Math.PI * 1.44);
    vk.add(vgeo, vest, [0, 0.6, -0.11], [0.27, 0.3, 0.2]);
    vk.add(GEO.box, 0x14181e, [0, 0.62, 0.095], [0.3, 0.2, 0.03]);
    for (let i = -1; i <= 1; i++) vk.add(GEO.box, 0x22282e, [i * 0.09, 0.53, 0.11], [0.075, 0.08, 0.035]);
    vk.add(GEO.box, 0xd8d4c8, [0, 0.67, 0.112], [0.16, 0.035, 0.005]);
    for (const s of [1, -1]) vk.add(GEO.box, vest, [0.16 * s, 0.76, -0.1], [0.07, 0.03, 0.26]);
    vk.add(GEO.box, 0x5a0a0c, [0.09, 0.58, 0.115], [0.06, 0.12, 0.004], [0, 0, 0.5]);
    vk.build(torsoM, vc());
    const wk = partsKit();
    wk.add(GEO.sph, 0x2e0608, [0.02, 0.62, -0.258], [0.085, 0.1, 0.025]);
    wk.add(GEO.sph, 0x5a1014, [0.03, 0.64, -0.266], [0.05, 0.065, 0.018]); wk.add(GEO.sphLo, 0x6a1a1c, [-0.03, 0.6, -0.266], [0.03, 0.035, 0.015]);
    for (let i = 0; i < 3; i++) wk.add(GEO.cyl, 0xb8a888, [0.0, 0.57 + i * 0.045, -0.27], [0.008, 0.11, 0.008], [0, 0, Math.PI / 2 + 0.15]);
    wk.build(torsoM, vc({ emissive: 0x1a0204 }));
    // guard pose for the shield arm + shield on the forearm (built in that pose so it faces forward)
    const q0 = B.uaL.quaternion.clone(), q1 = B.laL.quaternion.clone();
    const gU = aimBone(B.uaL, B.laL, new THREE.Vector3(0.25, -0.6, 0.55));
    const gL = aimBone(B.laL, B.handL, new THREE.Vector3(-0.8, 0.12, 0.45));
    root.updateMatrixWorld(true);
    const armM = boneMount(B.laL, 'zShieldMount');
    const a = new THREE.Vector3(), b = new THREE.Vector3(); B.laL.getWorldPosition(a); B.handL.getWorldPosition(b);
    const mid = a.clone().lerp(b, 0.55);
    const shield = new THREE.Group(); shield.name = 'shield'; armM.add(shield); shield.position.copy(mid).sub(armM.userData.origin).add(new THREE.Vector3(0, -0.03, 0.09));
    const sk = partsKit(); const so = armM.userData.origin.clone().sub(shield.position); // build around shield origin
    const at = (x, y, z) => [x, y, z];
    sk.add(GEO.box, 0x0c0d10, at(0, 0, 0), [0.34, 0.56, 0.025]);
    sk.add(GEO.box, 0x4a5868, at(0, 0.01, 0.012), [0.3, 0.5, 0.008]);
    sk.add(GEO.box, 0xd8d8d0, at(0, 0.17, 0.018), [0.22, 0.04, 0.003]);
    sk.add(GEO.box, 0x0c0d10, at(0, -0.13, 0.018), [0.28, 0.012, 0.003]);
    sk.add(GEO.box, 0x4a0608, at(0.06, -0.04, 0.018), [0.1, 0.16, 0.003], [0, 0, 0.4]);
    const shM = new THREE.Group(); shM.userData.origin = new THREE.Vector3(); shield.add(shM);
    sk.build(shM, vc({ emissive: 0x020304 }));
    const swin = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.09), visorMat); swin.position.set(0, 0.2 - 0.03, 0.017); shield.add(swin);
    B.uaL.quaternion.copy(q0); B.laL.quaternion.copy(q1); root.updateMatrixWorld(true);
    T.guard = [['UpperArmL', gU], ['LowerArmL', gL]];
  }
  if (type === 'brute') {
    const torsoM = boneMount(B.torso, 'zTorsoMount'), k = partsKit();
    for (let i = 0; i < 5; i++) k.add(GEO.cyl, 0x0e0a0a, [-0.12 + i * 0.03, 0.95 + i * 0.05, 0.2 + i * 0.004], [0.005, 0.07, 0.005], [Math.PI / 2 - 0.1, 0, 1.4]); // stitches
    k.add(GEO.box, 0x1a1210, [0.0, 0.98, 0.19], [0.22, 0.012, 0.01], [0, 0, 0.35]);
    for (let i = 0; i < 4; i++) k.add(GEO.cone, 0xa89a80, [0.18 - i * 0.1, 1.2 + (i % 2) * 0.05, -0.36], [0.03, 0.12, 0.03], [-1.1, 0, 0]);
    k.build(torsoM, vc());
  }
  if (type === 'boss') {
    const torsoM = boneMount(B.torso, 'zTorsoMount'), abM = boneMount(B.abdomen, 'zAbMount');
    const BN = 0xb0a084, FL = 0x3e1a1e, FL2 = 0x4a2c2c, DK = 0x140608;
    const tk = partsKit(), sk = partsKit();
    // tumours (lumpy flesh clusters) on back, shoulders and flank
    const lumps = [[0.25, 1.1, -0.3, 0.13], [0.33, 1.02, -0.2, 0.09], [-0.28, 0.95, -0.34, 0.12], [-0.2, 1.18, -0.28, 0.08], [0.3, 0.72, 0.05, 0.1], [0.36, 0.8, -0.02, 0.07], [-0.33, 0.7, -0.1, 0.09], [0.05, 1.25, -0.35, 0.1], [-0.08, 0.86, -0.42, 0.11]];
    for (const [x, y, z, r] of lumps) { tk.add(GEO.sph, rng() < 0.5 ? FL : FL2, [x, y, z], [r, r * 0.85, r * 0.9]); for (let j = 0; j < 3; j++) tk.add(GEO.sphLo, FL2, [x + (rng() - 0.5) * r * 1.6, y + (rng() - 0.5) * r * 1.4, z + (rng() - 0.3) * r], [r * 0.4, r * 0.38, r * 0.36]); }
    // bone spikes from the spine and shoulders
    for (let i = 0; i < 7; i++) sk.add(GEO.cone, BN, [(i % 2 ? 0.05 : -0.05), 0.7 + i * 0.09, -0.42 + i * 0.01], [0.035, 0.22 + (i % 3) * 0.06, 0.035], [-1.25 + i * 0.05, 0, (i % 2 ? -0.3 : 0.3)]);
    for (const s of [1, -1]) for (let i = 0; i < 3; i++) sk.add(GEO.cone, BN, [s * (0.2 + i * 0.06), 1.22 - i * 0.04, -0.15 - i * 0.04], [0.03, 0.2, 0.03], [-0.5, 0, -s * (0.5 + i * 0.25)]);
    tk.build(torsoM, vc()); sk.build(torsoM, vc());
    // arm spikes + tumours
    for (const [ua, s] of [[B.uaL, 1], [B.uaR, -1]]) {
      const m = boneMount(ua, ''), k = partsKit(), o = m.userData.origin;
      for (let i = 0; i < 3; i++) k.add(GEO.cone, BN, [o.x + s * (0.06 + i * 0.07), o.y + 0.04, o.z - 0.06], [0.025, 0.16, 0.025], [-0.6, 0, -s * 0.9]);
      k.add(GEO.sph, FL, [o.x + s * 0.12, o.y - 0.05, o.z + 0.02], [0.08, 0.07, 0.07]);
      k.build(m, vc());
    }
    // chest core: torn ribcage socket + pulsing core + glowing veins
    const cp = new THREE.Vector3(0, 0.84, 0.235);
    const rk = partsKit();
    rk.add(GEO.sph, DK, [cp.x, cp.y, cp.z - 0.02], [0.16, 0.18, 0.06]);
    rk.add(GEO.tor, 0x4a1418, [cp.x, cp.y, cp.z - 0.005], [0.15, 0.17, 0.2]);
    for (let i = 0; i < 4; i++) for (const s of [1, -1]) rk.add(GEO.cyl, BN, [cp.x + s * 0.13, cp.y - 0.12 + i * 0.08, cp.z + 0.01], [0.012, 0.13, 0.012], [0, 0, s * (1.2 - i * 0.12)]);
    rk.build(abM, vc());
    const core = new THREE.Group(); core.name = 'core'; abM.add(core); core.position.copy(cp).sub(abM.userData.origin); core.position.z += 0.02;
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffd84a }); coreMat.name = 'core';
    const cm = new THREE.Mesh(GEO.sph, coreMat); cm.scale.set(0.085, 0.095, 0.06); core.add(cm);
    if (ZR.glowSprite) core.add(ZR.glowSprite(0xffb020, 0.42, 0.55));
    const veinMat = new THREE.MeshBasicMaterial({ color: 0xff9a2a }); veinMat.name = 'vein';
    const vk = partsKit();
    for (let i = 0; i < 10; i++) { // crooked 3-segment veins crawling out of the socket
      let a = i / 10 * 6.283 + rng() * 0.4, x = cp.x + Math.cos(a) * 0.15, y = cp.y + Math.sin(a) * 0.16, w = 0.007;
      for (let k = 0; k < 3; k++) { const L = 0.04 + rng() * 0.05; a += (rng() - 0.5) * 0.9; const nx = x + Math.cos(a) * L, ny = y + Math.sin(a) * L; vk.add(GEO.box, 0xffffff, [(x + nx) / 2, (y + ny) / 2, cp.z - 0.035 - k * 0.012], [L * 1.1, w, w], [0, 0, a]); x = nx; y = ny; w *= 0.75; }
    }
    const vm = vk.build(abM, veinMat); vm.castShadow = false; vm.userData.cast = false;
    T.coreMat = coreMat; T.veinMat = veinMat;
  }
  // ---- creepier proportions: smaller lifted head, hunch pivots, tongue tucked in
  T.axTorsoX = localAxis(B.abdomen, new THREE.Vector3(1, 0, 0));
  const hp = insertPivot(B.torso, 'zHunch');
  const np = insertPivot(B.head, 'zHeadPivot');
  T.axHeadX = localAxis(B.neck, new THREE.Vector3(1, 0, 0)); T.axHeadZ = localAxis(B.neck, new THREE.Vector3(0, 0, 1));
  { root.updateMatrixWorld(true); const hw = new THREE.Vector3(); B.head.getWorldPosition(hw); const a = B.neck.worldToLocal(hw.clone()), b = B.neck.worldToLocal(hw.clone().add(new THREE.Vector3(0, S.lift, S.lift * 0.3))); np.position.add(b.sub(a)); } np.userData.base = np.position.clone();
  B.head.scale.set(S.head * 0.92, S.head * 1.05, S.head * 0.97);
  for (const n of ['Tongue2']) { const t = bone(n); if (t) t.scale.setScalar(0.02); }
  { const t = bone('Tongue1'); if (t) t.scale.setScalar(0.5); }
  T.gearMats = gearMats; T.eyeMat = eyeMat;
  T.nat = {};
  for (const cn of ['Walk', 'Run_Arms']) {
    const c = src.clips[cn]; if (!c) continue; const tr = c.tracks.find(t => t.name === 'FootL.position'); if (!tr) continue;
    let lo = 1e9, hi = -1e9; for (let i = 2; i < tr.values.length; i += 3) { lo = Math.min(lo, tr.values[i]); hi = Math.max(hi, tr.values[i]); }
    const fp = new THREE.Vector3(), fq = new THREE.Vector3(0, 0, hi - lo); const fb = bone('FootL'); fb.parent.getWorldScale(fp); // track units -> model units
    T.nat[cn] = (hi - lo) * fp.z / (c.duration * 0.55);
  }
  return T;
}

// ---------------------------------------------------------------- instance
const NEED = ['Idle', 'Walk', 'Run_Arms', 'Punch', 'Run_Attack', 'Idle_Attack', 'HitReact', 'Death'];
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
export function buildRiggedZombie(type, gameScale = 1) {
  if (!ZR.ready) return null;
  const T = ZR.tpl[type] || (ZR.tpl[type] = buildTemplate(type)), S = T.style;
  const rnd = Math.random;
  const model = skClone(T.root);
  const root = new THREE.Group(); root.name = 'zrig_' + type; root.add(model);
  const sj = 0.94 + rnd() * 0.12, k = S.scale * sj / gameScale;
  model.scale.set(k * S.ns[0], k * S.ns[1], k * S.ns[2]);
  // materials: one fresh skin material per instance (own tint uniforms, shared program); gear cloned
  const skin = makeSkinMat(S, rnd), mats = [skin], map = new Map(), glows = [];
  model.traverse(o => {
    if (o.userData.glow) { glows.push(o); if (o.userData.zEyeGlow && ZR.low) o.visible = false; }
    if (!o.material) return;
    if (o.userData.zskin) { o.material = skin; return; }
    let m = map.get(o.material); if (!m) { m = o.material.clone(); map.set(o.material, m); mats.push(m); } o.material = m;
  });
  const R = { rigged: true, type, root, model, mats, glows, style: S, hunch: S.hunch, nod: S.nod, sj };
  R.skinMat = skin;
  R.sacMat = T.sacMat ? map.get(T.sacMat) : null; R.coreMat = T.coreMat ? map.get(T.coreMat) : null; R.veinMat = T.veinMat ? map.get(T.veinMat) : null;
  R.core = model.getObjectByName('core') || null; R.sac = model.getObjectByName('sac') || null;
  R.hunchPivot = model.getObjectByName('zHunch'); R.headPivot = model.getObjectByName('zHeadPivot');
  R.axTorsoX = T.axTorsoX; R.axHeadX = T.axHeadX; R.axHeadZ = T.axHeadZ; R.headBase = R.headPivot.userData.base;
  R.guard = T.guard ? T.guard.map(([n, q]) => [model.getObjectByName(n), q]) : null;
  // animation
  const mixer = new THREE.AnimationMixer(model), actions = {};
  for (const n of NEED) if (T.clips[n]) actions[n] = mixer.clipAction(T.clips[n]);
  R.mixer = mixer; R.actions = actions; R.clips = T.clips;
  const ws = S.scale * sj; R.natWalk = (T.nat.Walk || 0.6) * ws; R.natRun = (T.nat.Run_Arms || 1.6) * ws;
  R.speed = 0.88 + rnd() * 0.24; R.acc = 0; R.anim = { cur: null, name: '' }; R.lastHitK = 0; R.hitT = 0; R.dead = false;
  R.play = (name, o = {}) => {
    const a = actions[name]; if (!a) return null;
    const A = R.anim, fade = o.fade ?? 0.2;
    if (A.name === name && !o.restart) { if (o.ts != null) a.timeScale = o.ts; return a; }
    a.reset(); a.enabled = true; a.setEffectiveWeight(1); a.timeScale = o.ts ?? 1;
    a.setLoop(o.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = !!o.once;
    a.time = o.start != null ? o.start : (o.once ? 0 : rnd() * a.getClip().duration);
    a.play();
    if (A.cur && A.cur !== a) a.crossFadeFrom(A.cur, fade, false);
    A.cur = a; A.name = name; return a;
  };
  // after a mixer update: armored shield-arm guard pose
  R.postMix = (w) => { if (R.guard && w > 0) for (const [b, q] of R.guard) b.quaternion.slerp(q, w); };
  // procedural spine / head offsets (pivots: never touched by the mixer)
  R.pose = (hunch, nod, roll) => {
    R.hunchPivot.quaternion.setFromAxisAngle(R.axTorsoX, hunch);
    _q1.setFromAxisAngle(R.axHeadX, nod); _q2.setFromAxisAngle(R.axHeadZ, roll);
    R.headPivot.quaternion.multiplyQuaternions(_q1, _q2);
  };
  R.play('Idle', { fade: 0 });
  R.pose(R.hunch, R.nod, 0);
  mixer.update(rnd() * 0.5);
  return R;
}
export function disposeRiggedZombie(R) { R.mixer.stopAllAction(); R.mixer.uncacheRoot(R.model); R.mats.forEach(m => m.dispose()); }
