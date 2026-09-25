import { createServer } from "vite";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";

// Exercise the same lifecycle as the worker, with complete final checkpoints.
const directory = resolve(
  process.argv[2] ?? "artifacts/solver-audit/lifecycle",
);
await mkdir(directory, { recursive: true });
const server = await createServer({
  server: { middlewareMode: true, watch: null, hmr: false },
  appType: "custom",
});
const results = [];
try {
  const { SimulationSession } = await server.ssrLoadModule(
    "/src/core/simulation.ts",
  );
  const { generate } = await server.ssrLoadModule("/src/core/generate.ts");
  const { validate } = await server.ssrLoadModule("/src/core/geometry.ts");
  for (const [seed, count, layers] of [
    [42017, 12, 4],
    [42017, 16, 2],
    [1, 8, 2],
    [99, 8, 2],
  ]) {
    const name = `seed-${seed}-${count}-${layers}`;
    const session = new SimulationSession();
    session.handle({
      version: 1,
      session: 1,
      type: "initialize",
      project: generate(seed, count, layers),
    });
    session.handle({ version: 1, session: 1, type: "run" });
    let firstClear = null,
      regressions = 0;
    const durations = [];
    const log = resolve(directory, name + ".ndjson");
    await writeFile(log, "");
    while (session.running && session.solver.project.tick < 150) {
      const started = performance.now();
      const frame = session.advance();
      durations.push(performance.now() - started);
      if (!frame.report.violations.length && firstClear === null)
        firstClear = frame.project.tick;
      if (firstClear !== null && frame.report.violations.length) regressions++;
      await appendFile(
        log,
        JSON.stringify({
          tick: frame.project.tick,
          ms: durations.at(-1),
          violations: frame.report.violations,
          stopReason: frame.stopReason,
        }) + "\n",
      );
    }
    const frame = session.frame();
    const savedViolations = validate(session.solver.project).violations.length;
    const sorted = [...durations].sort((a, b) => a - b);
    const result = {
      name,
      tick: session.solver.project.tick,
      firstClear,
      regressions,
      stopReason: frame.stopReason,
      liveViolations: frame.report.violations.length,
      savedViolations,
      crossings: session.solver.pbdEngine.getCrossings().length,
      elapsedMs: Math.round(durations.reduce((a, b) => a + b, 0)),
      p50Ms: Math.round(sorted[Math.floor(sorted.length * 0.5)]),
      p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)]),
      maxMs: Math.round(sorted.at(-1)),
      groups: session.solver
        .snapshot()
        .decisions.filter(
          (d) => d.operation === "coordinated-snap" && d.accepted,
        )
        .map((d) => d.routeIds),
    };
    result.passed =
      frame.stopReason === "solved" &&
      !result.liveViolations &&
      !savedViolations &&
      !regressions;
    results.push(result);
    await writeFile(
      resolve(directory, name + ".snapshot.json"),
      JSON.stringify(session.solver.snapshot()),
    );
    await writeFile(
      resolve(directory, "summary.json"),
      JSON.stringify(results, null, 2),
    );
    console.log(JSON.stringify(result));
  }
  if (results.some((r) => !r.passed)) process.exitCode = 1;
} finally {
  await server.close();
}
