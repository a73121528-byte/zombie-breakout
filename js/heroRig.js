import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

// ============================================================================
// Rigged heroine 星璃 built on assets/models/female_hooded.glb (Quaternius, CC0).
// Materials are cloned per mesh and recolored (black leather + bronze trim),
// long purple hair (back layer + 3-segment ponytail), star ornament and coat
// tails are procedural geometry attached to bones. Clips are in place; the game
// moves hero.root. Exposes the same fields main.js uses for the procedural rig
// (root, body, weapon, holster, gunMount, mats, star) plus rigged-only extras.
// ============================================================================
export const HERO_GLB = 'assets/models/female_hooded.glb';
export const HERO_SCALE = 0.95; // model is 1.84 m tall -> ~1.75 m like the v0.4 heroine

export function loadHeroGLB(url, onProgress) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, resolve, e => { if (onProgress && e && e.total) onProgress(e.loaded / e.total); }, reject);
  });
}

const HC = {
  coat: 0x1d1a22, coatHi: 0x2b2731, inner: 0x34303c, pants: 0x221f28, boot: 0x121015, bronze: 0x9a6232, bronzeHi: 0xc08040,
  skin: 0xe8d4c8, eye: 0x1a1024, hair: 0x5a2f8c, hairHi: 0x8452c4, hairDk: 0x3a1c60, strap: 0x2c1c14, metal: 0x2e2a34,
};
// per-part recolor: [color, shininess, specular]
const RECOLOR = {
  head: { White: [HC.hair, 40, 0x50306a], DarkBrown: [HC.coat, 34, 0x2a2630], Skin: [HC.skin, 12, 0x221a1a], Black: [HC.eye, 60, 0x444444], Brown: [HC.hairDk, 20, 0x221a2a] },
  body: { Black: [HC.coatHi, 34, 0x2a2630], LightBrown: [HC.inner, 30, 0x2a2630], DarkBrown: [HC.coat, 38, 0x2e2a34], Skin: [HC.skin, 12, 0x221a1a], Gold: [HC.bronzeHi, 70, 0x8a6030], Metal: [HC.metal, 60, 0x605868] },
  legs: { Black: [HC.pants, 24, 0x222026] },
  feet: { LightBrown: [HC.boot, 40, 0x2a2630], DarkBrown: [HC.strap, 30, 0x2a2630] },
};
const LEATHER_KEYS = new Set(['head:DarkBrown', 'body:DarkBrown', 'body:Black', 'body:LightBrown']);

function partOf(o) {
  for (let p = o; p; p = p.parent) {
    const n = p.name || '';
    if (/Sword/i.test(n)) return 'sword';
    if (/Head/.test(n) && /Medieval/.test(n)) return 'head';
    if (/Body/.test(n) && /Medieval/.test(n)) return 'body';
    if (/Legs/.test(n)) return 'legs';
    if (/Feet/.test(n)) return 'feet';
  }
  return 'other';
}

// a Group under `bone` whose bind-pose world frame = bone origin, model axes, metric scale
function boneMount(bone, modelRoot, name) {
  const g = new THREE.Group(); g.name = name || ''; bone.add(g);
  const bp = new THREE.Vector3(); bone.getWorldPosition(bp);
  const rq = new THREE.Quaternion(); modelRoot.parent ? modelRoot.parent.getWorldQuaternion(rq) : rq.identity();
  const want = new THREE.Matrix4().compose(bp, rq, new THREE.Vector3(1, 1, 1));
  const local = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(want);
  local.decompose(g.position, g.quaternion, g.scale);
  return g;
}
// bbox of a skinned part in a mount's frame (bind pose)
function boxIn(objs, mount) {
  const inv = new THREE.Matrix4().copy(mount.matrixWorld).invert(), b = new THREE.Box3(), t = new THREE.Box3();
  for (const o of objs) {
    if (o.isSkinnedMesh) { o.computeBoundingBox(); t.copy(o.boundingBox); } else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); t.copy(o.geometry.boundingBox); }
    t.applyMatrix4(o.matrixWorld).applyMatrix4(inv); b.union(t);
  }
  return b;
}

// small vertex-colored parts kit (capsules / sheets) merged into one mesh per parent
function colored(geo, color, p, r, s) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(r || [0, 0, 0]))), new THREE.Vector3(...(s || [1, 1, 1])));
  g.applyMatrix4(m);
  const c = new THREE.Color(color), n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
function mergedMesh(list, mat) { const g = mergeGeometries(list, false); list.forEach(x => x.dispose()); g.computeBoundingSphere(); const m = new THREE.Mesh(g, mat); m.castShadow = true; return m; }

export function buildRiggedHeroine(gltf, helpers) {
  const { buildMachete, starGeo, glowSprite } = helpers;
  const root = new THREE.Group(); root.name = 'heroRigged';
  const body = new THREE.Group(); root.add(body); // procedural-compat pivot (used for scale / reset)
  const model = gltf.scene; model.scale.setScalar(HERO_SCALE); body.add(model);
  root.updateMatrixWorld(true);
  const R = { root, body, model, rigged: true };
  // ---- materials: clone per mesh + recolor, convert to Phong (cheaper, matches the game's lighting)
  const shimmer = [], meshes = { head: [], body: [], legs: [], feet: [], sword: [] };
  let sword = null;
  model.traverse(o => {
    if (!o.isMesh) return;
    const part = partOf(o); (meshes[part] || (meshes[part] = [])).push(o);
    if (part === 'sword') return;
    const src = o.material, key = src.name, rc = (RECOLOR[part] || {})[key];
    const mat = new THREE.MeshPhongMaterial({ color: rc ? rc[0] : src.color.getHex(), shininess: rc ? rc[1] : 20, specular: rc ? rc[2] : 0x222222, emissive: 0x050308 });
    mat.name = part + ':' + key;
    if (LEATHER_KEYS.has(part + ':' + key)) shimmer.push(mat);
    o.material = mat; o.castShadow = true; o.userData.cast = true;
    if (o.isSkinnedMesh) o.frustumCulled = false;
  });
  const bone = n => model.getObjectByName(n);
  const B = { head: bone('Head'), hips: bone('Hips'), torso: bone('Torso'), chest: bone('Chest') || bone('Torso'), wristR: bone('WristR') || bone('Wrist.R'), wristL: bone('WristL') || bone('Wrist.L') };
  for (const k in B) if (!B[k]) throw new Error('hero rig: missing bone ' + k);
  R.bones = B;
  // ---- weapon grip frame: the built-in sword's transform, re-parented under Wrist.R
  if (!sword) sword = model.getObjectByName('Sword');
  const grip = new THREE.Group(); grip.name = 'grip'; B.wristR.add(grip);
  {
    const sp = new THREE.Vector3(), sq = new THREE.Quaternion(), ss = new THREE.Vector3();
    let bladeAxis = new THREE.Vector3(0, 1, 0), flatAxis = new THREE.Vector3(1, 0, 0);
    if (sword) {
      sword.matrixWorld.decompose(sp, sq, ss);
      const sms = sword.isMesh ? [sword] : sword.children.filter(c => c.isMesh);
      if (sms.length) {
        // quantized geometry is re-centred, so derive the blade direction from the hand -> blade centre
        const bb = new THREE.Box3(); for (const m of sms) { m.geometry.computeBoundingBox(); bb.union(m.geometry.boundingBox); }
        const size = [0, 1, 2].map(i => bb.max.getComponent(i) - bb.min.getComponent(i));
        const ia = size.indexOf(Math.max(...size)), it = size.indexOf(Math.min(...size));
        const hand = new THREE.Vector3(); (model.getObjectByName('Middle1R') || B.wristR).getWorldPosition(hand);
        const cW = bb.getCenter(new THREE.Vector3()).applyMatrix4(sms[0].matrixWorld);
        const axW = new THREE.Vector3().setComponent(ia, 1).applyQuaternion(sq);
        bladeAxis = new THREE.Vector3().setComponent(ia, axW.dot(cW.clone().sub(hand)) >= 0 ? 1 : -1);
        flatAxis = new THREE.Vector3().setComponent(it === ia ? (ia + 1) % 3 : it, 1);
        const wr = new THREE.Vector3(); B.wristR.getWorldPosition(wr);
        sp.copy(hand).lerp(wr, 0.35); // grip point: between the knuckles and the wrist
      }
      sword.visible = false;
    } else B.wristR.getWorldPosition(sp), B.wristR.getWorldQuaternion(sq);
    const want = new THREE.Matrix4().compose(sp, sq, new THREE.Vector3(HERO_SCALE, HERO_SCALE, HERO_SCALE));
    new THREE.Matrix4().copy(B.wristR.matrixWorld).invert().multiply(want).decompose(grip.position, grip.quaternion, grip.scale);
    // machete: blade +Z, flat normal +X, edge +Y  ->  sword blade axis / flat normal
    const zb = bladeAxis.clone().normalize(), xb = flatAxis.clone().projectOnPlane(zb).normalize(), yb = new THREE.Vector3().crossVectors(zb, xb);
    R.bladeBasis = new THREE.Matrix4().makeBasis(xb, yb, zb);
  }
  const weapon = new THREE.Group(); weapon.name = 'weapon'; grip.add(weapon);
  const machete = buildMachete(); machete.quaternion.setFromRotationMatrix(R.bladeBasis); machete.position.set(0, 0, 0); weapon.add(machete);
  machete.traverse(o => { if (o.isMesh) { o.castShadow = true; o.userData.cast = true; } });
  R.weapon = weapon; R.grip = grip;
  R.gunMount = new THREE.Group(); R.gunMount.name = 'gunMount'; grip.add(R.gunMount);
  R.foreR = grip; // parent used for world-space gun orientation
  // ---- mounts in model axes (bind pose)
  const headM = boneMount(B.head, model, 'headMount');
  const hipsM = boneMount(B.hips, model, 'hipsMount');
  const chestM = boneMount(B.chest, model, 'chestMount');
  root.updateMatrixWorld(true);
  // mounts were built with world scale 1 -> they live in metres of the *scaled* model (root scale 1)
  const hb = boxIn(meshes.head, headM), lb = boxIn(meshes.legs, hipsM), cb = boxIn(meshes.body, chestM);
  R.measure = { head: hb, legs: lb, chest: cb };
  // ---- hair (vertex colored Phong)
  const hairMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 40, specular: 0x50306a, emissive: 0x050308 });
  const hw = (hb.max.x - hb.min.x) / 2, hcx = (hb.max.x + hb.min.x) / 2, backZ = hb.min.z, botY = hb.min.y, topY = hb.max.y, frontZ = hb.max.z;
  {
    const L = [], cap = new THREE.CapsuleGeometry(1, 1, 3, 6);
    // back layer: strands emerging under the hood, down over the shoulder blades
    for (let i = 0; i < 11; i++) {
      const a = (i / 10 - 0.5) * 2.3, r = hw * 0.78;
      const x = hcx + Math.sin(a) * r, z = backZ * 0.55 + Math.cos(a + Math.PI) * -r * 0.35 - Math.abs(Math.sin(a)) * 0.01;
      const len = 0.34 - Math.abs(a) * 0.05;
      L.push(colored(cap, [HC.hair, HC.hairHi, HC.hairDk][i % 3], [x, botY + 0.05 - len / 2, z - 0.015], [0.18 + Math.abs(a) * 0.05, 0, -Math.sin(a) * 0.12], [0.03, len / 2, 0.013]));
    }
    // side locks falling in front of the shoulders
    for (const s of [1, -1]) {
      L.push(colored(cap, HC.hair, [hcx + s * hw * 0.62, botY + 0.02, frontZ - 0.07], [0.05, 0, s * 0.08], [0.02, 0.1, 0.012]));
      L.push(colored(cap, HC.hairHi, [hcx + s * hw * 0.5, botY + 0.0, frontZ - 0.055], [0.08, 0, s * 0.12], [0.014, 0.075, 0.01]));
    }
    const back = mergedMesh(L, hairMat); headM.add(back); R.hairBack = back;
  }
  // ponytail chain (3 segments), base at the hood's back opening; oriented in world space each frame
  const pony = []; {
    const segLen = [0.2, 0.22, 0.22], segR = [0.048, 0.042, 0.03];
    const base = new THREE.Group(); base.name = 'ponyBase'; base.position.set(hcx, botY + 0.1, backZ + 0.035); headM.add(base);
    let parent = base;
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group(); g.position.set(0, i === 0 ? 0 : -segLen[i - 1], 0); parent.add(g);
      const L = [], cap = new THREE.CapsuleGeometry(1, 1, 3, 8);
      L.push(colored(cap, HC.hair, [0, -segLen[i] / 2, 0], [0, 0, 0], [segR[i] * 1.1, segLen[i] / 2, segR[i] * 0.75]));
      for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2 + i; L.push(colored(cap, k === 0 ? HC.hairHi : k === 1 ? HC.hairDk : HC.hair, [Math.cos(a) * segR[i] * 0.7, -segLen[i] / 2 - 0.01, Math.sin(a) * segR[i] * 0.5], [Math.sin(a) * 0.1, 0, Math.cos(a) * 0.12], [segR[i] * 0.42, segLen[i] * 0.45, segR[i] * 0.42])); }
      if (i === 2) { const cone = new THREE.ConeGeometry(1, 1, 6); L.push(colored(cone, HC.hairDk, [0, -segLen[i] - 0.03, 0], [Math.PI, 0, 0], [0.024, 0.09, 0.018])); }
      if (i === 0) { const tor = new THREE.TorusGeometry(1, 0.28, 5, 10); L.push(colored(tor, HC.bronzeHi, [0, -0.015, 0], [Math.PI / 2, 0, 0], [0.042, 0.042, 0.042])); }
      g.add(mergedMesh(L, hairMat)); pony.push(g); parent = g;
    }
    R.ponyBase = base;
  }
  R.pony = pony;
  // star hair ornament on the hood's left temple + glow
  const starMat = new THREE.MeshLambertMaterial({ color: 0xffd36a, emissive: 0x8a5a10 });
  const star = new THREE.Mesh(starGeo(), starMat);
  star.position.set(hcx + hw * 0.8, topY - 0.11, frontZ - 0.045); star.rotation.set(0, 1.25, -0.3); star.scale.setScalar(0.034); headM.add(star);
  const starGlow = glowSprite(0xffc860, 0.12, 0.5); starGlow.position.copy(star.position); headM.add(starGlow);
  R.star = star;
  // ---- coat tails: two open-front layers from the waist to the knees, bronze hems (double sided)
  const coatSide = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 34, specular: 0x2a2630, side: THREE.DoubleSide, emissive: 0x050308 });
  shimmer.push(coatSide);
  {
    const waistY = lb.max.y - 0.03, rx = 0.15, zc = 0.0;
    const prof = (r0, r1, y0, len) => [[r0, y0 + 0.02], [r0 * 1.04, y0 - len * 0.18], [lerp(r0, r1, 0.55), y0 - len * 0.55], [r1, y0 - len]].map(([r, y]) => new THREE.Vector2(r, y));
    const L = [];
    const outer = new THREE.LatheGeometry(prof(rx * 1.02, rx * 1.6, waistY, 0.6), 22, 0.62, Math.PI * 2 - 1.24);
    L.push(colored(outer, HC.coat, [0, 0, zc], [0, 0, 0], [1, 1, 0.85]));
    const hem = new THREE.LatheGeometry([new THREE.Vector2(rx * 1.56, waistY - 0.57), new THREE.Vector2(rx * 1.61, waistY - 0.605)], 22, 0.62, Math.PI * 2 - 1.24);
    L.push(colored(hem, HC.bronze, [0, 0, zc], [0, 0, 0], [1.01, 1, 0.86]));
    const top = new THREE.LatheGeometry(prof(rx * 1.07, rx * 1.4, waistY + 0.01, 0.3), 22, 0.95, Math.PI * 2 - 1.9);
    L.push(colored(top, HC.coatHi, [0, 0, zc], [0, 0, 0], [1, 1, 0.88]));
    const hem2 = new THREE.LatheGeometry([new THREE.Vector2(rx * 1.37, waistY - 0.27), new THREE.Vector2(rx * 1.41, waistY - 0.295)], 22, 0.95, Math.PI * 2 - 1.9);
    L.push(colored(hem2, HC.bronze, [0, 0, zc], [0, 0, 0], [1.01, 1, 0.89]));
    const belt = new THREE.CylinderGeometry(1, 1, 1, 22, 1, true);
    L.push(colored(belt, HC.strap, [0, waistY - 0.005, zc], [0, 0, 0], [rx * 1.06, 0.035, rx * 1.06 * 0.85]));
    const tails = new THREE.Group(); tails.name = 'coatTails'; tails.position.set(0, waistY, 0); hipsM.add(tails);
    const mesh = mergedMesh(L, coatSide); mesh.position.y = -waistY; tails.add(mesh);
    R.skirt = tails;
  }
  // ---- holstered machete on the back (shown when a gun is out)
  const holster = new THREE.Group(); holster.name = 'holster'; chestM.add(holster);
  holster.position.set(-0.05, 0.02, cb.min.z - 0.03); holster.rotation.set(Math.PI / 2, 0, 0.55, 'ZYX');
  const hm = buildMachete(); hm.scale.setScalar(0.95); holster.add(hm); holster.visible = false;
  R.holster = holster;
  R.mats = { coat: shimmer[0], coatSide, star: starMat, face: null, shimmer, hair: hairMat };
  // ---- animation
  const mixer = new THREE.AnimationMixer(model), actions = {};
  for (const c of gltf.animations) actions[c.name] = mixer.clipAction(c);
  R.mixer = mixer; R.actions = actions; R.clips = Object.fromEntries(gltf.animations.map(c => [c.name, c]));
  R.anim = { cur: null, name: '' };
  R.play = (name, o = {}) => {
    const a = actions[name]; if (!a) return null;
    const A = R.anim, fade = o.fade ?? 0.15;
    if (A.name === name && !o.restart) { if (o.ts != null) a.timeScale = o.ts; return a; }
    a.reset(); a.enabled = true; a.setEffectiveWeight(1);
    a.timeScale = o.ts ?? 1;
    a.setLoop(o.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = !!o.once;
    if (o.start) a.time = o.start;
    a.play();
    if (A.cur && A.cur !== a) a.crossFadeFrom(A.cur, fade, false);
    else if (A.cur === a && fade > 0) { /* restart same clip: quick fade-in */ a.fadeIn(Math.min(fade, 0.06)); }
    A.cur = a; A.name = name;
    return a;
  };
  R.resetAnim = () => { mixer.stopAllAction(); R.anim.cur = null; R.anim.name = ''; R.play('Idle', { fade: 0 }); };
  R.resetAnim();
  root.traverse(o => { if (o.isMesh && o.userData.cast === undefined) { o.castShadow = true; o.userData.cast = true; } });
  return R;
}
function lerp(a, b, k) { return a + (b - a) * k; }
