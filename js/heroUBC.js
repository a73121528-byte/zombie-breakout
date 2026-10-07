import * as THREE from 'three';
import { loadHeroGLB, boneMount, colored, mergedMesh, HC } from './heroRig.js?v=20261008a';

// ============================================================================
// 星璃 v0.6b on Quaternius "Universal Base Characters" (Superhero_Female, CC0) animated with the
// "Universal Animation Library" clips (CC0, same UE-style skeleton). The outfit is built on the body:
// a fragment-shader catsuit (black leather, gloves, knee boots, bronze trims; zones computed from the
// bind-pose position so the lines are crisp), an inflated coat shell (open V front, bronze piping),
// a stand collar, procedural coat tails / belt / pouches, the star ornament and purple hue-locked
// Hair_Long whose back part is re-skinned onto a 2-bone spring chain (driven by main.js like the old ponytail).
// Exposes the same interface as buildRiggedHeroine (heroRig.js).
// ============================================================================
export const UBC_FILES = { body: 'assets/models/ubc_female.glb', hair: 'assets/models/ubc_hair_long.glb', anim: 'assets/models/ual_hero.glb' };
export const UBC_SCALE = 0.99; // 1.767 m -> 1.75 m

export async function loadUBC(v, onProgress) {
  const k = { body: 0, hair: 0, anim: 0 }, W = { body: 0.6, hair: 0.25, anim: 0.15 };
  const one = key => loadHeroGLB(UBC_FILES[key] + '?v=' + v, f => { k[key] = f; if (onProgress) onProgress(k.body * W.body + k.hair * W.hair + k.anim * W.anim); });
  const [body, hair, anim] = await Promise.all([one('body'), one('hair'), one('anim')]);
  return { body, hair, anim };
}

// game clip name -> UAL clip, playback-rate multiplier (main.js timings were tuned on the old clips)
const ALIAS = {
  Idle: ['Idle_Loop', 1], Idle_Gun: ['Pistol_Idle_Loop', 1], Walk: ['Walk_Loop', 0.8], Run: ['Jog_Fwd_Loop', 1.0],
  Sword_Slash: ['Sword_Attack', 1], Roll: ['Roll', 0.9], Death: ['Death01', 1.35], HitRecieve: ['Hit_Chest', 0.55], HitRecieve_2: ['Hit_Head', 0.6],
  Interact: ['Pistol_Reload', 1.05], Gun_Shoot: ['Pistol_Shoot', 1], Idle_Gun_Pointing: ['Pistol_Aim_Neutral', 1], Sprint: ['Sprint_Loop', 1], Idle_Sword: ['Sword_Idle', 1],
};
const UPPER = /^(spine_0[123]|neck_01|Head|clavicle_|upperarm_|lowerarm_|hand_|index_|middle_|ring_|pinky_|thumb_)/;
function layered(legs, upper, name) {
  const tracks = legs.tracks.filter(t => !UPPER.test(t.name.split('.')[0])).map(t => t.clone());
  for (const t of upper.tracks) if (UPPER.test(t.name.split('.')[0])) {
    const n = t.getValueSize(); const T = t.constructor; tracks.push(new T(t.name, [0], Array.from(t.values.slice(0, n))));
  }
  return new THREE.AnimationClip(name, legs.duration, tracks);
}

const lin = h => { const c = new THREE.Color(h); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };
const f = x => x.toFixed(4);
const ZC = { suit: 0x2c2733, suitHi: 0x36303d, boot: 0x141117, glove: 0x18151b, coat: 0x1a171f, bronze: 0x9a6232, bronzeHi: 0xc08040, skinTint: 0xffeee8 };

export function buildUBCHeroine(G, helpers) {
  const { buildMachete, starGeo, glowSprite } = helpers;
  const root = new THREE.Group(); root.name = 'heroUBC';
  const body = new THREE.Group(); root.add(body);
  const model = G.body.scene; model.scale.setScalar(UBC_SCALE); body.add(model);
  root.updateMatrixWorld(true);
  const R = { mats: {}, root, body, model, rigged: true, ubc: true, slashHit: 0.42, gunScale: { pistol: 1.12, other: 1.0 } };
  let bodyMesh = null, eyes = null, brows = null;
  model.traverse(o => {
    if (!o.isSkinnedMesh) return;
    if (/Superhero/.test(o.name)) bodyMesh = o; else if (/Eyes/.test(o.name)) eyes = o; else if (/Eyebrow/.test(o.name)) brows = o;
    o.frustumCulled = false; o.castShadow = true; o.userData.cast = true;
  });
  if (!bodyMesh) throw new Error('ubc: body mesh missing');
  const bone = n => { const b = model.getObjectByName(n); if (!b) throw new Error('ubc: missing bone ' + n); return b; };
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const bp = n => bone(n).getWorldPosition(new THREE.Vector3()).applyMatrix4(toModel);
  const K = { neck: bp('neck_01'), head: bp('Head'), chest: bp('spine_03'), spine2: bp('spine_02'), pelvis: bp('pelvis'), handR: bp('hand_r'), laR: bp('lowerarm_r'), uaR: bp('upperarm_r'), calfL: bp('calf_l'), footL: bp('foot_l'), thighL: bp('thigh_l'), midR: bp('middle_01_r'), thumbR: bp('thumb_01_r') };
  R.K = K;
  const B = { head: bone('Head'), hips: bone('pelvis'), torso: bone('spine_01'), chest: bone('spine_03'), wristR: bone('hand_r'), wristL: bone('hand_l') };
  R.bones = B;
  R.armL = { ua: bone('upperarm_l'), la: bone('lowerarm_l'), wr: B.wristL };
  R.armR = { ua: bone('upperarm_r'), la: bone('lowerarm_r'), wr: B.wristR };
  R.legs = { L: [bone('thigh_l'), bone('calf_l')], R: [bone('thigh_r'), bone('calf_r')] };

  // ---- landmarks (model space, bind pose; the model faces +Z, right hand at -X)
  const pos = bodyMesh.geometry.attributes.position;
  const HANDX = Math.abs(K.handR.x);
  const COLLAR = K.neck.y + (K.head.y - K.neck.y) * 0.62;   // suit collar top (back), lower at the throat
  const BOOTY = K.calfL.y - 0.06;                             // knee boots
  const HEM = K.pelvis.y + 0.035;                             // coat shell hem (tails take over below)
  const CUFF = HANDX - 0.045;                                 // coat sleeve end
  const VBOT = K.chest.y - 0.07;                              // bottom of the V neckline
  const WAIST = K.pelvis.y + 0.07;
  // body measurements at the waist / chest
  let wx = 0, wz0 = 1, wz1 = -1, cz0 = 1, hipX = 0, hz0 = 1, hz1 = -1; const HIPY = K.pelvis.y - 0.07;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (Math.abs(y - WAIST) < 0.015 && Math.abs(x) < 0.3) { wx = Math.max(wx, Math.abs(x)); wz0 = Math.min(wz0, z); wz1 = Math.max(wz1, z); }
    if (Math.abs(y - K.chest.y) < 0.03 && Math.abs(x) < 0.2) cz0 = Math.min(cz0, z);
    if (Math.abs(y - HIPY) < 0.02 && Math.abs(x) < 0.3) { hipX = Math.max(hipX, Math.abs(x)); hz0 = Math.min(hz0, z); hz1 = Math.max(hz1, z); }
  }
  R.measure = { hipX, hz0, hz1, HANDX, COLLAR, BOOTY, HEM, CUFF, VBOT, WAIST, wx, wz0, wz1, cz0 };

  // shared GLSL: zones from the bind-space position (vBind)
  const zoneDecl = `varying vec3 vBind;
    float zbCollarTop(vec3 p) { return ${f(COLLAR)} - 0.032 * smoothstep(-0.03, 0.06, p.z); }`;
  const vertBind = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + zoneDecl);
  };

  // ---- body: skin texture where exposed (face/neck/fingers), catsuit elsewhere
  const src = bodyMesh.material;
  const bodyMat = new THREE.MeshPhongMaterial({ map: src.map, normalMap: src.normalMap, shininess: 36, specular: 0x3a3442, emissive: 0x050308 });
  bodyMat.name = 'ubc:body';
  bodyMat.onBeforeCompile = sh => {
    vertBind(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float zbAx = abs(vBind.x), zbCT = zbCollarTop(vBind);
      float zbAA = fwidth(vBind.y) * 1.2 + 1e-4, zbAX = fwidth(zbAx) * 1.2 + 1e-4;
      float zbSkin = max(smoothstep(zbCT - zbAA, zbCT + zbAA, vBind.y), smoothstep(${f(HANDX + 0.062)} - zbAX, ${f(HANDX + 0.062)} + zbAX, zbAx));
      float zbSuit = 1.0 - zbSkin;
      float zbBoot = 1.0 - smoothstep(${f(BOOTY)} - zbAA, ${f(BOOTY)} + zbAA, vBind.y);
      float zbGlove = smoothstep(${f(HANDX - 0.004)} - zbAX, ${f(HANDX - 0.004)} + zbAX, zbAx) * step(1.0, vBind.y);
      float zbBand = 0.0;
      zbBand = max(zbBand, smoothstep(zbCT - 0.016 - zbAA, zbCT - 0.016 + zbAA, vBind.y) * zbSuit);                       // collar
      zbBand = max(zbBand, zbBoot * smoothstep(${f(BOOTY - 0.02)} - zbAA, ${f(BOOTY - 0.02)} + zbAA, vBind.y));          // boot cuff
      zbBand = max(zbBand, zbGlove * (1.0 - smoothstep(${f(HANDX + 0.012)} - zbAX, ${f(HANDX + 0.012)} + zbAX, zbAx)));    // glove cuff
      zbBand = max(zbBand, zbSuit * zbGlove * smoothstep(${f(HANDX + 0.05)} - zbAX, ${f(HANDX + 0.05)} + zbAX, zbAx));     // glove knuckle edge
      float zbSole = 1.0 - smoothstep(0.018, 0.022, vBind.y);
      // leather: slightly lighter panels on the shins / outer thighs, darker boots and gloves
      vec3 zbLeather = mix(${lin(ZC.suit)}, ${lin(ZC.suitHi)}, smoothstep(0.08, 0.13, zbAx) * step(vBind.y, ${f(K.pelvis.y)}) * (1.0 - zbBoot));
      zbLeather = mix(zbLeather, ${lin(ZC.boot)}, zbBoot);
      zbLeather = mix(zbLeather, ${lin(ZC.glove)}, zbGlove);
      zbLeather = mix(zbLeather, vec3(0.012), zbSole);
      vec3 zbSkinC = diffuseColor.rgb * ${lin(ZC.skinTint)}; zbSkinC = mix(vec3(dot(zbSkinC, vec3(0.3, 0.59, 0.11))), zbSkinC, 0.78) * 1.32;
      diffuseColor.rgb = mix(zbSkinC, zbLeather, zbSuit);
      diffuseColor.rgb = mix(diffuseColor.rgb, ${lin(ZC.bronze)}, zbBand);`)
      .replace('#include <specularmap_fragment>', `#include <specularmap_fragment>
      specularStrength = mix(0.22, 1.0, zbSuit) * (1.0 + zbBand * 1.5);`)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nvec3 zbN0 = normal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, zbN0, zbSuit * 0.55));');
  };
  bodyMat.customProgramCacheKey = () => 'zbubcbody1';
  bodyMesh.material = bodyMat;
  const shimmer = [bodyMat];

  // eyes / brows
  if (eyes) { const m = eyes.material; eyes.material = new THREE.MeshPhongMaterial({ map: m.map, shininess: 90, specular: 0x666666, emissive: 0x0a0610 }); eyes.material.name = 'ubc:eyes'; }
  if (brows) { const m = brows.material; brows.material = new THREE.MeshPhongMaterial({ map: m.map, color: 0x4a2a6a, shininess: 10, specular: 0x111111, transparent: false }); brows.material.name = 'ubc:brows'; }

  // ---- coat shell: torso + sleeves inflated along the normals, cut analytically in the fragment shader
  const coatMat = new THREE.MeshPhongMaterial({ color: ZC.coat, shininess: 42, specular: 0x403a4a, emissive: 0x050308 });
  coatMat.name = 'ubc:coat';
  coatMat.onBeforeCompile = sh => {
    vertBind(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float zbAx = abs(vBind.x), zbCT = zbCollarTop(vBind) - 0.006;
      float zbVH = vBind.y > ${f(VBOT)} ? clamp((vBind.y - ${f(VBOT)}) * 0.55, 0.0, 0.09) : 0.004 + (${f(VBOT)} - vBind.y) * 0.16;
      bool zbFront = vBind.z > 0.0;
      if (vBind.y > zbCT || vBind.y < ${f(HEM)} || zbAx > ${f(CUFF)} || (zbFront && zbAx < zbVH && zbAx < 0.25)) discard;
      float zbB = 0.0;
      zbB = max(zbB, 1.0 - smoothstep(${f(HEM + 0.012)}, ${f(HEM + 0.016)}, vBind.y));
      zbB = max(zbB, smoothstep(zbCT - 0.014, zbCT - 0.010, vBind.y));
      zbB = max(zbB, smoothstep(${f(CUFF - 0.018)}, ${f(CUFF - 0.014)}, zbAx) * step(0.3, zbAx));
      if (zbFront && zbAx < 0.25) zbB = max(zbB, 1.0 - smoothstep(zbVH + 0.008, zbVH + 0.012, zbAx));
      // shoulder seam + sleeve seam (thin darker lines), bronze studs along the V
      float zbSeam = (1.0 - smoothstep(0.0015, 0.003, abs(zbAx - 0.19))) * step(${f(K.chest.y)}, vBind.y);
      diffuseColor.rgb *= 1.0 - zbSeam * 0.55;
      diffuseColor.rgb = mix(diffuseColor.rgb, ${lin(ZC.bronze)}, zbB);`)
      .replace('#include <specularmap_fragment>', `#include <specularmap_fragment>
      specularStrength = 1.0 + zbB * 1.6;`);
  };
  coatMat.customProgramCacheKey = () => 'zbubccoat1';
  shimmer.push(coatMat);
  {
    const g = bodyMesh.geometry, idx = g.index, nrm = g.attributes.normal;
    const inReg = i => { const x = Math.abs(pos.getX(i)), y = pos.getY(i); return y > HEM - 0.03 && y < COLLAR + 0.02 && x < CUFF + 0.02; };
    const remap = new Map(), tri = [];
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      if (!(inReg(a) && inReg(b) && inReg(c))) continue;
      for (const v of [a, b, c]) { if (!remap.has(v)) remap.set(v, remap.size); tri.push(remap.get(v)); }
    }
    const n = remap.size, P = new Float32Array(n * 3), N = new Float32Array(n * 3), SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4);
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    for (const [o, i] of remap) {
      const x = pos.getX(o), y = pos.getY(o), z = pos.getZ(o), ax = Math.abs(x);
      // thicker over the bust / shoulders, thinner on the sleeves
      const d = ax > 0.22 ? 0.0085 : 0.0115 + 0.003 * Math.max(0, 1 - Math.abs(y - K.chest.y) / 0.12);
      P[i * 3] = x + nrm.getX(o) * d; P[i * 3 + 1] = y + nrm.getY(o) * d; P[i * 3 + 2] = z + nrm.getZ(o) * d;
      N[i * 3] = nrm.getX(o); N[i * 3 + 1] = nrm.getY(o); N[i * 3 + 2] = nrm.getZ(o);
      SI[i * 4] = si.getX(o); SI[i * 4 + 1] = si.getY(o); SI[i * 4 + 2] = si.getZ(o); SI[i * 4 + 3] = si.getW(o); SW[i * 4] = sw.getX(o); SW[i * 4 + 1] = sw.getY(o); SW[i * 4 + 2] = sw.getZ(o); SW[i * 4 + 3] = sw.getW(o);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(P, 3)); sg.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    sg.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4)); sg.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    sg.setIndex(tri);
    const shell = new THREE.SkinnedMesh(sg, coatMat); shell.name = 'coatShell';
    bodyMesh.parent.add(shell); shell.bind(bodyMesh.skeleton, bodyMesh.bindMatrix);
    shell.frustumCulled = false; shell.castShadow = true; shell.userData.cast = true;
    R.coatShell = shell;
  }

  // ---- hair: Hair_Long re-bound to the body skeleton; back hair re-weighted onto a 2-bone spring chain
  const hairMat = new THREE.MeshPhongMaterial({ color: 0x7848b4, shininess: 48, specular: 0x5a3a8a, emissive: 0x0c0418, side: THREE.DoubleSide });
  hairMat.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `{
      float hl = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
      vec3 hb = diffuseColor.rgb / max(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), 1e-4);
      outgoingLight = mix(outgoingLight, hb * hl, 0.72);
    }
    #include <opaque_fragment>`);
  };
  hairMat.customProgramCacheKey = () => 'zbhair2';
  const headM = boneMount(B.head, model, 'headMount');
  const hipsM = boneMount(B.hips, model, 'hipsMount');
  const chestM = boneMount(B.chest, model, 'chestMount');
  root.updateMatrixWorld(true);
  const S = UBC_SCALE;
  const toHead = p => new THREE.Vector3(p.x, p.y, p.z).multiplyScalar(S).applyMatrix4(model.parent.matrixWorld).applyMatrix4(new THREE.Matrix4().copy(headM.matrixWorld).invert());
  let hairMesh = null; G.hair.scene.traverse(o => { if (o.isSkinnedMesh && !hairMesh) hairMesh = o; });
  let hb = new THREE.Box3();
  const ponyBase = new THREE.Group(); ponyBase.name = 'ponyBase'; headM.add(ponyBase);
  const pony = [];
  if (hairMesh) {
    const hg = hairMesh.geometry; hg.computeBoundingBox(); hb = hg.boundingBox.clone();
    hairMat.map = hairMesh.material.map || null; hairMat.normalMap = hairMesh.material.normalMap || null;
    const bones = hairMesh.skeleton.bones.map(b => model.getObjectByName(b.name));
    const inv = hairMesh.skeleton.boneInverses.map(m => m.clone());
    // spring chain: nape pivot (in the head mount, model axes) -> two segments down the back
    const hp = hg.attributes.position;
    const NAPE_Y = K.head.y + 0.03, chainLen = 0.13;
    let backZ = 1; for (let i = 0; i < hp.count; i++) if (Math.abs(hp.getY(i) - NAPE_Y) < 0.02) backZ = Math.min(backZ, hp.getZ(i));
    const nape = toHead({ x: 0, y: NAPE_Y, z: backZ + 0.03 });
    ponyBase.position.copy(nape);
    const b1 = new THREE.Bone(); b1.name = 'hairChain1'; ponyBase.add(b1);
    const b2 = new THREE.Bone(); b2.name = 'hairChain2'; b2.position.set(0, -chainLen * S, 0); b1.add(b2);
    root.updateMatrixWorld(true);
    // bone inverse = inverse of the bone's world matrix expressed in the mesh's bind space (model world at bind)
    const mw = new THREE.Matrix4().copy(bodyMesh.matrixWorld).invert();
    for (const b of [b1, b2]) { bones.push(b); inv.push(new THREE.Matrix4().copy(mw).multiply(b.matrixWorld).invert()); }
    const iH = bones.indexOf(B.head), i1 = bones.length - 2, i2 = bones.length - 1;
    const si = hg.attributes.skinIndex, sw = hg.attributes.skinWeight;
    const SI = new Uint16Array(hp.count * 4), SW = new Float32Array(hp.count * 4);
    for (let i = 0; i < hp.count; i++) {
      const y = hp.getY(i), z = hp.getZ(i);
      const u = z < K.head.z + 0.03 ? Math.max(0, (NAPE_Y - y) / chainLen) : 0; // only hair behind the face plane
      let wH = 1, w1 = 0, w2 = 0;
      if (u > 0 && u <= 1) { const s = u * u * (3 - 2 * u); wH = 1 - s; w1 = s; }
      else if (u > 1 && u <= 2) { const s = (u - 1) * (u - 1) * (3 - 2 * (u - 1)); w1 = 1 - s; w2 = s; wH = 0; }
      else if (u > 2) { wH = 0; w2 = 1; }
      SI[i * 4] = iH; SI[i * 4 + 1] = i1; SI[i * 4 + 2] = i2; SI[i * 4 + 3] = 0;
      SW[i * 4] = wH; SW[i * 4 + 1] = w1; SW[i * 4 + 2] = w2; SW[i * 4 + 3] = 0;
    }
    hg.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4)); hg.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    hairMesh.removeFromParent();
    hairMesh.material = hairMat; hairMesh.name = 'hairLong';
    bodyMesh.parent.add(hairMesh);
    hairMesh.bind(new THREE.Skeleton(bones, inv), bodyMesh.bindMatrix);
    hairMesh.frustumCulled = false; hairMesh.castShadow = true; hairMesh.userData.cast = true;
    pony.push(b1, b2);
    R.hairMesh = hairMesh;
    // long back curtain (procedural strands, skinned to Head -> chain so it bends smoothly), hangs to mid-back
    {
      const prof = (src, test, y) => { let m = 1; const p = src; for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) - y) < 0.012 && test(p.getX(i))) m = Math.min(m, p.getZ(i)); return m; };
      const bodyBack = y => prof(pos, x => Math.abs(x) < 0.1, y), hairBack = y => prof(hp, x => Math.abs(x) < 0.06, y);
      const zAt = []; const Y0 = NAPE_Y + 0.07, LEN = 0.5;
      for (let k = 0; k <= 20; k++) { const y = Y0 - LEN * k / 20; let z = y > NAPE_Y - 0.02 ? hairBack(y) + 0.012 : 1; z = Math.min(z, bodyBack(y) - 0.045); if (y < COLLAR && y > K.chest.y - 0.05) z = Math.min(z, bodyBack(y) - 0.075); zAt.push(z < 0.9 ? z : (zAt[k - 1] ?? K.head.z - 0.1)); }
      for (let k = 1; k < zAt.length; k++) zAt[k] = Math.min(zAt[k], zAt[k - 1] + 0.004); // drape: never curls back in
      // light smoothing
      for (let it = 0; it < 3; it++) for (let k = 1; k < zAt.length - 1; k++) zAt[k] = Math.min(zAt[k], (zAt[k - 1] + zAt[k] + zAt[k + 1]) / 3);
      const zOf = y => { const t = Math.min(20, Math.max(0, (Y0 - y) / LEN * 20)), k = Math.min(19, Math.floor(t)), fr = t - k; return zAt[k] * (1 - fr) + zAt[k + 1] * fr; };
      const COLS = [0x4c2c7a, 0x5c3692, 0x3e2268, 0x6a42a6, 0x553088].map(c => new THREE.Color(c));
      const Pp = [], Nn = [], Cc = [], SIc = [], SWc = [], Ix = [];
      const SEG = 14, RAD = 6;
      const strands = [];
      for (let layer = 0; layer < 2; layer++) { const n = layer ? 14 : 17; for (let i = 0; i < n; i++) strands.push({ layer, u: (i + 0.5) / n - 0.5 + (layer ? 0.02 : 0), j: (i * 7 + layer * 3) % 5 }); }
      for (const st of strands) {
        const L = LEN * (st.layer ? 0.9 : 1) * (1 - Math.abs(st.u) * 0.35) * (0.92 + (st.j % 3) * 0.05);
        const w0 = (st.layer ? 0.026 : 0.03), base = Pp.length / 3, col = COLS[(st.j + st.layer) % 5];
        for (let k = 0; k <= SEG; k++) {
          const t = k / SEG, y = Y0 - L * t, spread = 0.2 + 0.07 * Math.min(1, t * 2.2) - 0.03 * t * t;
          const cx = st.u * spread, cz = zOf(y) - st.layer * 0.012 + Math.abs(st.u) * 0.03 * Math.min(1, t * 3);
          const wd = w0 * (1 - 0.78 * Math.pow(t, 1.8)), th = wd * 0.32 + 0.002;
          const uu = (NAPE_Y - y) / chainLen;
          let wH = 1, w1 = 0, w2 = 0;
          if (uu > 0 && uu <= 1) { const q = uu * uu * (3 - 2 * uu); wH = 1 - q; w1 = q; } else if (uu > 1 && uu <= 2) { const q = (uu - 1) * (uu - 1) * (3 - 2 * (uu - 1)); wH = 0; w1 = 1 - q; w2 = q; } else if (uu > 2) { wH = 0; w2 = 1; }
          for (let r = 0; r < RAD; r++) {
            const a = r / RAD * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
            Pp.push(cx + ca * wd, y, cz + sa * th); const nl = Math.hypot(ca / wd, sa / th); Nn.push(ca / wd / nl, 0, sa / th / nl);
            const sh = 0.85 + 0.15 * ca; Cc.push(col.r * sh, col.g * sh, col.b * sh);
            SIc.push(iH, i1, i2, 0); SWc.push(wH, w1, w2, 0);
          }
        }
        for (let k = 0; k < SEG; k++) for (let r = 0; r < RAD; r++) { const a = base + k * RAD + r, b = base + k * RAD + (r + 1) % RAD, c = a + RAD, d = b + RAD; Ix.push(a, c, b, b, c, d); }
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(Pp, 3)); cg.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3)); cg.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
      cg.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SIc, 4)); cg.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SWc, 4)); cg.setIndex(Ix);
      const cm = hairMat.clone(); cm.map = null; cm.normalMap = null; cm.vertexColors = true; cm.color.setHex(0xffffff); cm.side = THREE.FrontSide;
      cm.onBeforeCompile = hairMat.onBeforeCompile; cm.customProgramCacheKey = () => 'zbhair2v';
      const curtain = new THREE.SkinnedMesh(cg, cm); curtain.name = 'hairCurtain';
      bodyMesh.parent.add(curtain); curtain.bind(hairMesh.skeleton, bodyMesh.bindMatrix);
      curtain.frustumCulled = false; curtain.castShadow = true; curtain.userData.cast = true;
      R.hairCurtain = curtain; R.mats.hair2 = cm;
    }
  }
  R.pony = pony; R.ponyBase = ponyBase; R.ponyRest = [0.08, 0.04];
  R.hairGroups = null;

  // ---- weapon grip in the right fist (blade out of the thumb side, edge toward the knuckles)
  const grip = new THREE.Group(); grip.name = 'grip'; B.wristR.add(grip);
  {
    const fdir = K.midR.clone().sub(K.handR).normalize();
    const tdir = K.thumbR.clone().sub(K.handR); tdir.addScaledVector(fdir, -tdir.dot(fdir)).normalize();
    const ndir = new THREE.Vector3().crossVectors(fdir, tdir).normalize(); // back of the hand
    const gp = K.handR.clone().addScaledVector(fdir, 0.085).addScaledVector(ndir, -0.03).addScaledVector(tdir, 0.005);
    const wp = gp.clone().multiplyScalar(S).applyMatrix4(model.parent.matrixWorld);
    const want = new THREE.Matrix4().compose(wp, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    new THREE.Matrix4().copy(B.wristR.matrixWorld).invert().multiply(want).decompose(grip.position, grip.quaternion, grip.scale);
    const zb = tdir.clone(), yb = fdir.clone().projectOnPlane(zb).normalize(), xb = new THREE.Vector3().crossVectors(yb, zb);
    R.bladeBasis = new THREE.Matrix4().makeBasis(xb, yb, zb);
  }
  const weapon = new THREE.Group(); weapon.name = 'weapon'; grip.add(weapon);
  const machete = buildMachete(); machete.quaternion.setFromRotationMatrix(R.bladeBasis); weapon.add(machete);
  machete.traverse(o => { if (o.isMesh) { o.castShadow = true; o.userData.cast = true; } });
  R.weapon = weapon; R.grip = grip;
  R.gunMount = new THREE.Group(); R.gunMount.name = 'gunMount'; grip.add(R.gunMount);
  R.foreR = grip;

  // ---- star ornament on the hair, left temple (+X is her left)
  const starMat = new THREE.MeshLambertMaterial({ color: 0xffd36a, emissive: 0x8a5a10 });
  const star = new THREE.Mesh(starGeo(), starMat);
  {
    const hTop = toHead({ x: hb.max.x * 0.82, y: hb.max.y - 0.075, z: K.head.z + 0.05 });
    star.position.copy(hTop); star.rotation.set(0, 1.1, -0.3); star.scale.setScalar(0.03); headM.add(star);
    const glow = glowSprite(0xffc860, 0.11, 0.5); glow.position.copy(star.position); headM.add(glow);
  }
  R.star = star;

  // ---- stand collar + bunched hood (chest mount)
  const coatSide = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 38, specular: 0x2e2a34, side: THREE.DoubleSide, emissive: 0x050308 });
  shimmer.push(coatSide);
  {
    const L = [], inv = new THREE.Matrix4().copy(chestM.matrixWorld).invert();
    const toChest = p => new THREE.Vector3(p.x, p.y, p.z).multiplyScalar(S).applyMatrix4(model.parent.matrixWorld).applyMatrix4(inv);
    // measure the neck ring at the collar height
    let nx = 0, nz0 = 1, nz1 = -1; const cy = COLLAR - 0.035;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (Math.abs(y - cy) < 0.01 && Math.abs(pos.getX(i)) < 0.12) { nx = Math.max(nx, Math.abs(pos.getX(i))); nz0 = Math.min(nz0, pos.getZ(i)); nz1 = Math.max(nz1, pos.getZ(i)); } }
    const nc = toChest({ x: 0, y: cy, z: (nz0 + nz1) / 2 }), rX = (nx + 0.02) * S, rZ = ((nz1 - nz0) / 2 + 0.02) * S;
    const ring = (r0, r1, y0, y1, a0, a1, col) => { const g = new THREE.LatheGeometry([new THREE.Vector2(r0, y0), new THREE.Vector2(r1, y1)], 18, a0, a1 - a0); return colored(g, col, [nc.x, nc.y, nc.z], [0, 0, 0], [1, 1, rZ / rX]); };
    // collar: higher at the back, open at the front (lathe angle 0 = +Z front)
    L.push(ring(rX * 1.02, rX * 0.98, -0.01, 0.045, 0.55, Math.PI * 2 - 0.55, ZC.coat));
    L.push(ring(rX * 0.985, rX * 0.965, 0.04, 0.05, 0.55, Math.PI * 2 - 0.55, ZC.bronzeHi));
    chestM.add(mergedMesh(L, coatSide));
  }

  // ---- coat tails (4 hinged panels), belt, pouches — driven from main.js like the v0.5 rig
  {
    const zc = ((wz0 + wz1) / 2 - K.pelvis.z) * S;
    const waistY = (WAIST - K.pelvis.y) * S - 0.02, rx = wx * S * 1.06, sz = Math.min(1, (wz1 - wz0) / (2 * wx));
    const TL = Math.max(0.4, (WAIST - K.calfL.y + 0.03) * S), half = TL / 2;
    const tails = new THREE.Group(); tails.name = 'coatTails'; tails.position.set(0, waistY, zc); hipsM.add(tails);
    // the tails flare over the hips: radius at the hip line from the measured hip width / depth
    const rHip = Math.max(hipX * S * 1.1, (hz1 - hz0) / 2 * S / sz * 1.08, rx * 1.1), hipDy = (WAIST - HIPY) * S;
    const rUp0 = rx * 1.02, rMid = Math.max(rx * 1.3, rHip * 1.06), rBot = rMid * 1.14;
    const P4 = [[0.62, 1.75, 1, true], [1.75, Math.PI, 1, false], [Math.PI, 2 * Math.PI - 1.75, -1, false], [2 * Math.PI - 1.75, 2 * Math.PI - 0.62, -1, true]];
    R.coatPanels = [];
    for (const [p0, p1, side, front] of P4) {
      const pm = (p0 + p1) / 2, hz = Math.cos(pm) * rUp0 * sz, hx = Math.sin(pm) * rUp0;
      const up = new THREE.Group(); up.position.set(hx, 0, hz); tails.add(up);
      const lo = new THREE.Group(); lo.position.set(Math.sin(pm) * rMid - hx, -half, Math.cos(pm) * rMid * sz - hz); up.add(lo);
      const Lu = [], Ll = [], segs = Math.max(4, Math.round((p1 - p0) / (Math.PI * 2) * 28));
      const lat = (pts, a0, a1) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs, a0, a1 - a0);
      Lu.push(colored(lat([[rUp0, 0.02], [rHip * 0.97, -hipDy * 0.6], [rHip * 1.01, -hipDy], [rMid, -half]], p0, p1), ZC.coat, [-hx, 0, -hz], [0, 0, 0], [1, 1, sz]));
      const lox = Math.sin(pm) * rMid, loz = Math.cos(pm) * rMid * sz;
      Ll.push(colored(lat([[rMid, 0.004], [rBot, -half]], p0, p1), ZC.coat, [-lox, 0, -loz], [0, 0, 0], [1, 1, sz]));
      Ll.push(colored(lat([[rBot * 0.975, -half + 0.03], [rBot * 1.01, -half - 0.005]], p0, p1), ZC.bronze, [-lox, 0, -loz], [0, 0, 0], [1.01, 1, sz * 1.01]));
      if (front) {
        const ea = side > 0 ? p0 : p1;
        const eU = new THREE.Vector3(Math.sin(ea) * rUp0, 0, Math.cos(ea) * rUp0 * sz), eM = new THREE.Vector3(Math.sin(ea) * rMid, -half, Math.cos(ea) * rMid * sz), eB = new THREE.Vector3(Math.sin(ea) * rBot, -TL, Math.cos(ea) * rBot * sz);
        const bar = (A, Bv, Lx, ox, oz, oy) => { const d = Bv.clone().sub(A), len = d.length(); const g = new THREE.CylinderGeometry(0.005, 0.005, len, 5); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize())); g.translate((A.x + Bv.x) / 2 - ox, (A.y + Bv.y) / 2 - oy, (A.z + Bv.z) / 2 - oz); g.deleteAttribute('uv'); Lx.push(colored(g, ZC.bronzeHi, [0, 0, 0])); };
        bar(eU, eM, Lu, hx, hz, 0); bar(eM, eB, Ll, lox, loz, -half);
      }
      if (!front) { const sa = side > 0 ? p1 : p0; for (let k = 0; k < 2; k++) { const y = -0.06 - k * 0.1, r = rUp0 + (rMid - rUp0) * (-y / half) + 0.004; Lu.push(colored(new THREE.SphereGeometry(1, 6, 4), ZC.bronzeHi, [Math.sin(sa - side * 0.12) * r - hx, y, Math.cos(sa - side * 0.12) * r * sz - hz], [0, 0, 0], [0.007, 0.007, 0.004])); } }
      up.add(mergedMesh(Lu, coatSide)); lo.add(mergedMesh(Ll, coatSide));
      R.coatPanels.push({ up, lo, side, front, ax: 0, vx: 0, bx: 0, vb: 0 });
    }
    const L = [], belt = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true), box = new THREE.BoxGeometry(1, 1, 1);
    const by = waistY + 0.005, bz = zc;
    L.push(colored(belt, HC.strap, [0, by, bz], [0, 0, 0], [rx * 1.05, 0.036, rx * 1.05 * sz]));
    L.push(colored(belt, ZC.bronze, [0, by + 0.018, bz], [0, 0, 0], [rx * 1.055, 0.004, rx * 1.055 * sz]));
    L.push(colored(belt, ZC.bronze, [0, by - 0.018, bz], [0, 0, 0], [rx * 1.055, 0.004, rx * 1.055 * sz]));
    const fz = rx * 1.05 * sz + bz;
    L.push(colored(box, ZC.bronzeHi, [0, by, fz + 0.004], [0, 0, 0], [0.044, 0.034, 0.008]));
    L.push(colored(box, HC.strap, [0, by, fz + 0.009], [0, 0, 0], [0.026, 0.018, 0.004]));
    for (let k = 0; k < 10; k++) { const a = 0.5 + k / 9 * (Math.PI * 2 - 1.0); L.push(colored(new THREE.SphereGeometry(1, 5, 4), ZC.bronzeHi, [Math.sin(a) * rx * 1.065, by, Math.cos(a) * rx * 1.065 * sz + bz], [0, 0, 0], [0.004, 0.004, 0.004])); }
    for (const [a, w, h] of [[1.3, 0.05, 0.058], [-1.3, 0.05, 0.058], [2.5, 0.04, 0.05], [-2.6, 0.058, 0.05]]) {
      const r = rx * 1.1, x = Math.sin(a) * r, z = Math.cos(a) * r * sz + bz, q = [0, a, 0];
      L.push(colored(box, 0x2a2018, [x, by - 0.025, z], q, [w, h, 0.03]));
      L.push(colored(box, 0x1e1712, [Math.sin(a) * (r + 0.016), by - 0.007, Math.cos(a) * (r + 0.016) * sz + bz], q, [w * 1.04, h * 0.42, 0.006]));
      L.push(colored(new THREE.SphereGeometry(1, 5, 4), ZC.bronzeHi, [Math.sin(a) * (r + 0.02), by - 0.013, Math.cos(a) * (r + 0.02) * sz + bz], [0, 0, 0], [0.005, 0.005, 0.003]));
    }
    hipsM.add(mergedMesh(L, coatSide));
    R.skirt = tails;
  }
  // ---- boots: soles, block heels and rounded toe caps (foot mounts, model axes)
  for (const sd of ['l', 'r']) {
    const fb = bone('foot_' + sd), fm = boneMount(fb, model, 'foot_' + sd + 'M'); root.updateMatrixWorld(true);
    const fp = bp('foot_' + sd), bl = bp('ball_' + sd), gy = -fp.y * S, dz = (bl.z - fp.z) * S, dx = (bl.x - fp.x) * S;
    const L = [], box = new THREE.BoxGeometry(1, 1, 1);
    L.push(colored(box, 0x0c0a0e, [dx * 0.5, gy + 0.008, dz * 0.5 + 0.02], [0, 0, 0], [0.082, 0.016, dz + 0.13]));          // sole
    L.push(colored(box, 0x0e0c10, [0, gy + 0.025, -0.035], [0, 0, 0], [0.062, 0.05, 0.06]));                                 // heel
    L.push(colored(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), ZC.boot, [dx, gy + 0.014, dz + 0.012], [0, 0, 0], [0.047, 0.05, 0.085])); // toe cap
    const m = mergedMesh(L, coatSide); fm.add(m);
  }
  // ---- holstered machete on the back (shown while a gun is out)
  const holster = new THREE.Group(); holster.name = 'holster'; chestM.add(holster);
  holster.position.set(-0.06, -0.02, (cz0 - K.chest.z) * S - 0.05); holster.rotation.set(Math.PI / 2, 0, 0.55, 'ZYX');
  const hm = buildMachete(); hm.scale.setScalar(0.95); holster.add(hm); holster.visible = false;
  R.holster = holster;
  Object.assign(R.mats, { coat: coatMat, coatSide, star: starMat, face: bodyMat, shimmer, hair: hairMat, body: bodyMat });

  // ---- animation: UAL clips under the game's names (+ a layered jog/aim clip for Run_Shoot)
  const src2 = Object.fromEntries(G.anim.animations.map(c => [c.name, c]));
  const clips = {}, tsm = {};
  for (const [name, [ual, k]] of Object.entries(ALIAS)) if (src2[ual]) { const c = src2[ual].clone(); c.name = name; clips[name] = c; tsm[name] = k; }
  if (src2.Jog_Fwd_Loop && src2.Pistol_Aim_Neutral) { clips.Run_Shoot = layered(src2.Jog_Fwd_Loop, src2.Pistol_Aim_Neutral, 'Run_Shoot'); tsm.Run_Shoot = 1; }
  const mixer = new THREE.AnimationMixer(model), actions = {};
  for (const n in clips) actions[n] = mixer.clipAction(clips[n]);
  R.mixer = mixer; R.actions = actions; R.clips = clips; R.tsm = tsm;
  R.anim = { cur: null, name: '' };
  R.play = (name, o = {}) => {
    const a = actions[name]; if (!a) return null;
    const A = R.anim, fade = o.fade ?? 0.15, ts = (o.ts ?? 1) * (tsm[name] ?? 1);
    if (A.name === name && !o.restart) { a.timeScale = ts; return a; }
    a.reset(); a.enabled = true; a.setEffectiveWeight(1);
    a.timeScale = ts;
    a.setLoop(o.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = !!o.once;
    if (o.start) a.time = o.start;
    a.play();
    if (A.cur && A.cur !== a) a.crossFadeFrom(A.cur, fade, false);
    else if (A.cur === a && fade > 0) a.fadeIn(Math.min(fade, 0.06));
    A.cur = a; A.name = name;
    return a;
  };
  R.resetAnim = () => { mixer.stopAllAction(); R.anim.cur = null; R.anim.name = ''; R.play('Idle', { fade: 0 }); };
  R.resetAnim();
  root.traverse(o => { if (o.isMesh && o.userData.cast === undefined) { o.castShadow = true; o.userData.cast = true; } });
  return R;
}
