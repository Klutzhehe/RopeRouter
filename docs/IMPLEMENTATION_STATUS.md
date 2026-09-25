# Implementation status

## Whole-board sweep redesign — verification reviewed

The 24-net failure exposed a limitation of the previous six-route, mostly planar repair. A new speculative whole-board optimizer uses explicit vias at bends, lateral rope translations, and persistent conflict weights, then atomically commits only a fully validated board. Its resumable worker batches and complete pending-job snapshots are implemented. Generation now exposes 64, 100, and 200 components/nets in addition to the smaller counts.

The integrated run completed on September 24 at 18:45:57 Malaysia time and has now been reviewed: **86 unit tests, 5 browser workflows, the build, and all 9 scale scenarios passed**. Both 100-net and both 200-net cases stopped solved with zero live and saved violations. See `artifacts/solver-audit/sweep-verification/status.json`, `scale/status.json`, and the implementation plan for individual seeds, layers, ticks, via counts, and limitations. Earlier results below describe the previous solver version.

Responsiveness is still incomplete: ordinary search-batch p95 is 1–10 ms, but a preparation batch reached 14.4 seconds and another batch reached 7.7 seconds. The scale suite took 55.25 minutes overall. These results establish completion for the published cases, not guaranteed convergence or production routing quality. Further work must split the remaining synchronous preparation/validation stages and reduce total computation and via counts.

## Larger component counts and faster repairs — 2026-09-24

Added 20, 24, 32, and 40 components. The board grows vertically to provide real placement capacity; counts are no longer silently capped at 16. Existing smaller seeded boards are preserved.

Static segment-clearance caching, equivalent-layer geometry reuse, and cached candidate lengths reduce measured dense-board solve time by approximately 36–38%. The 16/2 case dropped from 21.83 s to 14.01 s, with its worst tick falling from 3.83 s to 2.10 s. All four published cases produced identical complete snapshots before and after optimization. Larger counts are supported for generation and simulation, not guaranteed convergence. Worker commands still wait for a synchronous tick; the implementation plan now details resumable batching and snapshot requirements to address that remaining latency.

## Dense-board completion — 2026-09-24

Terminal-aware geometric templates, atomic groups of up to six routes, and clearance-aware octilinear conversion now complete the previously stalled seed 42017 boards. The 12-component / 4-layer case becomes clear at tick 15 and stops solved at tick 44; the 16-component / 2-layer case becomes clear at tick 45 and stops solved at tick 74. Both finish with zero live violations, zero saved violations, and zero crossings, and remain clear during 30 further regression-test steps. Seeds 1 and 99 at 8 components / 2 layers also pass the published lifecycle sweep.

Verification: **74 unit tests across 11 files**, **3 browser workflows**, and **TypeScript/production build** pass. The browser verifies actual automatic completion and validates the saved project. Snapshot replay also covers warmed repair caches. Use `npm run test:lifecycle` for the assertion-bearing sweep and file logs; see `artifacts/solver-audit/lifecycle/summary.json` and the detailed [implementation plan](IMPLEMENTATION_PLAN.md).

Solver snapshots now identify `pbd-transactional-2`; older solver-version snapshots are rejected, while ordinary project files remain compatible. Full running-state export remains available. Some repair ticks take several seconds, so pause/export commands can wait for the current tick. Batching and broader adversarial coverage remain planned; completion is established for the published cases, not guaranteed for arbitrary boards.

## Earlier simulation recovery — 2026-09-23

The current implementation is a PBD live simulation plus checked octilinear project checkpoints. The 2026-09-19 entry below is historical and does not describe the current worker, vias, or stopping policy. See section 0 of [the implementation plan](IMPLEMENTATION_PLAN.md) for the root-cause evidence, exact state contract, implemented corrections, and remaining milestones.

### Implemented in this pass

- Segment-to-segment contact projection, including crossings between particles.
- Validated topology proposals with full reconnection checks and recorded rejection reasons.
- End-of-tick rollback protecting previously clear live routes; geometry-preserving remeshing.
- Validated via bypass/collapse, fixed via particles, segment-layer initialization, and mandatory via preservation in quantization.
- Transactional final quantization; unresolved tick-limit stops retain live state.
- Shared `SimulationSession` lifecycle for worker and tests; stale-session rejection and worker-authoritative Save.
- Export simulation during a run, versioned particle-state import, deterministic solver continuation, and in-place settings changes.
- Headless diagnostics, optional complete per-tick NDJSON recording, and standalone replay snapshots.
- Regression tests covering persistent live crossings, reversed terminal order, replay, rejected operations, via structure, worker lifecycle, and actual browser export/import behavior.

### Verification and limits

The original 55 tests passed despite a reproduced live crossing returning at tick 4. Final verification passed 71 unit tests across 10 files, the TypeScript/production build, and all three browser workflows, including comparing a restored worker's next step with headless replay. The single-layer, two-layer, and reversed-terminal crossing fixtures cleared at tick 3 and stayed clear through tick 100.

The background verification finished on 2026-09-23 at 12:18:44 Malaysia time and its logs have been reviewed at the user's request. All six commands exited successfully: unit tests, build, browser tests, diagnostic sweep, full recording, and replay. See `artifacts/solver-audit/verification/status.json`, `run.log`, and individual logs. Recording captured ticks 0–5; the restored fixture remained clear over 10 further ticks. The dense-board sweep is a measurement, not a pass/fail routing guarantee: seed 42017 ended with 9 live violations / 2 crossings at 12 components / 4 layers and 12 live violations / 3 crossings at 16 components / 2 layers.

Dense generated boards still have unresolved routes. Conservative rollback protects legality but can stall; bounded single-route detour templates do not solve all interacting constraints. Final quantization can still be rejected. Full continuous swept-motion safety, indexed collision performance, coordinated conflict-group repair, and strict octilinear exploratory motion remain work. No convergence or production-PCB guarantee is made.

Interactive exports contain complete current solver state and all events, with the latest 200 mutation decisions; they do not contain every historical particle frame. Use `npm run diagnose -- 100 <output-directory> --full` to record every tick. Import restores paused state and continuation data. Save project exports stored geometry, which may still include unresolved drafts; it is not a substitute for Export simulation.

## First runnable prototype — 2026-09-19

Status: first vertical slice implemented; the full roadmap is not complete.

### Implemented

- React/TypeScript/Vite app with a dominant imperative Canvas viewport and collapsible inspector.
- Seeded component placement and two-terminal nets; 1–8 fixed working layers.
- Synthetic DIP/header/passive-shaped bodies with circular through-hole pads. All pads span every layer; no hidden SMD-to-inner-layer transitions are assumed.
- Integer micrometer geometry, octilinear algebraic connectors, finite-width trace clearance, circular foreign-pad checks, fixed rectangular wall checks, and rectangular board boundaries.
- Worker-run deterministic tightening, local subchain shortcuts, and explicit stochastic multi-bend snaps through walls/ropes. No pathfinding.
- Run/pause/step/reset, layer visibility, trace selection, pan/zoom, violation markers, trace-length metrics, and accepted-snap history.
- Fading violation bubbles on marker hover, trace selection, or inspector diagnostic click. Diagnostics identify objects, layer, and clearance; trace markers use actual intersection/closest-contact positions.
- Strict commit gate: every changed route must have zero violations against the full board. Snaps cannot merely reduce the conflict count. Unresolved initial routes are dashed; clear routes are solid.
- Versioned, size-bounded JSON save/load with schema and object-reference validation.
- Best valid geometry checkpoint restore when the solver has found one.
- Session IDs and worker termination prevent old project updates from replacing new state.

### Roadmap mapping

| Stage | State | Remaining work |
|---|---|---|
| 0 Foundation | Substantially implemented | Broader worker protocol/replay and checkpoint persistence |
| 1 Geometry | Partial | Polygon outlines/cutouts, noncircular pads, vias, spatial index, broader connectivity |
| 2 Generation | Partial | SMD footprints, configurable package rules, multi-pin nets, witness fixtures |
| 3 Tightening | Experimental subset | Coupled segment edits, repulsion, simultaneous proposals, broader swept-motion proof |
| 4 Snaps | Experimental subset | Coordinated mutations, richer subchain displacement, bounded conflict-free exploration |
| 5 Multilayer | Display/initial assignment only | Via insertion, layer transitions and reassignment |
| 6 Layer reduction | Not implemented | Evacuation transactions, rollback, quality limits |
| 7 Multi-pin nets | Not implemented | Branch/junction graph and operations |
| 8 KiCad | Not implemented | Parsing, supported geometry, round-trip/export checks |
| 9 LCSC | Not implemented | Acquisition, conversion, provenance, cache |
| 10 Evaluation/polish | Started | Seed sweeps, performance budgets, release compatibility matrix |

### Important limitations

Initial routes use one loose control point. Repair proposals now support multiple bends, local subchain shortcuts, and independent geometric corridor guesses around blocker extents. Pad escape guesses use eight directions. This bounded mutation space can still stall, particularly when several initial tangled routes block one another. Every committed replacement must be fully clear; a reduction from several overlaps to one overlap is rejected. A formerly clear route remains clear after every accepted operation.

Ordinary moves from a clear state use a conservative inflated-clearance envelope to avoid tunneling. Initially invalid routes stay explicitly unresolved until a complete clear replacement is found. Snaps bypass swept collision checks but their full resulting geometry, including pin reconnections and self-overlap, is evaluated. The validator supports affected-route checks and remains exhaustive pairwise geometry, not spatially indexed. Different-layer crossings are legal; there is no fabricated overpass on the same copper layer.

The UI's validity statement applies only to supported prototype geometry. There is no production PCB export. Saving unresolved JSON is allowed for debugging. Best checkpoints and event history are session-local; saved projects preserve current geometry, tick, random state, and settings, not the complete session history.

Through-hole pads provide access on all generated layers, but no standalone vias or layer changes are implemented. Reducing trace-layer occupancy remains the next major feature after expanding the mutation/validation model. The UI explicitly marks it upcoming.

Running automatically pauses at 3,000 total ticks. A stalled or still-invalid run is not proof that the board cannot be routed. Settings changes currently reinitialize the worker at the current geometry and pause it; full continuous configuration commands remain future work.

### Verification

- `npm test`: 24 passing tests. Includes actual crossing-marker position, same-layer wire-end detour, rejection of shorter overlapping snaps, rejection of partial wall repairs, irreducible barrier, and no conflicts introduced by accepted geometry changes, alongside the original geometry/generation/replay checks.
- `npm run build`: strict TypeScript check and Vite production build.
- `$env:PW_CHANNEL='chrome'; npm run test:ui`: passing visible Chrome workflow for step/run/pause/reset, layer visibility, generation, save/load, invalid project handling, diagnostic selection and bubble fade-out, and narrow layout; no browser page errors.
- Desktop and narrow screenshots inspected from `test-results/desktop.png` and `test-results/narrow.png` (generated artifacts, ignored by Git).
- Playwright-managed Chromium download timed out in this environment. Installed Chrome was used successfully instead.

### Next bounded milestone

Add coordinated subchain edits to resolve mutually blocking drafts without accepting residual overlaps. Then add explicit vias/layer reassignment before implementing the layer-evacuation transaction. Preserve the no-pathfinding rule.
