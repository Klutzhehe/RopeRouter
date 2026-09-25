import type { ConflictOracle } from "./pbd/board-sweep";
import { Solver } from "./solver";
import { validate } from "./geometry";
import { projectSchema, type Project } from "./model";
import type { SolverSnapshot } from "./simulation-state";
import { quantizeProject } from "./pbd/quantize";

export type StopReason =
  "paused" | "solved" | "budget-exhausted" | "quantization-rejected" | null;
export type SimulationCommand = {
  version: 1;
  session: number;
  requestId?: number;
  type:
    | "initialize"
    | "run"
    | "pause"
    | "step"
    | "quantize"
    | "snapshot"
    | "save-project"
    | "configure";
  project?: Project;
  snapshot?: SolverSnapshot;
  settings?: Project["settings"];
};

/** The worker and headless tests share the same lifecycle and validation policy. */
export class SimulationSession {
  solver: Solver | null = null;
  session = 0;
  running = false;
  isQuantized = false;
  cleanTicks = 0;
  stopReason: StopReason = "paused";
  maxTicks = 1000;
  private frozenSweepFrame: {
    owner: NonNullable<Solver["sweep"]>;
    project: Project;
    report: ReturnType<typeof validate>;
  } | null = null;

  handle(m: SimulationCommand) {
    if (m.version !== 1) return null;
    if (m.type === "initialize" && (m.project || m.snapshot)) {
      this.solver = m.snapshot
        ? Solver.restore(m.snapshot)
        : new Solver(m.project!);
      this.session = m.session;
      this.running = false;
      this.isQuantized = false;
      this.cleanTicks = 0;
      this.stopReason = "paused";
      if (m.snapshot?.runtime) {
        this.isQuantized = m.snapshot.runtime.isQuantized;
        this.cleanTicks = m.snapshot.runtime.cleanTicks;
        this.maxTicks = m.snapshot.runtime.maxTicks;
      }
      return this.frame();
    }
    if (m.session !== this.session || !this.solver) return null;
    if (m.type === "configure" && m.settings) {
      this.solver.sweep = null;
      this.solver.project.settings = projectSchema.shape.settings.parse(
        m.settings,
      );
    }
    if (m.type === "snapshot") {
      const live = this.solver.getLiveProject();
      return {
        version: 1,
        session: this.session,
        type: "snapshot",
        requestId: m.requestId,
        snapshot: {
          ...this.solver.snapshot(),
          live,
          reports: {
            live: validate(live, undefined, true),
            stored: validate(this.solver.project),
            quantizedCandidate: validate(quantizeProject(live)),
          },
          crossings: this.solver.pbdEngine.getCrossings(),
          runtime: {
            running: this.running,
            isQuantized: this.isQuantized,
            cleanTicks: this.cleanTicks,
            stopReason: this.stopReason,
            maxTicks: this.maxTicks,
          },
          historyLimits: {
            decisions: 200,
            events: "all",
            particleHistory:
              "current tick only; use diagnose --full for every tick",
          },
        },
      };
    }
    if (m.type === "save-project") {
      this.running = false;
      this.stopReason = "paused";
      return {
        version: 1,
        session: this.session,
        type: "saved-project",
        requestId: m.requestId,
        project: structuredClone(this.solver.project),
      };
    }
    if (m.type === "run") {
      this.running = true;
      this.isQuantized = false;
      this.stopReason = null;
    }
    if (m.type === "pause") {
      this.running = false;
      this.stopReason = "paused";
    }
    if (m.type === "step") {
      this.running = false;
      this.isQuantized = false;
      this.stopReason = "paused";
      this.solver.step();
      this.cleanTicks = 0;
    }
    if (m.type === "quantize") {
      this.running = false;
      this.solver.sweep = null;
      this.solver.quantize();
      this.isQuantized = this.solver.lastQuantization?.accepted === true;
      this.stopReason = this.isQuantized ? "paused" : "quantization-rejected";
    }
    return this.frame();
  }

  advance() {
    if (!this.running || !this.solver) return null;
    this.solver.step();
    return this.afterAdvance();
  }

  async advanceAccelerated(oracle: ConflictOracle) {
    if (!this.running || !this.solver) return null;
    await this.solver.stepAccelerated(oracle);
    return this.afterAdvance();
  }

  private afterAdvance() {
    if (!this.solver) return null;
    if (this.solver.sweepActive) return this.frame();
    if (this.solver.sweep?.state.phase === "stalled") {
      this.running = false;
      this.stopReason = "budget-exhausted";
      return this.frame();
    }
    if (this.solver.sweepCommitted) {
      this.isQuantized = true;
      this.running = false;
      this.stopReason = "solved";
      return this.frame();
    }
    const report = validate(this.solver.getLiveProject(), undefined, true);
    this.cleanTicks = report.violations.length ? 0 : this.cleanTicks + 1;
    if (this.cleanTicks >= 30) {
      this.solver.quantize();
      this.isQuantized = this.solver.lastQuantization?.accepted === true;
      this.running = false;
      this.stopReason = this.isQuantized ? "solved" : "quantization-rejected";
    }
    if (this.running && this.solver.project.tick >= this.maxTicks) {
      this.running = false;
      this.stopReason = "budget-exhausted";
      // Keep the actual unresolved state. A tick budget is not permission to replace it.
    }
    return this.frame();
  }

  frame() {
    if (!this.solver) return null;
    const active = this.solver.sweepActive ? this.solver.sweep : null;
    if (active && this.frozenSweepFrame?.owner !== active) {
      const project = this.solver.getLiveProject();
      this.frozenSweepFrame = {
        owner: active,
        project,
        report: validate(project, undefined, true),
      };
    }
    const frozen = active ? this.frozenSweepFrame : null;
    const project = frozen
      ? { ...frozen.project, tick: this.solver.project.tick }
      : this.isQuantized
        ? structuredClone(this.solver.project)
        : this.solver.getLiveProject();
    return {
      version: 1,
      session: this.session,
      type: "frame",
      project,
      events: this.solver.events.slice(-50),
      running: this.running,
      best: this.solver.best,
      report: frozen?.report ?? validate(project, undefined, !this.isQuantized),
      stopReason: this.stopReason,
      representation: this.isQuantized ? "quantized" : "live",
      quantization: this.solver.lastQuantization,
      sweep: this.solver.sweep
        ? {
            phase: this.solver.sweep.state.phase,
            prepared: this.solver.sweep.working.length,
            total: this.solver.project.routes.length,
            iteration: this.solver.sweep.iteration,
            conflicts: this.solver.sweep.state.conflicts,
            reason: this.solver.sweep.state.reason,
          }
        : null,
    };
  }
}
