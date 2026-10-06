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
  coat: 0x1d1a22, coatHi: 0x2b2731, inner: 0x34303c, pants: 0x221f28, boot: 0x1d1922, bronze: 0x9a6232, bronzeHi: 0xc08040,
  skin: 0xe8d4c8, eye: 0x1a1024, hair: 0x5a2f8c, hairHi: 0x8452c4, hairDk: 0x3a1c60, strap: 0x2c1c14, metal: 0x2e2a34,
};
// per-part recolor: [color, shininess, specular]
const RECOLOR = {
  head: { White: [HC.hair, 40, 0x50306a], DarkBrown: [HC.coat, 34, 0x2a2630], Skin: [HC.skin, 12, 0x221a1a], Black: [HC.eye, 60, 0x444444], Brown: [HC.hairDk, 20, 0x221a2a] },
  body: { Black: [HC.coatHi, 34, 0x2a2630], LightBrown: [HC.inner, 30, 0x2a2630], DarkBrown: [HC.coat, 38, 0x2e2a34], Skin: [HC.skin, 12, 0x221a1a], Gold: [HC.bronzeHi, 70, 0x8a6030], Metal: [HC.metal, 60, 0x605868] },
  legs: { Black: [HC.pants, 24, 0x222026] },
  feet: { LightBrown: [HC.boot, 22, 0x141218], DarkBrown: [HC.strap, 22, 0x1a1614] }, // low specular: boots read pale/grey under the street lamps otherwise
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
  // left arm chain for the two-handed long-gun hold (analytic two-bone IK, applied after the mixer)
  R.armL = { ua: bone('UpperArmL') || bone('UpperArm.L'), la: bone('LowerArmL') || bone('LowerArm.L'), wr: B.wristL };
  R.armR = { ua: bone('UpperArmR') || bone('UpperArm.R'), la: bone('LowerArmR') || bone('LowerArm.R'), wr: B.wristR };
  R.legs = { L: [bone('UpperLegL'), bone('LowerLegL')], R: [bone('UpperLegR'), bone('LowerLegR')] };
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
  // ---- hair (vertex colored Phong, hue-locked so it stays purple under the magenta neon)
  const hairMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 55, specular: 0x6a40a0, emissive: 0x0c0418 });
  hairMat.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `{
      float hl = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
      vec3 hb = diffuseColor.rgb / max(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), 1e-4);
      outgoingLight = mix(outgoingLight, hb * hl, 0.72);
    }
    #include <opaque_fragment>`);
  };
  hairMat.customProgramCacheKey = () => 'zbhair1';
  const hw = (hb.max.x - hb.min.x) / 2, hcx = (hb.max.x + hb.min.x) / 2, backZ = hb.min.z, botY = hb.min.y, topY = hb.max.y, frontZ = hb.max.z;
  // tapered, slightly curved strand (tip at y = -1)
  const strand = (curve = 0.25) => { const g = new THREE.CylinderGeometry(1, 0.18, 1, 6, 5); g.translate(0, -0.5, 0); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, p.getZ(i) - curve * y * y); } g.computeVertexNormals(); return g; };
  const SG = strand(0.25), SGs = strand(0.5), SGf = strand(-0.35);
  const HAIRC = [HC.hair, HC.hairHi, HC.hairDk, 0x6a3aa0];
  R.hairGroups = [];
  {
    // back curtain in 3 sway groups (left / centre / right), two layers: inner darker + longer, outer lighter
    const pivY = botY + 0.06, pivZ = backZ * 0.5;
    for (let gi = 0; gi < 3; gi++) {
      const grp = new THREE.Group(); grp.name = 'hairBack' + gi; grp.position.set(hcx + (gi - 1) * hw * 0.42, pivY, pivZ); headM.add(grp);
      const L = [];
      for (let layer = 0; layer < 2; layer++) {
        const n = layer ? 6 : 5;
        for (let i = 0; i < n; i++) {
          const u = (gi - 1) * 0.42 + ((i + 0.5) / n - 0.5) * 0.42 + (layer ? 0.02 : -0.02), a = u * 2.4, r = hw * (0.74 + layer * 0.06);
          const x = Math.sin(a) * r - (gi - 1) * hw * 0.42, z = -Math.abs(Math.cos(a)) * r * 0.32 - 0.012 - layer * 0.012;
          const len = (layer ? 0.3 : 0.37) - Math.abs(u) * 0.08 + ((i * 7 + gi * 3) % 5) * 0.012;
          const w = layer ? 0.024 : 0.03;
          L.push(colored(layer ? SG : SGs, HAIRC[(i + gi + layer) % 4], [x, 0.015, z], [0.12 + Math.abs(u) * 0.12, 0, -u * 0.35], [w, len, w * 0.45]));
        }
      }
      grp.add(mergedMesh(L, hairMat)); R.hairGroups.push(grp);
    }
  }
  {
    // bangs under the hood rim + layered side locks framing the face
    const L = [];
    const by = Math.min(topY - 0.09, 0.172), bz = frontZ - 0.018;
    for (let i = 0; i < 11; i++) { const u = (i / 10 - 0.5); L.push(colored(SGf, HAIRC[i % 4], [hcx + u * 0.15, by + 0.005, bz - u * u * 0.12], [-0.3, u * 0.5, u * 0.6 + (i % 2 ? 0.1 : -0.1)], [0.0105, 0.032 + (i % 3) * 0.006 - Math.abs(u) * 0.012, 0.0045])); }
    for (const s of [1, -1]) for (let k = 0; k < 3; k++) {
      L.push(colored(SGf, HAIRC[(k + (s > 0 ? 1 : 0)) % 4], [hcx + s * (hw * 0.56 - k * 0.012), botY + 0.13 - k * 0.01, frontZ - 0.06 - k * 0.012], [0.08 + k * 0.05, 0, s * (0.06 + k * 0.05)], [0.017 - k * 0.003, 0.2 + k * 0.03, 0.007]));
    }
    const front = mergedMesh(L, hairMat); headM.add(front); R.hairFront = front;
  }
  // ponytail chain (4 segments of layered tapered strands), base at the hood's back opening; oriented in world space each frame
  const pony = []; {
    const segLen = [0.16, 0.17, 0.17, 0.16], segR = [0.046, 0.044, 0.036, 0.026];
    const base = new THREE.Group(); base.name = 'ponyBase'; base.position.set(hcx, botY + 0.1, backZ + 0.035); headM.add(base);
    let parent = base;
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group(); g.position.set(0, i === 0 ? 0 : -segLen[i - 1] * 0.92, 0); parent.add(g);
      const L = [], cap = new THREE.CapsuleGeometry(1, 1, 3, 8);
      L.push(colored(cap, HC.hair, [0, -segLen[i] / 2, 0], [0, 0, 0], [segR[i], segLen[i] / 2 + segR[i] * 0.4, segR[i] * 0.72]));
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + i * 0.7; L.push(colored(SG, HAIRC[(k + i) % 4], [Math.cos(a) * segR[i] * 0.62, 0.01, Math.sin(a) * segR[i] * 0.45], [Math.sin(a) * 0.12, 0, Math.cos(a) * 0.12], [segR[i] * 0.42, segLen[i] * (1.05 + (k % 3) * 0.08), segR[i] * 0.3])); }
      if (i === 3) for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + 0.4; L.push(colored(SG, HAIRC[k % 4], [Math.cos(a) * 0.01, -segLen[i] * 0.7, Math.sin(a) * 0.008], [Math.sin(a) * 0.25, 0, Math.cos(a) * 0.25], [0.012, 0.11 + k * 0.012, 0.006])); }
      if (i === 0) { const tor = new THREE.TorusGeometry(1, 0.28, 5, 10); L.push(colored(tor, HC.bronzeHi, [0, -0.015, 0], [Math.PI / 2, 0, 0], [0.044, 0.044, 0.044])); L.push(colored(tor, HC.bronze, [0, -0.032, 0], [Math.PI / 2, 0, 0], [0.04, 0.04, 0.04])); }
      g.add(mergedMesh(L, hairMat)); pony.push(g); parent = g;
    }
    R.ponyBase = base;
  }
  R.pony = pony;
  // ---- face decal: eyes (purple irises, lashes, catch-lights) + brows over the low-poly eyes
  {
    const fb = boxIn(meshes.head.filter(o => /Skin/.test(o.material.name)), headM), eb = boxIn(meshes.head.filter(o => /Brown/.test(o.material.name)), headM);
    if (fb.max.z > fb.min.z && eb.max.z > eb.min.z) {
      const W = 0.12, H = 0.05, ppm = 256 / W, cy = (eb.min.y + eb.max.y) / 2 - 0.0125; // eyes sit just under the brow geometry
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = Math.round(H * ppm); const g = cv.getContext('2d');
      const eyeX = 0.027 * ppm, eyeY = cv.height * 0.5, w = 0.0128 * ppm, h = 0.0062 * ppm, ir = 0.0058 * ppm;
      for (const sd of [-1, 1]) {
        const x = 128 + sd * eyeX, y = eyeY;
        g.save(); g.beginPath(); g.ellipse(x, y, w, h, 0, 0, Math.PI * 2); g.clip();
        g.fillStyle = '#d6c8cc'; g.fillRect(x - w, y - h, w * 2, h * 2);
        const ig = g.createRadialGradient(x, y + 1, 1, x, y + 1, ir); ig.addColorStop(0, '#1a0a2a'); ig.addColorStop(0.35, '#8a58d8'); ig.addColorStop(0.8, '#4a2290'); ig.addColorStop(1, '#22103a');
        g.fillStyle = ig; g.beginPath(); g.arc(x, y + 1, ir, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#0a0410'; g.beginPath(); g.arc(x, y + 1, ir * 0.38, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(40,20,40,.5)'; g.fillRect(x - w, y - h, w * 2, h * 0.55); // lid shadow
        g.restore();
        g.fillStyle = 'rgba(255,255,255,.95)'; g.beginPath(); g.arc(x + ir * 0.35, y - ir * 0.3, ir * 0.24, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#120812'; g.lineCap = 'round'; g.lineWidth = Math.max(2.5, h * 0.42);
        g.beginPath(); g.ellipse(x, y + 1, w + 1, h + 2, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
        g.lineWidth *= 0.7; g.beginPath(); g.moveTo(x + sd * (w - 1), y - h * 0.5); g.lineTo(x + sd * (w + h * 0.9), y - h * 1.1); g.stroke();
        g.strokeStyle = 'rgba(40,16,30,.5)'; g.lineWidth = 1.4; g.beginPath(); g.ellipse(x, y - 1, w - 2, h + 1, 0, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
      }
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const faceMat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, emissive: 0x150c14 });
      // curved patch hugging the face: cylinder segment around Y
      const Rc = 0.085, ang = W / Rc, geo = new THREE.CylinderGeometry(Rc, Rc, H, 12, 1, true, -ang / 2, ang);
      const face = new THREE.Mesh(geo, faceMat); face.renderOrder = 2;
      face.position.set(hcx, cy, fb.max.z + 0.003 - Rc); headM.add(face);
      R.face = face; R.faceMat = faceMat;
    }
  }
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
    // coat tails split into 4 panels (front-left, back-left, back-right, front-right), each with an upper and a
    // lower hinge so they swing with the thighs and bend/trail with speed (driven from main.js animateRigged)
    const waistY = lb.max.y - 0.03, rx = 0.15, sz = 0.85, midY = waistY - 0.3, botY2 = waistY - 0.6;
    const tails = new THREE.Group(); tails.name = 'coatTails'; tails.position.set(0, waistY, 0); hipsM.add(tails);
    const rUp0 = rx * 1.02, rMid = lerp(rx * 1.02, rx * 1.6, 0.5), rBot = rx * 1.6;
    const P4 = [[0.62, 1.75, 1, true], [1.75, Math.PI, 1, false], [Math.PI, 2 * Math.PI - 1.75, -1, false], [2 * Math.PI - 1.75, 2 * Math.PI - 0.62, -1, true]];
    R.coatPanels = [];
    for (const [p0, p1, side, front] of P4) {
      const pm = (p0 + p1) / 2, hz = Math.cos(pm) * rUp0 * sz, hx = Math.sin(pm) * rUp0;
      const up = new THREE.Group(); up.position.set(hx, 0, hz); tails.add(up);
      const lo = new THREE.Group(); lo.position.set(Math.sin(pm) * rMid - hx, midY - waistY, Math.cos(pm) * rMid * sz - hz); up.add(lo);
      const Lu = [], Ll = [], segs = Math.max(4, Math.round((p1 - p0) / (Math.PI * 2) * 26));
      const lat = (pts, a0, a1) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs, a0, a1 - a0);
      // upper: waist -> mid thigh (positions relative to the upper hinge), lower: mid -> knee + bronze hem
      Lu.push(colored(lat([[rUp0, 0.02], [rUp0 * 1.04, -0.12], [rMid, -0.3]], p0, p1), front ? HC.coat : HC.coat, [-hx, 0, -hz], [0, 0, 0], [1, 1, sz]));
      const lox = Math.sin(pm) * rMid, loz = Math.cos(pm) * rMid * sz;
      Ll.push(colored(lat([[rMid, 0.004], [rBot, -0.3]], p0, p1), HC.coat, [-lox, 0, -loz], [0, 0, 0], [1, 1, sz]));
      Ll.push(colored(lat([[rBot * 0.975, -0.27], [rBot * 1.01, -0.305]], p0, p1), HC.bronze, [-lox, 0, -loz], [0, 0, 0], [1.01, 1, sz * 1.01]));
      // bronze piping down the open front edges
      if (front) {
        const ea = side > 0 ? p0 : p1;
        const edgeU = new THREE.Vector3(Math.sin(ea) * rUp0, 0, Math.cos(ea) * rUp0 * sz), edgeM = new THREE.Vector3(Math.sin(ea) * rMid, -0.3, Math.cos(ea) * rMid * sz), edgeB = new THREE.Vector3(Math.sin(ea) * rBot, -0.6, Math.cos(ea) * rBot * sz);
        const bar = (A, B, L, ox, oz, oy) => { const d = B.clone().sub(A), len = d.length(); const g = new THREE.CylinderGeometry(0.0055, 0.0055, len, 5); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize())); g.translate((A.x + B.x) / 2 - ox, (A.y + B.y) / 2 - oy, (A.z + B.z) / 2 - oz); g.deleteAttribute('uv'); L.push(colored(g, HC.bronzeHi, [0, 0, 0])); };
        bar(edgeU, edgeM, Lu, hx, hz, 0); bar(edgeM, edgeB, Ll, lox, loz, -0.3);
      }
      // back panels: a centre vent seam + two bronze studs
      if (!front) { const sa = side > 0 ? p1 : p0; for (let k = 0; k < 2; k++) { const y = -0.06 - k * 0.1, r = lerp(rUp0, rMid, -y / 0.3) + 0.004; Lu.push(colored(new THREE.SphereGeometry(1, 6, 4), HC.bronzeHi, [Math.sin(sa - side * 0.12) * r - hx, y, Math.cos(sa - side * 0.12) * r * sz - hz], [0, 0, 0], [0.007, 0.007, 0.004])); } }
      up.add(mergedMesh(Lu, coatSide)); lo.add(mergedMesh(Ll, coatSide));
      R.coatPanels.push({ up, lo, side, front, ax: 0, vx: 0, bx: 0, vb: 0 });
    }
    // belt with bronze buckle, studs, pouches and a thigh holster strap (static on the hips)
    const L = [], belt = new THREE.CylinderGeometry(1, 1, 1, 22, 1, true), box = new THREE.BoxGeometry(1, 1, 1);
    L.push(colored(belt, HC.strap, [0, waistY - 0.005, 0], [0, 0, 0], [rx * 1.07, 0.038, rx * 1.07 * sz]));
    L.push(colored(belt, HC.bronze, [0, waistY + 0.013, 0], [0, 0, 0], [rx * 1.075, 0.004, rx * 1.075 * sz]));
    L.push(colored(belt, HC.bronze, [0, waistY - 0.023, 0], [0, 0, 0], [rx * 1.075, 0.004, rx * 1.075 * sz]));
    const fz = rx * 1.07 * sz;
    L.push(colored(box, HC.bronzeHi, [0, waistY - 0.005, fz + 0.004], [0, 0, 0], [0.046, 0.036, 0.008]));
    L.push(colored(box, HC.strap, [0, waistY - 0.005, fz + 0.009], [0, 0, 0], [0.028, 0.02, 0.004]));
    for (let k = 0; k < 10; k++) { const a = 0.5 + k / 9 * (Math.PI * 2 - 1.0); L.push(colored(new THREE.SphereGeometry(1, 5, 4), HC.bronzeHi, [Math.sin(a) * rx * 1.08, waistY - 0.005, Math.cos(a) * rx * 1.08 * sz], [0, 0, 0], [0.004, 0.004, 0.004])); }
    for (const [a, w, h] of [[1.25, 0.05, 0.06], [-1.25, 0.05, 0.06], [2.5, 0.04, 0.05], [-2.6, 0.06, 0.05]]) {
      const r = rx * 1.12, x = Math.sin(a) * r, z = Math.cos(a) * r * sz, q = [0, a, 0];
      L.push(colored(box, 0x2a2018, [x, waistY - 0.03, z], q, [w, h, 0.03]));
      L.push(colored(box, 0x1e1712, [Math.sin(a) * (r + 0.016), waistY - 0.012, Math.cos(a) * (r + 0.016) * sz], q, [w * 1.04, h * 0.42, 0.006]));
      L.push(colored(new THREE.SphereGeometry(1, 5, 4), HC.bronzeHi, [Math.sin(a) * (r + 0.02), waistY - 0.018, Math.cos(a) * (r + 0.02) * sz], [0, 0, 0], [0.005, 0.005, 0.003]));
    }
    const beltMesh = mergedMesh(L, coatSide); hipsM.add(beltMesh);
    R.skirt = tails;
  }
  // ---- holstered machete on the back (shown when a gun is out)
  const holster = new THREE.Group(); holster.name = 'holster'; chestM.add(holster);
  holster.position.set(-0.05, 0.02, cb.min.z - 0.03); holster.rotation.set(Math.PI / 2, 0, 0.55, 'ZYX');
  const hm = buildMachete(); hm.scale.setScalar(0.95); holster.add(hm); holster.visible = false;
  R.holster = holster;
  R.mats = { coat: shimmer[0], coatSide, star: starMat, face: R.faceMat || null, shimmer, hair: hairMat };
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
// two-bone IK: rotate upper/lower arm so the wrist reaches `target` (world), elbow bent toward `pole` (world); w = blend
const _S = new THREE.Vector3(), _E = new THREE.Vector3(), _W = new THREE.Vector3(), _T = new THREE.Vector3(), _D = new THREE.Vector3(), _Pp = new THREE.Vector3(), _E2 = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
function rotateBoneToward(bone, from, to, w) {
  // world-space rotation taking direction `from` onto `to`, applied to the bone (in its parent frame)
  _qa.setFromUnitVectors(from, to);
  if (w < 1) _qa.slerp(_qb.identity(), 1 - w);
  bone.getWorldQuaternion(_qb); _qb.premultiply(_qa);
  bone.parent.getWorldQuaternion(_qc).invert();
  bone.quaternion.copy(_qc.multiply(_qb));
  bone.updateWorldMatrix(false, true);
}
export function ikTwoBone(chain, target, pole, w) {
  const { ua, la, wr } = chain; if (!ua || !la || !wr || w <= 0.001) return;
  ua.getWorldPosition(_S); la.getWorldPosition(_E); wr.getWorldPosition(_W);
  const l1 = _E.distanceTo(_S), l2 = _W.distanceTo(_E);
  _T.copy(target).sub(_S); let d = _T.length(); const dmax = (l1 + l2) * 0.995; if (d > dmax) { _T.multiplyScalar(dmax / d); d = dmax; } d = Math.max(d, Math.abs(l1 - l2) + 1e-3);
  _D.copy(_T).normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _Pp.copy(pole).sub(_S); _Pp.addScaledVector(_D, -_Pp.dot(_D)); if (_Pp.lengthSq() < 1e-8) _Pp.set(0, -1, 0); _Pp.normalize();
  _E2.copy(_S).addScaledVector(_D, a).addScaledVector(_Pp, h);
  rotateBoneToward(ua, _v1.copy(_E).sub(_S).normalize(), _v2.copy(_E2).sub(_S).normalize(), w);
  la.getWorldPosition(_E); wr.getWorldPosition(_W);
  rotateBoneToward(la, _v1.copy(_W).sub(_E).normalize(), _v2.copy(_T).add(_S).sub(_E).normalize(), w);
}
