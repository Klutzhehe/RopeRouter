import { projectSchema, type Point, type Project, type Route } from "./model";
import {
  distance,
  equal,
  routeLength,
  simplify,
  validate,
  routePenetration,
} from "./geometry";
import { BoardSweep, type ConflictOracle } from "./pbd/board-sweep";
import { PbdEngine } from "./pbd/pbd-engine";
import { TopologicalSupervisor } from "./pbd/topological-snap";
import { LayeringManager } from "./pbd/layering";
import { quantizeProject } from "./pbd/quantize";
import {
  parseSimulationSnapshot,
  type SolverSnapshot,
} from "./simulation-state";

export type SolverEvent = {
  tick: number;
  kind: "tighten" | "snap" | "status" | "push" | "layer";
  text: string;
};

/** Commit only full, collision-free replacements. Initial tangled drafts stay
 * explicitly invalid until a complete clear replacement has been found. */
export class Solver {
  project: Project;
  events: SolverEvent[] = [];
  best: Project | null = null;
  pbdEngine: PbdEngine;
  supervisor: TopologicalSupervisor;
  layeringManager: LayeringManager;
  lastQuantization: { accepted: boolean; reasons: string[] } | null = null;
  initial: Project;
  sweep: BoardSweep | null = null;
  lastSweepTick = -30;
  sweepCommitted = false;

  constructor(project: Project) {
    this.initial = structuredClone(project);
    this.project = structuredClone(project);
    this.pbdEngine = new PbdEngine(this.project);
    this.supervisor = new TopologicalSupervisor();
    this.layeringManager = new LayeringManager();
    this.checkpoint();
  }
  checkpoint() {
    const report = validate(this.project);
    if (
      !report.violations.length &&
      (!this.best || report.length < validate(this.best).length)
    )
      this.best = structuredClone(this.project);
  }

  /** Shared gate for every geometry mutation, also exercised directly in tests. */
  tryCommit(
    index: number,
    points: Point[],
    snap = true,
    targetLayer?: number,
  ): boolean {
    const p = this.project,
      r = p.routes[index],
      clean = simplify(points);
    const target = targetLayer !== undefined ? targetLayer : r.layer;
    if (target < 0 || target >= p.layers) return false;
    if (clean.length < 2 || clean.length > 32) return false;
    if (
      clean.some(
        (v) =>
          !Number.isSafeInteger(v.x) ||
          !Number.isSafeInteger(v.y) ||
          v.x < 0 ||
          v.y < 0 ||
          v.x > p.width ||
          v.y > p.height,
      )
    )
      return false;
    const oldViolations = validate(p, r.id).violations;
    const candidate: Route = {
      ...r,
      layer: target,
      points: clean,
      control: clean[Math.floor(clean.length / 2)],
      pressure: 0,
      vias: targetLayer !== undefined && targetLayer !== r.layer ? [] : r.vias,
    };
    if (
      !oldViolations.length &&
      target === r.layer &&
      routeLength(candidate) >= routeLength(r) - 0.1
    )
      return false;
    if (!snap) {
      // Conservative envelope of the fixed algebraic control-point connector.
      const displacement = Math.max(
        ...candidate.points.map((v) =>
          Math.min(...r.points.map((a) => distance(a, v))),
        ),
      );
      if (
        validate({
          ...p,
          clearance: p.clearance + Math.ceil(displacement * 4),
        }).violations.some((v) => v.objects.includes(r.id))
      )
        return false;
    }
    p.routes[index] = candidate;
    const clear = validate(p, r.id).violations.length === 0;
    if (!clear) {
      p.routes[index] = r;
      return false;
    }
    this.syncPbdRoute(index, candidate);
    return true;
  }

  private syncPbdRoute(index: number, r: Route) {
    if (this.pbdEngine && this.pbdEngine.routes[index]) {
      this.pbdEngine.routes[index].nodes = this.pbdEngine.nodesForRoute(r);
      this.pbdEngine.routes[index].layer = r.layer;
      this.pbdEngine.routes[index].vias = r.vias ? structuredClone(r.vias) : [];
    }
  }

  /** Atomic multi-route commit gate for coordinated push-and-shove. Either all
   * modified routes meet all clearances, invariants, and length/conflict improvements,
   * or all rollback. No routing graph search or pathfinding fallback. */
  tryCommitCoordinated(
    mutations: { index: number; points: Point[] }[],
    snap = true,
  ): boolean {
    const p = this.project;
    if (!mutations.length) return false;

    const cleaned: { index: number; points: Point[]; original: Route }[] = [];
    for (const m of mutations) {
      const r = p.routes[m.index];
      if (!r) return false;
      const clean = simplify(m.points);
      if (clean.length < 2 || clean.length > 32) return false;
      if (
        clean.some(
          (v) =>
            !Number.isSafeInteger(v.x) ||
            !Number.isSafeInteger(v.y) ||
            v.x < 0 ||
            v.y < 0 ||
            v.x > p.width ||
            v.y > p.height,
        )
      )
        return false;
      if (
        !equal(clean[0], r.points[0]) ||
        !equal(clean.at(-1)!, r.points.at(-1)!)
      )
        return false;
      for (let k = 1; k < clean.length; k++) {
        const dx = Math.abs(clean[k].x - clean[k - 1].x);
        const dy = Math.abs(clean[k].y - clean[k - 1].y);
        if (!(dx === 0 || dy === 0 || dx === dy)) return false;
      }
      cleaned.push({ index: m.index, points: clean, original: r });
    }

    const oldLength = cleaned.reduce(
      (sum, c) => sum + routeLength(c.original),
      0,
    );
    const newLength = cleaned.reduce(
      (sum, c) => sum + routeLength({ ...c.original, points: c.points }),
      0,
    );
    const hadViolations = cleaned.some(
      (c) => validate(p, c.original.id).violations.length > 0,
    );
    if (!hadViolations && newLength >= oldLength - 0.1) return false;

    if (!snap) {
      const participatingIds = new Set(cleaned.map((c) => c.original.id));
      for (const c of cleaned) {
        const displacement = Math.max(
          ...c.points.map((v) =>
            Math.min(...c.original.points.map((a) => distance(a, v))),
          ),
        );
        if (
          validate({
            ...p,
            clearance: p.clearance + Math.ceil(displacement * 4),
          }).violations.some(
            (v) =>
              v.objects.includes(c.original.id) &&
              v.objects.some((objId) => !participatingIds.has(objId)),
          )
        )
          return false;
      }
    }

    for (const c of cleaned) {
      p.routes[c.index] = {
        ...c.original,
        points: c.points,
        control: c.points[Math.floor(c.points.length / 2)],
        pressure: 0,
      };
    }

    const clear = cleaned.every(
      (c) => validate(p, c.original.id).violations.length === 0,
    );
    if (!clear) {
      for (const c of cleaned) {
        p.routes[c.index] = c.original;
      }
      return false;
    }
    for (const c of cleaned) this.syncPbdRoute(c.index, p.routes[c.index]);
    return true;
  }

  /** Incremental commit gate for physical wiggling of unresolved drafts.
   * Accepts moves that strictly improve the route's penetration score (fewer violations
   * or smaller shortfall) without introducing violations on any clean route. */
  tryCommitWiggle(index: number, points: Point[]): boolean {
    const p = this.project;
    const r = p.routes[index];
    if (!r || points.length < 2 || points.length > 32) return false;
    const clean = simplify(points);
    if (clean.length < 2 || clean.length > 32) return false;
    if (
      clean.some(
        (v) =>
          !Number.isSafeInteger(v.x) ||
          !Number.isSafeInteger(v.y) ||
          v.x < 0 ||
          v.y < 0 ||
          v.x > p.width ||
          v.y > p.height,
      )
    )
      return false;
    if (
      !equal(clean[0], r.points[0]) ||
      !equal(clean.at(-1)!, r.points.at(-1)!)
    )
      return false;
    for (let k = 1; k < clean.length; k++) {
      const dx = Math.abs(clean[k].x - clean[k - 1].x);
      const dy = Math.abs(clean[k].y - clean[k - 1].y);
      if (!(dx === 0 || dy === 0 || dx === dy)) return false;
    }

    const oldScore = routePenetration(p, r.id);
    if (oldScore.count === 0) return false;

    const cleanOtherIds = p.routes
      .filter((o) => o.id !== r.id && validate(p, o.id).violations.length === 0)
      .map((o) => o.id);

    const candidate: Route = {
      ...r,
      points: clean,
      control: clean[Math.floor(clean.length / 2)],
    };
    p.routes[index] = candidate;

    const clear = validate(p, r.id).violations.length === 0;
    if (!clear) {
      p.routes[index] = r;
      return false;
    }

    this.syncPbdRoute(index, candidate);
    return true;
  }

  /** Complete state at a tick boundary, sufficient for deterministic continuation. */
  snapshot(): SolverSnapshot {
    const e = this.pbdEngine;
    return structuredClone({
      kind: "rope-router-simulation",
      version: 1,
      solverVersion: "pbd-transactional-3",
      initial: this.initial,
      project: this.project,
      best: this.best,
      routes: e.routes,
      parameters: {
        targetSegmentLength: e.targetSegmentLength,
        minSegmentLength: e.minSegmentLength,
        maxSegmentLength: e.maxSegmentLength,
        subIterations: e.subIterations,
        tensionAlpha: e.tensionAlpha,
        octilinearBuffer: e.octilinearBuffer,
      },
      layering: {
        viaRadius: this.layeringManager.viaRadius,
        viaDrill: this.layeringManager.viaDrill,
      },
      supervisor: {
        lastCheckedTick: this.supervisor.lastCheckedTick,
        consecutiveCrossingTicks: [...this.supervisor.consecutiveCrossingTicks],
      },
      events: this.events,
      decisions: e.decisions,
      lastQuantization: this.lastQuantization,
      sweep: this.sweep?.snapshot() ?? null,
      lastSweepTick: this.lastSweepTick,
    });
  }

  static restore(snapshot: SolverSnapshot): Solver {
    const s = parseSimulationSnapshot(JSON.stringify(snapshot));
    const solver = new Solver(s.project);
    solver.initial = s.initial;
    solver.best = s.best;
    solver.pbdEngine.routes = s.routes;
    Object.assign(solver.pbdEngine, s.parameters);
    Object.assign(solver.layeringManager, s.layering);
    solver.supervisor.lastCheckedTick = s.supervisor.lastCheckedTick;
    solver.supervisor.consecutiveCrossingTicks = new Map(
      s.supervisor.consecutiveCrossingTicks,
    );
    solver.events = s.events;
    solver.pbdEngine.decisions = s.decisions;
    solver.lastQuantization = s.lastQuantization;
    solver.sweep = s.sweep ? new BoardSweep(s.sweep.board, s.sweep) : null;
    solver.lastSweepTick = s.lastSweepTick;
    return solver;
  }

  /** Coordinated mutual separation wiggling: both touching drafts push each other apart. */
  tryCommitCoordinatedWiggle(
    indexA: number,
    pointsA: Point[],
    indexB: number,
    pointsB: Point[],
  ): boolean {
    const p = this.project;
    const rA = p.routes[indexA],
      rB = p.routes[indexB];
    if (!rA || !rB) return false;
    const cleanA = simplify(pointsA),
      cleanB = simplify(pointsB);
    if (
      cleanA.length < 2 ||
      cleanA.length > 32 ||
      cleanB.length < 2 ||
      cleanB.length > 32
    )
      return false;
    for (const pts of [cleanA, cleanB]) {
      if (
        pts.some(
          (v) =>
            !Number.isSafeInteger(v.x) ||
            !Number.isSafeInteger(v.y) ||
            v.x < 0 ||
            v.y < 0 ||
            v.x > p.width ||
            v.y > p.height,
        )
      )
        return false;
      for (let k = 1; k < pts.length; k++) {
        const dx = Math.abs(pts[k].x - pts[k - 1].x);
        const dy = Math.abs(pts[k].y - pts[k - 1].y);
        if (!(dx === 0 || dy === 0 || dx === dy)) return false;
      }
    }
    if (
      !equal(cleanA[0], rA.points[0]) ||
      !equal(cleanA.at(-1)!, rA.points.at(-1)!)
    )
      return false;
    if (
      !equal(cleanB[0], rB.points[0]) ||
      !equal(cleanB.at(-1)!, rB.points.at(-1)!)
    )
      return false;

    p.routes[indexA] = {
      ...rA,
      points: cleanA,
      control: cleanA[Math.floor(cleanA.length / 2)],
    };
    p.routes[indexB] = {
      ...rB,
      points: cleanB,
      control: cleanB[Math.floor(cleanB.length / 2)],
    };

    const clearA = validate(p, rA.id).violations.length === 0;
    const clearB = validate(p, rB.id).violations.length === 0;
    if (!clearA || !clearB) {
      p.routes[indexA] = rA;
      p.routes[indexB] = rB;
      return false;
    }
    this.syncPbdRoute(indexA, p.routes[indexA]);
    this.syncPbdRoute(indexB, p.routes[indexB]);
    return true;
  }

  /** Reassign route to an alternate layer if completely conflict-free. */
  tryCommitLayer(index: number, targetLayer: number): boolean {
    const p = this.project,
      r = p.routes[index];
    if (targetLayer === r.layer || targetLayer < 0 || targetLayer >= p.layers)
      return false;
    const candidate: Route = {
      ...r,
      layer: targetLayer,
      pressure: 0,
      vias: [],
    };
    p.routes[index] = candidate;
    const clear = validate(p, r.id).violations.length === 0;
    if (!clear) {
      p.routes[index] = r;
      return false;
    }
    this.syncPbdRoute(index, candidate);
    return true;
  }

  /** Insert a pair of through-vias to bypass an obstacle on another layer. */
  tryCommitViaBypass(
    index: number,
    startIdx: number,
    endIdx: number,
    bypassLayer: number,
  ): boolean {
    const p = this.project,
      r = p.routes[index];
    if (
      bypassLayer === r.layer ||
      bypassLayer < 0 ||
      bypassLayer >= p.layers ||
      startIdx <= 0 ||
      endIdx >= r.points.length - 1 ||
      startIdx >= endIdx
    )
      return false;

    const u = r.points[startIdx],
      v = r.points[endIdx];
    const via1 = {
      x: u.x,
      y: u.y,
      fromLayer: r.layer,
      toLayer: bypassLayer,
      drill: 300,
      radius: 450,
    };
    const via2 = {
      x: v.x,
      y: v.y,
      fromLayer: bypassLayer,
      toLayer: r.layer,
      drill: 300,
      radius: 450,
    };

    const candidate: Route = {
      ...r,
      vias: [via1, via2],
      pressure: 0,
    };
    p.routes[index] = candidate;
    const clear = validate(p, r.id).violations.length === 0;
    if (!clear) {
      p.routes[index] = r;
      return false;
    }
    this.syncPbdRoute(index, candidate);
    return true;
  }

  /** If a route's vias can be safely removed without conflict, collapse them. */
  tryCollapseVias(index: number): boolean {
    const p = this.project,
      r = p.routes[index];
    if (!r.vias || r.vias.length === 0) return false;
    const candidate: Route = {
      ...r,
      vias: [],
      pressure: 0,
    };
    p.routes[index] = candidate;
    const clear = validate(p, r.id).violations.length === 0;
    if (!clear) {
      p.routes[index] = r;
      return false;
    }
    this.syncPbdRoute(index, candidate);
    return true;
  }

  get sweepActive() {
    return (
      this.sweep?.state.phase === "preparing" ||
      this.sweep?.state.phase === "searching"
    );
  }

  private advanceSweep() {
    const sweep = this.sweep!;
    const before = sweep.iteration;
    sweep.advance();
    this.finishSweep(before);
  }

  async stepAccelerated(oracle: ConflictOracle) {
    if (!this.sweepActive || !this.project.settings.snaps) {
      this.step();
      return;
    }
    this.sweepCommitted = false;
    const before = this.sweep!.iteration;
    await this.sweep!.advanceAccelerated(oracle);
    this.finishSweep(before);
  }

  private finishSweep(before: number) {
    const sweep = this.sweep!;
    if (sweep.iteration !== before) this.project.tick++;
    if (sweep.state.phase === "solved") {
      const candidate = {
        ...this.project,
        routes: structuredClone(sweep.working),
      };
      if (
        projectSchema.safeParse(candidate).success &&
        !validate(candidate).violations.length &&
        this.pbdEngine.tryReplaceRoutes(
          candidate.routes,
          this.project.tick,
          "board-sweep",
        )
      ) {
        this.project.routes = candidate.routes;
        this.sweepCommitted = true;
        this.lastQuantization = { accepted: true, reasons: [] };
        this.checkpoint();
        this.events.push({
          tick: this.project.tick,
          kind: "snap",
          text: `Board sweep validated ${candidate.routes.length} nets after ${sweep.iteration} coordinated adjustments`,
        });
      } else {
        sweep.state.phase = "stalled";
        sweep.state.reason =
          "Final sweep transaction rejected by independent validation";
      }
    }
    if (sweep.state.phase === "stalled") {
      this.events.push({
        tick: this.project.tick,
        kind: "status",
        text: `Board sweep unresolved: ${sweep.state.reason}`,
      });
    }
    this.lastSweepTick = this.project.tick;
  }

  step() {
    this.sweepCommitted = false;
    const p = this.project;
    if (this.sweepActive && p.settings.snaps) {
      this.advanceSweep();
      return;
    }
    p.tick++;
    // Local repair can coordinate six participants. Larger coupled drafts need
    // a whole-board transaction instead of repeatedly freezing local choices.
    if (p.settings.snaps && p.tick - this.lastSweepTick >= 30) {
      const report = validate(this.getLiveProject(), undefined, true);
      const ids = new Set(p.routes.map((r) => r.id));
      const unresolved = new Set(
        report.violations.flatMap((v) => v.objects).filter((id) => ids.has(id)),
      );
      if (unresolved.size > 6) {
        this.sweep = new BoardSweep(structuredClone(p));
        this.events.push({
          tick: p.tick,
          kind: "status",
          text: `Preparing a coordinated board sweep for ${unresolved.size} blocked nets`,
        });
        this.advanceSweep();
        return;
      }
    }

    // 1. Advance continuous PBD physics simulation
    this.pbdEngine.step(p.tick, 30, p.settings.strength);

    // 2. Evaluate topological untangling snaps
    if (p.settings.snaps) {
      const snapEvents = this.supervisor.checkAndSnap(this.pbdEngine, p.tick);
      for (const ev of snapEvents) {
        this.events.push({
          tick: ev.tick,
          kind: "snap",
          text: ev.text,
        });
      }
    }

    // 3. Evaluate 2.5D layering transitions & via bypasses
    const layerEvents = this.layeringManager.evaluateLayers(
      this.pbdEngine,
      p.tick,
    );
    for (const ev of layerEvents) {
      this.events.push({
        tick: ev.tick,
        kind: "layer",
        text: ev.text,
      });
    }

    // 4. Quantize PBD state and adopt into project if it improves violations or wirelength
    const currReport = validate(p);
    const shouldCheckQuantize =
      currReport.violations.length > 0 || p.tick % 5 === 0;
    if (shouldCheckQuantize) {
      const pbdRoutes = this.pbdEngine.toRoutes();
      const candidateProject = structuredClone(p);
      for (let k = 0; k < candidateProject.routes.length; k++) {
        if (pbdRoutes[k]) {
          candidateProject.routes[k].points = pbdRoutes[k].points;
          candidateProject.routes[k].control = pbdRoutes[k].control;
          candidateProject.routes[k].pressure = pbdRoutes[k].pressure;
          candidateProject.routes[k].layer = pbdRoutes[k].layer;
          candidateProject.routes[k].vias = pbdRoutes[k].vias ?? [];
        }
      }

      const quantized = quantizeProject(candidateProject);
      const qReport = validate(quantized);

      // Invariant: Never introduce a violation onto a route that was previously clean,
      // and any modified route committed into p.routes must have 0 violations.
      const previouslyClean = p.routes
        .filter(
          (r) => !currReport.violations.some((v) => v.objects.includes(r.id)),
        )
        .map((r) => r.id);
      const allCleanPreserved = previouslyClean.every(
        (id) => !qReport.violations.some((v) => v.objects.includes(id)),
      );

      if (
        projectSchema.shape.routes.safeParse(quantized.routes).success &&
        allCleanPreserved &&
        qReport.violations.length === 0 &&
        (currReport.violations.length > 0 ||
          qReport.length < currReport.length - 0.1)
      ) {
        for (let k = 0; k < p.routes.length; k++) {
          p.routes[k] = quantized.routes[k];
        }
        this.events.push({
          tick: p.tick,
          kind: "push",
          text:
            currReport.violations.length > 0
              ? `${p.routes[0]?.id ?? "Route"} wiggled and pushed apart until cleared all conflicts · L${p.routes[0]?.layer + 1 || 1}`
              : "PBD relaxed and pushed routes into collision-free channels",
        });
      } else {
        // Partially clean or intermediate state: only commit routes that have 0 violations
        let committedAny = false;
        for (let k = 0; k < p.routes.length; k++) {
          const qRoute = quantized.routes[k];
          const oldRoute = p.routes[k];
          if (
            !qRoute ||
            (JSON.stringify(qRoute.points) ===
              JSON.stringify(oldRoute.points) &&
              qRoute.layer === oldRoute.layer &&
              JSON.stringify(qRoute.vias) === JSON.stringify(oldRoute.vias))
          ) {
            continue;
          }
          p.routes[k] = qRoute;
          const candidateReport = validate(p);
          const clean =
            projectSchema.shape.routes.element.safeParse(qRoute).success &&
            !candidateReport.violations.some((v) =>
              v.objects.includes(qRoute.id),
            );
          const noNewConflicts = previouslyClean.every(
            (id) =>
              !candidateReport.violations.some((v) => v.objects.includes(id)),
          );
          if (clean && noNewConflicts) {
            committedAny = true;
          } else {
            p.routes[k] = oldRoute;
          }
        }
        if (committedAny) {
          this.events.push({
            tick: p.tick,
            kind: "push",
            text: "PBD relaxed and pushed routes into collision-free channels",
          });
        }
      }
    }

    this.checkpoint();
    return validate(p);
  }

  getLiveProject(): Project {
    const live = structuredClone(this.project);
    const pbdRoutes = this.pbdEngine.toRoutes();
    for (let k = 0; k < live.routes.length; k++) {
      if (pbdRoutes[k]) {
        live.routes[k].points = pbdRoutes[k].points;
        live.routes[k].control = pbdRoutes[k].control;
        live.routes[k].pressure = pbdRoutes[k].pressure;
        live.routes[k].layer = pbdRoutes[k].layer;
        live.routes[k].vias = pbdRoutes[k].vias ?? [];
      }
    }
    return live;
  }

  quantize(): Project {
    const candidate = quantizeProject(this.getLiveProject());
    const reasons = validate(candidate).violations.map((v) => v.message);
    if (!projectSchema.safeParse(candidate).success)
      reasons.push("Quantized geometry exceeds the project format limits.");
    this.lastQuantization = { accepted: reasons.length === 0, reasons };
    if (reasons.length) return this.project;
    this.project = candidate;
    for (let i = 0; i < candidate.routes.length; i++)
      this.syncPbdRoute(i, candidate.routes[i]);
    this.checkpoint();
    return this.project;
  }
}
