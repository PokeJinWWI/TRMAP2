# Session Notes — TRMAP2 (Terra Relicta interactive star map)

Written as a handoff so a fresh session can pick up without re-deriving context. Read this
first, then check `git log` / `git diff` for the exact current state (this file will go stale
as more work happens).

## What this app is

A single-page Three.js (r0.166.1, via esm.sh CDN, no build step) interactive 3D map of:
Sol's solar system → nearby real stars (within ~12 ly) → the Milky Way → Sagittarius A* at the
galactic core. No bundler — `index.html` loads `scene-boilerplate.js` directly as an ES module.

- `index.html` — all UI markup + inline CSS. No separate CSS file.
- `scene-boilerplate.js` — everything else (~3000 lines). Scene setup, all celestial body data,
  all rendering, all UI event wiring, the animation loop. Monolithic by design so far.
- `textures/` — planet/star/moon image maps, HDR skybox, galaxy sprites.
- `.claude/launch.json` — a `static-site` preview config (`python3 -m http.server 8420`) for
  the Browser-pane preview tooling. Use `preview_start({name: "static-site"})`.

No package.json, no npm, no build. Just serve the directory statically.

## Coordinate system (important, comes up constantly)

- `sceneUnitsPerAU = 35`, `sceneUnitsPerLy = 35 * 63241.1`.
- Sol sits at `solGalacticPosition`, its *real* galactic coordinates — roughly
  **5.7×10¹⁰ scene units** from the world origin (0,0,0), which is the galactic center /
  Sagittarius A*'s location. This huge absolute offset is a deliberate design choice (correct
  galactic-scale placement) but is the root cause of a whole class of float32-precision bugs —
  see "Known issue: orbit-line drift" below.
- Camera/scene use a single flat coordinate space throughout; no camera-relative or
  floating-origin rendering anywhere (yet).

## View-scale state machine

`currentScale` ∈ `'planet' | 'system' | 'interstellar' | 'galactic'`, driven by
`distanceToTarget` / `distanceInAU` thresholds in the `SCALES` object (see `REALISTIC_SCALES`,
around line ~1715). Transitions between interstellar↔galactic use `startAutoZoom()` to glide the
camera; other transitions just flip the scale label without moving the camera. `autoZoom.active`
gates the whole state-machine block so it doesn't re-evaluate mid-glide.

`maintainCameraDistance()` runs every frame (whenever `focusedObject` is set) and lerps
`controls.target` toward the focused object's world position, independent of the state machine.
Interactions between this and `autoZoom`'s own target lerp are subtle — see the oscillation bug
fixed this session.

## Black hole (Sagittarius A*) — three-tier LOD

1. **Interstellar sprite** (`createBlackHole()`, in `stellarObjects`): a billboard, sized like a
   normal star sprite (`55000 * 10`, matching the `starData.scale * 10` convention other stars
   use) so it doesn't dominate the view disproportionately.
2. **Mesh fallback** (`createBlackHole()`, `systemGroup`): event horizon sphere + flat
   `RingGeometry` accretion disk (shader-animated swirl) + a Fresnel photon-ring glow shell.
   Used for "system" scale when *not* close enough for the raymarcher, **and** whenever
   Mode = Strategic (the deliberate low-cost fallback).
3. **Raymarcher** (`createBlackHoleRaymarcher()` + `updateBlackHoleRaymarchUniforms()`): a
   full-screen `ShaderMaterial` quad, ported from
   https://celticspwn.github.io/CS184FinalProject/ (Verlet-integrated curved photon paths,
   real gravitational lensing, disk-plane intersection, event-horizon cutoff). Only rendered
   when **all** of: `blackHoleRaymarch` exists, Mode ≠ Strategic, `currentScale === 'system'`,
   `lastFocusedSystem === 'Sagittarius A*'`, and `camera.position.length() < RAYMARCH_MAX_DISTANCE`
   (currently `40 * sceneUnitsPerAU`, empirically tuned — see below). See the render branch near
   the end of `animate()`.

   Adapted from the reference: uses the app's real OrbitControls camera (position/fov/basis
   vectors recomputed each frame in `updateBlackHoleRaymarchUniforms`) instead of the reference's
   auto-orbiting dummy camera; samples the app's own HDR skybox (`scene.background`) as the
   star field instead of a separate photo; disk texture is procedurally baked
   (`createDiskTexture()`) since we don't have the reference's photo asset.

   **Known limitations, deliberately accepted, not further pursued this session:**
   - *40 AU raymarcher cutoff*: found empirically, not analytically. The step size has to stay
     fine for the close-up lensing to look right, which bounds total reach within the ~140-step
     budget; pushing the reach further (tried extending the adaptive-step ceiling) didn't
     actually work because you need the per-step *fraction* of remaining distance to be much
     higher for far starting distances, which then wrecks near-field accuracy — no free lunch
     with a single global formula. Below 40 AU it's full quality; above it, falls through to the
     mesh tier. Tested empirically: good to ~40 AU, visibly degrading by ~55-70 AU, fails
     outright (rays never reach the disk) by ~85-90 AU.
   - *Moiré/grid interference pattern on the accretion disk near the photon ring* (user
     screenshot showed a visible dashed-line grid): confirmed via testing this is **not** from
     the disk texture (swapped periodic `sin(phi*N)` turbulence for non-periodic random+blur —
     zero visible change, ruling texture out). It's aliasing from the raymarcher's single-sample-
     per-pixel evaluation near the photon sphere, where the true screen→disk mapping has
     effectively infinite local frequency (photon orbits winding arbitrarily many times for
     infinitesimally different starting angles — a real physical feature of photon spheres, not
     a bug). Tried NSTEPS 140→220 + finer step — changed the pattern's character, didn't remove
     it, cost ~55% more per-frame. Reverted (kept at 140/0.16) rather than pay that cost for a
     partial fix, given phone-performance is an explicit standing concern. Real fix would be
     supersampling (multiple jittered samples per pixel, averaged) — a genuine, separate
     performance-for-quality trade, not attempted.
   - The interstellar↔system transition (sprite → mesh-tier) and mesh↔raymarcher transition
     (at 40 AU) are both **hard cuts**, not crossfades. Known, accepted, not revisited.
   - `u_camVel` (camera's own relativistic Doppler/aberration) is intentionally always zero — an
     earlier version derived it from frame-to-frame camera position deltas, which spiked
     violently on mouse-wheel zoom (large per-frame deltas) and caused a visible flash/bend that
     snapped away the instant the camera stopped moving. Removed entirely; the disk's own
     orbital-motion Doppler beaming (driven by `u_time`, not camera movement) is untouched and
     still works.

## Known issue, reverted this session, NOT currently fixed: orbit-line drift

Planets with large orbits (Pluto especially) visibly drift off their own drawn orbit ellipse when
zoomed in close. **Root cause** (confirmed, not just theorized): `orbitRing.position` gets set to
`systemCenterPosition` (~5.7×10¹⁰ units), and the GPU combines that huge mesh-level translation
with small per-vertex local ellipse offsets (up to ~1380 for Pluto) in 32-bit float — GLSL
uniforms are always float32, and at that magnitude one float32 ULP is ~6800 units, larger than
Pluto's entire orbit radius. The planet *mesh* doesn't show this because its position is computed
as a single `systemCenter.add(orbitOffset)` in JS double precision *before* ever touching the GPU
— i.e. rounded once, correctly, rather than the GPU adding huge+small itself.

**A fix was attempted and reverted** (bake the full double-precision world position into each
orbit-line vertex, so `mesh.position` stays identity). This *sounds* right but was wrong in
practice: `BufferAttribute`s are also `Float32Array`-backed, so it just moved the same rounding
problem to a different spot — and for *small* orbits (Mercury's is only ~14 units, entirely
inside one float32 ULP at this magnitude), baking absolute coordinates makes every vertex
independently round to a coarse grid, turning a smooth ellipse into a jagged, unstable zigzag
that visibly "flashed" as the camera moved. That regression was reported by the user and fully
reverted (verified via `git diff` showing the orbit-related code is byte-identical to the
original commit).

**Current state: back to the original (milder) bug.** Pluto drifts off its line when you zoom in
close on it; other planets are fine in practice (small enough orbits that it's not visually
obvious, though the underlying imprecision technically affects all of them somewhat).

**The correct fix**, not yet attempted: camera-relative / floating-origin rendering — recompute
each object's position relative to the camera in JS double precision every frame, so only *small*
numbers ever reach the GPU. This is a real, scoped, well-understood technique (used by every
large-world game engine), not a fundamental architecture problem — but it's a genuine
moderate-sized task that touches how orbit lines (and maybe more) are positioned, and deserves to
be built and tested in isolation (multiple planets, multiple zoom levels) rather than patched
live, given the last attempt's regression. User explicitly deferred this ("fix it later").
Labels, raycasting/click-picking, and the underlying simulation data are all already correct
regardless — this is purely a rendering-precision issue for drawn line geometry.

## Other fixes made this session (all verified in-browser, all still in place)

- **Interstellar label bleed**: labels for stars in one "stellar neighborhood" (e.g. Sol's real
  nearby-star catalog) were showing while focused on a different, far-away neighborhood (e.g.
  Sagittarius A*). Fixed with a `STELLAR_NEIGHBORHOOD_RADIUS` (50 ly) distance gate in the label-
  opacity logic in `animate()` — only labels within that radius of the currently-focused system's
  center are eligible to show (pinned labels always show regardless, unchanged).
- **Planet lighting**: `sunLight`/`starLight` power and decay were calibrated as if scene units
  were real AU (physically "correct" inverse-square falloff), but orbital distances here are
  compressed for visualization — this badly overexposed inner planets (Venus was almost solid
  white) and desaturated everything toward the ACES tonemapper's white point. Reduced
  `sunLight.power` from `4π×100000` to `4π×2000`, relaxed `decay` from `2.0` to `1.5`. Also:
  Strategic mode now zeros `sunLight.power` and sets `ambientLight.intensity = 1.3` (was
  wrongly still showing a day/night terminator from HDR-skybox image-based lighting even in
  "flat" mode — fixed by also toggling `material.envMapIntensity` to 0 on all planet/moon
  materials in Strategic mode, 1 in Realistic).
- **Galactic/interstellar oscillation**: focusing Sagittarius A* while zoomed out caused the
  camera to auto-zoom in/out forever between galactic and interstellar scale. The galactic-scale
  auto-zoom landing point (100 ly) was *inside* the 300 ly threshold that defines "galactic"
  scale, so completing that zoom immediately re-triggered the reverse transition. Fixed by
  landing at `SCALES.INTERSTELLAR_TO_GALACTIC * 1.3` (390 ly) instead — mirrors the existing
  (already-correct) `* 0.8` landing point used for the reverse transition.
- **Search filter**: added a "Black Holes" option to the search filter `<select>`; reclassified
  Sagittarius A*'s `searchableObjects` entry from `type: 'star'` to `type: 'blackhole'`.
- **Mobile memory**: `textures/hdr/space.hdr` was 8192×4096 (~536 MB decoded as a float texture)
  — almost certainly why the app didn't run on phones. Downsampled to 2048×1024 (61 MB → ~6 MB
  file). Also downsized the 4 sun-spectral-type textures and the asteroid belt texture. Originals
  are recoverable from git history (this is a git repo; nothing was deleted, just overwritten in
  the working tree — not yet committed as of writing).
- **Strategic mode** is now also the deliberate low-cost fallback for the black hole (reuses the
  existing mesh-tier rendering — see LOD section above) — this was a UX suggestion from the user
  partway through, replacing an earlier standalone checkbox I'd added and then removed.

## Testing/debugging notes for next session

- **Browser caching bit us repeatedly**: this environment's preview browser aggressively caches
  the JS module. A `preview_start` on the same port does *not* guarantee a fresh fetch. When
  iterating on a fix, append a throwaway query string to the script tag
  (`<script src="scene-boilerplate.js?v=qaN">`) and bump `N` each time, or open a genuinely new
  tab via `tabs_create`. Remove the query string before finishing.
- **Direct camera scripting via a debug hook fights OrbitControls' internal state.** Setting
  `camera.position`/`controls.target` directly from injected JS works for one frame but then gets
  overridden by `maintainCameraDistance()`'s own lerp using stale internal state, causing weird
  drift. The reliable way to test camera-dependent behavior is to drive the **actual UI**: click
  the search box, type, click the suggestion, then use real `scroll` actions to zoom — this
  was consistently reliable across the session; direct scripting was not.
- A temporary `window.__debug = { camera, controls, THREE, scene, focus }` hook (assigned in
  `main()`) is useful for quickly calling `scene.getObjectByName(...)` and `focus(obj)` from
  `javascript_exec`, but **remove it before considering a fix done** — it was added and removed
  several times this session; check `grep -n "window.__debug"` before wrapping up to confirm it's
  gone.
- `read_console_messages` in this tool session appeared to return **stale/accumulated** messages
  across navigations at least once (showed errors from a since-fixed bug after a fresh reload
  that visually worked fine). If console output contradicts what you're seeing on screen, trust
  the screenshot/live JS state and re-verify with a genuinely fresh tab before believing the
  console.
- Syntax-check quickly without a browser via:
  `node -e "new Function(require('fs').readFileSync('scene-boilerplate.js','utf8').replace(/^import.*$/gm,'').replace(/^export /gm,''))"`

## Git state as of writing

Nothing this session has been committed (user hasn't asked). Working tree has the changes
described above on top of `main` (commit `ddcb4e8`). `.claude/` (including `launch.json`) is
untracked. Modified: `index.html`, `scene-boilerplate.js`, and the texture files listed above.
