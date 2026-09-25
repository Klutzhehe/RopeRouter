import { z } from "zod";
import { parseProject, projectSchema } from "./model";

const finite = z.number().finite();
const layer = z.number().int().min(0).max(7);
const point = z.object({ x: finite, y: finite });
const decision = z.object({
  tick: z.number().int().nonnegative(),
  operation: z.string(),
  routeIds: z.array(z.string()),
  accepted: z.boolean(),
  reasons: z.array(z.string()),
});
const sweepRoute = projectSchema.shape.routes.element;
const sweepStateSchema = z.object({
  board: projectSchema,
  working: z.array(sweepRoute).max(1000),
  additions: z.array(z.array(sweepRoute).max(128)).max(1000),
  weights: z.array(z.tuple([z.string(), finite.positive()])),
  seed: z.number().int().min(0).max(4294967295),
  iteration: z.number().int().nonnegative(),
  phase: z.enum(["preparing", "searching", "solved", "stalled"]),
  conflicts: z.number().int().nonnegative(),
  evaluation: z
    .object({
      index: z.number().int().nonnegative(),
      cursor: z.number().int().nonnegative(),
      best: finite.nonnegative().nullable(),
      selected: sweepRoute.nullable(),
      ties: z.number().int().nonnegative(),
    })
    .nullable(),
  reason: z.string().nullable(),
});
export const solverSnapshotSchema = z.object({
  kind: z.literal("rope-router-simulation"),
  version: z.literal(1),
  solverVersion: z.literal("pbd-transactional-3"),
  project: projectSchema,
  initial: projectSchema,
  best: projectSchema.nullable(),
  routes: z
    .array(
      z.object({
        id: z.string(),
        terminals: z.tuple([z.string(), z.string()]),
        layer,
        width: finite.positive(),
        pressure: finite.nonnegative(),
        vias: projectSchema.shape.routes.element.shape.vias.unwrap(),
        nodes: z
          .array(
            point.extend({
              prevX: finite,
              prevY: finite,
              invMass: finite.min(0).max(1),
              layer,
              netId: z.string(),
            }),
          )
          .min(2)
          .max(10000),
        disabledCollisionUntilTick: finite.optional(),
      }),
    )
    .max(1000),
  parameters: z.object({
    targetSegmentLength: finite.positive(),
    minSegmentLength: finite.positive(),
    maxSegmentLength: finite.positive(),
    subIterations: z.number().int().min(1).max(100),
    tensionAlpha: finite.min(0).max(1),
    octilinearBuffer: finite.nonnegative(),
  }),
  layering: z.object({
    viaRadius: finite.positive(),
    viaDrill: finite.positive(),
  }),
  supervisor: z.object({
    lastCheckedTick: z.number().int(),
    consecutiveCrossingTicks: z.array(
      z.tuple([z.string(), z.number().int().nonnegative()]),
    ),
  }),
  events: z.array(
    z.object({
      tick: z.number().int().nonnegative(),
      kind: z.enum(["tighten", "snap", "status", "push", "layer"]),
      text: z.string(),
    }),
  ),
  decisions: z.array(decision).max(200),
  sweep: sweepStateSchema.nullable(),
  lastSweepTick: z.number().int(),
  lastQuantization: z
    .object({ accepted: z.boolean(), reasons: z.array(z.string()) })
    .nullable(),
  runtime: z
    .object({
      running: z.boolean(),
      isQuantized: z.boolean(),
      cleanTicks: z.number().int().nonnegative(),
      stopReason: z
        .enum(["paused", "solved", "budget-exhausted", "quantization-rejected"])
        .nullable(),
      maxTicks: z.number().int().positive(),
    })
    .optional(),
});
export type SolverSnapshot = z.infer<typeof solverSnapshotSchema>;

/** Runtime state has a separate format: particle counts and floats are not Project geometry. */
export function parseSimulationSnapshot(text: string): SolverSnapshot {
  if (text.length > 100_000_000)
    throw new Error("Simulation snapshot exceeds 100 MB.");
  const s = solverSnapshotSchema.parse(JSON.parse(text));
  parseProject(JSON.stringify(s.project));
  parseProject(JSON.stringify(s.initial));
  if (s.best) parseProject(JSON.stringify(s.best));
  if (s.sweep) {
    parseProject(JSON.stringify(s.sweep.board));
    if (
      s.sweep.board.routes.length !== s.project.routes.length ||
      s.sweep.working.length > s.project.routes.length ||
      (s.sweep.phase !== "preparing" &&
        s.sweep.phase !== "stalled" &&
        s.sweep.working.length !== s.project.routes.length)
    )
      throw new Error("Sweep routes do not match the project.");
    const expected = new Map(s.project.routes.map((r) => [r.id, r]));
    for (const r of [
      ...s.sweep.working,
      ...s.sweep.additions.flat(),
      ...(s.sweep.evaluation?.selected ? [s.sweep.evaluation.selected] : []),
    ]) {
      const base = expected.get(r.id);
      if (
        !base ||
        r.width !== base.width ||
        JSON.stringify(r.terminals) !== JSON.stringify(base.terminals) ||
        r.points[0].x !== base.points[0].x ||
        r.points[0].y !== base.points[0].y ||
        r.points.at(-1)!.x !== base.points.at(-1)!.x ||
        r.points.at(-1)!.y !== base.points.at(-1)!.y
      )
        throw new Error("Sweep changed route ownership or fixed anchors.");
    }
    if (
      s.sweep.evaluation &&
      (s.sweep.evaluation.index >= s.project.routes.length ||
        s.sweep.phase !== "searching")
    )
      throw new Error("Invalid sweep evaluation cursor.");
  }

  if (
    s.routes.length !== s.project.routes.length ||
    new Set(s.routes.map((r) => r.id)).size !== s.routes.length
  )
    throw new Error("Simulation routes do not match the project.");
  for (const [index, route] of s.routes.entries()) {
    const reference = s.project.routes[index];
    if (
      !reference ||
      route.id !== reference.id ||
      route.width !== reference.width ||
      JSON.stringify(route.terminals) !== JSON.stringify(reference.terminals) ||
      route.layer >= s.project.layers
    )
      throw new Error("Simulation route metadata does not match the project.");
    const ends = [route.nodes[0], route.nodes.at(-1)!];
    const anchors = [reference.points[0], reference.points.at(-1)!];
    if (
      ends.some(
        (n, i) =>
          n.invMass !== 0 || n.x !== anchors[i].x || n.y !== anchors[i].y,
      ) ||
      route.nodes.some(
        (n) => n.netId !== route.id || n.layer >= s.project.layers,
      )
    )
      throw new Error("Simulation contains invalid anchors or node ownership.");
    let expectedLayer = route.layer;
    for (const node of route.nodes) {
      const via = route.vias.find((v) => v.x === node.x && v.y === node.y);
      if (via) {
        if (
          node.invMass !== 0 ||
          via.fromLayer !== expectedLayer ||
          via.toLayer >= s.project.layers
        )
          throw new Error("Simulation has an unpinned or inconsistent via.");
        expectedLayer = via.toLayer;
      }
      if (node.layer !== expectedLayer)
        throw new Error("Simulation node layers do not follow its vias.");
    }
    if (
      route.vias.some(
        (v) =>
          !route.nodes.slice(1, -1).some((n) => n.x === v.x && n.y === v.y),
      )
    )
      throw new Error("Simulation via is missing its interior node.");
  }
  return s;
}
