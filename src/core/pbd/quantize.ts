import type { Point, Project, Route } from "../model";
import {
  distance,
  simplify,
  validate,
  pointSegment,
  rectDistance,
  routeSegments,
  segmentDistance,
} from "../geometry";
import {
  pointToSegmentDist,
  segmentIntersectsBox,
  segmentsIntersect,
} from "./pbd-engine";

/**
 * Connect two points with a strict octilinear dogleg (axis + diagonal or diagonal + axis).
 */
export function octilinearConnect(
  a: Point,
  b: Point,
  diagFirst = false,
): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);

  // Already octilinear
  if (adx === 0 || ady === 0 || adx === ady) {
    return [a, b];
  }

  const sx = Math.sign(dx);
  const sy = Math.sign(dy);

  let mid: Point;

  if (adx > ady) {
    if (diagFirst) {
      // Diagonal first, then horizontal
      mid = { x: a.x + sx * ady, y: a.y + sy * ady };
    } else {
      // Horizontal first, then diagonal
      mid = { x: a.x + sx * (adx - ady), y: a.y };
    }
  } else {
    if (diagFirst) {
      // Diagonal first, then vertical
      mid = { x: a.x + sx * adx, y: a.y + sy * adx };
    } else {
      // Vertical first, then diagonal
      mid = { x: a.x, y: a.y + sy * (ady - adx) };
    }
  }

  return [a, mid, b];
}

/**
 * Simplify a polyline by keeping only points that deviate significantly from a straight chord.
 */
function decimatePolyline(points: Point[], tolerance = 400): Point[] {
  if (points.length <= 2) return points;

  const result: Point[] = [points[0]];
  let last = points[0];

  for (let i = 1; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];

    // Distance from curr to segment last -> next
    const dx = next.x - last.x;
    const dy = next.y - last.y;
    const len = Math.hypot(dx, dy);
    let dev = 0;
    if (len > 1e-4) {
      dev = Math.abs((curr.x - last.x) * dy - (curr.y - last.y) * dx) / len;
    }

    if (dev > tolerance) {
      result.push(curr);
      last = curr;
    }
  }

  result.push(points.at(-1)!);
  return result;
}

/**
 * Quantize a free-angle continuous polyline into a strict 45°/90° octilinear route.
 */
export function quantizeRoutePoints(
  rawPoints: Point[],
  project?: Project,
  routeId?: string,
  mandatoryWaypoints?: Point[],
): Point[] {
  if (rawPoints.length < 2) return rawPoints;

  // Split at mandatory vertices before decimation. Replacing the nearest
  // decimated vertex can overwrite an endpoint or merge two distinct vias.
  if (mandatoryWaypoints?.length) {
    const cuts = rawPoints
      .map((p, i) =>
        mandatoryWaypoints.some((v) => v.x === p.x && v.y === p.y) ? i : -1,
      )
      .filter((i) => i > 0 && i < rawPoints.length - 1);
    const output: Point[] = [];
    let start = 0;
    for (const end of [...cuts, rawPoints.length - 1]) {
      const part = quantizeRoutePoints(
        rawPoints.slice(start, end + 1),
        project,
        routeId,
      );
      output.push(...(output.length ? part.slice(1) : part));
      start = end;
    }
    // Do not simplify across via vertices: even collinear transitions are mandatory.
    return output;
  }
  const waypoints = decimatePolyline(rawPoints, 350).map((pt) => ({
    x: Math.round(pt.x),
    y: Math.round(pt.y),
  }));

  // 2. Connect consecutive waypoints with octilinear segments
  let fullPath: Point[] = [waypoints[0]];

  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = fullPath.at(-1)!;
    const b = waypoints[i + 1];

    // Evaluate both dogleg options (diag-first vs axis-first)
    const optDiag = octilinearConnect(a, b, true);
    const optAxis = octilinearConnect(a, b, false);

    // If we have a project context, pick the option with fewer obstacle conflicts
    let chosen = optAxis;
    if (project && routeId) {
      const currentRoute = project.routes.find((r) => r.id === routeId);
      const layer = currentRoute?.layer ?? 0;
      const margin = (currentRoute?.width ?? 300) / 2 + project.clearance;

      const scoreOption = (opt: Point[]) => {
        let minClearance = Infinity;

        for (let s = 0; s < opt.length - 1; s++) {
          const s1 = opt[s];
          const s2 = opt[s + 1];

          // 1. Check against foreign pads
          for (const c of project.components) {
            for (const pad of c.pads) {
              if (pad.net !== routeId) {
                const { dist } = pointToSegmentDist(
                  pad.x,
                  pad.y,
                  s1.x,
                  s1.y,
                  s2.x,
                  s2.y,
                );
                const cl = dist - pad.radius - margin;
                if (cl < 0) return -100000;
                if (cl < minClearance) minClearance = cl;
              }
            }
          }

          // 2. Check against walls
          for (const wall of project.walls) {
            if (wall.layers.includes(layer)) {
              if (
                segmentIntersectsBox(
                  s1.x,
                  s1.y,
                  s2.x,
                  s2.y,
                  wall.x,
                  wall.y,
                  wall.w,
                  wall.h,
                  margin,
                )
              ) {
                return -200000;
              }
            }
          }

          // 3. Check against other routes on the same layer
          for (const other of project.routes) {
            if (other.id !== routeId && other.layer === layer) {
              for (let o = 0; o < other.points.length - 1; o++) {
                const o1 = other.points[o];
                const o2 = other.points[o + 1];
                if (
                  segmentsIntersect(
                    s1.x,
                    s1.y,
                    s2.x,
                    s2.y,
                    o1.x,
                    o1.y,
                    o2.x,
                    o2.y,
                  ).hit
                ) {
                  return -300000;
                }
              }
            }
          }
        }

        return minClearance;
      };

      if (scoreOption(optDiag) > scoreOption(optAxis)) {
        chosen = optDiag;
      }
    }

    for (let k = 1; k < chosen.length; k++) {
      fullPath.push(chosen[k]);
    }
  }

  // 3. Simplify redundant collinear points and eliminate zero-length segments
  return simplify(fullPath);
}

/**
 * Quantize all routes in a project from free-angle continuous curves
 * into strict 45°/90° integer octilinear polylines.
 */
export function quantizeProject(project: Project): Project {
  const quantized = structuredClone(project);

  for (let i = 0; i < quantized.routes.length; i++) {
    const r = quantized.routes[i];
    const mandatory = r.vias ? r.vias.map((v) => ({ x: v.x, y: v.y })) : [];
    const octilinearPoints =
      clearancePreservingPoints(r, quantized) ??
      quantizeRoutePoints(r.points, quantized, r.id, mandatory);
    r.points = octilinearPoints;
    r.control = octilinearPoints[Math.floor(octilinearPoints.length / 2)];
  }

  return quantized;
}

/** Shorten existing subchains with the two fixed octilinear connectors. This only
 * removes rope vertices; it never expands a routing frontier or invents a corridor. */
function clearancePreservingPoints(
  route: Route,
  board: Project,
): Point[] | null {
  const raw = route.points.map((p) => ({
    x: Math.round(p.x),
    y: Math.round(p.y),
  }));
  const mandatory = new Set((route.vias ?? []).map((v) => `${v.x},${v.y}`));
  const cuts = raw
    .map((p, i) => (mandatory.has(`${p.x},${p.y}`) ? i : -1))
    .filter((i) => i > 0 && i < raw.length - 1);
  const pads = board.components
    .flatMap((c) => c.pads)
    .filter((p) => p.net !== route.id);
  const others = board.routes.filter((r) => r.id !== route.id);
  const segments = others.flatMap(routeSegments);
  const vias = others.flatMap((r) => r.vias ?? []);
  const margin = route.width / 2 + board.clearance;
  const output: Point[] = [raw[0]];
  let start = 0,
    layer = route.layer;
  const clear = (a: Point, b: Point) => {
    if (
      [a, b].some(
        (p) =>
          p.x < margin ||
          p.y < margin ||
          p.x > board.width - margin ||
          p.y > board.height - margin,
      )
    )
      return false;
    if (pads.some((p) => pointSegment(p, a, b) < margin + p.radius - 1e-7))
      return false;
    if (
      board.walls.some(
        (w) =>
          w.layers.includes(layer) && rectDistance(a, b, w) < margin - 1e-7,
      )
    )
      return false;
    if (vias.some((v) => pointSegment(v, a, b) < margin + v.radius - 1e-7))
      return false;
    return !segments.some(
      (s) =>
        s.layer === layer &&
        segmentDistance(a, b, s.a, s.b) <
          (route.width + s.width) / 2 + board.clearance - 1e-7,
    );
  };
  for (const end of [...cuts, raw.length - 1]) {
    while (start < end) {
      let chosen: Point[] | undefined,
        last = start;
      for (let next = end; next > start; next--) {
        for (const diagonal of [false, true]) {
          const path = octilinearConnect(raw[start], raw[next], diagonal);
          if (path.slice(1).every((p, i) => clear(path[i], p))) {
            chosen = path;
            last = next;
            break;
          }
        }
        if (chosen) break;
      }
      if (!chosen) return null;
      output.push(...chosen.slice(1));
      start = last;
    }
    const via = route.vias?.find(
      (v) => v.x === raw[end].x && v.y === raw[end].y,
    );
    if (via) layer = via.toLayer;
  }
  const candidate = { ...route, points: output };
  if (
    validate(
      {
        ...board,
        routes: board.routes.map((r) => (r.id === route.id ? candidate : r)),
      },
      route.id,
    ).violations.length
  )
    return null;
  return output;
}
