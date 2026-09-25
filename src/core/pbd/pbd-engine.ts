import type { Point, Project, Rect, Route, Via } from "../model";
import { routeSegments, validate } from "../geometry";

export type MutationDecision = {
  tick: number;
  operation: string;
  routeIds: string[];
  accepted: boolean;
  reasons: string[];
};

export interface PbdNode {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  invMass: number; // 0 for fixed anchors, 1 for movable
  layer: number;
  netId: string;
}

export interface PbdRoute {
  id: string;
  terminals: [string, string];
  layer: number;
  width: number;
  nodes: PbdNode[];
  vias: Via[];
  pressure: number;
  disabledCollisionUntilTick?: number;
}

export interface ObstacleCircle {
  x: number;
  y: number;
  radius: number;
  netId: string | null;
  layer?: number; // undefined means all layers
}

export interface ObstacleBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  layers: number[];
}

export interface CrossingRecord {
  netA: string;
  netB: string;
  point: Point;
  layer: number;
  normal: Point;
}

/** Closest points on finite segments, including interior intersections and collinear contact. */
export function segmentContact(a: Point, b: Point, c: Point, d: Point) {
  const hit = segmentsIntersect(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y);
  if (hit.hit) {
    const pa = pointToSegmentDist(hit.x, hit.y, a.x, a.y, b.x, b.y);
    const pb = pointToSegmentDist(hit.x, hit.y, c.x, c.y, d.x, d.y);
    return {
      distance: 0,
      s: pa.t,
      t: pb.t,
      ax: hit.x,
      ay: hit.y,
      bx: hit.x,
      by: hit.y,
    };
  }
  const candidates = [a, b].map((p, i) => {
    const q = pointToSegmentDist(p.x, p.y, c.x, c.y, d.x, d.y);
    return {
      distance: q.dist,
      s: i,
      t: q.t,
      ax: p.x,
      ay: p.y,
      bx: q.closestX,
      by: q.closestY,
    };
  });
  candidates.push(
    ...[c, d].map((p, i) => {
      const q = pointToSegmentDist(p.x, p.y, a.x, a.y, b.x, b.y);
      return {
        distance: q.dist,
        s: q.t,
        t: i,
        ax: q.closestX,
        ay: q.closestY,
        bx: p.x,
        by: p.y,
      };
    }),
  );
  return candidates.reduce((a, b) => (a.distance <= b.distance ? a : b));
}

/** Distance between two 2D points */
export function pbdDist(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

/** Distance from point (px, py) to line segment (x1, y1)-(x2, y2) */
export function pointToSegmentDist(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { dist: number; closestX: number; closestY: number; t: number } {
  const dx = x2 - x1,
    dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-8) {
    return {
      dist: Math.hypot(px - x1, py - y1),
      closestX: x1,
      closestY: y1,
      t: 0,
    };
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  return {
    dist: Math.hypot(px - closestX, py - closestY),
    closestX,
    closestY,
    t,
  };
}

/** Check if two 2D line segments intersect */
export function segmentsIntersect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number,
): { hit: boolean; x: number; y: number } {
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-7) return { hit: false, x: 0, y: 0 };
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return { hit: true, x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
  }
  return { hit: false, x: 0, y: 0 };
}

/** Check if a line segment intersects or touches an axis-aligned box with margin */
export function segmentIntersectsBox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  margin: number,
): boolean {
  const minX = bx - margin;
  const maxX = bx + bw + margin;
  const minY = by - margin;
  const maxY = by + bh + margin;

  if (x1 >= minX && x1 <= maxX && y1 >= minY && y1 <= maxY) return true;
  if (x2 >= minX && x2 <= maxX && y2 >= minY && y2 <= maxY) return true;

  if (Math.max(x1, x2) < minX || Math.min(x1, x2) > maxX) return false;
  if (Math.max(y1, y2) < minY || Math.min(y1, y2) > maxY) return false;

  if (segmentsIntersect(x1, y1, x2, y2, minX, minY, maxX, minY).hit)
    return true;
  if (segmentsIntersect(x1, y1, x2, y2, maxX, minY, maxX, maxY).hit)
    return true;
  if (segmentsIntersect(x1, y1, x2, y2, maxX, maxY, minX, maxY).hit)
    return true;
  if (segmentsIntersect(x1, y1, x2, y2, minX, maxY, minX, minY).hit)
    return true;

  return false;
}

/**
 * Convert an array of polyline points into a flexible chain of PBD nodes.
 * Automatically interpolates intermediate movable nodes along long spans
 * so that ropes can immediately deform and deflect around obstacles.
 */
export function pointsToPbdNodes(
  points: Point[],
  netId: string,
  layer: number,
  targetSegLen = 2500,
): PbdNode[] {
  if (points.length < 2) return [];
  const nodes: PbdNode[] = [];

  nodes.push({
    x: points[0].x,
    y: points[0].y,
    prevX: points[0].x,
    prevY: points[0].y,
    invMass: 0,
    layer,
    netId,
  });

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const numSubdivisions = Math.max(1, Math.round(dist / targetSegLen));

    for (let k = 1; k <= numSubdivisions; k++) {
      const t = k / numSubdivisions;
      const x = Math.round(a.x + t * (b.x - a.x));
      const y = Math.round(a.y + t * (b.y - a.y));
      const isEndAnchor = i === points.length - 2 && k === numSubdivisions;

      nodes.push({
        x,
        y,
        prevX: x,
        prevY: y,
        invMass: isEndAnchor ? 0 : 1,
        layer,
        netId,
      });
    }
  }

  return nodes;
}

/**
 * Continuous Position-Based Dynamics (PBD) simulation engine for PCB routing ropes.
 */
export class PbdEngine {
  readonly board: Project;
  decisions: MutationDecision[] = [];
  width: number;
  height: number;
  layers: number;
  drcClearance: number;
  octilinearBuffer: number;
  routes: PbdRoute[] = [];
  pads: ObstacleCircle[] = [];
  walls: ObstacleBox[] = [];

  // PBD Tuning Parameters
  targetSegmentLength = 2500;
  minSegmentLength = 1200;
  maxSegmentLength = 4500;
  subIterations = 3;
  tensionAlpha = 0.35; // Laplacian smoothing coefficient

  constructor(project: Project) {
    this.board = structuredClone(project);
    this.width = project.width;
    this.height = project.height;
    this.layers = project.layers;
    this.drcClearance = project.clearance;
    // Extra clearance buffer to guarantee that subsequent 45°/90° quantization never causes shorts
    this.octilinearBuffer = Math.ceil(project.clearance * (Math.SQRT2 - 1));

    this.extractObstacles(project);
    this.initializeRoutes(project);
  }

  private extractObstacles(project: Project) {
    this.pads = [];
    for (const c of project.components) {
      for (const pad of c.pads) {
        this.pads.push({
          x: pad.x,
          y: pad.y,
          radius: pad.radius,
          netId: pad.net,
        });
      }
    }
    this.walls = project.walls.map((w) => ({
      id: w.id,
      x: w.x,
      y: w.y,
      w: w.w,
      h: w.h,
      layers: [...w.layers],
    }));
  }

  private initializeRoutes(project: Project) {
    this.routes = [];
    for (const r of project.routes) {
      const pbdNodes = this.nodesForRoute(r);

      this.routes.push({
        id: r.id,
        terminals: [r.terminals[0], r.terminals[1]],
        layer: r.layer,
        width: r.width,
        nodes: pbdNodes,
        vias: r.vias ? structuredClone(r.vias) : [],
        pressure: 0,
      });
    }
  }

  nodesForRoute(route: Route): PbdNode[] {
    const nodes: PbdNode[] = [];
    for (const seg of routeSegments(route)) {
      const part = pointsToPbdNodes(
        [seg.a, seg.b],
        route.id,
        seg.layer,
        this.targetSegmentLength,
      );
      if (nodes.length) nodes.pop();
      nodes.push(...part);
    }
    nodes.forEach((node, i) => {
      node.invMass =
        i === 0 ||
        i === nodes.length - 1 ||
        route.vias?.some((v) => v.x === node.x && v.y === node.y)
          ? 0
          : 1;
    });
    return nodes;
  }

  getProject(tick = this.board.tick): Project {
    return { ...this.board, tick, routes: this.toRoutes() };
  }

  record(decision: MutationDecision) {
    this.decisions.push(decision);
    this.decisions = this.decisions.slice(-200);
  }

  /** Topology mutations are proposals. Only a full-board checked route is installed. */
  tryReplaceRoute(candidate: Route, tick: number, operation: string): boolean {
    return this.tryReplaceRoutes([candidate], tick, operation);
  }

  /** Atomic conflict-group replacement. No candidate or participant is committed alone. */
  tryReplaceRoutes(
    candidates: Route[],
    tick: number,
    operation: string,
  ): boolean {
    const ids = new Set(candidates.map((r) => r.id));
    const reasons: string[] = [];
    const project = this.getProject(tick);
    if (!candidates.length || ids.size !== candidates.length) return false;
    for (const candidate of candidates) {
      const index = project.routes.findIndex((r) => r.id === candidate.id);
      if (index < 0) return false;
      const before = project.routes[index];
      if (
        candidate.points.length < 2 ||
        candidate.points.some(
          (p) => !Number.isFinite(p.x) || !Number.isFinite(p.y),
        )
      )
        return false;
      if (
        candidate.width !== before.width ||
        JSON.stringify(candidate.terminals) !== JSON.stringify(before.terminals)
      )
        reasons.push("Route ownership or width changed");
      if (
        JSON.stringify(candidate.points[0]) !==
          JSON.stringify(before.points[0]) ||
        JSON.stringify(candidate.points.at(-1)) !==
          JSON.stringify(before.points.at(-1))
      )
        reasons.push("Fixed anchors changed");
      project.routes[index] = candidate;
    }
    reasons.push(
      ...validate(project, undefined, true)
        .violations.filter((v) => v.objects.some((id) => ids.has(id)))
        .map((v) => v.message),
    );
    this.record({
      tick,
      operation,
      routeIds: [...ids],
      accepted: !reasons.length,
      reasons,
    });
    if (reasons.length) return false;
    for (const candidate of candidates) {
      const index = this.routes.findIndex((r) => r.id === candidate.id);
      this.routes[index] = {
        ...this.routes[index],
        layer: candidate.layer,
        nodes: this.nodesForRoute(candidate),
        vias: structuredClone(candidate.vias ?? []),
        pressure: 0,
      };
    }
    return true;
  }

  /** Roll back the whole interacting set until every previously clear route stays clear.
   * Checking only the moved vertices misses middle-of-segment crossings and remesh shortcuts. */
  private preserveClearRoutes(
    before: PbdRoute[],
    clean: Set<string>,
    tick: number,
  ) {
    const restored = new Set<string>();
    const reasons: string[] = [];
    for (let pass = 0; pass <= this.routes.length; pass++) {
      const violations = validate(
        this.getProject(tick),
        undefined,
        true,
      ).violations.filter((v) => v.objects.some((id) => clean.has(id)));
      if (!violations.length) break;
      let changed = false;
      for (const violation of violations) {
        for (const id of violation.objects) {
          const index = this.routes.findIndex((r) => r.id === id);
          if (index < 0 || restored.has(id)) continue;
          this.routes[index] = structuredClone(before[index]);
          restored.add(id);
          reasons.push(violation.message);
          changed = true;
        }
      }
      if (!changed) break;
    }
    if (restored.size)
      this.record({
        tick,
        operation: "physics/remesh",
        routeIds: [...restored],
        accepted: false,
        reasons,
      });
  }

  /**
   * Run one PBD simulation tick consisting of multiple relaxation sub-steps.
   * @param tick Current simulation tick
   * @param warmupTicks Number of ticks over which clearance is gradually annealed
   */
  step(tick: number, warmupTicks = 30, strength = 1): void {
    const before = structuredClone(this.routes);
    const report = validate(this.getProject(tick), undefined, true);
    const invalid = new Set(report.violations.flatMap((v) => v.objects));
    const clean = new Set(
      this.routes.filter((r) => !invalid.has(r.id)).map((r) => r.id),
    );
    // Clearance annealing scale factor (0 -> 1 during warmup)
    const scale =
      warmupTicks > 0 ? Math.min(1, Math.max(0.1, tick / warmupTicks)) : 1;
    const effClearance = (this.drcClearance + this.octilinearBuffer) * scale;

    for (let sub = 0; sub < this.subIterations; sub++) {
      // 1. Distance constraints between adjacent nodes (stiffness)
      this.applyDistanceConstraints();

      // 2. Laplacian tension smoothing (pulls ropes into geodesics)
      this.applyTension(strength);

      // 3. Inter-trace clearance (repulsion between routes on the same layer)
      this.projectInterTraceCollisions(effClearance, tick);

      // 4. Obstacle collisions (pads, walls, board boundaries, vias) - PROJECTED LAST FOR ZERO PENETRATION
      this.projectObstacleCollisions(effClearance);
    }

    // Dynamic remeshing: split stretched segments, collapse bunched nodes
    if (tick % 2 === 0) {
      this.remesh();
    }
    this.preserveClearRoutes(before, clean, tick);
  }

  /**
   * Tension / Rubber-Banding:
   * Interior nodes are pulled toward the midpoint of their neighbors (Laplacian curvature vector).
   */
  private applyTension(strength: number) {
    for (const route of this.routes) {
      const nodes = route.nodes;
      const count = nodes.length;
      if (count < 3) continue;

      for (let i = 1; i < count - 1; i++) {
        const curr = nodes[i];
        if (curr.invMass === 0) continue;
        const prev = nodes[i - 1];
        const next = nodes[i + 1];

        // Midpoint of neighbors
        const midX = (prev.x + next.x) * 0.5;
        const midY = (prev.y + next.y) * 0.5;

        // Laplacian pull
        curr.x += (midX - curr.x) * Math.min(1, this.tensionAlpha * strength);
        curr.y += (midY - curr.y) * Math.min(1, this.tensionAlpha * strength);
      }
    }
  }

  /**
   * Distance constraints:
   * Ensures segments maintain target length and prevents excessive stretching.
   */
  private applyDistanceConstraints() {
    for (const route of this.routes) {
      const nodes = route.nodes;
      for (let i = 0; i < nodes.length - 1; i++) {
        const n1 = nodes[i];
        const n2 = nodes[i + 1];
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1e-4) continue;

        const target = this.targetSegmentLength;
        const delta = dist - target;
        // PBD projection factor
        const totalMass = n1.invMass + n2.invMass;
        if (totalMass === 0) continue;

        const nx = dx / dist;
        const ny = dy / dist;

        // Soft distance constraint (pull if longer than target)
        if (delta > 0) {
          const correction = delta * 0.5;
          if (n1.invMass > 0) {
            n1.x += nx * correction * (n1.invMass / totalMass);
            n1.y += ny * correction * (n1.invMass / totalMass);
          }
          if (n2.invMass > 0) {
            n2.x -= nx * correction * (n2.invMass / totalMass);
            n2.y -= ny * correction * (n2.invMass / totalMass);
          }
        }
      }
    }
  }

  /**
   * Project nodes away from circular pads, rectangular obstacles, and boundaries.
   */
  private projectObstacleCollisions(effClearance: number) {
    const padCount = this.pads.length;

    for (const route of this.routes) {
      const margin = route.width * 0.5 + effClearance;
      const nodes = route.nodes;

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.invMass === 0) continue; // Pinned anchors don't move

        // 1. Board Boundaries
        const bMargin = margin + 100;
        if (node.x < bMargin) node.x = bMargin;
        if (node.y < bMargin) node.y = bMargin;
        if (node.x > this.width - bMargin) node.x = this.width - bMargin;
        if (node.y > this.height - bMargin) node.y = this.height - bMargin;

        // 2. Circular Pads (Foreign pads or unconnected pads)
        for (let pIdx = 0; pIdx < padCount; pIdx++) {
          const pad = this.pads[pIdx];
          // Allow connection to own terminals
          if (pad.netId === route.id) {
            continue;
          }

          const reqDist = pad.radius + margin;
          // Quick AABB rejection
          if (
            Math.abs(node.x - pad.x) > reqDist ||
            Math.abs(node.y - pad.y) > reqDist
          ) {
            continue;
          }

          const dx = node.x - pad.x;
          const dy = node.y - pad.y;
          const distSq = dx * dx + dy * dy;

          if (distSq < reqDist * reqDist) {
            const dist = Math.sqrt(distSq);
            const push = reqDist - (dist > 1e-4 ? dist : 0.001);
            const nx = dist > 1e-4 ? dx / dist : 1;
            const ny = dist > 1e-4 ? dy / dist : 0;

            node.x += nx * push;
            node.y += ny * push;
          }
        }

        // 3. Rectangular Walls on this layer
        for (const wall of this.walls) {
          if (!wall.layers.includes(node.layer)) continue;

          // Closest point on rectangle
          const cx = Math.max(wall.x, Math.min(node.x, wall.x + wall.w));
          const cy = Math.max(wall.y, Math.min(node.y, wall.y + wall.h));
          const dx = node.x - cx;
          const dy = node.y - cy;
          const dist = Math.hypot(dx, dy);

          if (dist < margin) {
            if (dist > 1e-4) {
              const push = margin - dist;
              node.x += (dx / dist) * push;
              node.y += (dy / dist) * push;
            } else {
              // Inside rectangle: project to nearest edge with clamped displacement
              const left = node.x - wall.x;
              const right = wall.x + wall.w - node.x;
              const top = node.y - wall.y;
              const bottom = wall.y + wall.h - node.y;
              const minEdge = Math.min(left, right, top, bottom);
              const maxPush = 600;

              if (minEdge === left) {
                const targetX = wall.x - margin;
                node.x +=
                  Math.sign(targetX - node.x) *
                  Math.min(maxPush, Math.abs(targetX - node.x));
              } else if (minEdge === right) {
                const targetX = wall.x + wall.w + margin;
                node.x +=
                  Math.sign(targetX - node.x) *
                  Math.min(maxPush, Math.abs(targetX - node.x));
              } else if (minEdge === top) {
                const targetY = wall.y - margin;
                node.y +=
                  Math.sign(targetY - node.y) *
                  Math.min(maxPush, Math.abs(targetY - node.y));
              } else {
                const targetY = wall.y + wall.h + margin;
                node.y +=
                  Math.sign(targetY - node.y) *
                  Math.min(maxPush, Math.abs(targetY - node.y));
              }
            }
          }
        }

        // 4. Vias of other routes
        for (const otherRoute of this.routes) {
          if (otherRoute.id === route.id) continue;
          for (const via of otherRoute.vias) {
            const minL = 0;
            const maxL = this.layers - 1;
            if (node.layer >= minL && node.layer <= maxL) {
              const vMargin = via.radius + margin;
              if (
                Math.abs(node.x - via.x) > vMargin ||
                Math.abs(node.y - via.y) > vMargin
              ) {
                continue;
              }
              const dx = node.x - via.x;
              const dy = node.y - via.y;
              const dist = Math.hypot(dx, dy);
              if (dist < vMargin) {
                const push = vMargin - (dist > 1e-4 ? dist : 0.001);
                const nx = dist > 1e-4 ? dx / dist : 1;
                const ny = dist > 1e-4 ? dy / dist : 0;
                node.x += nx * push;
                node.y += ny * push;
              }
            }
          }
        }
      }

      // Check segments penetrating obstacles (pads and walls)
      for (let sIdx = 0; sIdx < nodes.length - 1; sIdx++) {
        const n1 = nodes[sIdx];
        const n2 = nodes[sIdx + 1];
        const minX = Math.min(n1.x, n2.x);
        const maxX = Math.max(n1.x, n2.x);
        const minY = Math.min(n1.y, n2.y);
        const maxY = Math.max(n1.y, n2.y);

        // 1. Circular pads segment penetration
        for (let pIdx = 0; pIdx < padCount; pIdx++) {
          const pad = this.pads[pIdx];
          if (pad.netId === route.id) continue;
          const reqDist = pad.radius + margin;

          if (
            maxX < pad.x - reqDist ||
            minX > pad.x + reqDist ||
            maxY < pad.y - reqDist ||
            minY > pad.y + reqDist
          ) {
            continue;
          }

          const pDist = pointToSegmentDist(
            pad.x,
            pad.y,
            n1.x,
            n1.y,
            n2.x,
            n2.y,
          );
          if (pDist.dist < reqDist) {
            const push = reqDist - (pDist.dist > 1e-4 ? pDist.dist : 0.001);
            const dx = pDist.closestX - pad.x;
            const dy = pDist.closestY - pad.y;
            const nx = pDist.dist > 1e-4 ? dx / pDist.dist : 1;
            const ny = pDist.dist > 1e-4 ? dy / pDist.dist : 0;

            const t = pDist.t;
            const w1 = n1.invMass;
            const w2 = n2.invMass;
            const denom = w1 * (1 - t) * (1 - t) + w2 * t * t;
            if (denom > 1e-6) {
              const lambda = push / denom;
              if (w1 > 0) {
                n1.x += nx * lambda * w1 * (1 - t);
                n1.y += ny * lambda * w1 * (1 - t);
              }
              if (w2 > 0) {
                n2.x += nx * lambda * w2 * t;
                n2.y += ny * lambda * w2 * t;
              }
            }
            route.pressure += push;
          }
        }

        // 2. Rectangular walls segment penetration
        for (const wall of this.walls) {
          if (!wall.layers.includes(n1.layer)) continue;
          if (
            segmentIntersectsBox(
              n1.x,
              n1.y,
              n2.x,
              n2.y,
              wall.x,
              wall.y,
              wall.w,
              wall.h,
              margin,
            )
          ) {
            const wallMidY = wall.y + wall.h * 0.5;
            const wallMidX = wall.x + wall.w * 0.5;
            const segMidY = (n1.y + n2.y) * 0.5;
            const segMidX = (n1.x + n2.x) * 0.5;

            const dNorth = Math.abs(segMidY - (wall.y - margin));
            const dSouth = Math.abs(segMidY - (wall.y + wall.h + margin));
            const dWest = Math.abs(segMidX - (wall.x - margin));
            const dEast = Math.abs(segMidX - (wall.x + wall.w + margin));
            const minD = Math.min(dNorth, dSouth, dWest, dEast);

            const maxPush = 600;
            if (minD === dNorth) {
              const yClear = wall.y - margin - 300;
              if (n1.invMass > 0) {
                n1.y +=
                  Math.sign(yClear - n1.y) *
                  Math.min(maxPush, Math.abs(yClear - n1.y) * 0.4);
              }
              if (n2.invMass > 0) {
                n2.y +=
                  Math.sign(yClear - n2.y) *
                  Math.min(maxPush, Math.abs(yClear - n2.y) * 0.4);
              }
            } else if (minD === dSouth) {
              const yClear = wall.y + wall.h + margin + 300;
              if (n1.invMass > 0) {
                n1.y +=
                  Math.sign(yClear - n1.y) *
                  Math.min(maxPush, Math.abs(yClear - n1.y) * 0.4);
              }
              if (n2.invMass > 0) {
                n2.y +=
                  Math.sign(yClear - n2.y) *
                  Math.min(maxPush, Math.abs(yClear - n2.y) * 0.4);
              }
            } else if (minD === dWest) {
              const xClear = wall.x - margin - 300;
              if (n1.invMass > 0) {
                n1.x +=
                  Math.sign(xClear - n1.x) *
                  Math.min(maxPush, Math.abs(xClear - n1.x) * 0.4);
              }
              if (n2.invMass > 0) {
                n2.x +=
                  Math.sign(xClear - n2.x) *
                  Math.min(maxPush, Math.abs(xClear - n2.x) * 0.4);
              }
            } else {
              const xClear = wall.x + wall.w + margin + 300;
              if (n1.invMass > 0) {
                n1.x +=
                  Math.sign(xClear - n1.x) *
                  Math.min(maxPush, Math.abs(xClear - n1.x) * 0.4);
              }
              if (n2.invMass > 0) {
                n2.x +=
                  Math.sign(xClear - n2.x) *
                  Math.min(maxPush, Math.abs(xClear - n2.x) * 0.4);
              }
            }
            route.pressure += 500;
          }
        }
      }
    }
  }

  /**
   * Finite-width segment-to-segment contact projection between routes on the same layer.
   */
  private projectInterTraceCollisions(clearance: number, _tick: number) {
    for (let i = 0; i < this.routes.length; i++) {
      const a = this.routes[i];
      for (let j = i + 1; j < this.routes.length; j++) {
        const b = this.routes[j];
        const required = (a.width + b.width) / 2 + clearance;
        for (let ai = 0; ai < a.nodes.length - 1; ai++) {
          const a0 = a.nodes[ai],
            a1 = a.nodes[ai + 1];
          for (let bi = 0; bi < b.nodes.length - 1; bi++) {
            const b0 = b.nodes[bi],
              b1 = b.nodes[bi + 1];
            if (a0.layer !== b0.layer) continue;
            if (
              Math.max(a0.x, a1.x) + required < Math.min(b0.x, b1.x) ||
              Math.max(b0.x, b1.x) + required < Math.min(a0.x, a1.x) ||
              Math.max(a0.y, a1.y) + required < Math.min(b0.y, b1.y) ||
              Math.max(b0.y, b1.y) + required < Math.min(a0.y, a1.y)
            )
              continue;
            const contact = segmentContact(a0, a1, b0, b1);
            if (contact.distance >= required) continue;
            const weights = [
              1 - contact.s,
              contact.s,
              1 - contact.t,
              contact.t,
            ];
            const nodes = [a0, a1, b0, b1];
            const denominator = nodes.reduce(
              (sum, n, k) => sum + n.invMass * weights[k] ** 2,
              0,
            );
            const push = required - contact.distance;
            a.pressure += push;
            b.pressure += push;
            if (denominator < 1e-8) continue;
            let nx = contact.ax - contact.bx,
              ny = contact.ay - contact.by;
            if (contact.distance > 1e-7) {
              nx /= contact.distance;
              ny /= contact.distance;
            } else {
              // A true interior crossing requires a topology change. A stable normal
              // supplies contact pressure without depending on node sampling density.
              const length = Math.hypot(b1.x - b0.x, b1.y - b0.y) || 1;
              nx = -(b1.y - b0.y) / length;
              ny = (b1.x - b0.x) / length;
            }
            nodes.forEach((n, k) => {
              const delta =
                (push / denominator) *
                n.invMass *
                weights[k] *
                (k < 2 ? 1 : -1);
              n.x += nx * delta;
              n.y += ny * delta;
            });
          }
        }
      }
    }
  }

  /**
   * Dynamic Remeshing:
   * Subdivides long segments and collapses short ones, while inserting waypoints around obstacles.
   */
  remesh(): void {
    for (const route of this.routes) {
      const output: PbdNode[] = [route.nodes[0]];
      for (let i = 1; i < route.nodes.length; i++) {
        const node = route.nodes[i];
        const previous = output.at(-1)!;
        const next = route.nodes[i + 1];
        if (
          next &&
          node.invMass !== 0 &&
          previous.layer === node.layer &&
          node.layer === next.layer
        ) {
          const chord = pointToSegmentDist(
            node.x,
            node.y,
            previous.x,
            previous.y,
            next.x,
            next.y,
          );
          // A remesh is a representation change, never an unvalidated obstacle detour.
          // Preserve bends and mandatory vias; only collapse points on the exact chord.
          if (
            chord.dist < 1e-7 &&
            Math.hypot(node.x - previous.x, node.y - previous.y) <
              this.minSegmentLength
          )
            continue;
        }
        const length = Math.hypot(node.x - previous.x, node.y - previous.y);
        const remainingOriginal = route.nodes.length - i;
        const parts = Math.max(
          1,
          Math.min(
            Math.ceil(length / this.maxSegmentLength),
            512 - output.length - remainingOriginal + 1,
          ),
        );
        for (let k = 1; k < parts; k++) {
          const t = k / parts;
          const x = previous.x + (node.x - previous.x) * t;
          const y = previous.y + (node.y - previous.y) * t;
          output.push({
            x,
            y,
            prevX: x,
            prevY: y,
            invMass: 1,
            layer: previous.layer,
            netId: route.id,
          });
        }
        output.push(node);
      }
      route.nodes = output;
    }
  }

  /**
   * Find any segment-to-segment crossings between different routes on the same layer.
   */
  getCrossings(): CrossingRecord[] {
    const crossings: CrossingRecord[] = [];

    for (let i = 0; i < this.routes.length; i++) {
      const rA = this.routes[i];
      for (let j = i + 1; j < this.routes.length; j++) {
        const rB = this.routes[j];

        for (let aIdx = 0; aIdx < rA.nodes.length - 1; aIdx++) {
          const a1 = rA.nodes[aIdx];
          const a2 = rA.nodes[aIdx + 1];

          for (let bIdx = 0; bIdx < rB.nodes.length - 1; bIdx++) {
            const b1 = rB.nodes[bIdx];
            const b2 = rB.nodes[bIdx + 1];
            if (a1.layer !== b1.layer) continue;

            const isect = segmentsIntersect(
              a1.x,
              a1.y,
              a2.x,
              a2.y,
              b1.x,
              b1.y,
              b2.x,
              b2.y,
            );

            if (isect.hit) {
              const dx = b2.x - b1.x;
              const dy = b2.y - b1.y;
              const len = Math.hypot(dx, dy);
              const normal =
                len > 1e-4 ? { x: -dy / len, y: dx / len } : { x: 0, y: 1 };

              crossings.push({
                netA: rA.id,
                netB: rB.id,
                point: { x: Math.round(isect.x), y: Math.round(isect.y) },
                layer: a1.layer,
                normal,
              });
            }
          }
        }
      }
    }

    return crossings;
  }

  /**
   * Export the current continuous PBD ropes back into Route objects.
   */
  toRoutes(): Route[] {
    return this.routes.map((r) => {
      const points: Point[] = r.nodes.map((n) => ({
        x: Math.round(n.x),
        y: Math.round(n.y),
      }));

      return {
        id: r.id,
        terminals: [r.terminals[0], r.terminals[1]],
        layer: r.layer,
        width: r.width,
        points,
        control: points[Math.floor(points.length / 2)],
        pressure: Math.round(r.pressure),
        vias: r.vias.length > 0 ? structuredClone(r.vias) : undefined,
      };
    });
  }
}
