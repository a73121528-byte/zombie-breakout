喪屍突圍 ZOMBIE BREAKOUT — mobile 3D action prototype (three.js r160, vendored in lib/)
Serve:   cd /workspace/game && python3 -m http.server 8000   →  http://<host>:8000/index.html
Phone:   open in landscape; Add to Home Screen for fullscreen (manifest.webmanifest).
Desktop: WASD move · mouse drag / arrow keys camera · J attack · K/Space dodge · L skill · ; / Q / Tab lock-on · Esc/P pause · E cycle weapon · 1-4 select weapon · R reload
v0.2: procedural rounded character models, guns (手槍/霰彈槍/步槍, unlocked waves 1/2/3), weapon parts 武器零件 (auto-equip, see pause menu),
      graphics quality 自動/低/中/高 (menu or pause; saved in localStorage zb_quality), 裝甲屍 riot-police zombie (waves 3-5).
