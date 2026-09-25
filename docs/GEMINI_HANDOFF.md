# Gemini implementation handoff

## Mission

Read the strict collision-free commit revision at the top of `SOLVER_SPEC.md`. The current user explicitly requires no overlaps after a snap. This supersedes earlier instructions allowing temporary overlaps in accepted solver moves; unresolved input drafts remain visible and marked until repaired.

Implement the Rope Router simulation described in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) and [SOLVER_SPEC.md](SOLVER_SPEC.md). Read both before changing code. The repository now contains a runnable prototype; consult [implementation status](IMPLEMENTATION_STATUS.md) and preserve implemented behavior.

The defining user requirements are simultaneous rope tightening, snapping through ropes AND fixed walls, discrete PCB layers, octilinear planar geometry, and adaptive reduction from a larger initial layer pool. No pathfinding algorithm is permitted, including as an unadvertised fallback.

## Execution order

Implement stages 0 through 10 sequentially. Start by making the model, validator, viewer, and seeded generators trustworthy. Demonstrate tightening and snapping on small fixtures before spending time on large imported boards or LCSC networking.

Use the proposed TypeScript/worker architecture unless an actual constraint justifies a documented change. Keep the solver headless and renderer independent. Select supported dependency versions during implementation, pin them, and use official documentation for version-specific behavior.

For each stage:

1. Read its scope and acceptance criteria.
2. Implement real behavior and a runnable fixture.
3. Run focused geometry, invariant, and integration tests relevant to the change.
4. Inspect the UI when the stage changes rendering or interaction.
5. Record actual commands and results in `docs/IMPLEMENTATION_STATUS.md`.
6. State limitations and the next stage. Do not call unimplemented work complete.

Do not create empty modules or simulated success responses merely to match the architecture. Build working vertical slices, while maintaining the shared contracts.

## What not to reinterpret

- Snapping through a wall is allowed during solving. The wall itself remains fixed.
- Temporary intersections may exist in working geometry. A valid export may not contain them.
- Final geometry must remain horizontal/vertical/45 degrees; visually snapping an arbitrary polyline is insufficient.
- Layer reduction is a real evacuation and validation transaction with rollback.
- Fewer stage-three trace layers does not imply a physically thinner imported PCB stack.
- An SMD terminal cannot move to an internal layer. Through vias occupy their entire physical span.
- Random netlists are routing stress inputs, not automatically sensible circuits.
- LCSC part lookup is footprint acquisition, not netlist generation.
- A beautiful animation is not evidence of route validity or solver progress.

## First runnable milestone

Deliver one desktop-style window with a dominant board viewport, fixed sample components, a seed field, Generate, Run/Pause, Step, and Reset. Show actual generated slack octilinear routes and their violations. Save/load the project. Keep future features visibly unavailable until implemented.

The next milestone should visibly shorten routes using the worker solver. The following milestone should demonstrate an explicitly logged snap through a wall, with full-route validity checked afterward. Then add multilayer transitions and the layer-evacuation demonstration.

## Stage completion report template

```markdown
## Stage N — title

Status: complete / partial / blocked

Implemented behavior:
- Concrete user-visible capabilities.

Validation:
- Actual commands and outcomes.
- Fixture/seed and observed result.

Known limitations:
- Unsupported behavior and how the app reports it.

Next:
- Next bounded implementation step.
```

Do not fabricate tests, benchmark numbers, imported asset provenance, or KiCad compatibility. If a heuristic fails, preserve and report the failure case; improve allowed mutations rather than adding pathfinding.
