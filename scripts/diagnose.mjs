import { createServer } from "vite";
import { mkdir, writeFile, appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ticks = Number(process.argv[2] ?? 100);
if (!Number.isInteger(ticks) || ticks < 1 || ticks > 10000)
  throw new Error("Ticks must be an integer from 1 to 10000");
const out = resolve(process.argv[3] ?? "test-results/diagnostics");
const full = process.argv.includes("--full");
const input = process.argv.find((a) => a.startsWith("--input="))?.slice(8);
const onlyCase = process.argv.find((a) => a.startsWith("--case="))?.slice(7);
const server = await createServer({
  server: { middlewareMode: true, watch: null, hmr: false },
  appType: "custom",
});
try {
  const { Solver } = await server.ssrLoadModule("/src/core/solver.ts");
  const { generate } = await server.ssrLoadModule("/src/core/generate.ts");
  const { validate } = await server.ssrLoadModule("/src/core/geometry.ts");
  const { crossingFixture } = await server.ssrLoadModule(
    "/tests/fixtures/crossing.ts",
  );
  await mkdir(out, { recursive: true });
  const summary = [];
  const cases = input
    ? [["replay", JSON.parse(await readFile(resolve(input), "utf8"))]]
    : [
        ["crossing-1-layer", crossingFixture()],
        ["crossing-2-layers", crossingFixture(2)],
        ["crossing-reversed", crossingFixture(1, true)],
        ["seed-42017-12-4", generate(42017, 12, 4)],
        ["seed-42017-16-2", generate(42017, 16, 2)],
      ];
  for (const [name, project] of cases.filter(
    ([name]) => !onlyCase || name === onlyCase,
  )) {
    const inputState = project.snapshot ?? project;
    const solver =
      inputState.kind === "rope-router-simulation"
        ? Solver.restore(inputState)
        : new Solver(inputState);
    const history = [];
    const tracePath = resolve(out, `${name}.ndjson`);
    if (full) await writeFile(tracePath, "");
    const started = performance.now();
    for (let t = 0; t <= ticks; t++) {
      if (t) solver.step();
      const live = solver.getLiveProject();
      const report = validate(live, undefined, true);
      history.push({
        tick: live.tick,
        liveViolations: report.violations,
        storedViolations: validate(solver.project).violations.length,
        crossings: solver.pbdEngine.getCrossings().length,
        nodes: solver.pbdEngine.routes.reduce((n, r) => n + r.nodes.length, 0),
        length: report.length,
      });
      if (full)
        await appendFile(tracePath, JSON.stringify(solver.snapshot()) + "\n");
      if (t && t % 25 === 0)
        console.error(
          `${name}: tick ${live.tick}, ${report.violations.length} violations, ${history.at(-1).nodes} nodes`,
        );
    }
    const row = {
      name,
      ticks,
      milliseconds: Math.round(performance.now() - started),
      initial: history[0].liveViolations.length,
      final: history.at(-1).liveViolations.length,
      stored: history.at(-1).storedViolations,
      crossings: history.at(-1).crossings,
      firstClear: history.find((h) => !h.liveViolations.length)?.tick ?? null,
      clearRegressions: history.filter(
        (h, i) =>
          i && !history[i - 1].liveViolations.length && h.liveViolations.length,
      ).length,
      maxNodes: Math.max(...history.map((h) => h.nodes)),
    };
    summary.push(row);
    await writeFile(
      resolve(out, `${name}.snapshot.json`),
      JSON.stringify(solver.snapshot(), null, 2),
    );
    await writeFile(
      resolve(out, `${name}.json`),
      JSON.stringify(
        {
          summary: row,
          initial: project,
          history,
          snapshot: solver.snapshot?.() ?? {
            project: solver.project,
            live: solver.getLiveProject(),
            routes: solver.pbdEngine.routes,
            events: solver.events,
          },
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(row));
  }
  await writeFile(
    resolve(out, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
} finally {
  await server.close();
}
