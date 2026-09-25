import type { Point, Rect, Route, Project, Report, Violation } from "./model";
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);
export const equal = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export function pointSegment(p: Point, a: Point, b: Point) {
  return distance(p, closestPoint(p, a, b));
}
export function closestPoint(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    d = dx * dx + dy * dy;
  const t = d
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d))
    : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}
export function contactPoint(a: Point, b: Point, c: Point, d: Point): Point {
  const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (denominator !== 0) {
    const t =
      ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator;
    const u =
      ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1)
      return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  }
  const pairs = [
    [a, closestPoint(a, c, d)],
    [b, closestPoint(b, c, d)],
    [closestPoint(c, a, b), c],
    [closestPoint(d, a, b), d],
  ];
  pairs.sort((x, y) => distance(x[0], x[1]) - distance(y[0], y[1]));
  return {
    x: (pairs[0][0].x + pairs[0][1].x) / 2,
    y: (pairs[0][0].y + pairs[0][1].y) / 2,
  };
}
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  const ab1 = cross(a, b, c),
    ab2 = cross(a, b, d),
    cd1 = cross(c, d, a),
    cd2 = cross(c, d, b);
  if (
    ((ab1 > 0 && ab2 < 0) || (ab1 < 0 && ab2 > 0)) &&
    ((cd1 > 0 && cd2 < 0) || (cd1 < 0 && cd2 > 0))
  )
    return 0;
  return Math.min(
    pointSegment(a, c, d),
    pointSegment(b, c, d),
    pointSegment(c, a, b),
    pointSegment(d, a, b),
  );
}
export function rectDistance(a: Point, b: Point, r: Rect) {
  const inside = (p: Point) =>
    p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  if (inside(a) || inside(b)) return 0;
  const corners = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  return Math.min(
    ...corners.map((p, i) => segmentDistance(a, b, p, corners[(i + 1) % 4])),
  );
}
export function connector(a: Point, b: Point, reverse = false): Point[] {
  if (reverse) return connector(b, a).reverse();
  const dx = b.x - a.x,
    dy = b.y - a.y,
    n = Math.min(Math.abs(dx), Math.abs(dy));
  const mid = { x: a.x + Math.sign(dx) * n, y: a.y + Math.sign(dy) * n };
  return [a, mid, b]
    .filter((p, i, arr) => i === 0 || !equal(p, arr[i - 1]))
    .map((p) => ({ x: p.x, y: p.y }));
}
export function rope(a: Point, b: Point, control: Point) {
  return [...connector(a, control), ...connector(control, b).slice(1)];
}
export function simplify(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const p of points) {
    if (result.length && equal(result.at(-1)!, p)) continue;
    result.push({ x: p.x, y: p.y });
    while (result.length >= 3) {
      const [a, b, c] = result.slice(-3);
      if (cross(a, b, c) !== 0) break;
      result.splice(result.length - 2, 1);
    }
  }
  return result;
}
export function connectWaypoints(points: Point[], reverse = false): Point[] {
  return simplify(
    points.slice(1).flatMap((p, i) => connector(points[i], p, reverse)),
  );
}
export const segments = (r: Route) =>
  r.points.slice(1).map((b, i) => [r.points[i], b] as const);
export const routeLength = (r: Route) =>
  segments(r).reduce((n, [a, b]) => n + distance(a, b), 0);

/** A negative direction dot product is a reversal of more than 90 degrees,
 * i.e. an acute inside corner, even though both segments are octilinear. */
export function acuteCorner(a: Point, b: Point, c: Point): boolean {
  return (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0;
}

export type CornerEdit = { points: Point[]; sweep: [Point, Point, Point] };
export function cornerEdits(points: Point[], step: number): CornerEdit[] {
  const edits: CornerEdit[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1],
      b = points[i],
      c = points[i + 1];
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (dot > 0 || equal(a, b) || equal(b, c)) continue;
    const available = Math.min(
      Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)),
      Math.max(Math.abs(c.x - b.x), Math.abs(c.y - b.y)),
    );
    // Try a bounded contraction, then smaller ones near obstacles. All eight
    // heading combinations retain exact H/V/45 geometry on the integer lattice.
    const sizes = [
      ...new Set([
        Math.min(available, step * 2),
        Math.min(available, step),
        Math.min(available, Math.max(1, Math.floor(step / 4))),
        1,
      ]),
    ];
    for (const size of sizes) {
      if (size <= 0) continue;
      const u = {
        x: b.x + Math.sign(a.x - b.x) * size,
        y: b.y + Math.sign(a.y - b.y) * size,
      };
      const v = {
        x: b.x + Math.sign(c.x - b.x) * size,
        y: b.y + Math.sign(c.y - b.y) * size,
      };
      edits.push({
        points: simplify([...points.slice(0, i), u, v, ...points.slice(i + 1)]),
        sweep: [u, b, v],
      });
    }
  }
  return edits;
}

/** Exact swept triangle checks for local corner cuts, including obstacles
 * entirely inside the patch (not just along the final replacement segment). */
export function cornerSweepClear(
  p: Project,
  r: Route,
  triangle: [Point, Point, Point],
): boolean {
  const [a, b, c] = triangle;
  if (cross(a, b, c) === 0) return true; // Collinear retracing removes no area.
  const inside = (v: Point) => {
    const signs = [cross(a, b, v), cross(b, c, v), cross(c, a, v)];
    return signs.every((n) => n >= 0) || signs.every((n) => n <= 0);
  };
  const edges = [
    [a, b],
    [b, c],
    [c, a],
  ] as const;
  const margin = p.clearance + r.width / 2;
  for (const pad of p.components.flatMap((c) => c.pads))
    if (
      pad.net !== r.id &&
      (inside(pad) ||
        edges.some(
          ([u, v]) => pointSegment(pad, u, v) < margin + pad.radius - 1e-7,
        ))
    )
      return false;
  for (const other of p.routes)
    if (other.id !== r.id && other.layer === r.layer)
      for (const [u, v] of segments(other)) {
        if (
          inside(u) ||
          inside(v) ||
          edges.some(
            ([w, z]) =>
              segmentDistance(u, v, w, z) < margin + other.width / 2 - 1e-7,
          )
        )
          return false;
      }
  for (const wall of p.walls)
    if (wall.layers.includes(r.layer)) {
      const corners = [
        { x: wall.x, y: wall.y },
        { x: wall.x + wall.w, y: wall.y },
        { x: wall.x + wall.w, y: wall.y + wall.h },
        { x: wall.x, y: wall.y + wall.h },
      ];
      if (
        corners.some(inside) ||
        edges.some(([u, v]) => rectDistance(u, v, wall) < margin - 1e-7)
      )
        return false;
    }
  return true;
}

/** Conservative swept hull for discrete local shortcuts. Checking the entire
 * hull prevents a cleanup from tunneling across an island between both paths. */
export function shortcutSweepClear(
  p: Project,
  r: Route,
  points: Point[],
): boolean {
  const sorted = [
    ...new Map(points.map((v) => [`${v.x},${v.y}`, v])).values(),
  ].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return true;
  const half = (input: Point[]) => {
    const result: Point[] = [];
    for (const v of input) {
      while (
        result.length >= 2 &&
        cross(result.at(-2)!, result.at(-1)!, v) <= 0
      )
        result.pop();
      result.push(v);
    }
    return result;
  };
  const hull = [
    ...half(sorted).slice(0, -1),
    ...half([...sorted].reverse()).slice(0, -1),
  ];
  for (let i = 1; i < hull.length - 1; i++)
    if (!cornerSweepClear(p, r, [hull[0], hull[i], hull[i + 1]])) return false;
  return true;
}

export function localShortcuts(
  points: Point[],
): { points: Point[]; sweep: Point[] }[] {
  const candidates: { points: Point[]; sweep: Point[] }[] = [];
  for (const span of [2, 3])
    for (let i = 0; i + span < points.length; i++)
      for (const reverse of [false, true]) {
        const replacement = connector(points[i], points[i + span], reverse);
        candidates.push({
          points: simplify([
            ...points.slice(0, i),
            ...replacement,
            ...points.slice(i + span + 1),
          ]),
          sweep: [...points.slice(i, i + span + 1), ...replacement],
        });
      }
  return candidates;
}

/** Slide an interior H/V/45 segment under tension, preserving both neighboring
 * headings. Displacement is bounded; anchors never move. No route replacement. */
export function segmentSlides(
  points: Point[],
  maxMove: number,
): { points: Point[]; sweep: Point[] }[] {
  const edits: { points: Point[]; sweep: Point[] }[] = [];
  const direction = (a: Point, b: Point) => ({
    x: Math.sign(b.x - a.x),
    y: Math.sign(b.y - a.y),
  });
  const intersect = (a: Point, d: Point, b: Point, e: Point): Point | null => {
    const det = d.x * e.y - d.y * e.x;
    if (!det) return null;
    const t = ((b.x - a.x) * e.y - (b.y - a.y) * e.x) / det;
    const v = { x: a.x + t * d.x, y: a.y + t * d.y };
    return Number.isSafeInteger(v.x) && Number.isSafeInteger(v.y) ? v : null;
  };
  const step = Math.max(2, Math.floor(maxMove / 6) * 2);
  for (let i = 1; i + 2 < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      c = points[i + 1],
      d = points[i + 2];
    const before = direction(a, b),
      middle = direction(b, c),
      after = direction(c, d);
    for (const sign of [-1, 1]) {
      const shifted = {
        x: b.x - middle.y * step * sign,
        y: b.y + middle.x * step * sign,
      };
      const u = intersect(a, before, shifted, middle),
        v = intersect(d, after, shifted, middle);
      if (!u || !v || distance(u, b) > maxMove || distance(v, c) > maxMove)
        continue;
      // A segment may collapse, but never flip back over a neighbor.
      if (
        (u.x - a.x) * before.x + (u.y - a.y) * before.y < 0 ||
        (v.x - u.x) * middle.x + (v.y - u.y) * middle.y < 0 ||
        (d.x - v.x) * after.x + (d.y - v.y) * after.y < 0
      )
        continue;
      edits.push({
        points: simplify([...points.slice(0, i), u, v, ...points.slice(i + 2)]),
        sweep: [b, c, u, v],
      });
    }
  }
  return edits;
}

/** Shift interior H/V/45 segments by an exact distance step along their normals, preserving octilinearity. */
export function segmentShift(
  points: Point[],
  step: number,
): { points: Point[]; sweep: Point[] }[] {
  const edits: { points: Point[]; sweep: Point[] }[] = [];
  const direction = (a: Point, b: Point) => ({
    x: Math.sign(b.x - a.x),
    y: Math.sign(b.y - a.y),
  });
  const intersect = (a: Point, d: Point, b: Point, e: Point): Point | null => {
    const det = d.x * e.y - d.y * e.x;
    if (!det) return null;
    const t = ((b.x - a.x) * e.y - (b.y - a.y) * e.x) / det;
    const v = { x: Math.round(a.x + t * d.x), y: Math.round(a.y + t * d.y) };
    return Number.isSafeInteger(v.x) && Number.isSafeInteger(v.y) ? v : null;
  };
  for (let i = 1; i + 2 < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      c = points[i + 1],
      d = points[i + 2];
    const before = direction(a, b),
      middle = direction(b, c),
      after = direction(c, d);
    for (const sign of [-1, 1]) {
      const shifted = {
        x: b.x - middle.y * step * sign,
        y: b.y + middle.x * step * sign,
      };
      const u = intersect(a, before, shifted, middle),
        v = intersect(d, after, shifted, middle);
      if (!u || !v) continue;
      if (
        (u.x - a.x) * before.x + (u.y - a.y) * before.y < 0 ||
        (v.x - u.x) * middle.x + (v.y - u.y) * middle.y < 0 ||
        (d.x - v.x) * after.x + (d.y - v.y) * after.y < 0
      )
        continue;
      edits.push({
        points: simplify([...points.slice(0, i), u, v, ...points.slice(i + 2)]),
        sweep: [b, c, u, v],
      });
    }
  }
  return edits;
}
export type RouteSegment = {
  a: Point;
  b: Point;
  layer: number;
  routeId: string;
  width: number;
};

export function routeSegments(r: Route): RouteSegment[] {
  const result: RouteSegment[] = [];
  let currentLayer = r.layer;
  for (let i = 0; i < r.points.length - 1; i++) {
    const a = r.points[i];
    const b = r.points[i + 1];
    const via = r.vias?.find((v) => equal(v, a));
    if (via) {
      currentLayer = via.toLayer;
    }
    result.push({
      a,
      b,
      layer: currentLayer,
      routeId: r.id,
      width: r.width,
    });
  }
  return result;
}

export function validate(
  p: Project,
  onlyRoute?: string,
  allowFreeAngle = false,
): Report {
  const violations: Violation[] = [],
    pads = p.components.flatMap((c) => c.pads);
  const segmentCache = new Map(p.routes.map((r) => [r.id, routeSegments(r)]));
  let connected = 0;
  const add = (
    kind: Violation["kind"],
    objects: string[],
    point: Point,
    message: string,
    layer?: number,
    shortfall?: number,
  ) => {
    // One diagnostic per object pair/rule, regardless of bend subdivision.
    if (
      violations.some(
        (v) => v.kind === kind && v.objects.join("|") === objects.join("|"),
      )
    )
      return;
    const route = p.routes.find((r) => r.id === objects[0]);
    violations.push({
      kind,
      objects,
      point,
      message,
      layer: layer !== undefined ? layer : route ? route.layer : undefined,
      shortfall:
        shortfall !== undefined ? Math.max(1, Math.round(shortfall)) : 1000,
    });
  };
  for (const r of p.routes) {
    if (onlyRoute && r.id !== onlyRoute) continue;
    const ends = r.terminals.map((id) => pads.find((a) => a.id === id));
    if (
      ends[0] &&
      ends[1] &&
      equal(ends[0], r.points[0]) &&
      equal(ends[1], r.points.at(-1)!)
    )
      connected++;
    else
      add(
        "anchor",
        [r.id],
        r.points[0],
        "Route does not meet both fixed terminal centers.",
      );
    const rSegs = segmentCache.get(r.id)!;
    let viaLayer = r.layer;
    if (!Number.isInteger(r.layer) || r.layer < 0 || r.layer >= p.layers)
      add(
        "via",
        [r.id],
        r.points[0],
        "Route layer is outside the board stack.",
      );
    const orderedVias = [...(r.vias ?? [])].sort(
      (a, b) =>
        r.points.findIndex((pt) => equal(pt, a)) -
        r.points.findIndex((pt) => equal(pt, b)),
    );
    const seenViaPoints = new Set<string>();
    for (const via of orderedVias) {
      const key = `${via.x},${via.y}`;
      if (
        !r.points.slice(1, -1).some((pt) => equal(pt, via)) ||
        seenViaPoints.has(key) ||
        via.fromLayer !== viaLayer ||
        via.fromLayer === via.toLayer ||
        !Number.isInteger(via.toLayer) ||
        via.toLayer < 0 ||
        via.toLayer >= p.layers
      ) {
        add(
          "via",
          [r.id],
          via,
          "Via must be a unique interior route vertex with a continuous, in-range layer transition.",
        );
      }
      seenViaPoints.add(key);
      viaLayer = via.toLayer;
    }
    for (const seg of rSegs) {
      const a = seg.a,
        b = seg.b,
        dx = Math.abs(a.x - b.x),
        dy = Math.abs(a.y - b.y),
        margin = r.width / 2 + p.clearance;
      if (!allowFreeAngle && !(dx === 0 || dy === 0 || dx === dy))
        add("angle", [r.id], a, "Segment is not horizontal, vertical, or 45°.");
      if (
        [a, b].some(
          (v) =>
            v.x < margin ||
            v.y < margin ||
            v.x > p.width - margin ||
            v.y > p.height - margin,
        )
      ) {
        const deficit = Math.max(
          ...[a, b].flatMap((v) => [
            margin - v.x,
            margin - v.y,
            v.x - (p.width - margin),
            v.y - (p.height - margin),
          ]),
        );
        add(
          "boundary",
          [r.id],
          a,
          "Trace is too close to the board edge.",
          undefined,
          deficit,
        );
      }
      for (const w of p.walls) {
        if (
          w.layers.includes(seg.layer) &&
          Math.max(a.x, b.x) + margin >= w.x &&
          Math.min(a.x, b.x) - margin <= w.x + w.w &&
          Math.max(a.y, b.y) + margin >= w.y &&
          Math.min(a.y, b.y) - margin <= w.y + w.h
        ) {
          const dist = rectDistance(a, b, w);
          if (dist < margin - 1e-7) {
            add(
              "wall",
              [r.id, w.id],
              closestPoint({ x: w.x + w.w / 2, y: w.y + w.h / 2 }, a, b),
              `${r.id} intersects ${w.id} or its clearance on L${seg.layer + 1}. Required edge clearance: ${(p.clearance / 1000).toFixed(2)} mm.`,
              seg.layer,
              margin - dist,
            );
          }
        }
      }
      for (const pad of pads) {
        if (
          pad.net !== r.id &&
          pad.x >= Math.min(a.x, b.x) - margin - pad.radius &&
          pad.x <= Math.max(a.x, b.x) + margin + pad.radius &&
          pad.y >= Math.min(a.y, b.y) - margin - pad.radius &&
          pad.y <= Math.max(a.y, b.y) + margin + pad.radius
        ) {
          const dist = pointSegment(pad, a, b);
          const req = margin + pad.radius;
          if (dist < req - 1e-7) {
            add(
              "pad",
              [r.id, pad.id],
              pad,
              `${r.id} is too close to pad ${pad.id} on L${seg.layer + 1}. Edge gap: ${((dist - pad.radius - r.width / 2) / 1000).toFixed(2)} mm; required: ${(p.clearance / 1000).toFixed(2)} mm.`,
              seg.layer,
              req - dist,
            );
          }
        }
      }
    }
    for (let i = 0; i < rSegs.length; i++)
      for (let j = i + 2; j < rSegs.length; j++)
        if (
          rSegs[i].layer === rSegs[j].layer &&
          Math.max(rSegs[i].a.x, rSegs[i].b.x) >=
            Math.min(rSegs[j].a.x, rSegs[j].b.x) &&
          Math.max(rSegs[j].a.x, rSegs[j].b.x) >=
            Math.min(rSegs[i].a.x, rSegs[i].b.x) &&
          Math.max(rSegs[i].a.y, rSegs[i].b.y) >=
            Math.min(rSegs[j].a.y, rSegs[j].b.y) &&
          Math.max(rSegs[j].a.y, rSegs[j].b.y) >=
            Math.min(rSegs[i].a.y, rSegs[i].b.y) &&
          segmentDistance(rSegs[i].a, rSegs[i].b, rSegs[j].a, rSegs[j].b) < 1e-7
        )
          add(
            "self",
            [r.id],
            contactPoint(rSegs[i].a, rSegs[i].b, rSegs[j].a, rSegs[j].b),
            `${r.id} folds back across itself on L${rSegs[i].layer + 1}.`,
            rSegs[i].layer,
          );

    // Validate explicit through-vias
    for (const v of r.vias ?? []) {
      const vMargin = v.radius + p.clearance;
      if (equal(v, r.points[0]) || equal(v, r.points.at(-1)!)) {
        add(
          "anchor",
          [r.id],
          v,
          `Through via cannot be placed on terminal anchor of ${r.id}.`,
        );
      }
      if (
        v.x < vMargin ||
        v.y < vMargin ||
        v.x > p.width - vMargin ||
        v.y > p.height - vMargin
      ) {
        add(
          "boundary",
          [r.id],
          v,
          `Through via of ${r.id} violates board boundary.`,
        );
      }
      for (let l = 0; l < p.layers; l++) {
        for (const w of p.walls) {
          if (w.layers.includes(l) && rectDistance(v, v, w) < vMargin - 1e-7) {
            add(
              "wall",
              [r.id, w.id],
              v,
              `Through via of ${r.id} intersects protected copper ${w.id} on L${l + 1}.`,
              l,
            );
          }
        }
        for (const pad of pads) {
          if (
            pad.net !== r.id &&
            distance(v, pad) < v.radius + pad.radius + p.clearance - 1e-7
          ) {
            add(
              "pad",
              [r.id, pad.id],
              v,
              `Through via of ${r.id} is too close to pad ${pad.id} on L${l + 1}.`,
              l,
            );
          }
        }
        for (const other of p.routes) {
          if (other.id === r.id) continue;
          for (const otherSeg of segmentCache.get(other.id)!) {
            if (otherSeg.layer === l) {
              const segMargin = v.radius + otherSeg.width / 2 + p.clearance;
              if (pointSegment(v, otherSeg.a, otherSeg.b) < segMargin - 1e-7) {
                add(
                  "trace",
                  [r.id, other.id],
                  v,
                  `Through via of ${r.id} violates clearance with ${other.id} on L${l + 1}.`,
                  l,
                );
              }
            }
          }
          for (const ov of other.vias ?? []) {
            if (distance(v, ov) < v.radius + ov.radius + p.clearance - 1e-7) {
              add(
                "via",
                [r.id, other.id],
                v,
                `Through via of ${r.id} violates clearance with through via of ${other.id}.`,
              );
            }
          }
        }
      }
    }
  }

  // An affected-route query must also see copper belonging to foreign vias.
  // Those vias are skipped by the per-route loop above but span every layer.
  if (onlyRoute) {
    const target = p.routes.find((r) => r.id === onlyRoute);
    if (target)
      for (const other of p.routes) {
        if (other.id === target.id) continue;
        for (const via of other.vias ?? [])
          for (const seg of segmentCache.get(target.id)!) {
            const required = via.radius + target.width / 2 + p.clearance;
            if (pointSegment(via, seg.a, seg.b) < required - 1e-7)
              add(
                "trace",
                [other.id, target.id],
                via,
                `Through via of ${other.id} violates clearance with ${target.id} on L${seg.layer + 1}.`,
                seg.layer,
              );
          }
      }
  }

  for (let i = 0; i < p.routes.length; i++)
    for (let j = i + 1; j < p.routes.length; j++) {
      const a = p.routes[i],
        b = p.routes[j];
      if (onlyRoute && a.id !== onlyRoute && b.id !== onlyRoute) continue;
      const segsA = segmentCache.get(a.id)!;
      const segsB = segmentCache.get(b.id)!;
      let hit = false;
      for (const sa of segsA)
        for (const sb of segsB)
          if (
            sa.layer === sb.layer &&
            !hit &&
            Math.max(sa.a.x, sa.b.x) +
              (sa.width + sb.width) / 2 +
              p.clearance >=
              Math.min(sb.a.x, sb.b.x) &&
            Math.max(sb.a.x, sb.b.x) +
              (sa.width + sb.width) / 2 +
              p.clearance >=
              Math.min(sa.a.x, sa.b.x) &&
            Math.max(sa.a.y, sa.b.y) +
              (sa.width + sb.width) / 2 +
              p.clearance >=
              Math.min(sb.a.y, sb.b.y) &&
            Math.max(sb.a.y, sb.b.y) +
              (sa.width + sb.width) / 2 +
              p.clearance >=
              Math.min(sa.a.y, sa.b.y)
          ) {
            const dist = segmentDistance(sa.a, sa.b, sb.a, sb.b);
            const req = (sa.width + sb.width) / 2 + p.clearance;
            if (dist < req - 1e-7) {
              add(
                "trace",
                [a.id, b.id],
                contactPoint(sa.a, sa.b, sb.a, sb.b),
                `${a.id} and ${b.id} ${dist < (sa.width + sb.width) / 2 ? "overlap" : "are too close"} on L${sa.layer + 1}. Edge gap: ${((dist - (sa.width + sb.width) / 2) / 1000).toFixed(2)} mm; required: ${(p.clearance / 1000).toFixed(2)} mm.`,
                sa.layer,
                req - dist,
              );
              hit = true;
            }
          }
    }

  // Pads span every layer in the prototype, including unconnected pads.
  for (let i = 0; !onlyRoute && i < pads.length; i++)
    for (let j = i + 1; j < pads.length; j++)
      if (
        (pads[i].net === null || pads[i].net !== pads[j].net) &&
        distance(pads[i], pads[j]) <
          pads[i].radius + pads[j].radius + p.clearance - 1e-7
      )
        add(
          "pad",
          [pads[i].id, pads[j].id],
          pads[i],
          "Foreign pads violate clearance.",
        );
  for (const pad of pads) {
    if (onlyRoute) break;
    const margin = pad.radius + p.clearance;
    if (
      pad.x < margin ||
      pad.y < margin ||
      pad.x > p.width - margin ||
      pad.y > p.height - margin
    )
      add("boundary", [pad.id], pad, "Pad violates board edge clearance.");
    for (const wall of p.walls)
      if (wall.layers.length && rectDistance(pad, pad, wall) < margin - 1e-7)
        add(
          "wall",
          [pad.id, wall.id],
          pad,
          "Through-hole pad intersects protected copper.",
        );
  }

  const occupiedLayers = new Set<number>();
  for (const r of p.routes) {
    for (const seg of segmentCache.get(r.id)!) {
      occupiedLayers.add(seg.layer);
    }
  }

  return {
    violations,
    length: p.routes.reduce((n, r) => n + routeLength(r), 0),
    occupied: occupiedLayers.size,
    connected,
    vias: p.routes.reduce((n, r) => n + (r.vias?.length || 0), 0),
  };
}

/** Quantifies the collision severity and clearance deficit for a route. */
export function routePenetration(
  p: Project,
  routeId: string,
): { count: number; shortfall: number } {
  const viols = validate(p, routeId).violations;
  const shortfall = viols.reduce((sum, v) => sum + (v.shortfall ?? 1000), 0);
  return { count: viols.length, shortfall };
}

/** Computes unit normal direction pointing from segment B away from segment A. */
export function separationDirection(
  segA: { a: Point; b: Point },
  segB: { a: Point; b: Point },
): { x: number; y: number } {
  const dx = segA.b.x - segA.a.x,
    dy = segA.b.y - segA.a.y,
    len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: 1 };
  const nx = -Math.round(dy / len),
    ny = Math.round(dx / len);
  const midA = { x: (segA.a.x + segA.b.x) / 2, y: (segA.a.y + segA.b.y) / 2 };
  const closestOnB = closestPoint(midA, segB.a, segB.b);
  const awayX = midA.x - closestOnB.x,
    awayY = midA.y - closestOnB.y;
  const dot = awayX * nx + awayY * ny;
  return dot >= 0 ? { x: nx, y: ny } : { x: -nx, y: -ny };
}

/** Calculates shortest exit normal to expel a segment out of a wall/keepout. */
export function wallExpulsionDirection(
  seg: { a: Point; b: Point },
  wall: Rect,
  margin: number,
): { x: number; y: number } {
  const mid = { x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 };
  const dNorth = Math.abs(mid.y - (wall.y - margin));
  const dSouth = Math.abs(wall.y + wall.h + margin - mid.y);
  const dWest = Math.abs(mid.x - (wall.x - margin));
  const dEast = Math.abs(wall.x + wall.w + margin - mid.x);
  const minD = Math.min(dNorth, dSouth, dWest, dEast);
  if (minD === dNorth) return { x: 0, y: -1 };
  if (minD === dSouth) return { x: 0, y: 1 };
  if (minD === dWest) return { x: -1, y: 0 };
  return { x: 1, y: 0 };
}
