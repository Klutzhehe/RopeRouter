# Rope Router

A simulation-first experiment for stage three of a PCB routing pipeline. Routes begin as loose, octilinear ropes distributed across several discrete layers. They tighten, push, and snap through obstacles while the solver periodically attempts to use fewer layers.

## Project status

A runnable first prototype is implemented: seeded synthetic components and two-pin nets, a multilayer canvas, a worker-based tightening/snap experiment, geometric diagnostics, and JSON project save/load. See [implementation status](docs/IMPLEMENTATION_STATUS.md) for the exact supported subset. The solver remains experimental and has no guarantee of finding a route or the minimum layer count.

## Run locally

Requires Node.js 22.12+ (tested with 22.18.0).

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Use Run simulation, Step, and Reset; drag the canvas to pan, scroll to zoom, or select a net. The inspector can be collapsed. Save/Open work with the prototype's JSON project format, not KiCad files.

The Components selector supports 4–200 components. Larger counts extend the board with placement rows and columns. The published nine-case suite passes through 200 nets on two and four layers; this does not guarantee every generated board will route. Large boards can still take substantial time, and some preparation batches delay pause/export. See the implementation plan for measured results.

**Export simulation** captures the actual worker state while running or paused: particle coordinates, layers, vias, parameters, topology counters, events, recent mutation decisions, and validation reports. Open that file to resume deterministically from a paused copy. **Save project** saves the worker's stored project geometry; it does not capture the live particle simulation. Quantization is accepted only when the complete result validates.

```sh
npm test
npm run build
npx playwright install chromium
npm run test:ui
npm run test:lifecycle
npm run test:scale
npm run diagnose -- 100 artifacts/solver-audit/manual
```

For full per-tick particle recording, append `--full` to the diagnostic command. For replay, append `--input=C:/path/to/simulation.json`; worker exports, standalone snapshots, and diagnostic envelopes are supported. Diagnostics write summaries, per-tick violations, and final replay snapshots. They report unresolved boards explicitly.

Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-background.ps1` for sequential verification with output in `artifacts/solver-audit/verification/`. The detailed [recovery plan](docs/IMPLEMENTATION_PLAN.md) documents the reproduced crossing failure, corrections, solved dense-board cases, known limitations, and next acceptance gates. `test:lifecycle` writes diagnostics and snapshots and fails unless the published scenarios reach independently validated completion without regression.

Browser tests run visibly. To use installed Chrome instead of downloaded Chromium on PowerShell: `$env:PW_CHANNEL='chrome'; npm run test:ui`.

## Read in this order

For GPU experiments, use the [Colab notebook](colab/RouterV2_GPU.ipynb) and [CUDA setup guide](docs/COLAB_GPU.md). This implements batched CUDA collision checks with CPU validation, checkpoints, and an optional CPU speed comparison. Actual GPU correctness and speedup remain to be measured; the normal browser simulation continues using its CPU backend.

1. [Implementation plan](docs/IMPLEMENTATION_PLAN.md): product scope, architecture, development stages, and acceptance criteria.
2. [Solver specification](docs/SOLVER_SPEC.md): geometry, tightening, snaps, temporary violations, and layer reduction.
3. [Gemini handoff](docs/GEMINI_HANDOFF.md): execution instructions and stage completion requirements.

## Non-negotiable behavior

- No pathfinding: no A*, maze routing, Lee routing, Dijkstra routing, visibility-graph routing, or hidden conventional routing fallback.
- Ropes can snap through both other ropes and fixed walls during solving. Fixed walls never move.
- All planar route segments are horizontal, vertical, or 45-degree diagonals. Layers are discrete; transitions are explicit vias.
- Begin with slack and configurable extra working layers. Periodically attempt layer evacuation and reduction, with rollback when an attempt fails.
- Preserve pin anchors, net ownership, and protected routing from earlier pipeline stages.
- Temporary intersections are allowed in the exploratory state, visibly marked, and excluded from valid PCB export.
- The board viewport is the main interface. Controls remain compact and secondary.

## Pipeline context

1. Route high-speed signals, such as DDR, and identify their protected regions.
2. Generate power planes using the separate diffusion stage.
3. Route remaining nets with this application.
4. Refill/revalidate planes and validate the combined board. Report conflicts to earlier stages where necessary.

This project implements stage three and its input/output contracts, not the high-speed router or power-plane diffusion algorithm.
