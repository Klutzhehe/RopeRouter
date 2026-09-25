import { createServer } from "vite";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";

const directory = resolve(
  process.argv[2] ?? "artifacts/solver-audit/scale-verification",
);
await mkdir(directory, { recursive: true });
const server = await createServer({
  server: { middlewareMode: true, watch: null, hmr: false },
  appType: "custom",
});
const results = [];
const status = async (state, current = null) =>
  writeFile(
    resolve(directory, "status.json"),
    JSON.stringify(
      { state, current, updated: new Date().toISOString(), results },
      null,
      2,
    ),
  );
try {
  const { SimulationSession } = await server.ssrLoadModule(
    "/src/core/simulation.ts",
  );
  const { generate } = await server.ssrLoadModule("/src/core/generate.ts");
  const { validate } = await server.ssrLoadModule("/src/core/geometry.ts");
  const { parseProject } = await server.ssrLoadModule("/src/core/model.ts");
  const cases = [
    [42017, 16, 2],
    [42017, 24, 2],
    [1, 24, 2],
    [99, 40, 2],
    [42017, 40, 2],
    [42017, 100, 2],
    [1, 100, 4],
    [42017, 200, 2],
    [99, 200, 4],
  ];
  for (const [seed, count, layers] of cases) {
    const name = `seed-${seed}-${count}-${layers}`;
    await status("running", name);
    const session = new SimulationSession();
    const initial = generate(seed, count, layers);
    session.handle({
      version: 1,
      session: 1,
      type: "initialize",
      project: initial,
    });
    session.handle({ version: 1, session: 1, type: "run" });
    const path = resolve(directory, name + ".ndjson");
    await writeFile(path, "");
    const timings = [],
      preparation = [];
    let batches = 0,
      previous = "",
      firstClear = null,
      regressions = 0;
    while (session.running && batches < 2200000) {
      const preparing = session.solver.sweep?.state.phase === "preparing";
      const start = performance.now();
      const frame = session.advance();
      (preparing ? preparation : timings).push(performance.now() - start);
      batches++;
      if (!frame.report.violations.length && firstClear === null)
        firstClear = frame.project.tick;
      if (firstClear !== null && frame.report.violations.length) regressions++;
      const key = JSON.stringify([
        frame.project.tick,
        frame.sweep?.phase,
        frame.sweep?.prepared,
        frame.sweep?.iteration,
        frame.stopReason,
      ]);
      if (key !== previous) {
        previous = key;
        const row = {
          batches,
          tick: frame.project.tick,
          sweep: frame.sweep,
          liveViolations: frame.report.violations.length,
          stopReason: frame.stopReason,
        };
        await appendFile(path, JSON.stringify(row) + "\n");
        if (!session.running || frame.sweep?.iteration % 100 === 0) {
          console.log(name, JSON.stringify(row));
          await writeFile(
            resolve(directory, name + ".latest.snapshot.json"),
            JSON.stringify(session.solver.snapshot()),
          );
        }
      }
    }
    const frame = session.frame();
    const project = parseProject(JSON.stringify(session.solver.project));
    const violations = validate(project).violations;
    const snapshot = session.handle({
      version: 1,
      session: 1,
      type: "snapshot",
    }).snapshot;
    await writeFile(
      resolve(directory, name + ".snapshot.json"),
      JSON.stringify(snapshot),
    );
    const sorted = timings.sort((a, b) => a - b);
    const result = {
      name,
      passed:
        frame.stopReason === "solved" &&
        !violations.length &&
        !frame.report.violations.length &&
        !regressions,
      tick: project.tick,
      batches,
      firstClear,
      regressions,
      stopReason: frame.stopReason,
      liveViolations: frame.report.violations.length,
      savedViolations: violations.length,
      components: project.components.length,
      nets: project.routes.length,
      vias: validate(project).vias,
      p95BatchMs: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
      maxBatchMs: Math.round(sorted.at(-1) ?? 0),
      maxPreparationMs: Math.round(Math.max(0, ...preparation)),
      reason: frame.sweep?.reason ?? null,
    };
    results.push(result);
    console.log("RESULT", JSON.stringify(result));
    await status("running", name);
  }
  const failed = results.some((r) => !r.passed);
  await status(failed ? "completed-with-failures" : "passed");
  if (failed) process.exitCode = 1;
} catch (error) {
  console.error(error);
  await status("runner-error", String(error));
  process.exitCode = 1;
} finally {
  await server.close();
}
