# Reddit Boy — Model Cards Research: Movement Pins + Engine Feasibility

Written 2026-11-25, for Sonja's review before the cards go in the repo.
Sources: web research (artist mannequins, T13/Dummy 13 13-point figures, ball-jointed dolls,
Disney's 12 principles via UBC slides, Pixeli pixel-art timing rules, gamedev animation-frame
conventions, Phaser 4.2.1 README / npm / agent-phaser world notes) + the snoo-boy scaffold
(Phaser 4.2.1 installed and verified, Devvit 0.15.6).

## 1. Movement pin models — what they are and why they work

An artist mannequin (wooden lay figure, 3D-printed Dummy 13 / T13 figure, ball-jointed doll)
is a body reduced to **pins**: ball-and-socket joints at every place a limb changes direction,
with friction that holds a pose. The standard figure has **13+ articulation points**:
neck, shoulders, elbows, wrists, spine/torso, hips, knees, ankles. The realism doesn't come
from the number of joints — it comes from **the chain**: motion starts at the hips/spine
(the leader) and the limbs follow 1–2 beats late, decaying back to still. That is the same
rule Disney codified as follow-through and overlapping action, and it is the rule that makes
a drawn rider read as moving instead of sliding.

### Which pivots matter for our rider (Snoo on an e-scooter)

Snoo has no visible legs in the usual sense — he stands on a scooter deck — so the pin map
is different from a walking figure. The pivots that carry every animation are:

| Pivot | What it does in our game |
|---|---|
| **Neck / head** | Look direction = steering read. Head turns into the steer 1 frame before the body leans. Eyes (orange-red ovals) are the emotion carrier — they tilt, widen, narrow. |
| **Spine / torso** | The leader. Leans into steers, compresses on boost, recoils on a hit. Every other part follows it. |
| **Shoulder (throwing arm)** | The throw. Wind-up pulls the arm back and the torso twists away; release snaps forward; follow-through lets the arm trail 1–2 frames after the phone leaves the hand. |
| **Shoulder (grip arm)** | Stays on the handlebar. It is the anchor — it barely moves, which is what sells the throwing arm's motion by contrast. |
| **Elbow (throwing arm)** | Bends the wind-up, straightens at release. The elbow is the visible "loading" of the throw. |
| **Antenna** | The lagging follower. It trails 1–2 frames behind every head move and wobbles after a hit or a landing — the cheapest, most readable motion cue on the whole character. The ball on the tip is the dot to track on an arc. |
| **Satchel** | A second follower. It swings opposite the torso lean and bounces on boost. Stuffed with glowing phones, so its swing reads even in silhouette. |
| **Scooter deck + handlebars** | The rigid frame. It does NOT deform (squash & stretch never applies to rigid objects). The scooter tilts as one piece; the rider's body does the deforming around it. |
| **Wheels** | Spin + squash at landing only. One squash drawing at contact (a second makes a frog hop). |

### How the animation frames are planned around the pins

- **Pose-to-pose, keys first.** For each action (steer, throw, boost, hit, celebrate, idle),
  draw the 2–3 extreme key poses first — the silhouette must read as a filled black shape
  (staging). Then add breakdowns, then in-betweens.
- **The 3-beat structure for every action:** anticipation → impact → recovery.
  - Throw: wind-up (1–2 frames, torso twist back, arm cocked) → release (1 frame, arm
    snapped forward, phone gone) → follow-through (1–2 frames, arm trailing, antenna lagging).
  - Hit: impact (1 frame, body compressed, eyes wide) → recovery (2–3 frames, shake it off).
  - Boost: lean-in (torso compresses forward, satchel swings back) → hold → settle.
- **Player actions get NO anticipation.** Disney's rule says anticipate everything; games
  forbid it for the player — any wind-up on a player-controlled throw is input lag.
  The throw's anticipation is a single frame at most (≤50 ms), or none. Enemies and
  obstacles (Troll lunge, Mod stepping out) get the full 2–3 frame anticipation — that is
  how the player reads danger coming.
- **Timing table (60 Hz game, sprite rate 100 ms default):** a pose meant to be read stays
  ≥83 ms on screen; impact/snap frames can be 42–50 ms; idle is 2–4 frames of breathing
  (never 1 frame — static reads as dead). Throw total: ~300–450 ms. Hit: 100–200 ms, snappy.
  Celebrate: 500–1000 ms, it is the reward, let it breathe.
- **Arcs, not lines.** The throwing hand, the phone, and the antenna ball all travel on
  arcs — plot them as dots on a guide layer and put each frame's pivot on the curve.
- **Squash & stretch keeps volume constant** (widen by N, lower by about N) and applies
  only to Snoo's soft body — never to the scooter, the phones, or the inbox.
- **Leader first, followers late.** Torso moves, then head, then antenna and satchel trail
  1–2 frames and decay 3 → 2 → 1 → 0 px. That trailing is what makes the motion feel
  physical instead of puppeted.
- **Frame counts per action (pixel-art conventions):** idle 2–4f, throw 4–6f, hit 2–4f,
  celebrate 4–6f, boost lean is a held pose with 2-frame wobble, steering is a lean
  pose (not a cycle — the rider stands on a deck, so steering reads as torso lean +
  head turn, not legs).

## 2. Engine feasibility — Phaser 4.2.1 (the engine in the snoo-boy scaffold)

**Verified in the scaffold:** `phaser: 4.2.1` in package.json and in node_modules, Devvit
0.15.6, scenes Boot / Preloader / MainMenu / Game / GameOver present. Phaser 4.2.1 is the
current stable release (July 9, 2026), MIT-licensed, WebGL + Canvas rendering.

### Verdict: YES, Phaser 4.2.1 can make this art style, glitch-free — it is the right engine

| What the game needs | Phaser 4.2.1 support | Notes |
|---|---|---|
| Pixel-art sprite animation | Built-in animation system; sprite sheets / texture atlases with frame maps; `roundPixels` for crisp pixels | Use power-of-two atlases, 1–2 px extruded padding per frame to stop edge bleeding |
| Oblique view | Cameras + scroll: the oblique look is a camera/scroll setup, not a special renderer — street scrolls up-right, houses drawn in pseudo-3D | No engine feature needed; it is art + camera math |
| Parallax scrolling | `TileSprite` scroll factors; `SpriteGPULayer` per-member scroll factors for parallax backgrounds | GPU layer does parallax without touching the frame budget |
| Particles (glow, phone trails, Front Page! burst) | Particle emitters, `SpriteGPULayer` non-looping one-off effects | Particles live in emitter space — move the emitter, the particles follow |
| Scaling (zoom, phone-class screens) | Camera zoom; `Blocky` filter for pixel-art-friendly pixelation; `Quantize` for retro dithered palettes; `GradientMap` for palette swaps (golden scooter skin = a palette swap) | Palette-swap filters make the golden skin and colorblind palettes cheap |
| Tight controls (no input delay, no clipping, no glitching) | Input system + Gamepad API built in; fixed-timestep update loop; Arcade physics for clean collision | Input is polled per frame; the 100 ms sprite rate is decoupled from input polling, so a throw fires on the frame it is pressed |
| Haptics (rumble cue) | Gamepad API exposes vibration actuators | Optional channel, with off switch, per the XAG haul |
| Accessibility hooks (remapping, text scale, high contrast) | All runtime-controllable (input map, camera/text scale, filters) | Nothing here needs a plugin |

### Real risks / limits and how to avoid them

1. **No automatic sprite culling in Phaser 4.** Offscreen sprites cost the same as visible
   ones. Fix: hide/destroy chunks outside the camera view; only hidden objects are free.
   (Our routes are 20 houses — small — but the rule still applies to particles and background layers.)
2. **Two tilemap renderers, different rules.** `TilemapGPULayer` paints an empty cell as the
   sheet's top-left pixel, has no per-tile tint, and keeps only flipX/flipY (Tiled rotations
   draw wrong). Fix: dense ground on GPU layers, sparse/special content (houses, inbox,
   obstacles) on CPU layers. Don't author rotated tiles for GPU layers.
3. **`roundPixels` stops snapping at zoom.** At camera zoom ≠ 1, pixel snapping breaks and
   art shimmers. Fix: keep world zoom at 1 and scale the whole canvas instead, or accept
   the shimmer only on the comic-panel overlays (never on gameplay sprites).
4. **Particles live in emitter space.** Moving the emitter moves its particles — a phone
   trail emitter parented to a moving phone will smear. Fix: emit in world space for trails,
   emitter space only for static bursts.
5. **Phaser 3 habits fail in v4.** New Render Node architecture, new tinting/lighting
   (`sprite.setLighting(true)`), filter system replaces pipelines. Fix: build against the
   v4 docs only; do not copy v3 examples.
6. **Devvit Web iframe context.** The game runs inside an iframe on reddit.com; the
   Gamepad API in Reddit's in-app webview is unverified (already flagged as a playtest
   target on Sonja's S21+). Fix: touch + keyboard always work; controller is a bonus
   channel, never the only input.
7. **Frame-rate-dependent animation.** Sprite rate must be decoupled from render rate or
   the game runs fast on 120 Hz screens. Fix: drive animations from the update loop's
   delta, not from frame counts.

### Bottom line

Phaser 4.2.1 is the right engine — it is what the official Devvit Phaser starter ships,
it is already installed and building clean in the scaffold, and every visual in the box art
and on the cards maps to a first-class Phaser feature. The risks above are all known,
documented, and avoidable with the fixes listed. No engine change needed.

## 3. Cards

All in `cards/` in this project folder, one subject per card, each checked against the
canon bible NEVER list before presenting. Known v3 violation (mailbox-looking receptacle)
was NOT copied forward — every inbox card shows a proper glowing inbox.

Final set (14 cards, verified 2026-11-25):
- `card-rider-female.webp` — 24 views: idle, steer L/R, side/back, braking, throw
  wind-up/release/follow-through, satchel reach, look-back, wave, boost lean + speed
  lines, coast, sharp turn, curb jump, landing, hit flinch front/side, recovery,
  thumbs-up, celebration arms-up, celebration on golden scooter.
- `card-rider-trans.webp` — same 24 views, pride pin on satchel strap.
- `card-inbox.webp` — 6 views: front, 3/4 oblique, side, glowing slot close-up,
  night, phone landing.
- `card-hot-post.webp` — 6 views: front, back, in flight, tablet variant, night
  glow, spinning mid-throw.
- `card-scooter.webp` — 8 views: 4 upgrade stages (junky, cleaner, sleek, golden)
  × side + 3/4.
- `card-satchel.webp` — 6 views: front closed, open loaded, back, strap & buckle
  close-up, worn over shoulder, swinging mid-ride.
- `card-mod.webp` — 6 views: front standing, side walking, muttering, blocking
  path, shaking ban-hammer, ban-hammer detail.
- `card-troll.webp` — 6 views: front grinning, side lurking, typing furiously,
  laughing/pointing, throwing a rotten post, dizzy after a Hot Post hit.
- `card-doomscroller.webp` — 6 views: front shambling, side walking, phone-glow
  close-up, pole collision, curb stumble, back walking away.
- `card-dasher.webp` — 6 views: front riding, side speeding, insulated backpack
  close-up, handing off a food bag, waving apology, skidding to a stop. NOTE: the
  generator drew the Dasher as a Snoo in a helmet — flagged for Sonja's call.
- `card-karma-thief.webp` — 6 views: front sneaking, side running with sack, sack
  of upvotes close-up, reaching for a glowing inbox, caught red-handed, dizzy.
- `card-billboard.webp` — 6 views: front, 3/4, side, lit at night, Snoo face
  close-up winking, back (posts + frame).
- `card-snoo-gnome.webp` — 6 views: front, side, back, sitting on a mushroom,
  glowing at night, face close-up.
- `card-dollhouse.webp` — 6 views: front, 3/4, side, glowing windows at night,
  door/porch close-up, back. Neon pink #FF1E89 only here (sanctioned easter egg).

GAP: `card-rider-male.webp` was refused by the image tool on an integrity check
(2026-11-25 ~07:51) and was NOT retried. Needs Sonja's go-ahead on a reworded prompt.
Nothing was pushed to GitHub — Sonja reviews the cards first.

## 4. Regeneration round — Dasher (human) + Dollhouse (logo match), 2026-11-25

Sonja's feedback: the Dasher must be HUMAN (not a Snoo in a helmet) and must ride an
E-BIKE; the Dollhouse must look like her actual logo. Both regenerated, verified
against the canon NEVER list, old cards replaced/deleted.

- `card-dasher-male.webp` — 6 views: front riding toward viewer, side speeding,
  insulated backpack close-up ("HOT & FRESH"), handing off a food bag, waving
  apology, skidding to a stop. Human man, helmet, blue jacket, green insulated
  backpack, e-bike with battery pack. PASSES canon check.
- `card-dasher-female.webp` — same 6 views: front, side speeding, insulated
  backpack close-up ("INSULATED · THERMAL"), handing off a food bag, waving
  apology, skidding to a stop. Human woman, ponytail, helmet, teal jacket, orange
  insulated backpack, e-bike with battery pack. PASSES canon check.
- `card-dollhouse.webp` (REPLACED) — 6 views: front, 3/4, side, glowing windows
  at night, door/porch close-up, back. Now matches Sonja's logo
  (`dollhouse-logo-reference.jpg`, copied from her upload): neon pink dollhouse,
  woman in pink seated on the roof, dolls in the windows, neon DOLLHOUSE DEVIANTS
  sign, haunted night backdrop. Neon pink #FF1E89 sanctioned here (DD easter egg).
  PASSES canon check. Minor: side view's sign text garbles ("DOLHOSE DEVIANS");
  front/4/5 views render the sign cleanly.
- DELETED: old `card-dasher.webp` (Snoo in a helmet — wrong).

### Design notes recorded (Sonja's direction, 2026-11-25)

- **Dasher randomization:** in-game, which Dasher appears is RANDOM per appearance
  (male or female — you don't always see the same one). Both variants share the
  same audio cue: the **Dasher Ding**, the 5-note glockenspiel bell
  (ding-ding-DING-ding-DONG). The sound is the constant; the rider varies.
- **Dasher uniform note (flagged, not a violation):** the two variant cards use
  different palettes (male: blue jacket / green bag; female: teal jacket / orange
  bag) — they read as two different delivery companies. For in-game continuity,
  consider one shared courier uniform palette across both variants; Sonja's call.
- **Dollhouse logo fidelity:** the logo's own tagline spelling ("colaborstive") is
  preserved on the card as it appears in the reference — do not "fix" it without
  Sonja's say-so; it is her logo's text.
- Male rider card (`card-rider-male.webp`) still BLOCKED — not retried, per
  instructions; Sonja has not asked for a reworded attempt.
