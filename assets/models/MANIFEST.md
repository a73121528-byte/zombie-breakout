# assets/models — manifest (v0.5 step1)

All models: Quaternius, CC0 (see LICENSES.txt). GLB, no external files, **no Draco/meshopt**.
Only extension used: `KHR_mesh_quantization` (handled natively by three r160 GLTFLoader, no decoder needed).
Loader: `lib/GLTFLoader.js` (r160, import path patched to `./BufferGeometryUtils.js`).
Use `lib/SkeletonUtils.js` `clone()` to make multiple skinned instances (plain `.clone()` breaks skinning).
Inspect with `python3 tools/inspect_glb.py <file>`; re-optimize with `tools/optimize_glb.mjs` (needs `@gltf-transform/*` from npm).

Total size: **2.6 MB** (budget 15 MB).

| File | Bytes | Tris | Role |
|---|---|---|---|
| `female_hooded.glb` | 797,332 | ~7.3k (incl. 0.9k sword) | **Protagonist 星璃 base** (hood, leather corset, pauldrons, gold trim, sword in right hand) |
| `female_casual.glb` | 759,952 | ~6.4k | Alternate female body (longer tied hair, T-shirt/trousers). Same rig + clips as hooded; spare / NPC survivor |
| `zombie_a.glb` | 646,176 | ~7.8k | Zombie enemy, basic (green, torn jeans, eyelids, tongue bones) |
| `zombie_chubby.glb` | 414,756 | ~6.2k | Zombie enemy, chubby/brute variant (purple). Same rig + clips as zombie_a |

All clips are **in place** (root/Body translation net ≈ 0 for Walk/Run/Roll/Death) → game code moves the object.
Clip names had the `CharacterArmature|` prefix stripped and duplicates removed.

## Scale / orientation
- Root node `RootNode`; armature `CharacterArmature`; skinned mesh nodes have scale 100 (FBX legacy; renders correctly). Y-up, facing +Z.
- Bind-pose bbox (m): female_hooded 0.58 × **1.84** × 1.03 (sword sticks out), female_casual 0.52 × **1.81** × 0.62,
  zombie_a 1.31 × **1.19** × 0.73, zombie_chubby 1.64 × **1.52** × 0.84.
  → women ≈ 1.8 m tall; zombies are cartoon/chibi proportioned and short — scale zombie_a ≈ ×1.45, chubby ≈ ×1.15 to match.

## Skeletons / key bones
**Female rig (female_hooded, female_casual — identical, 62 joints):**
`Root > Body > Hips > Abdomen > Torso > Chest > Neck > Head (> Head_end)`;
arms `Shoulder.L/R > UpperArm.L/R > LowerArm.L/R > Wrist.L/R > Index1-4/Middle1-4/Ring1-4/Pinky1-4/Thumb1-3 .L/.R`;
legs `UpperLeg.L/R > LowerLeg.L/R`, `Foot.L/R` (IK-style, parented to Root), pole targets `PT.L/R`.
- Weapon attach: **`Wrist.R`** (right hand), `Wrist.L` (left). Hooded's `Sword` mesh is a child of `Middle1.R` —
  reuse it as the melee blade or hide via `getObjectByName('Sword').visible=false`.
- Head: `Head`; spine: `Abdomen`/`Torso`/`Chest`; hips: `Hips`.

**Zombie rig (zombie_a, zombie_chubby — same bone names, 50 joints):**
`Root > Body > Hips > Abdomen > Torso > Neck > Head` (+ `Tongue1-5`, `Eyelid.L/R` on zombie_a);
arms `Shoulder.L/R > UpperArm.L/R > LowerArm.L/R > Pinky1-3/Middle1-3/Index1-3/Thumb1-2 .L/.R` (**no wrist bone** — hand = `LowerArm.*`/finger roots);
legs `UpperLeg.L/R > LowerLeg.L/R`, `Foot.L/R`, `PoleTarget.L/R`.
- Head (headshots / hit FX): `Head`; hands for claw hit-box: `Middle1.L/R` or `LowerArm.L/R`.

Female and zombie rigs differ (no clip sharing between them). Clips can be shared within each pair.

## Materials (for recolor)
- **female_hooded**: `Medieval_Head`: White (=hair, 1072 tris), DarkBrown (=hood), Skin, Black, Brown.
  `Medieval_Body`: Black, LightBrown, DarkBrown, Skin, **Gold (trim, 68 tris)**, Metal (pauldrons).
  `Medieval_Legs`: Black. `Medieval_Feet`: LightBrown, DarkBrown. `Sword`: Metal, Brown2, Metal_Dark.
  Materials are **shared across meshes** (e.g. DarkBrown = hood + corset + boots) → clone materials per mesh before recoloring.
  Suggested 星璃 recolor: White(hair)→purple, DarkBrown/LightBrown→near-black leather, Gold→bronze (#8c5a2b-ish), Metal→dark bronze.
- **female_casual**: Hair_Blond (hair, 2128 tris), Hair_Brown, Skin, White (shirt), Orange (trousers), Grey (shoes), Brown.
- **zombies**: single `Atlas` material with tiny palette PNG (6 KB / 3.5 KB) — tint via `material.color` or swap atlas.

## Clip mapping
Durations in seconds.

| Need | female_hooded / female_casual | zombie_a / zombie_chubby |
|---|---|---|
| idle | `Idle` 2.08 (alt `Idle_Neutral` 2.08, `Idle_Sword` 2.08, `Idle_Gun` 2.08) | `Idle` 1.00 |
| walk | `Walk` 1.67 | `Walk` 1.33 (zombie shamble) |
| run | `Run` 1.00 (strafe `Run_Left`/`Run_Right` 1.00, `Run_Back` 1.04) | `Run_Arms` 0.67 (arms-forward zombie run; chubby `Run` 0.71, zombie_a `Run` 0.67) |
| melee attack | `Sword_Slash` 1.29 (alt `Punch_Left`/`Punch_Right` 1.04, `Kick_Left`/`Kick_Right` 1.17) | `Punch` 0.75 (alt `Run_Attack` 0.67 lunge-while-running, `Idle_Attack` 1.67 flailing) |
| shoot / aim | `Gun_Shoot` 0.75, aim-hold `Idle_Gun_Pointing` 2.08, `Idle_Gun_Shoot` 0.83, moving `Run_Shoot` 1.04 | n/a |
| roll / dodge | `Roll` 1.67 (forward roll, in place) | n/a (`Crawl` 1.67 for a crawler state) |
| hit react | `HitRecieve` 0.71 (alt `HitRecieve_2` 0.71) | `HitReact` 0.58 |
| death | `Death` 1.33 | `Death` 0.75 |
| extras | `Interact` 1.58, `Wave` 2.08 | `Jump` 0.33, `Jump_Idle` 0.50, `Jump_Land` 0.33, `No`/`Yes`/`Wave` 1.67 |

(Clip names are spelled exactly as in the files, including Quaternius's "Recieve" typo.)

## Gaps / caveats
1. **Hair**: hooded's hair is short/shoulder-length under the hood — no long hair. Long purple hair needs extra geometry
   (e.g. procedural hair cards/ribbon attached to `Head`, optionally swaying) — or use female_casual's head (tied hair) as reference.
2. **Coat**: hooded wears a corset/jerkin + trousers, not a long coat. Coat tails must be added (mesh attached to `Hips`/`Torso`), or accept the jerkin look.
   Hood + gold trim exist natively.
3. **Female**: no reload, no aim-walk (only `Run_Shoot`), no backward/side dodge (only forward `Roll`), single death variant; gun clips assume a one-handed pistol pose and there is no gun mesh (attach the game's own weapon to `Wrist.R`).
4. **Zombies**: cartoon/chibi proportions (large head) — style contrast with the semi-realistic female; need upscaling. No shoot/roll (not needed). Short `Death` (0.75 s), single variant — hold last frame (`clampWhenFinished`). No female zombie.
   Only 2 CC0 humanoid zombie bodies were directly downloadable; the kit's Ribcage zombie / arm-crawler are only in a Google Drive folder (browser) — skipped.
   Variety can come from tinting the atlas, scaling, and mixing the 2 bodies.
5. Considered, not vendored: Quaternius "Lis" (zombie-kit survivor, pistol, same rig as zombies, but no roll — https://poly.pizza/m/gjuwleUT1U, CC0);
   Quaternius Universal Animation Library free subset (CC0 mannequin with 46 clips incl. Pistol_Aim/Roll/Hit_Chest, GitHub mirror J-Ponzo/gltf-universal-animation-library, 2.9 MB raw, no zombie clips);
   three.js Xbot/Michelle/Soldier (Mixamo-derived → not redistributable).

## v0.6 heroine: Universal Base Characters + Universal Animation Library (CC0, Quaternius)
| File | Contents | Size |
|---|---|---|
| `ubc_female.glb` | Superhero_Female body (7.4k verts, 65-joint UE-style skeleton: root/pelvis/spine_01-03/neck_01/Head/clavicle/upperarm/lowerarm/hand/fingers/thigh/calf/foot/ball), Eyes, Eyebrows; 2048 base colour (light skin), 1024 normal | ~0.9 MB |
| `ubc_hair_long.glb` | Hair_Long, skinned to the same skeleton (Head only), greyscale albedo + normal | ~0.56 MB |
| `ual_hero.glb` | clips only: Idle_Loop 2.50, Walk_Loop 1.33, Jog_Fwd_Loop 0.93, Sprint_Loop 0.67, Sword_Attack 1.53, Sword_Idle 1.67, Roll 1.47, Death01 2.40, Hit_Chest 0.33, Hit_Head 0.43, Pistol_Idle_Loop 1.67, Pistol_Aim_Neutral 0.17, Pistol_Shoot 0.63, Pistol_Reload 1.67 | ~0.24 MB |

Game alias → UAL clip: Idle←Idle_Loop, Idle_Gun←Pistol_Idle_Loop, Walk←Walk_Loop, Run←Jog_Fwd_Loop, Sword_Slash←Sword_Attack,
Roll←Roll, Death←Death01, HitRecieve←Hit_Chest, HitRecieve_2←Hit_Head, Interact←Pistol_Reload, Gun_Shoot←Pistol_Shoot,
Idle_Gun_Pointing←Pistol_Aim_Neutral, Run_Shoot←Jog legs + Pistol_Aim_Neutral upper body (built at runtime).
The v0.5 rig (`female_hooded.glb`) stays available with `?hero=old`.
