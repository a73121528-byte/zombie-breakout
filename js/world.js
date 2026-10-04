import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

// seeded rng
let seed = 1337;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const rr = (a, b) => a + rnd() * (b - a);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}

// Box with UVs scaled to world size (tile = T meters) so one material can tile across sizes
function tiledBox(w, h, d, T = 4) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const s = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i; uv.setXY(k, uv.getX(k) * s[f][0] / T, uv.getY(k) * s[f][1] / T);
  }
  return g;
}

export function buildWorld(scene) {
  seed = 1337;
  const colliders = [];   // {minX,maxX,minZ,maxZ,h}
  const mapRects = [];    // minimap {x,z,w,d,rot,kind}
  const buckets = new Map();
  const mats = {};
  const add = (geo, matKey, x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    const g = geo.clone(); g.applyMatrix4(m);
    if (!buckets.has(matKey)) buckets.set(matKey, []);
    buckets.get(matKey).push(g);
  };
  const addCollider = (x, z, w, d, ry = 0, h = 3) => {
    const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
    const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
    colliders.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, h });
  };

  // ---------- textures ----------
  const facade = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#4a4850'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { const v = 50 + Math.random() * 40 | 0; g.fillStyle = `rgba(${v},${v},${v + 4},.35)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.fillStyle = 'rgba(20,18,22,.5)'; g.fillRect(0, 60, w, 4); g.fillRect(0, 124, w, 4);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
      const x = 14 + c * 64, y = 10 + r * 64;
      g.fillStyle = '#0c0b0e'; g.fillRect(x, y, 36, 40);
      g.fillStyle = '#26232a'; g.fillRect(x - 3, y + 40, 42, 5);
      if (Math.random() < .5) { g.strokeStyle = '#3a3840'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y + rnd() * 40); g.lineTo(x + 36, y + rnd() * 40); g.stroke(); }
    }
    // stains
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(15,12,14,.28)'; g.fillRect(Math.random() * w, Math.random() * h * .6, 6 + Math.random() * 10, 30 + Math.random() * 60); }
  });
  const facadeEm = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    // one lit (fire-lit) window per tile, deterministic-ish
    g.fillStyle = '#7a3a12'; g.fillRect(14 + 64, 10, 36, 40);
    g.fillStyle = '#3a1808'; g.fillRect(14, 74, 36, 40);
  });
  const asphalt = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#26252a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) { const v = 25 + Math.random() * 35 | 0; g.fillStyle = `rgb(${v},${v},${v + 3})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
    g.strokeStyle = 'rgba(8,8,10,.8)'; g.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) { g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (Math.random() - .5) * 50; y += (Math.random() - .5) * 50; g.lineTo(x, y); } g.stroke(); }
    for (let i = 0; i < 5; i++) { g.fillStyle = 'rgba(10,9,12,.35)'; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 10 + Math.random() * 25, 0, 7); g.fill(); }
  });
  asphalt.repeat.set(24, 24);
  const concrete = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#4b4a4f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) { const v = 55 + Math.random() * 40 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
    g.fillStyle = '#2c2b30'; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h);
  });

  mats.facade = new THREE.MeshLambertMaterial({ map: facade, emissiveMap: facadeEm, emissive: 0xffffff, emissiveIntensity: 0.32, color: 0x9a96a0 });
  mats.facadeDark = new THREE.MeshLambertMaterial({ map: facade, color: 0x5d5a63 });
  mats.concrete = new THREE.MeshLambertMaterial({ map: concrete, color: 0x8a8790 });
  mats.rubble = new THREE.MeshLambertMaterial({ color: 0x3e3c42 });
  mats.metal = new THREE.MeshLambertMaterial({ color: 0x2c2b30 });
  mats.rust = new THREE.MeshLambertMaterial({ color: 0x4a2e22 });
  mats.carRed = new THREE.MeshLambertMaterial({ color: 0x4a1a1c });
  mats.carGrey = new THREE.MeshLambertMaterial({ color: 0x55545a });
  mats.carBlue = new THREE.MeshLambertMaterial({ color: 0x222838 });
  mats.glass = new THREE.MeshLambertMaterial({ color: 0x0b0c10 });
  mats.tire = new THREE.MeshLambertMaterial({ color: 0x0c0c0d });
  mats.blood = new THREE.MeshBasicMaterial({ color: 0x220204, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  mats.line = new THREE.MeshBasicMaterial({ color: 0x5f5a48, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  mats.lamp = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  mats.ember = new THREE.MeshBasicMaterial({ color: 0xff6a20 });
  mats.trash = new THREE.MeshLambertMaterial({ color: 0x141316 });

  // ---------- ground ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshLambertMaterial({ map: asphalt, color: 0x8c8892 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);

  const box1 = new THREE.BoxGeometry(1, 1, 1);
  // sidewalks along the cross streets
  const swGeo = tiledBox(1, 1, 1, 1);
  for (const s of [-1, 1]) {
    add(swGeo, 'concrete', s * 8.2, 0.08, 0, 0, 0, 0, 2.4, 0.16, 140);
    add(swGeo, 'concrete', 0, 0.08, s * 8.2, 0, 0, 0, 140, 0.16, 2.4);
  }
  // road dashed lines
  const lineGeo = new THREE.PlaneGeometry(1, 1); lineGeo.rotateX(-Math.PI / 2);
  for (let i = -40; i < 40; i += 4) {
    if (Math.abs(i) > 8) { add(lineGeo, 'line', 0, 0.02, i, 0, 0, 0, 0.18, 1, 2); add(lineGeo, 'line', i, 0.02, 0, 0, 0, 0, 2, 1, 0.18); }
  }
  // crosswalk
  for (let k = -3; k <= 3; k++) { add(lineGeo, 'line', k * 1.2, 0.02, 7.5, 0, 0, 0, 0.6, 1, 2.2); add(lineGeo, 'line', -7.5, 0.02, k * 1.2, 0, 0, 0, 2.2, 1, 0.6); }

  // ---------- buildings ----------
  const buildings = [];
  const B = (x, z, w, d, h, ruined) => buildings.push({ x, z, w, d, h, ruined });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    B(sx * 15.5, sz * 15, rr(9, 11), rr(8, 10), rr(10, 18), rnd() < 0.5);
    B(sx * rr(29, 32), sz * rr(12, 15), rr(7, 9), rr(8, 11), rr(7, 13), rnd() < 0.6);
    B(sx * rr(15, 18), sz * rr(30, 33), rr(9, 12), rr(7, 9), rr(12, 20), rnd() < 0.4);
  }
  // backdrop ring beyond bounds (no gameplay collision needed but add anyway)
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2, r = rr(46, 54);
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (Math.abs(x) < 9 || Math.abs(z) < 9) { // street ends: push farther, make them shorter ruins
      B(x * 1.25, z * 1.25, rr(10, 14), rr(10, 14), rr(6, 14), true);
    } else B(x, z, rr(10, 16), rr(10, 16), rr(14, 32), rnd() < 0.5);
  }
  const bGeoCache = (w, h, d) => tiledBox(w, h, d, 4);
  for (const b of buildings) {
    const key = rnd() < 0.7 ? 'facade' : 'facadeDark';
    add(bGeoCache(b.w, b.h, b.d), key, b.x, b.h / 2, b.z);
    if (b.ruined) {
      // jagged broken top
      for (let k = 0; k < 4; k++) {
        const w = rr(1.5, b.w * 0.5), d = rr(1.5, b.d * 0.5), hh = rr(1, 4);
        add(bGeoCache(w, hh, d), key, b.x + rr(-b.w, b.w) * 0.3, b.h + hh / 2 - 0.3, b.z + rr(-b.d, b.d) * 0.3, rr(-.2, .2), rr(-.15, .15), rr(-.15, .15));
      }
      // rubble at base
      for (let k = 0; k < 8; k++) {
        const s = rr(0.4, 1.6);
        const side = rnd() < 0.5;
        const px = b.x + (side ? (rnd() < .5 ? -1 : 1) * (b.w / 2 + rr(0.2, 1.5)) : rr(-b.w / 2, b.w / 2));
        const pz = b.z + (!side ? (rnd() < .5 ? -1 : 1) * (b.d / 2 + rr(0.2, 1.5)) : rr(-b.d / 2, b.d / 2));
        add(box1, 'rubble', px, s * 0.3, pz, rr(0, 3), rr(-.4, .4), rr(-.4, .4), s, s * 0.6, s * 0.8);
      }
    }
    // rooftop details
    add(box1, 'metal', b.x + rr(-1, 1), b.h + 0.6, b.z + rr(-1, 1), 0, 0, 0, 1.6, 1.2, 1.2);
    addCollider(b.x, b.z, b.w, b.d, 0, b.h);
    mapRects.push({ x: b.x, z: b.z, w: b.w, d: b.d, rot: 0, kind: 'b' });
  }

  // ---------- wrecked cars ----------
  const cars = [
    [-3.5, 14, 0.2, 'carRed', 0], [3.8, -16, 2.9, 'carGrey', 0], [-2.5, -27, 1.4, 'carBlue', 0.25],
    [13, 3.4, 1.65, 'carGrey', 0], [-14, -3.2, 1.4, 'carRed', Math.PI], [24, -3, -0.3, 'carBlue', 0],
    [-25, 2.5, 1.9, 'carGrey', 0.2], [3, 30, 0.1, 'carGrey', 0], [-27, -24, 0.7, 'carRed', 0], [26, 25, 2.2, 'carBlue', Math.PI],
  ];
  const cabinGeo = new THREE.BoxGeometry(2.2, 0.7, 1.7);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10); wheelGeo.rotateZ(Math.PI / 2);
  const carBodyGeo = new THREE.BoxGeometry(4.3, 0.85, 1.9);
  for (const [x, z, ry, mk, roll] of cars) {
    const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.set(0, ry, roll);
    if (roll > 1) grp.position.y = 1.6; else if (roll > 0) grp.position.y = 0.25;
    grp.updateMatrixWorld();
    const parts = [[carBodyGeo, mk, 0, 0.75, 0], [cabinGeo, 'glass', -0.2, 1.5, 0], [box1, mk, -0.2, 1.88, 0, 2.0, 0.06, 1.6]];
    for (const [gx, gz] of [[1.35, 0.85], [1.35, -0.85], [-1.35, 0.85], [-1.35, -0.85]]) if (rnd() < 0.85) parts.push([wheelGeo, 'tire', gx, 0.36, gz]);
    for (const p of parts) {
      const g = p[0].clone();
      if (p.length > 5) g.applyMatrix4(new THREE.Matrix4().makeScale(p[5], p[6], p[7]));
      g.applyMatrix4(new THREE.Matrix4().makeTranslation(p[2], p[3], p[4]));
      g.applyMatrix4(grp.matrixWorld);
      if (!buckets.has(p[1])) buckets.set(p[1], []);
      buckets.get(p[1]).push(g);
    }
    addCollider(x, z, 4.3, 1.9, ry, 1.8);
    mapRects.push({ x, z, w: 4.3, d: 1.9, rot: ry, kind: 'c' });
  }
  // concrete barriers
  const barriers = [[-5, -9.5, 0.1], [-2.6, -9.6, -0.15], [10, 9.5, 1.57], [20, -9.6, 0.3], [-20, 9.4, -0.2], [9.5, -22, 1.57], [-9.5, 24, 1.4]];
  for (const [x, z, ry] of barriers) {
    add(tiledBox(2.2, 0.85, 0.6, 1), 'concrete', x, 0.42, z, ry);
    addCollider(x, z, 2.2, 0.6, ry, 0.85);
    mapRects.push({ x, z, w: 2.2, d: 0.6, rot: ry, kind: 'c' });
  }
  // street lamps (some bent)
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, 5, 6);
  for (const [x, z, tilt] of [[-8.6, -20, 0], [8.6, 20, 0.25], [8.6, -30, 0], [-8.6, 30, -0.4], [20, 8.6, 0], [-30, -8.6, 0.15], [30, -8.6, 0]]) {
    add(poleGeo, 'metal', x, 2.5, z, 0, tilt, 0);
    add(box1, 'metal', x + (x > 0 ? -0.5 : 0.5), 4.95, z - tilt * 2.4, 0, 0, 0, 1.1, 0.1, 0.25);
    if (tilt === 0) add(box1, 'lamp', x + (x > 0 ? -0.9 : 0.9), 4.86, z, 0, 0, 0, 0.35, 0.08, 0.2);
    addCollider(x, z, 0.3, 0.3, 0, 5);
  }
  // debris / trash / blood pools
  for (let i = 0; i < 70; i++) {
    const x = rr(-36, 36), z = rr(-36, 36);
    if (colliders.some(c => x > c.minX - .5 && x < c.maxX + .5 && z > c.minZ - .5 && z < c.maxZ + .5)) continue;
    const t = rnd();
    if (t < 0.45) { const s = rr(0.15, 0.6); add(box1, 'rubble', x, s * 0.25, z, rr(0, 3), rr(-.5, .5), rr(-.5, .5), s, s * 0.5, s * 0.7); }
    else if (t < 0.65) { const g = new THREE.SphereGeometry(0.35, 6, 4); add(g, 'trash', x, 0.18, z, rr(0, 3), 0, 0, rr(.8, 1.4), 0.6, 1); }
    else if (t < 0.8) { add(box1, 'rust', x, 0.02, z, rr(0, 3), 0, 0, rr(.6, 1.6), 0.03, rr(.4, 1.0)); }
    else { const g = new THREE.CircleGeometry(1, 10); g.rotateX(-Math.PI / 2); add(g, 'blood', x, 0.03, z, 0, 0, 0, rr(.5, 1.6), 1, rr(.4, 1.2)); }
  }
  // burnt-out paper/blood streaks near center
  for (let i = 0; i < 6; i++) { const g = new THREE.CircleGeometry(1, 10); g.rotateX(-Math.PI / 2); add(g, 'blood', rr(-6, 6), 0.031, rr(-6, 6), 0, 0, 0, rr(.4, .9), 1, rr(1.2, 2.5)); }

  // ---------- fire barrels (with flickering point lights) ----------
  const fires = [];
  const barrelGeo = new THREE.CylinderGeometry(0.32, 0.3, 0.9, 10);
  const flameGeo = new THREE.ConeGeometry(0.28, 0.9, 7, 1, true);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: true, side: THREE.DoubleSide });
  const flameMat2 = new THREE.MeshBasicMaterial({ color: 0xffcf6a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const firePos = [[6.2, 9.8, true], [-9.8, -6.5, true], [-6.3, 21, true], [21, -10.5, false], [-21, 10.5, false], [10.4, -26, false]];
  for (const [x, z, lit] of firePos) {
    add(barrelGeo, 'rust', x, 0.45, z);
    addCollider(x, z, 0.65, 0.65, 0, 0.9);
    const f1 = new THREE.Mesh(flameGeo, flameMat); f1.position.set(x, 1.3, z); scene.add(f1);
    const f2 = new THREE.Mesh(flameGeo, flameMat2); f2.position.set(x, 1.15, z); f2.scale.set(0.6, 0.6, 0.6); scene.add(f2);
    let light = null;
    if (lit) { light = new THREE.PointLight(0xff7a30, 18, 16, 1.6); light.position.set(x, 1.8, z); scene.add(light); }
    fires.push({ x, z, f1, f2, light, ph: rnd() * 10 });
    mapRects.push({ x, z, w: 0.8, d: 0.8, rot: 0, kind: 'f' });
  }
  // a burning car glow (emissive only)
  {
    const f = new THREE.Mesh(flameGeo, flameMat); f.position.set(-3.5, 2.3, 14); f.scale.set(2.2, 1.6, 2.2); scene.add(f);
    fires.push({ x: -3.5, z: 14, f1: f, f2: null, light: null, ph: 3, big: true });
  }

  // ---------- merge static ----------
  for (const [k, list] of buckets) {
    const merged = mergeGeometries(list, false);
    list.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(merged, mats[k]);
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    scene.add(mesh);
  }

  // ---------- distant city glow / smoke backdrop ----------
  const skyGeo = new THREE.SphereGeometry(80, 16, 10);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {},
    vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'varying vec3 vp; void main(){ float h = normalize(vp).y; vec3 base = vec3(0.067,0.063,0.086); vec3 glow = vec3(0.32,0.09,0.06); float g = exp(-abs(h-0.02)*9.0); vec3 c = mix(base, glow, g*0.55); c = mix(c, vec3(0.04,0.035,0.055), smoothstep(0.1,0.6,h)); gl_FragColor = vec4(c,1.); }'
  });
  const sky = new THREE.Mesh(skyGeo, skyMat); sky.renderOrder = -1; scene.add(sky);

  const spawnPoints = [
    [0, -37], [0, 37], [-37, 0], [37, 0], [-4, -36], [4, 36], [-36, 4], [36, -4],
    [-24, -24], [24, 24], [-24, 24], [24, -24], [-36, -36], [36, 36], [-36, 36], [36, -36],
    [23, 0], [-23, 0], [0, 23], [0, -23],
  ];
  return { colliders, mapRects, fires, spawnPoints, sky, bounds: 38 };
}
