import { SimulationSession, type SimulationCommand } from "./core/simulation";

const simulation = new SimulationSession();
let lastProgress = 0;
let publishedSweep: unknown = null;
let timer: ReturnType<typeof setTimeout> | undefined;
function schedule() {
  clearTimeout(timer);
  if (simulation.running)
    timer = setTimeout(
      () => {
        const frame = simulation.advance();
        if (frame) {
          const sweep = simulation.solver?.sweepActive
            ? simulation.solver.sweep
            : null;
          if (sweep && sweep === publishedSweep) {
            if (performance.now() - lastProgress >= 50) {
              postMessage({
                version: 1,
                session: simulation.session,
                type: "progress",
                tick: frame.project.tick,
                sweep: frame.sweep,
              });
              lastProgress = performance.now();
            }
          } else {
            postMessage(frame);
            publishedSweep = sweep;
          }
        }
        schedule();
      },
      simulation.solver?.sweepActive ? 0 : 32,
    );
}
self.onmessage = (event: MessageEvent<SimulationCommand>) => {
  const m = event.data;
  try {
    const response = simulation.handle(m);
    if (!response) return;
    postMessage(response);
    if (m.type === "save-project") postMessage(simulation.frame());
    // Observation must not reset the running timer or starve the simulation.
    if (m.type !== "snapshot") schedule();
  } catch (error) {
    postMessage({
      version: 1,
      session: m.session,
      type: "error",
      requestId: m.requestId,
      message:
        error instanceof Error ? error.message : "Simulation command failed",
    });
  }
};
