import type { Point, Project, Route } from "../model";
import {
  connectWaypoints,
  distance,
  pointSegment,
  rectDistance,
  routeLength,
  simplify,
  validate,
  routeSegments,
  segmentDistance,
} from "../geometry";

/** A finite family of geometric rope mutations. No grid, frontier, or routing graph. */
export function repairCandidates(board: Project, route: Route): Route[] {
  const a = route.points[0],
    b = route.points.at(-1)!;
  const padMargin = Math.ceil(route.width / 2 + board.clearance + 100);
  const pads = board.components
    .flatMap((c) => c.pads)
    .filter((p) => p.net !== route.id);
  const output: Route[] = [];
  const seen = new Set<string>();
  // Through-hole pads are common to every layer. Equal wall sets therefore
  // have identical static candidate geometry, which can be generated once.
  const layerGeometry = new Map<string, Route[]>();
  for (let layer = 0; layer < board.layers; layer++) {
    const walls = board.walls.filter((w) => w.layers.includes(layer));
    const wallKey = JSON.stringify(walls.map((w) => w.id));
    const existing = layerGeometry.get(wallKey);
    if (existing) {
      output.push(...existing.map((candidate) => ({ ...candidate, layer })));
      continue;
    }
    const firstCandidate = output.length;
    const clearCache = new Map<string, boolean>();
    const computeClear = (u: Point, v: Point) => {
      if (
        [u, v].some(
          (p) =>
            p.x < padMargin ||
            p.y < padMargin ||
            p.x > board.width - padMargin ||
            p.y > board.height - padMargin,
        )
      )
        return false;
      return (
        !pads.some((p) => pointSegment(p, u, v) < p.radius + padMargin) &&
        !walls.some((w) => rectDistance(u, v, w) < padMargin)
      );
    };
    const clear = (u: Point, v: Point): boolean => {
      const key =
        u.x < v.x || (u.x === v.x && u.y <= v.y)
          ? `${u.x},${u.y};${v.x},${v.y}`
          : `${v.x},${v.y};${u.x},${u.y}`;
      const previous = clearCache.get(key);
      if (previous !== undefined) return previous;
      const result = computeClear(u, v);
      clearCache.set(key, result);
      return result;
    };
    const escapes = (p: Point, terminal: string, toward: Point): Point[][] => {
      const component = board.components.find((c) =>
        c.pads.some((p) => p.id === terminal),
      );
      const options: Point[][] = [[p]];
      const tips: Point[] = [];
      for (const length of [1500, 3000])
        for (const [x, y] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]) {
          const end = { x: p.x + x * length, y: p.y + y * length };
          if (clear(p, end)) {
            options.push([p, end]);
            tips.push(end);
          }
        }
      if (component) {
        const left =
          Math.min(...component.pads.map((p) => p.x - p.radius)) - padMargin;
        const right =
          Math.max(...component.pads.map((p) => p.x + p.radius)) + padMargin;
        const top =
          Math.min(...component.pads.map((p) => p.y - p.radius)) - padMargin;
        const bottom =
          Math.max(...component.pads.map((p) => p.y + p.radius)) + padMargin;
        for (const tip of tips)
          for (const end of [
            { x: left, y: tip.y },
            { x: right, y: tip.y },
            { x: tip.x, y: top },
            { x: tip.x, y: bottom },
          ]) {
            if (clear(tip, end)) options.push(simplify([p, tip, end]));
          }
      }
      const unique = new Map<string, Point[]>();
      for (const path of options) {
        const tip = path.at(-1)!;
        const key = `${tip.x},${tip.y}`;
        const previous = unique.get(key);
        if (
          !previous ||
          routeLength({ ...route, points: path }) <
            routeLength({ ...route, points: previous })
        )
          unique.set(key, path);
      }
      return [...unique.values()].sort(
        (u, v) =>
          routeLength({ ...route, points: u }) +
          distance(u.at(-1)!, toward) -
          routeLength({ ...route, points: v }) -
          distance(v.at(-1)!, toward),
      );
    };
    const start = escapes(a, route.terminals[0], b),
      end = escapes(b, route.terminals[1], a);
    const xs = new Set<number>(),
      ys = new Set<number>();
    for (const p of [a, b])
      for (const delta of [-6400, -3200, -1600, 1600, 3200, 6400]) {
        xs.add(p.x + delta);
        ys.add(p.y + delta);
      }
    for (const w of walls) {
      xs.add(w.x - padMargin);
      xs.add(w.x + w.w + padMargin);
      ys.add(w.y - padMargin);
      ys.add(w.y + w.h + padMargin);
    }
    const add = (points: Point[]) => {
      points = simplify(points);
      if (points.length < 2 || points.length > 32) return;
      const key = layer + ":" + points.map((p) => `${p.x},${p.y}`).join(";");
      if (seen.has(key)) return;
      seen.add(key);
      for (let i = 1; i < points.length; i++)
        if (!clear(points[i - 1], points[i])) return;
      const candidate = {
        ...route,
        points,
        layer,
        vias: [],
        control: points[Math.floor(points.length / 2)],
        pressure: 0,
      };
      if (
        validate({ ...board, routes: [candidate] }, route.id).violations.length
      )
        return;
      output.push(candidate);
    };
    for (const prefix of start)
      for (const suffix of end) {
        const u = prefix.at(-1)!,
          v = suffix.at(-1)!;
        const tail = [...suffix].reverse();
        for (const diagonalFirst of [false, true])
          add([...prefix, ...connectWaypoints([u, v], diagonalFirst), ...tail]);
        add([...prefix, { x: u.x, y: v.y }, ...tail]);
        add([...prefix, { x: v.x, y: u.y }, ...tail]);
        for (const x of xs)
          add([...prefix, { x, y: u.y }, { x, y: v.y }, ...tail]);
        for (const y of ys)
          add([...prefix, { x: u.x, y }, { x: v.x, y }, ...tail]);
      }
    layerGeometry.set(wallKey, output.slice(firstCandidate));
  }
  const lengths = new Map(output.map((r) => [r, routeLength(r)]));
  return output.sort((a, b) => lengths.get(a)! - lengths.get(b)!);
}

export function candidateConflicts(board: Project, candidate: Route): string[] {
  return board.routes
    .filter(
      (r) =>
        r.id !== candidate.id && routesConflict(candidate, r, board.clearance),
    )
    .map((r) => r.id);
}

const segmentCache = new WeakMap<Route, ReturnType<typeof routeSegments>>();
function routeEdges(route: Route) {
  let edges = segmentCache.get(route);
  if (!edges) {
    edges = routeSegments(route);
    segmentCache.set(route, edges);
  }
  return edges;
}
export function routesConflict(a: Route, b: Route, clearance: number): boolean {
  const required = (a.width + b.width) / 2 + clearance;
  for (const u of routeEdges(a))
    for (const v of routeEdges(b)) {
      if (u.layer !== v.layer) continue;
      if (
        Math.max(u.a.x, u.b.x) + required < Math.min(v.a.x, v.b.x) ||
        Math.max(v.a.x, v.b.x) + required < Math.min(u.a.x, u.b.x) ||
        Math.max(u.a.y, u.b.y) + required < Math.min(v.a.y, v.b.y) ||
        Math.max(v.a.y, v.b.y) + required < Math.min(u.a.y, u.b.y)
      )
        continue;
      if (segmentDistance(u.a, u.b, v.a, v.b) < required - 1e-7) return true;
    }
  const viaTouches = (via: Point & { radius: number }, other: Route) => {
    const required = via.radius + other.width / 2 + clearance;
    return routeEdges(other).some(
      (s) =>
        via.x >= Math.min(s.a.x, s.b.x) - required &&
        via.x <= Math.max(s.a.x, s.b.x) + required &&
        via.y >= Math.min(s.a.y, s.b.y) - required &&
        via.y <= Math.max(s.a.y, s.b.y) + required &&
        pointSegment(via, s.a, s.b) < required - 1e-7,
    );
  };
  for (const via of a.vias ?? []) {
    if (viaTouches(via, b)) return true;
    for (const other of b.vias ?? []) {
      const required = via.radius + other.radius + clearance;
      if (
        Math.abs(via.x - other.x) < required &&
        Math.abs(via.y - other.y) < required &&
        distance(via, other) < required - 1e-7
      )
        return true;
    }
  }
  for (const via of b.vias ?? []) if (viaTouches(via, a)) return true;
  return false;
}

/** Candidate geometry depends only on fixed copper and terminals. Cache is derived
 * state; no RNG or mutable search frontier is needed to replay a snapshot. */
export class ConflictRepair {
  private candidates = new Map<string, Route[]>();

  private options(board: Project, route: Route) {
    let candidates = this.candidates.get(route.id);
    if (!candidates) {
      candidates = repairCandidates(board, route);
      this.candidates.set(route.id, candidates);
    }
    return candidates;
  }

  repair(engine: import("./pbd-engine").PbdEngine, tick: number): string[] {
    const board = engine.getProject(tick);
    const report = validate(board, undefined, true);
    const invalid = new Set(report.violations.flatMap((v) => v.objects));
    for (let offset = 0; offset < board.routes.length; offset++) {
      const route =
        board.routes[(Math.floor(tick / 3) + offset) % board.routes.length];
      if (!invalid.has(route.id)) continue;
      const candidates = this.options(board, route);
      for (const candidate of candidates) {
        if (
          !candidateConflicts(board, candidate).length &&
          engine.tryReplaceRoute(candidate, tick, "terminal-aware-snap")
        )
          return [route.id];
      }
      if (tick < 15 || tick % 15 !== 0) return [];
      // Enumerate bounded combinations of whole-rope mutations. Displaced routes
      // join the same transaction; no partially repaired board is ever installed.
      const conflicts = new Map<Route, string[]>();
      const baseConflicts = (candidate: Route) => {
        let ids = conflicts.get(candidate);
        if (!ids) {
          ids = candidateConflicts(board, candidate);
          conflicts.set(candidate, ids);
        }
        return ids;
      };
      let budget = 600;
      const combine = (
        assigned: Route[],
        pending: string[],
      ): Route[] | null => {
        if (!pending.length) return assigned;
        if (assigned.length >= 6 || --budget < 0) return null;
        const id = pending[0];
        const assignedIds = new Set(assigned.map((r) => r.id));
        const choices = this.options(
          board,
          board.routes.find((r) => r.id === id)!,
        )
          .filter(
            (c) => !assigned.some((r) => routesConflict(c, r, board.clearance)),
          )
          .map((candidate) => ({
            candidate,
            blockers: baseConflicts(candidate).filter(
              (id) => !assignedIds.has(id),
            ),
          }))
          .filter(
            (c) =>
              new Set([...pending.slice(1), ...c.blockers]).size +
                assigned.length +
                1 <=
              6,
          )
          .sort((a, b) => a.blockers.length - b.blockers.length);
        const signatures = new Map<string, number>();
        let attempts = 0;
        for (const { candidate, blockers } of choices) {
          const key = [...blockers].sort().join("|") + ":" + candidate.layer;
          const count = signatures.get(key) ?? 0;
          if (count >= 3) continue;
          signatures.set(key, count + 1);
          if (++attempts > 36 || budget < 0) break;
          const next = [...new Set([...pending.slice(1), ...blockers])].filter(
            (other) => other !== id,
          );
          const result = combine([...assigned, candidate], next);
          if (result) return result;
        }
        return null;
      };
      const replacement = combine([], [route.id]);
      if (
        replacement &&
        engine.tryReplaceRoutes(replacement, tick, "coordinated-snap")
      )
        return replacement.map((r) => r.id);
      // Work on at most one conflict group per call, so the worker can service commands.
      return [];
    }
    return [];
  }
}
