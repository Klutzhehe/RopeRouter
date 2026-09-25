import type { Project, Route } from "../model";
import { validate, connectWaypoints, simplify } from "../geometry";
import { repairCandidates, routesConflict } from "./repair";

/** Explicit layer transitions at bends of an existing fixed geometric template. */
export function directionalLayers(
  route: Route,
  horizontal: number,
  vertical: number,
): Route {
  const layers = route.points
    .slice(1)
    .map((p, i) =>
      Math.abs(p.x - route.points[i].x) >= Math.abs(p.y - route.points[i].y)
        ? horizontal
        : vertical,
    );
  const vias: NonNullable<Route["vias"]> = [];
  for (let i = 1; i < layers.length; i++)
    if (layers[i] !== layers[i - 1])
      vias.push({
        ...route.points[i],
        fromLayer: layers[i - 1],
        toLayer: layers[i],
        radius: 450,
        drill: 300,
      });
  return { ...route, layer: layers[0], vias };
}

export function sweepOptions(board: Project, route: Route): Route[] {
  const all = repairCandidates(board, route);
  const pool: Route[] = [];
  const seen = new Set<string>();
  // Sample the full geometry family, including longer escape/channel templates.
  for (let i = 0; i < Math.min(256, all.length); i++) {
    const index =
      i < 32 ? i : Math.floor(((i - 32) * (all.length - 32)) / 224) + 32;
    const base = all[Math.min(index, all.length - 1)];
    for (const candidate of [
      base,
      ...Array.from({ length: board.layers - 1 }, (_, l) =>
        directionalLayers(base, l, l + 1),
      ),
      ...(board.layers > 1 ? [directionalLayers(base, 1, 0)] : []),
    ]) {
      const key = JSON.stringify([
        candidate.layer,
        candidate.points,
        candidate.vias,
      ]);
      if (seen.has(key)) continue;
      seen.add(key);
      if (
        (candidate.vias?.length ?? 0) > 30 ||
        validate({ ...board, routes: [candidate] }, candidate.id).violations
          .length
      )
        continue;
      pool.push(candidate);
    }
  }
  return pool;
}

/** External batch accelerator. Entries are row-major exact pair-conflict flags. */
export interface ConflictOracle {
  conflicts(
    candidates: readonly Route[],
    others: readonly Route[],
    clearance: number,
  ): Promise<Uint8Array>;
}

export interface SweepState {
  board: Project;
  working: Route[];
  additions: Route[][];
  weights: [string, number][];
  seed: number;
  iteration: number;
  phase: "preparing" | "searching" | "solved" | "stalled";
  conflicts: number;
  evaluation: {
    index: number;
    cursor: number;
    best: number | null;
    selected: Route | null;
    ties: number;
  } | null;
  reason: string | null;
}

/** A resumable speculative whole-board transaction. Only a fully checked result
 * may replace live copper; intermediate assignments remain in this workspace. */
export class BoardSweep {
  options: Route[][] = [];
  state: SweepState;
  private weights: Map<string, number>;
  constructor(
    public readonly board: Project,
    restored?: SweepState,
  ) {
    this.state = restored
      ? structuredClone(restored)
      : {
          board: structuredClone(board),
          working: [],
          additions: [],
          weights: [],
          seed: board.seed || 1,
          iteration: 0,
          phase: "preparing",
          conflicts: 0,
          evaluation: null,
          reason: null,
        };
    this.weights = new Map(this.state.weights);
  }
  get working() {
    return this.state.working;
  }
  get iteration() {
    return this.state.iteration;
  }
  snapshot(): SweepState {
    return structuredClone({ ...this.state, weights: [...this.weights] });
  }
  private random() {
    this.state.seed = (Math.imul(this.state.seed, 1664525) + 1013904223) >>> 0;
    return this.state.seed / 4294967296;
  }
  private pool(index: number) {
    return (this.options[index] ??= [
      ...sweepOptions(this.board, this.board.routes[index]),
      ...(this.state.additions[index] ?? []),
    ]);
  }
  initializeRoute(index: number) {
    this.state.additions[index] ??= [];
    const candidates = this.pool(index);
    if (!candidates.length) {
      this.state.phase = "stalled";
      this.state.reason = `No statically clear geometric template for ${this.board.routes[index].id}`;
      return;
    }
    this.working[index] = candidates[0];
    if (this.working.length === this.board.routes.length)
      this.state.phase = "searching";
  }
  private pair(a: Route, b: Route) {
    return JSON.stringify([a.id, b.id].sort());
  }
  private conflicts(a: Route, b: Route) {
    return routesConflict(a, b, this.board.clearance);
  }

  private lateralCandidates(index: number) {
    const current = this.working[index];
    const pool = this.pool(index);
    const key = (r: Route) => JSON.stringify([r.layer, r.points, r.vias]);
    const known = new Set(pool.map(key));
    const additions = (this.state.additions[index] ??= []);
    // One or two via-clearance pitches moves a rope out of an occupied channel.
    const pitch = 2 * 450 + this.board.clearance + 100;
    for (const scale of [-2, -1, 1, 2])
      for (const axis of [0, 1]) {
        const middle = current.points.slice(1, -1).map((p) => ({
          x: p.x + (axis === 0 ? scale * pitch : 0),
          y: p.y + (axis === 1 ? scale * pitch : 0),
        }));
        if (!middle.length) continue;
        const points = simplify(
          connectWaypoints([
            current.points[0],
            ...middle,
            current.points.at(-1)!,
          ]),
        );
        if (points.length > 32) continue;
        for (const orientation of [0, 1]) {
          const candidate = directionalLayers(
            {
              ...current,
              points,
              control: points[Math.floor(points.length / 2)],
            },
            orientation % this.board.layers,
            (orientation + 1) % this.board.layers,
          );
          const signature = key(candidate);
          if (
            known.has(signature) ||
            validate({ ...this.board, routes: [candidate] }, candidate.id)
              .violations.length
          )
            continue;
          known.add(signature);
          additions.push(candidate);
          pool.push(candidate);
        }
      }
    // Bound serialized adaptive geometry independently of run duration.
    while (additions.length > 128) {
      const obsolete = additions.shift()!;
      const position = pool.indexOf(obsolete);
      if (position >= 0) pool.splice(position, 1);
    }
  }

  private beginEvaluation(matrix?: Uint8Array) {
    const s = this.state;

    const invalid = new Set<number>();
    s.conflicts = 0;
    for (let i = 0; i < this.working.length; i++)
      for (let j = i + 1; j < this.working.length; j++) {
        if (
          matrix
            ? matrix[i * this.working.length + j] === 1
            : this.conflicts(this.working[i], this.working[j])
        ) {
          invalid.add(i);
          invalid.add(j);
          s.conflicts++;
        }
      }
    if (!invalid.size) {
      const report = this.report();
      s.phase = report.violations.length ? "stalled" : "solved";
      s.reason = report.violations.length ? report.violations[0].message : null;
      return;
    }
    if (s.iteration >= Math.max(1000, this.working.length * 100)) {
      s.phase = "stalled";
      s.reason = "Whole-board proposal budget exhausted";
      return;
    }
    s.iteration++;
    const indices = [...invalid].sort((a, b) => a - b);
    const index = indices[Math.floor(this.random() * indices.length)];
    this.lateralCandidates(index);
    s.evaluation = { index, cursor: 0, best: null, selected: null, ties: 0 };
  }

  /** GPU/remote execution changes batch size, not proposal order or acceptance. */
  async advanceAccelerated(oracle: ConflictOracle, candidateBudget = 1024) {
    if (!Number.isInteger(candidateBudget) || candidateBudget < 1)
      throw new Error("Invalid candidate batch size");
    if (this.state.phase !== "searching") {
      this.advance();
      return;
    }
    if (!this.state.evaluation) {
      const matrix = await oracle.conflicts(
        this.working,
        this.working,
        this.board.clearance,
      );
      if (
        matrix.length !== this.working.length ** 2 ||
        matrix.some((v) => v > 1)
      )
        throw new Error("Invalid accelerator conflict matrix");
      this.beginEvaluation(matrix);
      if (!this.state.evaluation) return;
    }
    const e = this.state.evaluation;
    const candidates = this.pool(e.index).slice(
      e.cursor,
      e.cursor + candidateBudget,
    );
    const matrix = await oracle.conflicts(
      candidates,
      this.working,
      this.board.clearance,
    );
    if (
      matrix.length !== candidates.length * this.working.length ||
      matrix.some((v) => v > 1)
    )
      throw new Error("Invalid accelerator conflict matrix");
    const weights = this.working.map((other) =>
      other.id === candidates[0].id
        ? 0
        : (this.weights.get(this.pair(candidates[0], other)) ?? 1),
    );
    const scores = candidates.map((_, i) =>
      weights.reduce(
        (sum, weight, j) => sum + weight * matrix[i * weights.length + j],
        0,
      ),
    );
    this.advance(candidateBudget, scores);
  }

  /** One event-loop batch: prepare one net, or evaluate at most 24 alternatives. */
  advance(candidateBudget = 24, suppliedScores?: readonly number[]) {
    if (!Number.isInteger(candidateBudget) || candidateBudget < 1)
      throw new Error("Invalid candidate batch size");
    const s = this.state;
    if (s.phase === "preparing") {
      this.initializeRoute(s.working.length);
      return;
    }
    if (s.phase !== "searching") return;
    if (!s.evaluation) this.beginEvaluation();
    if (!s.evaluation) return;
    const e = s.evaluation;
    const options = this.pool(e.index);
    const end = Math.min(options.length, e.cursor + candidateBudget);
    const first = e.cursor;
    if (
      suppliedScores &&
      (suppliedScores.length !== end - first ||
        suppliedScores.some((v) => !Number.isSafeInteger(v) || v < 0))
    )
      throw new Error("Invalid accelerator scores");
    for (; e.cursor < end; e.cursor++) {
      const candidate = options[e.cursor];
      let score = suppliedScores?.[e.cursor - first] ?? 0;
      if (!suppliedScores)
        for (const other of this.working) {
          if (candidate.id !== other.id && this.conflicts(candidate, other))
            score += this.weights.get(this.pair(candidate, other)) ?? 1;
          if (e.best !== null && score > e.best) break;
        }
      if (e.best === null || score < e.best) {
        e.best = score;
        e.selected = candidate;
        e.ties = 1;
      } else if (score === e.best && this.random() < 1 / ++e.ties)
        e.selected = candidate;
    }
    if (e.cursor === options.length) {
      if (e.selected) this.working[e.index] = e.selected;
      s.evaluation = null;
      // Persistent conflicts accumulate weight, making the next board-wide pass
      // rearrange neighboring routes rather than retrying the same local minimum.
      if (s.iteration % this.working.length === 0) {
        for (let i = 0; i < this.working.length; i++)
          for (let j = i + 1; j < this.working.length; j++)
            if (this.conflicts(this.working[i], this.working[j])) {
              const key = this.pair(this.working[i], this.working[j]);
              this.weights.set(key, (this.weights.get(key) ?? 1) + 1);
            }
      }
    }
  }
  /** Convenience for offline probes; the worker uses advance's bounded batches. */
  step() {
    do {
      this.advance();
    } while (this.state.evaluation);
    return this.state.phase === "solved";
  }
  report() {
    return validate({ ...this.board, routes: this.working });
  }
}
