// Weapon + attachment definitions and stat computation
export const WEAPONS = {
  machete: { id: 'machete', name: '開山刀', short: '刀', kind: 'melee', unlockWave: 0, desc: '近戰三段連擊' },
  pistol: { id: 'pistol', name: '手槍', short: '手槍', kind: 'gun', unlockWave: 1, dmg: 24, pellets: 1, rate: 0.24, mag: 12, reload: 1.1, spread: 0.035, range: 24, knock: 1.6, startAmmo: 0, ammoPick: 0, infinite: true, recoil: 0.5, shake: 0.06, auto: false, noise: 20 },
  shotgun: { id: 'shotgun', name: '霰彈槍', short: '霰彈', kind: 'gun', unlockWave: 2, dmg: 12, pellets: 8, rate: 0.78, mag: 6, reload: 1.9, spread: 0.14, range: 13, knock: 5.5, startAmmo: 24, ammoPick: 8, recoil: 1.2, shake: 0.22, auto: false, noise: 26 },
  rifle: { id: 'rifle', name: '步槍', short: '步槍', kind: 'gun', unlockWave: 3, dmg: 17, pellets: 1, rate: 0.1, mag: 30, reload: 1.6, spread: 0.045, range: 32, knock: 1.0, startAmmo: 90, ammoPick: 30, recoil: 0.35, shake: 0.07, auto: true, noise: 26 },
};
export const WEAPON_ORDER = ['machete', 'pistol', 'shotgun', 'rifle'];

// 武器零件
export const PARTS = {
  extMag: { id: 'extMag', name: '擴充彈匣', icon: '▮', color: '#5ad0ff', guns: true, max: 3, desc: lv => `彈匣容量 +${lv * 40}%` },
  stabilizer: { id: 'stabilizer', name: '穩定器', icon: '◎', color: '#9effa0', guns: true, max: 3, desc: lv => `散布 −${Math.round((1 - Math.pow(0.7, lv)) * 100)}%・後座力降低` },
  suppressor: { id: 'suppressor', name: '消音器', icon: '≡', color: '#c0c0d0', guns: true, max: 2, desc: lv => `槍聲引怪範圍 −${lv === 1 ? 60 : 80}%・散布 −${lv * 10}%・傷害 +${lv * 5}%` },
  scope: { id: 'scope', name: '瞄準鏡', icon: '⊕', color: '#ffd84a', guns: true, max: 3, desc: lv => `爆擊率 +${lv * 10}%・射程 +${lv * 20}%` },
  apAmmo: { id: 'apAmmo', name: '穿甲彈', icon: '◆', color: '#ff6a4a', guns: true, max: 3, desc: lv => `無視裝甲／盾牌減傷・對裝甲 +${lv * 25}%` },
  speedLoader: { id: 'speedLoader', name: '速裝器', icon: '↻', color: '#ffa040', guns: true, max: 3, desc: lv => `換彈時間 −${Math.round((1 - Math.pow(0.75, lv)) * 100)}%` },
  edge: { id: 'edge', name: '強化刀刃', icon: '✦', color: '#d08aff', guns: false, max: 5, desc: lv => `開山刀傷害 +${lv * 20}%・攻擊範圍 +${(lv * 0.15).toFixed(2)}m` },
};
export const PART_KEYS = Object.keys(PARTS);
export const GUN_PART_KEYS = PART_KEYS.filter(k => PARTS[k].guns);

export function gunStats(id, parts) {
  const W = WEAPONS[id], p = parts[id] || {};
  const lv = k => p[k] || 0;
  return {
    ...W,
    mag: Math.round(W.mag * (1 + 0.4 * lv('extMag'))),
    spread: W.spread * Math.pow(0.7, lv('stabilizer')) * (1 - 0.1 * lv('suppressor')),
    recoil: W.recoil * Math.pow(0.75, lv('stabilizer')),
    dmg: W.dmg * (1 + 0.05 * lv('suppressor')),
    noise: W.noise * (lv('suppressor') === 0 ? 1 : lv('suppressor') === 1 ? 0.4 : 0.2),
    crit: 0.08 + 0.1 * lv('scope'),
    range: W.range * (1 + 0.2 * lv('scope')),
    ap: lv('apAmmo'),
    reload: W.reload * Math.pow(0.75, lv('speedLoader')),
  };
}
export function meleeMul(parts) { const l = (parts.machete && parts.machete.edge) || 0; return { dmg: 1 + 0.2 * l, range: 0.15 * l }; }
