喪屍突圍 ZOMBIE BREAKOUT — mobile 3D action prototype (three.js r160, vendored in lib/)
Serve:   cd /workspace/game && python3 -m http.server 8000   →  http://<host>:8000/index.html
Phone:   open in landscape; Add to Home Screen for fullscreen (manifest.webmanifest).
Desktop: WASD move · mouse drag / arrow keys camera · J attack · K/Space dodge · L skill · ; / Q / Tab lock-on · Esc/P pause · E cycle weapon · 1-4 select weapon · R reload
v0.2: procedural rounded character models, guns (手槍/霰彈槍/步槍, unlocked waves 1/2/3), weapon parts 武器零件 (auto-equip, see pause menu),
      graphics quality 自動/低/中/高 (menu or pause; saved in localStorage zb_quality), 裝甲屍 riot-police zombie (waves 3-5).
v0.3: much bigger city map (~170 m x 170 m: 3x3 road grid with 9 intersections, crosswalks, sidewalks/curbs, alleys, plaza + parking lot,
      gas station, bus stop, police checkpoint, collapsed building, road-end barricades at the map bounds), ~90 procedural vehicles
      (sedan/hatchback/SUV/pickup/van/taxi/police/ambulance/bus with wheels+rims, lights, plates, mirrors, damage, fires, overturned),
      oriented-box collision for cars/props, flow-field zombie pathing across the map, minimap with compass + tap-to-open full map.
v0.6: five connected districts (~450x530 m): downtown, hospital (enterable lobby) + parking garage (enterable deck) east, mall plaza (enterable ground floor) west, subway entrance south with stairs/portal to an underground platform, military checkpoint north (boss lair). js/districts.js; chunk culling, windowed flow field, district zombie mix, ACES + split-tone grading, wall-base AO, searchlight god-rays, ground mist, indoor lighting.
v0.5: rigged heroine 星璃 (Quaternius female_hooded.glb, CC0) and rigged zombies (zombie_a / zombie_chubby, CC0) in js/zombieRig.js:
      per-instance SkeletonUtils clone + AnimationMixer, generated skin shader (bruises, veins, blood, torn clothes), smaller head,
      hunch pivots, glowing eyes, type gear (spitter sac, riot helmet/visor/vest/shield, boss spikes/tumours/core); far mixers throttled.
      Fallbacks: ?hero=proc and ?zombie=proc force the v0.4 procedural models.
