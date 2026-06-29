# Warhammer Fantasy — Development Log

> **For AI collaborators:** This is Hades' domain. Read this before touching anything. It captures decisions, architecture, and context that won't be obvious from the code alone.

---

## Project Overview

A Warhammer Fantasy (Warhammer Fantasy Battle / The Old World) companion app — scope TBD by the user. Owned by Lenny-glitch on GitHub.

**Sister projects:**
- `warhammer-fantasy/` ← this repo
- `age-of-sigmar/` ← Age of Sigmar companion (separate repo, same AI: Hades)
- `warhammer40k/` ← 40K simulator (separate AI team: nyx + nox)
- `killteam/` ← Kill Team variant
- `roster/` ← standalone roster builder

**AI team:** Hades handles both `warhammer-fantasy` and `age-of-sigmar`. Nyx and Nox handle the 40K-side repos.

---

## Stack

- **Frontend:** Vanilla JS, no framework. Single-page app (`whf.html` + `whf.js` + `whf.css`).
- **Data:** Firebase Realtime Database, same project as 40K (`warhammer-5f2f4`). Plain HTTPS REST — no auth token needed while rules are open for dev.
- **Build/deploy:** `build.js` generates `firebase-config.js` from env vars at Netlify build time. `netlify.toml` wires it up.
- **Scale:** 1200×900px SVG board = 72"×48" (6'×4' standard). `INCHES_TO_PX = 1200/72 = 16.67px/inch`.

---

## Phase Log

### Phase 0 — Project Bootstrap (2026-06-27)

- Repo initialised. DEVLOG.md and CLAUDE.md created. Awaiting first feature brief.

---

### Phase 1 — WHF Roster Data Layer (2026-06-27)

**Commits:** `7355cb2` (data write + corrections patch)

Populated Firebase with 8th edition unit templates and roster schemas for two factions.

**Empire (10 units):** Halberdiers, Handgunners, Greatswords, Empire Knights, General of the Empire, Empire Captain, Battle Wizard, Cannon, Mortar, Hellblaster Volley Gun.

**Bretonnia (9 units):** Men-at-Arms, Peasant Bowmen, Knights of the Realm, Questing Knights, Grail Knights, Bretonnian Lord, Paladin, Damsel, Prophetess.

**Firebase paths:** `gameData/warhammer-fantasy/{factionId}/units/{unitId}` and `rosterSchemas/warhammer-fantasy/{factionId}`.

**Scripts:** `scripts/write-whf-units.js` (one-shot write, plain HTTPS PUT), `scripts/patch-whf-corrections-1.js` (stat corrections applied after Nox spot-check).

**Stat corrections applied:**
- Grail Knights: WS 6→5, I 6→5, A 3→2, Ld 10→8; Living Saints ability added; Lance Formation rank-of-3 errata applied to KotR, QK, GK
- Paladin: T 3→4, I 6→5, Ld 9→8
- Bretonnian Lord: WS 7→6, BS 4→3, S 5→4, I 7→6, Ld 10→9

**Source:** Primary stats from 8th.whfb.app Next.js data endpoint (`/_next/data/{buildId}/unit/{slug}.json`). Grail Knights, Paladin, Bretonnian Lord verified against this source. Character stats (General, Captain) are from training knowledge — flagged for future verification before character combat is implemented (unblocks at WHF-5).

**KotR Sv = 2+:** Army book default (full plate + shield). The 1+ achievable with barding + magic item upgrade is not the base profile. Roster system will handle equipment-modified saves when wired up.

---

### Phase 2 — WHF-1: Board & Regiment Engine (2026-06-27)

**Commits:** `1736e12`, `293e9f6`

**Files:** `whf.html`, `whf.js`, `whf.css`, `build.js`, `netlify.toml`

Static SVG battlefield with two hardcoded test regiments and full click-to-inspect stat panel.

**Core geometry (`modelPosition`):** 2D CW rotation in SVG space (Y-axis down). `unit.position` = front-left slot (row=0, col=0). `unit.facing` = degrees CW from north. All subsequent geometry (charge, flank detection, wheel) derives from this. Tested at 0°, 90°, and 45° — all 7 cases pass.

**Test units:**
- Empire Halberdiers: 20 models, rankWidth=5, facing=90° (east), position={x:460,y:376}
- Bretonnian KotR: 9 models, rankWidth=3, facing=270° (west), position={x:740,y:442}

**Rendering:** `<circle>` model tokens with `<polygon>` facing arrows and `<text>` labels in `<g class="unit">` groups. Champion marked with inner dot. Dead models at 28% opacity (ghost-in-place).

**WHF-1 interactions:** click unit → stat panel slides in from right; right-click model → toggle dead/alive; Escape or click background → deselect.

---

### Phase 3 — WHF-2: Movement Phase (2026-06-28)

**Commits:** `8a6fc5c`

**Files:** `whf.html`, `whf.js`, `whf.css` (extended)

Full 8th edition Movement Phase. Ghost preview pattern (preview before commit), three manoeuvre types, phase tracker chrome.

**Geometry added (all standalone, derive from `modelPosition`):**
- `facingVector(unit)` — SVG-space forward direction vector
- `frontCorners(unit)` — front-left and front-right model slot world positions
- `moveUnitForward(unit, inches)` — pure; returns new unit, no mutation
- `calculateNewPositionFromRightPivot(unit, rightPivot, newFacingDeg)` — algebraic inverse for wheel right-pivot constraint
- `wheelUnit(unit, pivotSide, angleDeltaDeg)` — pivots around one front corner; returns null if M exceeded
- `reassignModels(unit)` — rebuilds model row/col after rankWidth change (NOT rank collapse — that is WHF-5)
- `reformUnit(unit, newRankWidth)` — redresses in place, front-centre fixed, costs full M
- `violates1InchRule(movingUnit, allUnits)` — O(m×e) edge-to-edge check; threshold = inchesToPx(1) + 2×MODEL_R

**Movement state on units:** `movementUsed`, `backwardInches`, `hasReformed`, `hasMoved`, `phaseDone`

**Interaction:** two-step preview-then-commit. `moveGhost` lives outside state. Ghost renders at 40% opacity in `#ghost-layer`. Pivot diamonds in `#overlay-layer` during wheel-pick mode. Escape cancels ghost (context-aware). Arrow keys drive move/wheel. Enter commits.

**Rules implemented:** forward 1"/press, backward 0.5"/press (M/2 cap on total backward), wheel with M allowance tracking and pivot-fixed invariant, reform front-centre invariant, 1" rule check at commit time (ghost can phase through enemies during preview).

**Known RAW deviation:** `frontCorners()` uses model slot centres as pivot points. Arc distance underestimated by ~0.6" (one model radius) on the outer edge. Accepted simplification.

**Phase tracker:** [Movement] → [Magic] → [Shooting] → [Combat] → [End Turn]. Active phase highlighted in gold. End-phase-bar appears when all units have `phaseDone: true`.

---

## Current State (2026-06-28)

| Phase | Status |
|-------|--------|
| WHF-1: Board & Regiment Engine | Complete |
| WHF-2: Movement Phase | Complete |
| WHF-3: Charge | Not started — brief not written |
| WHF-4: Shooting | Not started |
| WHF-5: Combat (Close Combat + Rank Collapse) | Not started |

## Things The Next AI Should Know

- **`modelPosition()` is the load-bearing geometry function.** All movement, charge, and arc calculations derive from it. It is standalone at the top of `whf.js`. Do not embed it inside objects or render loops.
- **`reassignModels()` is NOT rank collapse.** It only fixes row/col slot indices after a `rankWidth` change. Dead models stay at their array index. Rank collapse (sliding alive models forward to fill gaps) is WHF-5.
- **`frontCorners()` is simplified.** Uses slot centres, not outer model edges. Arc distance is ~0.6" short on a 5-wide unit. Fix: add MODEL_R to radius in `wheelUnit()` if tighter fidelity is needed.
- **Shooting-after-reform restriction** is not enforced. Noted for WHF-4.
- **Character stats (General of the Empire, Empire Captain)** are from training knowledge, not verified against 8th.whfb.app. Unblocks at WHF-5 before character combat is implemented.
- **Firebase credentials** are in `firebase-config.js` (gitignored). Shape: same as `warhammer40k/firebase-config.js`.
