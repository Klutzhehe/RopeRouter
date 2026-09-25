# Rope solver specification

> Implementation note, 2026-09-23: the current code uses a free-angle PBD live preview with independently checked octilinear checkpoints. That is a deviation from the strict octilinear exploratory-motion design below, not a claim that this specification is fully implemented. The recovery work adds live-state acceptance checks, validated topology changes, safe finalization, and complete replay snapshots. End-of-tick validity does not yet establish swept-motion safety. See section 0 of [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the evidence and remaining reconciliation work.

## User revision: strict collision-free commits

The latest user instruction supersedes the earlier exploratory acceptance rules below: an accepted snap or tightening move must leave the complete changed route free of overlaps and clearance violations. It may pass through a wire/wall as a discontinuous operation, but must land on a legal detour with valid pin reconnections. Initial/imported tangled geometry is an explicitly unresolved draft, never an accepted route. Show the reason with diagnostic bubbles. Do not accept partial overlap reduction as completion, or introduce pathfinding to resolve it. The historical annealing/worse-state proposals below are not authorized to commit overlapping copper.

## 1. Design boundary

This is a stochastic geometric optimizer, not a pathfinding router. It uses local relaxation, geometric mutations, and layer evacuation. It must not enumerate routing-grid paths, expand a routing frontier, trace maze distances, or call a conventional autorouter as a fallback.

Spatial indices for collisions, graph traversal for electrical connectivity, and a seeded initial net tree are permitted: these do not search board space for routes. The restriction also applies to obstacle-aware reconnection disguised as a helper.

The algorithm is an experimental proposal. Mutation choices, weights, and budgets must be measured and tuned. No convergence, routability, or layer-optimality guarantee is assumed.

## 2. Route representation

Represent a net as a connected geometric graph:

- Anchor: fixed terminal/contact position with permitted copper access layers.
- Bend: movable point on one discrete layer.
- Junction: movable point joining branches of the same net.
- Planar edge: copper segment with width, layer, and net ID.
- Via: explicit copper transition with diameter, drill, and physical layer span.

Every planar edge satisfies `dx == 0`, `dy == 0`, or `abs(dx) == abs(dy)` after quantization. Remove zero-length edges and merge redundant collinear edges when this preserves connectivity and attachments.

Do not move arbitrary independent particles and round the resulting angles. Use segment slides, coupled bend moves, and small fixed reconnection templates that preserve octilinear geometry. For two points, a diagonal-plus-axis connector (in either order) is a permitted algebraic template. It is not guaranteed to avoid obstacles; intersections become measured violations. If a template cannot preserve structural invariants, reject that proposal.

Finite trace width and clearance participate in every collision test. Collision pressure should act on closest segment/shape features, not only vertices. Board holes and concave outlines require proper containment checks.

## 3. State categories and invariants

Maintain:

1. **Exploratory state:** current working geometry, possibly with temporary overlaps.
2. **Best valid checkpoint:** best independently validated state seen so far, or absent if none exists.
3. **Operation checkpoint:** complete state before a speculative transaction, such as evacuation.

Structural invariants are never relaxed:

- Stable pin anchors, net ownership, fixed geometry, and physical layer stack.
- Legal segment angles, finite coordinates, bounded geometry complexity.
- Explicit layer transitions and permitted via technology.
- Allowed layers and pad access constraints.
- Connected rope topology for a represented net; never silently drop a branch or terminal.

Temporary geometric violations may include foreign-copper overlap and clearance deficits. Initial routes may therefore be electrically invalid even though their own net graph is connected. Keep geometry within the board's usable outline; reject outside-board proposals rather than using off-board space as an escape route. An interior obstacle may be crossed speculatively.

Final validation must additionally verify physical copper connectivity, all represented terminals, absence of shorts, width/clearance, via constraints, board boundaries, and unchanged protected geometry. Graph connectivity alone is insufficient.

## 4. Loose initialization

1. Create a deterministic initial branch topology from each net's terminals. Initially support two-pin nets; later add a seeded star/tree with movable junctions.
2. Assign planar runs to a seeded distribution of permitted working layers.
3. Add explicit terminal escape segments and through vias where needed. An SMD pad remains on its actual copper layer.
4. Insert bounded alternating doglegs using the eight planar directions to achieve a configurable slack ratio.
5. Enforce structural invariants and board containment. Report overlaps rather than hiding them.

There is no gravity requirement. “Dangling” means visible excess length and loose bends. Extra layers reduce initial competition but do not guarantee a legal initial arrangement.

In imported mode, physical layer IDs and order never change. In sandbox mode, construct the declared virtual stack before initialization; do not silently add physical layers during a reduction attempt.

## 5. Iteration schedule

Use a fixed simulation tick independent of display frame rate. Budgets are iteration/proposal counts for reproducibility; wall-clock limits are an optional outer stop condition.

```text
advance_tick(state):
    apply pending commands at a deterministic boundary
    snapshot current geometry
    generate bounded relaxation proposals from snapshot
    process proposals in seeded deterministic order
    update geometry and affected collision-index entries
    accumulate blocked-motion pressure and stagnation statistics
    if snap schedule permits:
        propose and evaluate a bounded set of mutations
    simplify geometry within invariant checks
    independently validate checkpoint candidates
    update best valid checkpoint when quality improves
    if layer-reduction trigger fires:
        advance one bounded batch of an evacuation transaction
    publish compact metrics and geometry deltas
```

Do not mutate overlapping subchains concurrently without conflict resolution. UI rendering may interpolate positions, but diagnostic/export geometry always comes from a real solver state.

## 6. Tightening and collision pressure

Approximate tension at an interior point from the sum of unit vectors toward adjacent points, weighted by segment/branch settings. Convert this desired motion into legal coupled edits; use a small maximum displacement and damping.

Shorten runs, collapse redundant bends, and move junctions toward lower total incident length. Repulsion discourages foreign-copper overlap. Fixed obstacles never receive displacement. Movable ropes may share displacement according to configurable mobility/priority; process deterministically to avoid route-order starvation.

Ordinary tightening uses swept checks to stop tunneling. Only an explicitly logged snap can bypass swept-path collisions.

For blocked motion, accumulate pressure from the blocked displacement, persistent clearance deficit, and number of stalled ticks. Decay pressure when the blockage clears. Normalize for segment length/scale so adding vertices does not artificially increase snap probability.

## 7. Snap mutations

Candidate operators:

- Translate a connected subchain in one of eight directions.
- Displace a subchain across the nearest blocking feature by its thickness plus the required clearance envelope.
- Expand the affected subchain to adjacent bends when reconnections remain blocked.
- Move all movable points in a branch/network while keeping anchors fixed and reconstructing attachment segments.
- Change dogleg orientation or add/remove a bounded pair of bends.
- Move a planar run to an allowed layer, adding explicit vias where required.
- Apply a bounded coordinated mutation to a few interacting ropes.

Choose displacement scales from a finite configured schedule plus seeded jitter. Do not trace obstacle boundaries to construct routes or call a hidden path planner. Reconnection uses only fixed algebraic templates and can initially collide.

Ropes may snap through immutable walls and other ropes. Ignore swept-path collisions for this explicit operation, but score the complete resulting geometry. Moving the middle across a wall may leave its endpoint connectors crossing the same wall; those violations must remain counted.

A completely obstructed arrangement may never resolve. Return stalled or budget exhausted with its best available checkpoint, not a fabricated path.

Trigger snaps through both accumulated pressure and low-rate exploration. A valid long detour can benefit from exploration even when it has no contact pressure.

## 8. Acceptance and checkpoint quality

Use hard invariant rejection before scoring. Define a normalized working energy:

```text
E = w_clearance * clearance_deficit
  + w_overlap * foreign_overlap_measure
  + w_length * normalized_trace_length
  + w_bends * bend_count
  + w_vias * via_count
  + w_congestion * local_density_penalty
  + w_evacuate * occupancy_on_target_layer
```

Specify the exact units and normalization in code. Avoid counting one collision many times merely because a trace was subdivided. `w_evacuate` is active only during evacuation. Do not rely on a soft energy to establish final validity.

Accept improvements. Permit bounded worse moves with a seeded annealing rule, for example `p = exp(-deltaE / temperature)` when temperature is positive. Cap temporary overlap severity, proposal count, vertex count, and consecutive non-improving iterations. Cool exploration gradually; optionally reheat a bounded number of times after stagnation.

Compare valid checkpoints lexicographically by configured priorities: occupied stage-three planar routing layers, then weighted via/length/bend quality. Apply explicit quality limits during layer reduction so saving a layer cannot silently produce an arbitrarily bad route. Report the tradeoff.

Stop when the configured goal is valid and stable, the user stops, or a budget expires. Retain best valid output on failure. If no valid state was found, display unresolved geometry without permitting validated PCB export.

## 9. Adaptive layer reduction

### Configuration

Expose these proposed initial defaults for the sandbox demo; tune through benchmarks:

| Parameter | Starting value | Meaning |
|---|---:|---|
| Initial working layers | 4 | Pool available to generated routes |
| Target trace layers | 2 | Requested stage-three planar occupancy |
| Stable valid ticks | 120 | Delay before an evacuation attempt |
| Evacuation budget | 2000 ticks | Bounded speculative solve window |
| Failed-layer cooldown | 600 ticks | Avoid immediate repeated attempts |
| Maximum wire-length increase | 20% | Relative to pre-attempt valid checkpoint |
| Maximum added vias | 8 | Absolute per-attempt quality limit |
| Allowed-layer expansion | Off | Never silently widen the allowed pool |

These tick counts are not milliseconds. Small test fixtures should override them. User-facing aggressiveness can map to budget, pressure, and cooldown, while Advanced exposes individual values.

### Eligibility and target accounting

Compute trace occupancy from actual planar copper; include terminal escape stubs. Track via-span occupancy separately. Exclude a layer from evacuation when removing its stage-three planar usage would violate an unavoidable attachment constraint. Protected earlier-stage occupancy does not disappear when stage three evacuates a layer.

Rank eligible layers by stage-three trace length, number of affected nets, via relationships, and recent failed attempts. This ranks operations, not spatial paths. Attempt one layer at a time initially. If a requested target cannot be met within the budget, preserve the best validated larger-layer result.

### Transaction

1. Require a valid stable checkpoint in the initial implementation.
2. Snapshot routes, configuration, RNG state, pressure, temperature, counters, and layer permissions.
3. Mark the selected layer as an evacuation target. Prevent new persistent assignments to it; existing traces remain until explicitly moved.
4. Propose moving affected runs to surviving allowed layers. Preserve terminal access; update explicit vias and test their full spans.
5. Tighten and snap affected ropes and their neighbors. Temporarily invalid working states are allowed within the transaction's budget.
6. Independently validate a fully evacuated candidate. Confirm no planar occupancy remains on the target and all quality limits hold.
7. On success, commit and remove that layer from the current stage-three assignment pool. Keep the physical layer and fixed copper unchanged.
8. On failure, restore the checkpoint, invalidate/rebuild affected caches, record the failed attempt, and apply cooldown outside the restored state. Advance the attempt ID deterministically so the next attempt does not replay the identical failure forever.

Do not reduce only the displayed layer count or relabel layers to hide occupied copper. A solver can reach a valid result above the requested target; label this “valid, target not reached.”

Later experiments may attempt evacuation before global validity, but must preserve a separate valid checkpoint and use stricter budgets. This is not required for the first implementation.

## 10. Diagnostics and reproducibility

Log operation ID, seed stream position, mutation type, affected net/layer IDs, energy delta, validation summary, acceptance reason, and checkpoint events. Bound log memory and allow export. Record configuration changes at tick boundaries.

Show current violations, connected terminals, total length, bends, vias, planar layers used, via-span layers, snap attempts/acceptances, and evacuation progress. Distinguish validator errors from temporary solver collisions.

Replay should restore recorded checkpoints and events. Deterministic rerun is required on the same supported runtime/configuration; cross-platform floating-point identity is not assumed until tested.

## 11. Required falsification tests

- A middle section moved past a wall still has crossing connectors: never mark valid.
- A route visually clear at zero width violates clearance at its actual width: never mark valid.
- A through via crosses fixed copper on a hidden layer: reject or keep explicitly invalid.
- Evacuating a layer disconnects an SMD terminal: never commit.
- A plane exists only as an unfilled outline: do not infer connectivity from it.
- Two nets touch at a junction coordinate: detect a short despite separate graph IDs.
- A failed evacuation mutates fixed geometry or loses a branch: fail the transaction test.
- A seed stalls: report budget exhaustion without declaring physical impossibility.
- A valid result uses extra layers: report target not reached rather than deleting those layers.
