# Rope Router — implementation plan

## Whole-board verification results — reviewed after completion

The background run completed on **2026-09-24 at 18:45:57 Malaysia time**. Its logs were reviewed following the user's completion message; no background polling was used. All four commands passed: **86 unit tests across 13 files**, the TypeScript/production build, **5 browser workflows**, and **all 9 integrated routing scenarios**. The complete run took about 57.5 minutes; the scale suite accounted for 55.25 minutes.

| Seed | Components / nets | Layers | Solved tick | Final vias | Live / saved violations |
|---|---|---|---|---|---|
| 42017 | 16 / 16 | 2 | 20 | 10 | 0 / 0 |
| 42017 | 24 / 24 | 2 | 469 | 57 | 0 / 0 |
| 1 | 24 / 24 | 2 | 53 | 45 | 0 / 0 |
| 99 | 40 / 40 | 2 | 179 | 98 | 0 / 0 |
| 42017 | 40 / 40 | 2 | 209 | 105 | 0 / 0 |
| 42017 | 100 / 100 | 2 | 539 | 352 | 0 / 0 |
| 1 | 100 / 100 | 4 | 542 | 169 | 0 / 0 |
| 42017 | 200 / 200 | 2 | 7894 | 709 | 0 / 0 |
| 99 | 200 / 200 | 4 | 2011 | 494 | 0 / 0 |

All cases stopped automatically with `solved`, preserved the requested component/net counts, and reported no clear-to-invalid regressions. The sweep commits only at completion, so the scale test's regression count does not establish prolonged post-completion relaxation safety. Separate smaller regression tests cover further stepping. Browser coverage includes pausing and exporting a pending sweep, importing it, and comparing the next batch with headless replay. The unit suite includes impossible-barrier rejection and through-via collision rejection.

Evidence: `artifacts/solver-audit/sweep-verification/status.json`, individual command logs, and `scale/status.json`. Per-case NDJSON diagnostics and resumable final snapshots are in the `scale/` directory. The PowerShell `NativeCommandError` text in the browser log wraps a nonfatal Node color-environment warning; the browser runner reports five passes and exit code zero.

**Routing correctness passes for this published matrix; interactive performance is not yet resolved.** Search-batch p95 values are 1–10 ms, but the largest preparation batch is 14,423 ms and the largest other batch is 7,666 ms. These tails can still delay pause/export despite ordinary batches being short. The next work should split static catalog preparation, conflict-set construction, and final validation/commit into measured resumable stages. Retain complete continuation state and the atomic acceptance boundary. Optimize total work separately from yielding: the two-layer 200-net case required 7,893 coordinated adjustments and 258,859 batches. Broadening the seed/obstacle corpus and reducing via counts remain necessary before claiming general routing capability or production quality.

## Whole-board coordination and hundreds-scale implementation

The larger-board failure invalidates any claim that the 16-net success establishes scalability. A captured 24-net / 2-layer run still had 18 live violations after 100 ticks, with several repair ticks taking more than 14 seconds. The local method could coordinate only six routes and generally selected one layer for a complete route. Its via fallback tested one middle span. That is a restricted geometry model, not a basis for claiming general routing capability.

### Implemented architectural change

`pbd/board-sweep.ts` introduces a speculative transaction over the whole board. It selects from independently checked geometric templates, adds explicit layer transitions at bends, and translates rope interiors sideways by clearance-derived pitches while reconnecting fixed anchors algebraically. Persistent pair conflicts accumulate weight so successive passes can rearrange neighboring routes instead of repeatedly accepting the same local minimum. This is geometric constraint optimization; it does not enumerate routing-grid paths or use a maze/visibility-graph router.

Tentative assignments are separate from accepted live copper. The solver installs all participants together only after strict full-board validation, project-schema validation, and the engine transaction gate agree. A missing template or exhausted proposal budget remains unresolved. The displayed board remains the accepted live geometry while the heading reports preparation and candidate-conflict progress; tentative zero-conflict counts are not a solved status.

The job prepares one net per worker batch and evaluates at most 24 alternatives per subsequent batch. It freezes the source geometry while the proposal is pending, caches its unchanged display report, and sends lightweight progress updates. Pause/export requests can run between batches. Preparation of one net is still synchronous and can take longer than a candidate-evaluation batch; this is not yet a hard response-time guarantee.

Snapshots now use solver identifier `pbd-transactional-3` and include the working proposal, adaptive alternatives, accumulated pair weights, random state, iteration, and the exact in-progress evaluation cursor/selection. Static catalogs are derived caches. Configuration changes and manual quantization discard pending proposals; pause/save preserve them. Old solver snapshots are rejected explicitly. Project coordinate bounds now support boards up to 1 m, with schema limits of 500 components and 1,000 two-pin nets; the generator exposes up to 200 components/nets and adds columns as well as rows for larger boards. A 32-point route may have up to 30 interior via transitions rather than an unrelated eight-via cap.

### Initial evidence and verification procedure

Standalone prototypes completed 24 and 40 nets on two layers with zero violations. A standalone 100-net / 2-layer run completed with zero violations and 265 vias after 1,770 adjustments, taking about 330 seconds including preparation. This is useful feasibility evidence, not a completed integrated-scale release test. Later adaptive/batched implementation changes still require the queued verification.

At the user's request, run verification to files without polling. `scripts/verify-sweep-background.ps1` runs unit tests, build, browser workflows, and `npm run test:scale` sequentially. Its `status.json` records running/passed/completed-with-failures/runner-error. The scale suite exercises the real `SimulationSession` at 16, 24, 40, 100, and 200 nets, including multiple seeds and 2-/4-layer configurations. Each result requires automatic solved status, zero live and saved violations, and no clear-to-invalid regressions. It records resumable pending/final snapshots, progress, per-batch timing, and explicit failure status. A completed command is not routing success unless its assertions pass.

Before claiming hundreds-scale support is verified: review every queued result; reproduce failures from saved pending jobs; verify mid-batch export/import equivalence and impossible-barrier rejection; check through-via clearances independently; inspect pause/export latency including preparation outliers. Broaden the seed/obstacle corpus before any general convergence claim. The solver must never label an unroutable or budget-exhausted board as solved.

## Larger boards and repair performance — 2026-09-24

The component selector now supports **4, 8, 12, 16, 20, 24, 32, and 40**. This stays within the existing 40-component project schema. The generator previously silently stopped at 16 placement cells; it now creates enough rows and returns exactly the requested component/net count. Width stays 120 mm; height grows by 17.5 mm for each additional row of four components, reaching 185 mm at 40. Existing boards at 16 components or fewer retain their seeded geometry. Unsupported counts fail explicitly. Larger-board tests cover deterministic generation, boundaries, component/wall separation, anchors, schema round-trips, and browser generation/stepping/save/load at 40; these checks do not claim arbitrary 40-net boards converge.

### Implemented performance changes

- Memoize static clearance for identical undirected candidate segments within a layer. Repeated terminal stubs and channel edges reuse exact results.
- Generate static candidate geometry once for layers with identical fixed-wall sets. Through-hole pads are common to all layers; different wall sets get separate generation. Dynamic inter-route clearance and the final full transaction gate still run on each actual layer.
- Calculate each candidate length once before sorting, preserving candidate order and solver choices.

Sequential before/after runs of the same lifecycle script produced the following timings on this machine. Times include solver ticks and frame validation, exclude file output, and are measurements rather than latency guarantees.

| Case | Total before → after | Slowest tick before → after | p95 tick before → after |
|---|---|---|---|
| 42017, 12 / 4 | 10.20 s → 6.36 s | 3.46 s → 2.27 s | 1.20 s → 0.33 s |
| 42017, 16 / 2 | 21.83 s → 14.01 s | 3.83 s → 2.10 s | 1.95 s → 1.21 s |
| 1, 8 / 2 | 8.23 s → 4.44 s | 1.43 s → 1.11 s | 1.22 s → 0.37 s |
| 99, 8 / 2 | 3.37 s → 1.22 s | 1.70 s → 0.40 s | 1.22 s → 0.28 s |

All four complete solver snapshots compare exactly equal before and after: particle state, decisions, events, stored geometry, and completion ticks are unchanged. Logs and checkpoints are under `artifacts/solver-audit/performance-before/` and `performance-after/`. These are derived-cache optimizations, so solver snapshot compatibility is unchanged.

### Next step for pause/export latency

Caching reduces computation but does not interrupt a synchronous tick. The next architectural change should make candidate generation and group enumeration resumable:

1. Hold an immutable board revision for a pending proposal batch. Process a deterministic number of candidates, then yield to the worker event loop; do not advance physics while that transaction is pending.
2. Serve pause, snapshot, and cancellation between batches. Exports must include the enumeration cursor, pending assignments, candidate budget, and board revision; do not serialize JavaScript generator objects or omit hidden continuation state.
3. Discard pending work on reset, import, board edits, or incompatible configuration changes. Validate the complete proposal against the authoritative board before committing.
4. Use the same batch API in worker and headless lifecycle tests. Compare uninterrupted and pause/export/import runs at every batch boundary. Measure p95/max pause and snapshot response time on 16-, 24-, and 40-component cases.
5. Profile again before adding per-layer spatial indexing, and compare every indexed narrow-phase result with the exhaustive validator. Neither batching nor indexing should relax the collision gate or change a failed solve into a success status.

## September 24 follow-through — dense boards now complete

This section supersedes the unresolved dense-board results in the September 23 audit below. The original evidence remains useful as a baseline.

### Additional root causes and implemented solution

1. **Wall detours omitted terminal access.** A route leaving a pin row sometimes needs an outward stub, a turn past the component's pad envelope, and then a wall bypass. The previous four box templates could not express that geometry. `pbd/repair.ts` now enumerates finite terminal escapes, component-side turns, axis/diagonal connectors, and wall-side channel templates on each permitted layer. Every proposal passes independent static clearance and self-intersection checks. Geometry is cached from fixed board data and terminals. No routing grid, visibility graph, or maze search is used.
2. **Single-route acceptance trapped mutually blocking routes.** Keeping clear routes safe is necessary, but freezing them in place can prevent a feasible repair. `PbdEngine.tryReplaceRoutes` validates a complete group against external copper and each other before installing any participant. Bounded combinations may displace up to six whole routes: at most 600 recursive assignments, 36 alternatives per assignment, and three alternatives per blocker/layer signature. Single-route repair runs every third tick; group repair runs every fifteenth tick. Selection is deterministic. A failed group changes no particles, layers, or vias. The successful 16/2 run required a five-route transaction.
3. **Clear continuous geometry failed final conversion.** Fixed-tolerance decimation ignored available clearance. `pbd/quantize.ts` now checks both fixed octilinear connectors when shortening existing subchains, against finite-width traces, pads, walls, boundaries, and through-vias on the correct segment layer. Mandatory via vertices split conversion. The complete converted route is checked again; final acceptance also enforces the saved-project schema. The old conversion remains a proposal fallback for unresolved drafts, never an unchecked commit.
4. **Cleared vias left stale metadata.** Live and quantization projections now explicitly copy an empty via list when the particle route has none.

The solver identifier is now `pbd-transactional-2`. Snapshot format version remains 1, but older solver identifiers are rejected explicitly because continuation behavior changed. Ordinary project files are unchanged. Deterministic replay applies within the same solver version, including restoration after candidate caches have warmed.

### Measured acceptance results

`scripts/verify-lifecycle.mjs` exercises the actual `SimulationSession` lifecycle. It exits unsuccessfully unless every published case stops as solved, independently validates its saved result, has no live violations, and never regresses after first becoming clear. It writes per-tick diagnostics, timings, final full solver checkpoints, and a summary to `artifacts/solver-audit/lifecycle/`.

| Seed | Components / layers | First fully clear tick | Automatic solved tick | Live / saved violations | Clear-to-invalid regressions |
|---|---|---|---|---|---|
| 42017 | 12 / 4 | 15 | 44 | 0 / 0 | 0 |
| 42017 | 16 / 2 | 45 | 74 | 0 / 0 | 0 |
| 1 | 8 / 2 | 30 | 59 | 0 / 0 | 0 |
| 99 | 8 / 2 | 6 | 35 | 0 / 0 | 0 |

All four ended with zero segment crossings. Dense regression tests additionally step 30 times after final quantization and require geometry to remain clear. They cover atomic group rejection/acceptance and replay after derived caches have warmed. The browser regression now waits for “Validated solution”, checks the exported worker snapshot, and independently validates the downloaded project. Elapsed time or screenshots alone no longer count as success.

Final verification: **74 unit tests in 11 files passed**, **3 browser workflows passed**, and **TypeScript plus the production build passed**. Logs: `artifacts/solver-audit/full-tests-v2-final.log`, `browser-v2-final.log`, and `build-v2.log`. The browser completed the 16/2 case at tick 74. The initial browser rerun exposed a stale expected status string in the test; the assertion now requires the actual validated-output wording as well as independent file validation.

Run `npm run test:lifecycle` to reproduce these cases, or pass an output directory after `--`. `scripts/verify-background.ps1` now includes this assertion-bearing check alongside the diagnostic sweep. A diagnostic command exiting successfully alone does not establish routing completion.

### Remaining implementation work, in priority order

- **R1 correctness boundary:** batch acceptance is implemented and tested. Consolidation of legacy public helper mutations, continuous swept-motion safety during relaxation, and the larger 500-tick geometry matrix remain. End-of-tick validity does not establish continuous swept-motion safety.
- **R2 conflict groups:** bounded coordinated repair and both requested dense cases are implemented. Expand the published seeds and witness-backed adversarial cases for barriers and mutually blocking routes. Bounded templates do not guarantee every feasible board can be solved. Preserve truthful budget-exhausted status.
- **R3 quantization:** clearance-aware subchain conversion completes the known dense cases. Add adversarial narrow-channel and mixed-layer via fixtures before changing route-format limits. Never truncate geometry to satisfy the existing 32-point format.
- **R4 responsiveness:** profile candidate generation and combinations first. Maximum ticks in this run were approximately 4.9 s (12/4) and 4.5 s (16/2); p95 was 1.5 s and 2.3 s. These measurements overlapped other verification work and are not isolated benchmarks. Worker commands wait for a synchronous tick to end. Split enumeration into deterministic resumable batches, include pending work in snapshots, and measure pause/export latency before claiming interactive latency guarantees. Add spatial indexing only with exhaustive-validator equivalence tests.
- **R5 product contract:** retain explicit free-angle live preview versus validated octilinear saved output. Resume layer evacuation and imports only after the broader correctness/performance gates below pass.

## 0. Earlier recovery plan and root-cause audit — 2026-09-23

This section supersedes older descriptions of the implemented solver below. The long-term product stages remain goals, not a statement that those stages have shipped. Finish simulation correctness and reproducibility before adding layer evacuation, new import formats, or more routing heuristics.

### What actually failed

The failure was not a missing repulsion constant. Several systems disagreed about the geometry being simulated and the rules for changing it.

| Root cause | Evidence in the original implementation | Consequence |
|---|---|---|
| Two different states were treated as the result | `Solver.project` stored accepted quantized replacements while the worker displayed `getLiveProject()` from PBD nodes. Most solver tests checked only `project`. | The stored project could report zero violations while the visible simulation still crossed itself or another net. |
| Collision sampling did not cover full segments | `projectInterTraceCollisions` projected nodes against foreign segments in both directions. An interior segment crossing can have all four endpoints outside clearance. | A crossing could survive without the correct physical contact response. |
| A successful snap was an unchecked mutation | The supervisor spliced waypoints directly, chose only one participant/orientation, clamped detours back inside the board, and emitted success without checking reconnections and the full route. Layer migration checked intersections, not all clearance rules. | “Untangled” events did not establish a valid route; a chosen corridor could still be blocked. |
| Later operations could undo a repair | Tension and remeshing had no live-state non-regression gate. Remeshing inserted wall detours and collapsed bends using incomplete obstacle checks. | A crossing resolved at tick 3 could return at tick 4. |
| Via topology was inconsistent | The via manager checked proposed via locations, but not the entire bypass; collapse was unconditional. Via coordinates were not mandatory fixed particles, and some collision paths used the base route layer. Quantization overwrote nearest decimated vertices to preserve vias. | Copper could be assigned to the wrong layer, vias could detach, and via removal could recreate crossings. |
| Finalization bypassed acceptance | Manual quantization and the worker's tick-limit path installed the quantized result unconditionally. | Stopping could destroy a valid live result or replace the actual unresolved state with a different invalid one. |
| Save was neither a worker checkpoint nor a full simulation export | React sent pause and immediately serialized its last frame. Particle coordinates, prior positions, topology counters, parameters, diagnostics, and full events were absent. | A downloaded file could lag the worker and could not reproduce continued simulation. Dense particle polylines could also exceed the project format's 32-point limit. |
| Tests did not establish the user-visible outcome | The original 55 unit tests passed. A browser test titled “solves and resolves nets” only ran the simulation and took screenshots. | Passing tests concealed live-state regressions. |

Reproduction: `tests/fixtures/crossing.ts` is a schema-valid board whose perpendicular crossing lies between sampled particles. The new live-state regression failed on the original implementation at tick 4. With reversed terminal order, the original 100-tick run ended with **one live crossing and zero stored-project violations**. The saved evidence is in `artifacts/solver-audit/baseline/`.

### Changes implemented in this recovery pass

1. **Make contact detection independent of particle placement.** Segment contact uses the actual finite segment intersection or closest endpoints/projections, then distributes correction using the two segment parameters and inverse masses. Centerline intersection, collinear contact, and finite-width clearance use the same segment geometry. Physical contact pressure alone cannot change crossing topology; the supervisor still performs explicit snaps.
2. **Treat topology edits as validated proposals.** `PbdEngine.tryReplaceRoute` checks the complete candidate against board boundaries, pads, walls, other traces, self-intersection, anchors, and vias before installing nodes. The supervisor considers both participants and both orientations of bounded box-detour templates, as well as legal whole-net layer migration. No routing-grid or graph search was added. Rejected proposals retain their reasons and leave route state unchanged.
3. **Preserve previously clear live routes.** Each physics tick records its starting particle state. After projection/remeshing, validation identifies violations involving previously clear routes and rolls back all involved route participants, repeating when restoring one participant exposes another dependency. This protects the displayed state, not just the stored checkpoint. It is a conservative acceptance boundary; it can stall and does not prove continuous swept-motion safety.
4. **Keep remeshing geometric.** Split existing segments; collapse only redundant collinear points; preserve actual bends and pinned via nodes. Remeshing no longer invents unvalidated wall detours. Subdivision is bounded, though broader resource and sampling policies still need performance work.
5. **Put via operations through the same gate.** Check the full bypass/collapse, pin via nodes, initialize node layers from explicit transitions, preserve mandatory vertices before decimation, validate transition continuity and interior via attachment, and include foreign through-vias in affected-route validation. Through-hole terminal access remains the only supported terminal technology.
6. **Make final quantization transactional.** Construct a candidate, validate its geometry and project-format limits, and install/synchronize it only on success. On failure, keep both stored and live state and return reasons. A tick budget now leaves the unresolved live geometry available. “Solved” requires successful full quantization and independent validation.
7. **Expose and replay actual worker state.** `simulation-state.ts` defines a separate versioned snapshot schema. `Solver.snapshot/restore` preserve particle coordinates, prior coordinates, masses, node layers, vias, pressure, solver parameters, RNG/tick, supervisor persistence, event history, recent decisions, original project, stored project, and best checkpoint. Worker exports include live/stored/quantized-candidate reports, crossings, lifecycle counters, and explicit history limits. Imports validate ownership, anchors, and node/via layer consistency. Import pauses by design while retaining completion counters.
8. **Share lifecycle behavior with tests.** `SimulationSession` is used by the worker and headless tests. Requests carry session and request IDs; obsolete-session requests are discarded. Snapshot requests observe a complete tick without pausing or resetting the run timer. Save requests serialize the worker's stored project after pausing. Runtime settings update in place instead of rebuilding particles from a rounded React frame; tightening strength now reaches the physics step.
9. **Remove the unreachable second stepping loop.** The legacy discrete fallback could never run because `pbdEngine` is always initialized. Its dead stepping/alternative-generation branch was removed. Public legacy commit helpers remain for compatibility tests; completing their consolidation under a single transaction API is part of the next milestone.

### State contract to maintain

| State | Meaning | Allowed consumers |
|---|---|---|
| PBD routes | Authoritative live particle state; may contain unresolved drafts and free-angle segments | Physics, topology proposals, live diagnostics, replay snapshots |
| Live project | Rounded projection of those particles for rendering and independent free-angle validation | Canvas and live status; **not** a resumable simulation format |
| Stored project | Integer octilinear accepted replacements plus any original unresolved drafts | Project Save, checkpoint comparisons; not evidence that the live board is clear |
| Quantization candidate | Proposed integer octilinear conversion of the live board | Validation only until accepted |
| Best valid project | Fully validated stored board, if one has been found | Explicit restore/export; never silently substituted for live simulation |
| Simulation snapshot | All state needed to continue the solver deterministically, plus optional worker lifecycle state | Export simulation, Open simulation, headless replay |

The UI must always show the report for the geometry it displays. Stored and live validity must not be substituted for one another. Unresolved project files remain legal debugging artifacts; they are not PCB exports.

### Evidence and verification status

The original baseline passed 55 unit tests but failed the new persistent live-crossing regression. The completed verification run passed **71 unit tests across 10 files**, the TypeScript/production build, and **all 3 browser workflows**, including export while running and exact equality of the next worker step against headless replay after import. Single-layer, two-layer, and reversed-terminal fixtures cleared by tick 3 and remained clear through tick 100, with zero clear-to-invalid regressions.

The final logged dense runs for seed 42017 reduced live violations from 37 to 9 with 12 components / 4 layers, and from 47 to 12 with 16 components / 2 layers after 100 ticks. They retained respectively **2 and 3 actual crossings**, and stored-project violation counts were 19 and 27. These are **unresolved results**, not successful routing. The headless runs took 10.604 and 10.392 seconds respectively (roughly 106 and 104 ms per tick on average, including diagnostic work). Do not infer 32 ms tick throughput from the worker's scheduling delay or treat these averages as latency percentiles.

The complete verification logs have now been reviewed at the user's request. The background run completed on **2026-09-23 at 12:18:44 Malaysia time (04:18:44 UTC)** with all six commands exiting successfully. `scripts/verify-background.ps1` ran unit tests, build, browser tests, a five-scenario 100-tick diagnostic sweep, full particle-history capture, and snapshot replay. Results are in `artifacts/solver-audit/verification/`; `status.json` records `passed`. Full recording covered ticks 0–5 of the single-layer fixture; replay continued that snapshot for 10 further ticks and remained clear. Diagnostic command success means the measurement completed, not that dense routing solved. The browser log's PowerShell `NativeCommandError` wrapper is for a non-fatal Node color-environment warning; the actual browser runner reports 3 passed and exit code 0.

The 300-tick correctness sweep has an explicit 60-second timeout because it now includes additional full-geometry checks. This is not a performance acceptance criterion. Performance must be evaluated from measured tick distributions and snapshot costs in the milestones below.

### How to reproduce and inspect a failure

```powershell
# Current-state export: use Export simulation while running or paused.
# Open the exported file to restore particles; imports start paused.

# Five fixed scenarios, summary + per-tick diagnostics + final resumable snapshots:
npm run diagnose -- 100 artifacts/solver-audit/manual

# Capture every tick's complete solver state as NDJSON:
npm run diagnose -- 100 artifacts/solver-audit/full --full

# Continue a worker export, standalone snapshot, or diagnostic envelope:
npm run diagnose -- 50 artifacts/solver-audit/replay --input=C:/path/to/simulation.json

# Run verification with file logs (the provided runner is also usable directly):
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-background.ps1
```

Every scenario records initial/final live violations, stored violations, actual crossings, first-clear tick, transitions from clear back to invalid, node counts, length, and elapsed time. `--full` streams complete states to disk; it does not retain all particle frames in memory. Interactive exports include all events but only the latest 200 mutation decisions and the current particle frame; those limits are explicit in the export. Continuous historical frames cannot be reconstructed from an arbitrary earlier run unless it was recorded or replayed from its initial state with the same solver version.

### Next implementation milestones, in dependency order

#### R1 — Complete the correctness boundary

**Scope:** consolidate remaining public discrete commit helpers with the live transaction interface; add a single batch-replacement operation for geometry/layer/via changes. Preserve route IDs, anchors, fixed geometry, RNG, pressure, and caches on rejection. Validate the full combined result, not routes in isolation.

**Remaining technical work:** distinguish endpoint validity from swept-motion validity. The current physics rollback checks end-of-tick geometry; it cannot prove that an ordinary move did not tunnel through an obstacle and end clear. Add conservative swept envelopes or continuous collision tests for ordinary relaxation. Explicit snaps may cross obstacles in transit but must still land clear. Establish a single segment-layer representation shared by physics, quantization, rendering, and validation; audit quantizer scoring on mixed-layer routes.

**Acceptance:** every accepted live transaction preserves all formerly clear routes; thin-wall and thin-trace swept-motion fixtures reject tunneling; coordinated transaction rejection restores all state exactly; remeshing preserves path geometry and every via; one-, two-, and three-route crossing fixtures remain clear for at least 500 subsequent ticks, including pause/resume and quantize/resume. Include diagonal crossings, collinear overlaps, endpoint reversal, unequal widths, arbitrary node spacing, board-edge detours, and blocked alternate layers.

#### R2 — Repair conflict groups instead of only isolated routes

**Problem:** a route with several blockers may have no fully clear single-route candidate while a small coordinated movement of neighboring nets is feasible. The current whole-blocker bounding-box templates are a limited mutation family. Increasing pressure, waiting longer, or reporting a temporary count reduction does not solve this.

**Implementation:** derive a graph of current constraint conflicts (not a routing-space graph); choose small bounded connected groups in deterministic order. Produce coordinated segment slides, endpoint detours, subchain replacements, and legal layer changes for those groups from the same immutable starting state. Score full candidate groups by validity, then length/layers/vias. Use the R1 batch gate. Keep a candidate budget, rejection categories, cooldown, and exact rollback. Expand the mutation family only when captured failures demonstrate a missing degree of freedom. No A*, visibility graph, maze routing, or hidden pathfinding fallback.

**Acceptance:** witness-backed cases with 3–6 mutually blocking routes resolve with zero violations in both the displayed result and final quantized result. The witness proves feasibility but is never supplied to the solver. A board-spanning barrier remains unresolved. Failed candidates cannot damage previously clear unrelated routes. Compare solved fraction and per-rule violations on a fixed published seed set, including seed 42017 at 12/4 and 16/2; do not change fixtures or budgets to hide failures.

#### R3 — Quantization that preserves a clear solution

**Problem:** decimation and local dogleg selection can turn a clear continuous rope into an invalid octilinear candidate. A constant clearance buffer is not a mathematical guarantee. The current gate safely rejects that candidate, but rejection is not a conversion algorithm.

**Implementation:** partition at anchors, vias, and required topology features; bound decimation error relative to actual available clearance; evaluate complete fixed octilinear reconnection templates on the correct segment layers. Retain mandatory points even when collinear. When conversion fails, expose the precise segment/rule and return that constraint to the next continuous or discrete proposal rather than overwriting live geometry. Decide explicitly whether to retain the 32-point saved-route limit or version the project format; never truncate geometry to fit it.

**Acceptance:** clear witness routes in narrow corridors and around pads quantize without losing anchors, vias, or clearances; failed conversions preserve complete pre-conversion state; live→quantize→resume→export→import never resurrects a crossing; success status always agrees with strict independent validation and the serialized project schema.

#### R4 — Bounded computation and complete investigation tooling

**Implementation:** profile validation, collision projection, proposal generation, quantization, snapshot serialization, and worker transfers separately. Introduce per-layer segment/via spatial indexing with exact narrow-phase checks; test index invalidation against the exhaustive validator. Bound node growth, proposals per tick, history retention, and wall-clock work per batch. Track maximum/p50/p95 tick duration and pause/snapshot latency. Cache unchanged rejection context with explicit invalidation when blockers change. Add an optional recording control that streams full frames and decisions to an artifact, rather than sending a huge snapshot every render frame.

**Acceptance:** published before/after timings on the same hardware, input, tick budget, and solver version; indexed and exhaustive validation agree on randomized fixtures; repeated snapshot requests cannot starve simulation; cancellation runs between bounded batches; paused exports round-trip exactly; malformed/oversized/unsupported snapshots fail with clear errors. Keep historical snapshots versioned and define migrations or reject incompatible solver versions.

#### R5 — Reconcile product documentation and release claims

The original specification requires octilinear exploratory motion, while the current implementation uses a free-angle PBD preview with checked octilinear checkpoints. Make that discrepancy explicit until a decision is implemented: either constrain actual motion to octilinear degrees of freedom or retain a clearly separate continuous preview and validated output contract. Do not silently describe free-angle PBD as strict octilinear simulation. Only after R1–R4 pass should the older stages for layer evacuation, multi-terminal nets, KiCad, and LCSC resume.

**Release gate:** final log review, all correctness/browser tests passing, published seed sweep including failures, documented supported geometry, no false “solved” status, reproducible failing-run exports, and no pathfinding introduced.

## 1. Intended outcome

Build a professional desktop-style simulation application in which PCB nets behave like tightening ropes. Start with loose routes spread across a configurable set of working layers. Allow routes to push and snap through other routes and fixed obstacles as exploratory operations. Periodically consolidate the routing onto fewer layers.

The user explicitly rejects pathfinding. Do not substitute a conventional autorouter behind the animation. The visible movement must derive from the actual relaxation and mutation solver described in [SOLVER_SPEC.md](SOLVER_SPEC.md).

Success means a useful experimental environment with reproducible scenarios, measurable solver behavior, correct geometry validation, and honest unresolved results. Production routing quality is a later conclusion to establish through evidence.

## 2. Scope and product rules

### Required capabilities

- Random synthetic components and non-overlapping placement on a board.
- Seeded random two-pin and multi-pin nets assigned to available component pads.
- Import KiCad footprints, footprint libraries, and supported KiCad boards.
- Resolve LCSC component identifiers to available footprint assets, with preview and caching.
- Discrete multilayer simulation with horizontal, vertical, and 45-degree segments.
- Loose initialization, tightening, pushing, wall/rope snapping, via mutations, and layer reduction.
- Fixed copper and protected regions from high-speed routing; power-plane geometry from stage two.
- Run, pause, step, reset, replay, parameter editing, save/load, and diagnostics.
- Independent validation and export of supported, validated routes.

### Initial exclusions

- Circuit synthesis or electrical correctness inference from random nets.
- DDR tuning, impedance analysis, electromagnetic simulation, and power-plane diffusion.
- General component placement optimization; components remain fixed during routing.
- Arbitrary-angle traces, curved tracks, blind/buried vias, and unrestricted KiCad round-trip fidelity in the first release.
- Claims of optimality or guaranteed routing completion.

### Layer semantics

Use two explicit modes:

1. **Sandbox:** the user defines an experimental layer pool, including extra layers. The solver reduces the layers used by its routes. A future manufacturable stackup must be selected and revalidated separately.
2. **Imported board:** the physical stack is fixed. Extra working layers must come from permitted existing copper layers. Reduction means fewer layers used by stage-three routing; it does not delete physical layers or move earlier-stage copper.

Show separate counts for physical copper layers, allowed routing layers, and layers currently occupied by stage-three routes. Also distinguish planar trace occupancy from via barrel occupancy. A through via still traverses the physical stack even when intermediate layers contain no stage-three traces.

The layer target is a requested optimization goal, not a promise. Protected copper, planes, pad access, and via constraints can impose a higher practical minimum.

## 3. Proposed architecture

Use TypeScript throughout the first prototype: a React application shell, an imperative Canvas/WebGL board renderer, and a dedicated Web Worker for the deterministic solver. A Vite-based development setup is a reasonable starting choice; resolve current compatible package versions at implementation time and commit the lockfile. Do not use React component updates to animate individual rope vertices.

Package as a desktop application only after the simulator is useful. Keep filesystem/network integrations behind interfaces so a later desktop wrapper does not require rewriting the solver. A local import service may be used for LCSC acquisition where browser access is unsupported; never embed service secrets in the client.

Suggested modules:

| Module | Responsibility |
|---|---|
| `model` | Board, pads, nets, layers, rules, fixed geometry, project schema |
| `geometry` | Octilinear edits, segment/polygon distances, robust intersections, via geometry |
| `solver` | Initialization, relaxation, collision pressure, snaps, acceptance, checkpoints |
| `layers` | Layer eligibility, explicit transitions, evacuation transactions |
| `validation` | Independent geometry and connectivity checks, export eligibility |
| `generation` | Seeded components, placements, nets, and benchmark fixtures |
| `adapters` | KiCad, LCSC, previous-stage input, project serialization |
| `rendering` | Board rendering, hit testing, overlays, camera, layer views |
| `ui` | Commands, inspector, import preview, settings, progress and errors |
| `benchmarks` | Headless batch runs, seed sweeps, metrics, regression reports |

The solver must run without the UI. Use versioned worker messages: initialize, run, pause, step, apply configuration, checkpoint, restore, and dispose. Return versioned snapshots/events; discard stale updates after reset or project replacement. Poll cancellation between bounded batches so pause is responsive.

## 4. Data and integration contracts

Use stable IDs and an explicit schema version. Store physical coordinates in integer board units, such as nanometers, within a checked safe numeric range. Solver proposals may use floating-point values but must be quantized and reconstructed before evaluation. Never rely on display rounding as geometry validation.

Core entities:

- Board: outline, holes, layer stack, units, source metadata, rules.
- Layer: ID, physical order, type, routability, and protected status.
- Component: footprint reference, position, rotation, side, placement boundary.
- Pad: component ID, logical pin number, shape, copper layers, drill, net ID.
- Net: terminals, width/clearance class, priority, allowed layers, fixed attachments.
- Rope network: anchor nodes, movable bend/junction nodes, edges, explicit vias.
- Fixed copper/region: owner net if applicable, shape, affected layers, immutable flag.
- Project: seed, generator configuration, solver configuration, checkpoints, import diagnostics.

Multiple physical pads can share a logical pin or net. Do not assume pin numbers are unique geometry IDs. Net connection to a pad requires actual supported copper contact on a permitted pad layer; proximity to its center is insufficient.

Earlier-stage input must include immutable copper, net IDs, layer IDs, board outline, keepouts, protected corridor polygons, and actual plane fill geometry. Zone outlines alone do not establish conductive filled regions. Same-net copper is not automatically an obstacle; foreign-net copper is.

Export stage-three traces/vias with net ownership, a validation report, and provenance. Preserve original imported board data outside the supported edit subset. Unsupported safety-critical geometry must block routing/export in the affected project rather than disappear silently.

## 5. Application layout

Target a viewport occupying approximately 80% of a typical desktop window. Use a restrained neutral palette, clear typography, small consistent controls, and intentional net/layer colors. Avoid dashboard cards around the canvas.

- Top toolbar: project name, Generate, Import, Run/Pause, Step, Reset, Save.
- Compact layer rail: active layer, visibility, occupied/available state, lock indicators.
- Collapsible right inspector: selection details or grouped simulation settings.
- Bottom status strip: connected terminals/nets, violations, trace layers used, vias, iteration, current operation.
- Optional bottom drawer: event history, validation findings, benchmark results.

Top-down view is primary. Add an optional exploded-layer view after multilayer correctness. Inactive layers are dimmed; selected routes remain legible. Use color plus line style/icons for fixed geometry, speculative routes, invalid intersections, and accepted routes. Avoid flashing effects.

Primary settings: initial layers, target layers, tightening strength, snap aggressiveness, and layer-reduction aggressiveness. Put numerical tolerances, acceptance temperatures, and mutation budgets in Advanced.

Selecting a violation should focus its location and explain the objects/rule involved. A layer reduction should visibly progress through attempting, settling, accepted, or rolled back. Show best valid results separately from the current exploratory configuration.

## 6. Implementation stages

Implement sequentially. Each stage must include a runnable demonstration, meaningful automated checks, known limitations, and updated handoff notes. Do not advance by replacing missing behavior with decorative animation.

### Stage 0 — project foundation and contracts

Deliver the application shell, worker protocol, shared model, seeded PRNG, versioned project format, and headless test runner. Add a small sample project, not randomly changing demo data.

Acceptance: project save/load preserves geometry and configuration; identical seed and operation sequence reproduce the same state on the supported runtime. Worker reset cancels old work. UI remains usable while the worker runs.

### Stage 1 — geometry and validation

Implement supported pad shapes (circle, axis-aligned/rotated rectangle, oval, rounded rectangle), swept-width trace segments, outline containment, holes, clearance, and full-span through vias. Add a per-layer spatial index for candidate collision pairs, followed by exact narrow-phase checks. Treat component bodies/courtyards as placement constraints unless an explicit copper keepout exists.

Implement independent net connectivity and octilinear checks. Diagonal distance and acute-corner cases must use full trace geometry, not bounding-box overlap alone.

Acceptance: fixtures cover diagonal near misses, exact clearance boundaries, board cutouts, rotated pads, via collisions on intermediate layers, same-net contacts, foreign-net shorts, and disconnected terminals. No solver work is considered valid without this validator.

### Stage 2 — generators and loose initialization

Generate synthetic resistor/capacitor-like two-pad parts, headers, and multi-pad IC-like packages. Expose count, package mix, pitch, spacing, rotation, board size, and seed. Bound placement attempts and return a useful partial-placement report when density is excessive.

Generate nets with fanout and length-distribution controls. Assign each pad to at most one net; support intentional unconnected pads and multi-terminal nets. Include both unconstrained stress cases and fixtures with a stored valid witness routing. Discard the witness before solver initialization; retain it only to establish feasibility for evaluation.

Create slack octilinear ropes with reproducible detours and distribute planar runs across allowed layers. Build real terminal access transitions; never silently relocate an SMD pin to an internal layer. Initial overlaps are permitted and visibly marked.

Acceptance: no overlapping component placement under supported placement rules; reproducible generation; fixed anchors; requested layers respected; slack is measurable as excess route length; initial constraint violations are reported honestly.

### Stage 3 — single-layer relaxation

Implement route shortening, redundant-segment removal, bounded segment sliding, clearance repulsion, and damping. Begin with two-pin nets but preserve the graph-based data model. Run simultaneous proposals from a snapshot and resolve conflicts in deterministic seeded order.

Acceptance: open-space ropes become shorter; ordinary tightening does not tunnel through walls; frozen obstacles remain unchanged; segment directions stay legal; invalid initial states are distinguishable from valid states. Pause and step operate on actual solver iterations.

### Stage 4 — snaps through ropes and walls

Add pressure-driven and exploratory connected-subchain mutations, normal displacement past obstacles, bounded whole-network mutations, and rollback. Drafts may remain unresolved, but accepted replacements must be fully clear; partial-conflict reduction is not an accepted snap. Record affected objects and acceptance reasons. Validate reconnection segments as well as the moved section.

Acceptance: a wrong-side-of-wall fixture demonstrates a topology-changing snap; a competing-rope fixture demonstrates mutual rearrangement; a truly blocked fixture remains unresolved rather than producing a false valid result. The solver contains no routing graph search or pathfinding fallback.

### Stage 5 — multilayer routing

Add discrete layer reassignment, explicit terminal access, via insertion/removal/relocation, and per-net layer restrictions. Start with through vias; unsupported via technologies remain unavailable. Vias retain their real occupied span.

Acceptance: an appropriate two-layer crossing fixture can resolve; a forbidden layer remains unused; a via that intersects protected copper on an intermediate layer is rejected; a layer mutation cannot break an anchor connection.

### Stage 6 — adaptive layer reduction

Implement the evacuation transaction in the solver specification. Add target count, stability window, evacuation budget, quality limits, failed-attempt cooldown, and progress indicators. Allow coordinated movement of existing ropes on surviving layers.

Acceptance: a known reducible scenario uses fewer planar routing layers while retaining validity; an overconstrained scenario rolls back exactly; earlier-stage geometry stays identical; lowering the target never silently removes required pad/via access. Repeated failed attempts do not oscillate endlessly.

### Stage 7 — multi-pin nets and junctions

Add branching networks, junction relocation, geometric branch splitting/merging, and local attachment mutations. A simple deterministic or seeded initial star/tree is allowed; it is connectivity bookkeeping, not obstacle-aware pathfinding. Keep disconnected states explicitly unresolved.

Acceptance: all terminals of each solved net are connected; branch mutations preserve net ownership; same-net overlap cannot conceal a foreign-net short; multi-pin networks participate in snapping and layer evacuation.

### Stage 8 — KiCad and previous-stage integration

Implement `.kicad_mod`, `.pretty` library browsing, and a declared subset/version range of `.kicad_pcb`. Use a real s-expression parser. Preserve unknown source fields for round-trip where possible, while rejecting unsupported geometry needed for correctness. Handle transformations, bottom-side placement, pad numbering, holes, layer mapping, net IDs, and fixed tracks/vias.

Import stage-one protected geometry and stage-two filled planes. Export into a copy of the original board; never overwrite the source by default. Reopen supported exports in KiCad and run available board validation. Record the supported KiCad version and any project-level rule limitations.

Acceptance: representative fixtures preserve pad locations and layers; protected geometry is unchanged; exported traces keep correct net IDs; supported valid output passes the relevant KiCad checks. An unsupported custom pad or rule receives an explicit diagnostic, not a misleading success.

### Stage 9 — LCSC footprint acquisition

Define a provider interface: resolve part, list available CAD assets, fetch, convert if supported, validate, cache. At implementation time verify the actual supported LCSC/EasyEDA acquisition workflow and applicable access conditions. Do not invent a stable public API or promise all parts have footprints.

Accept a part identifier/product URL or user-supplied CAD file. Preview footprint geometry, pad numbers, source, and units before placement. Persist source IDs, asset hashes, conversion version, and retrieval metadata. Support offline cached assets, absent footprints, network failures, and unsupported conversions. Importing a footprint does not create an electrical netlist.

Acceptance: test provider behavior with local fixtures; verify at least one real supported acquisition end to end; missing assets produce a recoverable result; converted geometry matches its reference dimensions and pad numbering.

### Stage 10 — performance, evaluation, and release polish

Add reproducible headless seed sweeps, event replay, responsive inspector layout, keyboard commands, and optional exploded-layer visualization. Measure worker throughput, snapshot cost, frame responsiveness, and memory on documented hardware. Set performance budgets from measured results rather than guessed promises.

Benchmark tightening only, tightening plus snaps, and tightening plus snaps plus layer reduction. Do not add a pathfinding baseline implementation. Report solved fraction, violations, layers, vias, length, runtime, and rollback rate across all seeds, including failures.

Acceptance: a release includes fixture results, supported import/export matrix, known failure cases, reproducible configuration, and no claim of minimal layers. Final output clearly distinguishes validated, unresolved, and target-not-reached states.

## 7. Integration and testing strategy

Use small exact geometry fixtures, invariant/property tests for mutations, deterministic replay tests, and a few end-to-end UI workflows. Revalidate accepted checkpoints independently of the solver's incremental collision cache. Test failed transactions by comparing full restored state, including RNG and cache invalidation behavior.

Essential fixtures: empty board, single wall, wrong-side detour, narrow channel, competing nets, crossing requiring a layer, immovable full barrier, dense pad escape, through-via intermediate-layer collision, three-plus-terminal net, reducible stack, irreducible target, foreign power plane, same-net plane contact, and imported rotated/bottom-side footprints.

Keep a record of seed, configuration, solver version, budgets, hardware, final validity, and target attainment for every benchmark. A time limit is an unresolved result, not evidence that a board is impossible.

## 8. Reference specifications

### CUDA/Colab work added September 24, 2026

The proposed acceleration targets route-pair evaluation in the whole-board sweep. It does not change the finite candidate search, clearance rules, layer budget, RNG choices, or final commit gate. See [the setup and evidence guide](COLAB_GPU.md).

Implemented:

- An asynchronous conflict oracle batches candidate-versus-working-board checks, while TypeScript applies weights and chooses candidates in the original order. CPU/browser execution remains available unchanged.
- A persistent local CuPy process caches route geometry and runs a float64 CUDA kernel for same-layer finite-width segment checks and through-via checks. Ambiguous clearance-boundary answers use the authoritative CPU predicate.
- Accelerated sessions retain the original full-board CPU commit validator. Accelerator output is shape/range checked, and no CUDA failure silently becomes a CPU benchmark.
- A Colab notebook clones a chosen GitHub revision, installs CUDA-matched dependencies and a pinned Node runtime, verifies collision parity, runs reproducible cases, optionally compares CPU timing/state hashes, and exports evidence. Drive checkpoint mirroring and snapshot resume support interrupted sessions.

Validation completed: four new accelerator integration tests and production build pass; notebook schema and Python syntax validate. Real CUDA validation is still pending because the initial local dependency download timed out. A file-logging Windows verification script retries installation, checks 36,300 collision pairs, and compares the complete CPU/GPU result on a 16-net fixture. It does not poll progress.

Remaining acceptance gates, in order:

1. Pass actual CUDA collision parity and exact final-state comparison on the small fixture. Diagnose numerical, transport, or scheduling differences before larger runs.
2. In Colab, compare CPU and CUDA on the same revision, seed, component count, layer budget, and hardware session. Record end-to-end time, preparation/search time, maximum batch duration, GPU kernel/bridge time, fallback count, hardware, and validity. Preserve failure artifacts.
3. Repeat the published 100/200-net cases and additional seeds. Require zero live/saved violations and matching CPU results; do not treat faster but unresolved boards as a success.
4. Retain CUDA as opt-in unless measured large-board end-to-end performance improves. If bridge transfers or double-precision throughput dominate, measure persistent device buffers and larger independent geometry batches before changing numerical precision.
5. Independently subdivide candidate preparation and long bookkeeping batches. Those CPU phases still determine pause/export latency and are not solved by this CUDA kernel. Preserve resumable cursors and deterministic replay when splitting them.

No GPU performance or universal routability claim is made before these gates pass.

These sources describe file formats and acquisition context, not an endorsement or proof of this solver:

- [KiCad s-expression and common geometry format](https://dev-docs.kicad.org/en/file-formats/sexpr-intro/index.html)
- [KiCad board file format](https://dev-docs.kicad.org/en/file-formats/sexpr-pcb/)
- [LCSC CAD workflow overview](https://www.lcsc.com/blog/smarter-pcb-design-easyeda/)

Consult the relevant official documentation for selected versions during implementation, particularly imports, rules, and external asset access.
