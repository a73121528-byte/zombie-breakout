// boss-route test: fixed 1/60 s simulation steps (no big headless frame steps), steering with the on-screen joystick
// along the in-game guide (route field), from downtown spots + every district; asserts the dormant boss wakes up.
const out = { runs: [] };
out.seams = await page.evaluate(() => { const W = __zb.W; return [['N', 0, -83.6, 0, -0.1], ['E', 83.6, 0, 0.1, 0], ['W', -83.6, 0, -0.1, 0], ['S', 0, 83.6, 0, 0.1]].map(([k, x, z, dx, dz]) => { const p = { x, z }; for (let i = 0; i < 12; i++) { p.x += dx; p.z += dz; W.resolveCircle(p, 0.38); } return k + ':' + (Math.abs(p.x - x) + Math.abs(p.z - z) > 1 ? 'ok' : 'STUCK'); }).join(' '); });
await page.evaluate(() => { const z = __zb; z.unfreeze(); for (const q of z.zombies.slice()) if (q.alive) z.killZombie(q); z.G.wave = 5; z.G.queue = []; z.G.phase = 'fight'; z.simOnly(true); z.sim(60 * 8); });
out.phase = await page.evaluate(() => [__zb.G.phase, !!__zb.G.boss, __zb.G.boss && __zb.G.boss.dormant]);
await page.evaluate(() => { const c = __zb.renderer.domElement; window.__joy = (dx, dy, down) => { const R = 150, B = 250; if (down) c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 77, pointerType: 'touch', clientX: R, clientY: B, bubbles: true, cancelable: true })); c.dispatchEvent(new PointerEvent('pointermove', { pointerId: 77, pointerType: 'touch', clientX: R + dx, clientY: B + dy, bubbles: true, cancelable: true })); }; __joy(0, 0, true); });
const SPOTS = [['downtown NE', 40, 40], ['downtown SW', -60, 62], ['downtown far E', 72, -30], ['downtown W', -70, -10], ['downtown S', 0, 76], ['hospital', 150, 2], ['hospital lobby', 144, -20], ['garage', 150, 30], ['mall', -150, 2], ['mall interior', -173, -30], ['subway', 0, 150], ['station', 0, 284]];
for (const [name, x, z] of SPOTS) {
  const r = await page.evaluate(async ([x, z]) => {
    const zb = __zb, P = zb.P, W = zb.W, b = zb.G.boss;
    for (const q of zb.zombies.slice()) if (q.alive && !q.isBoss) zb.killZombie(q);
    b.dormant = true; b.state = 'wander'; b.pos.set(W.bossSpot[0], 0, W.bossSpot[1]); b.wander.copy(b.pos); b.aggroT = 1e9;
    // free spot near the requested start
    let sx = x, sz = z; for (let rr = 0; rr < 12 && W.inside(sx, sz, 0.6); rr += 0.5) { sx = x + Math.cos(rr * 2.3) * rr; sz = z + Math.sin(rr * 2.3) * rr; }
    P.pos.set(sx, W.groundY ? W.groundY(sx, sz) * 0 : 0, sz); P.state = 'move'; P.t = 0; P.kb.set(0, 0, 0); zb.CAM.yaw = Math.random() * 6.28;
    zb.sim(5);
    const start = [+sx.toFixed(1), +sz.toFixed(1), W.districtAt(sx, sz)];
    let t = 0, lastP = [P.pos.x, P.pos.z], stuckT = 0, maxStuck = 0, woke = false, path = 0, crossed = new Set([W.districtAt(sx, sz)]), firstDist = null;
    while (t < 240) {
      const g = zb.guide; if (firstDist === null && g.on) firstDist = Math.round(g.dist);
      let jx = 0, jy = 1;
      if (g.on && g.tgt) { const bear = Math.atan2(g.tgt.x - P.pos.x, g.tgt.z - P.pos.z), rel = bear - (zb.CAM.yaw + Math.PI); jx = -Math.sin(rel); jy = Math.cos(rel); }
      else if (!b.dormant) { woke = true; break; }
      __joy(jx * 60, -jy * 60, false);
      zb.sim(6); t += 0.1;
      if (W.portalAt(P.pos.x, P.pos.z)) { zb.sim(1); await new Promise(res => setTimeout(res, 400)); } // portal fade uses a real-time timer
      for (const q of zb.zombies) if (q.alive && !q.isBoss && Math.hypot(q.pos.x - P.pos.x, q.pos.z - P.pos.z) < 3) zb.killZombie(q); // keep the lane clear
      const mv = Math.hypot(P.pos.x - lastP[0], P.pos.z - lastP[1]); path += mv; lastP = [P.pos.x, P.pos.z];
      if (mv < 0.05 && P.state === 'move') { stuckT += 0.1; maxStuck = Math.max(maxStuck, stuckT); } else stuckT = 0;
      crossed.add(W.districtAt(P.pos.x, P.pos.z));
      if (!b.dormant) { woke = true; break; }
      if (stuckT > 6) break;
    }
    return { start, woke, t: +t.toFixed(1), path: Math.round(path), guideDist: firstDist, maxStuck: +maxStuck.toFixed(1), end: [Math.round(P.pos.x), Math.round(P.pos.z)], via: [...crossed].join('>'), bossD: Math.round(Math.hypot(b.pos.x - P.pos.x, b.pos.z - P.pos.z)) };
  }, [x, z]);
  out.runs.push(Object.assign({ name }, r));
}
await page.evaluate(() => { __joy(0, 0, false); __zb.simOnly(false); });
out.pass = out.runs.filter(r => r.woke).length + '/' + out.runs.length;
return { out, errs };
