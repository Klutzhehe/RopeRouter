import { z } from "zod";

const coordinate = z.number().int().min(0).max(1000000);
export const pointSchema = z.object({ x: coordinate, y: coordinate });
export type Point = z.infer<typeof pointSchema>;
const rectSchema = z.object({
  x: coordinate,
  y: coordinate,
  w: z.number().int().positive().max(1000000),
  h: z.number().int().positive().max(1000000),
});
export type Rect = z.infer<typeof rectSchema>;
const padSchema = pointSchema.extend({
  id: z.string().min(1),
  component: z.string(),
  radius: z.number().int().min(100).max(2000),
  net: z.string().nullable(),
});
const componentSchema = rectSchema.extend({
  id: z.string(),
  kind: z.enum(["DIP", "HEADER", "PASSIVE"]),
  pads: z.array(padSchema).min(2).max(16),
});
export const viaSchema = z.object({
  x: coordinate,
  y: coordinate,
  fromLayer: z.number().int().min(0).max(7),
  toLayer: z.number().int().min(0).max(7),
  drill: z.number().int().min(100).max(1000).default(300),
  radius: z.number().int().min(200).max(1500).default(450),
});
export type Via = z.infer<typeof viaSchema>;
const routeSchema = z.object({
  id: z.string(),
  terminals: z.tuple([z.string(), z.string()]),
  layer: z.number().int().min(0).max(7),
  width: z.number().int().min(100).max(1000),
  points: z.array(pointSchema).min(2).max(32),
  control: pointSchema,
  pressure: z.number().int().min(0),
  vias: z.array(viaSchema).max(30).optional(),
});
export type Route = z.infer<typeof routeSchema>;
export const projectSchema = z.object({
  version: z.literal(1),
  units: z.literal("um"),
  name: z.string().max(100),
  seed: z.number().int().min(0).max(4294967295),
  width: z.number().int().min(20000).max(1000000),
  height: z.number().int().min(20000).max(1000000),
  layers: z.number().int().min(1).max(8),
  clearance: z.number().int().min(100).max(2000),
  components: z.array(componentSchema).max(500),
  routes: z.array(routeSchema).max(1000),
  walls: z
    .array(
      rectSchema.extend({
        id: z.string(),
        layers: z.array(z.number().int().min(0).max(7)).max(8),
      }),
    )
    .max(30),
  settings: z.object({
    strength: z.number().min(0.1).max(2),
    snaps: z.boolean(),
  }),
  tick: z.number().int().min(0),
  rng: z.number().int().min(0).max(4294967295),
});
export type Project = z.infer<typeof projectSchema>;
export type Violation = {
  kind:
    "wall" | "trace" | "pad" | "boundary" | "angle" | "anchor" | "self" | "via";
  objects: string[];
  point: Point;
  message: string;
  layer?: number;
  shortfall?: number;
};
export type Report = {
  violations: Violation[];
  length: number;
  occupied: number;
  connected: number;
  vias: number;
};
export const COLORS = [
  "#e7a768",
  "#73bcae",
  "#8faee0",
  "#cba1cf",
  "#c4c879",
  "#db8d99",
  "#86bdca",
  "#c8ac85",
];
export function random(state: { rng: number }) {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng / 4294967296;
}
export function parseProject(text: string): Project {
  if (text.length > 2_000_000)
    throw new Error("Project exceeds the 2 MB prototype limit.");
  const p = projectSchema.parse(JSON.parse(text));
  const ids = [
    ...p.components.map((c) => c.id),
    ...p.components.flatMap((c) => c.pads.map((a) => a.id)),
    ...p.routes.map((r) => r.id),
    ...p.walls.map((w) => w.id),
  ];
  if (new Set(ids).size !== ids.length)
    throw new Error("Object IDs must be unique.");
  const pads = p.components.flatMap((c) => c.pads);
  for (const c of p.components) {
    if (
      c.x + c.w > p.width ||
      c.y + c.h > p.height ||
      c.pads.some(
        (a) =>
          a.component !== c.id ||
          a.x < c.x ||
          a.y < c.y ||
          a.x > c.x + c.w ||
          a.y > c.y + c.h,
      )
    )
      throw new Error("Component or pad lies outside its boundary.");
  }
  for (const r of p.routes) {
    if (
      r.layer >= p.layers ||
      r.terminals[0] === r.terminals[1] ||
      r.terminals.some((id) => !pads.some((a) => a.id === id && a.net === r.id))
    )
      throw new Error("Invalid layer or terminal assignment.");
  }
  for (const pad of pads)
    if (
      pad.net !== null &&
      !p.routes.some((r) => r.id === pad.net && r.terminals.includes(pad.id))
    )
      throw new Error("Pad references a missing net.");
  if (
    p.walls.some(
      (w) =>
        w.x + w.w > p.width ||
        w.y + w.h > p.height ||
        w.layers.some((l) => l >= p.layers),
    )
  )
    throw new Error("Invalid fixed region.");
  return p;
}
