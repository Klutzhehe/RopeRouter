import { createServer } from "vite";
import {
  mkdir,
  writeFile,
  appendFile,
  readFile,
  rename,
  copyFile,
  readdir,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { createCudaOracle } from "./lib/cuda-oracle.mjs";
import { checkGpuParity } from "./lib/gpu-parity.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i < 0
      ? [a.replace(/^--/, ""), true]
      : [a.slice(2, i), a.slice(i + 1)];
  }),
);
const backend = args.backend ?? "cuda";
if (!["cpu", "cuda"].includes(backend))
  throw new Error("Use --backend=cpu or --backend=cuda");
const output = resolve(args.output ?? "artifacts/colab");
const mirror = args["checkpoint-dir"] ? resolve(args["checkpoint-dir"]) : null;
const checkpointEvery = Number(args["checkpoint-every"] ?? 100);
if (!Number.isInteger(checkpointEvery) || checkpointEvery < 1)
  throw new Error("Invalid checkpoint interval");
let cases = JSON.parse(args.cases ?? "[[42017,100,2]]");
if (
  !Array.isArray(cases) ||
  cases.some(
    (c) =>
      !Array.isArray(c) ||
      c.length !== 3 ||
      !c.every(Number.isInteger) ||
      c[0] < 0 ||
      c[0] > 4294967295 ||
      c[1] < 1 ||
      c[1] > 200 ||
      c[2] < 1 ||
      c[2] > 8,
  )
)
  throw new Error(
    "Cases must be [seed, components (1-200), layers (1-8)] tuples",
  );
await mkdir(output, { recursive: true });
if (mirror) await mkdir(mirror, { recursive: true });
const atomic = async (path, value) => {
  await writeFile(path + ".tmp", JSON.stringify(value, null, 2));
  await rename(path + ".tmp", path);
};
const log = async (value) => {
  const line = JSON.stringify({ at: new Date().toISOString(), ...value });
  console.log(line);
  await appendFile(join(output, "run.log"), line + "\n");
};
const server = await createServer({
  server: { middlewareMode: true, watch: null, hmr: false },
  appType: "custom",
});
let oracle,
  activeSession,
  activeName,
  interrupted = false;
const results = [];
process.once("SIGINT", () => {
  interrupted = true;
});
process.once("SIGTERM", () => {
  interrupted = true;
});
const checkpoint = async (name, session) => {
  const snapshot = {
    ...session.solver.snapshot(),
    runtime: {
      running: session.running,
      isQuantized: session.isQuantized,
      cleanTicks: session.cleanTicks,
      stopReason: session.stopReason,
      maxTicks: session.maxTicks,
    },
  };
  const path = join(output, name + ".snapshot.json");
  await atomic(path, snapshot);
  if (mirror) {
    await copyFile(path, join(mirror, name + ".snapshot.json.tmp"));
    await rename(
      join(mirror, name + ".snapshot.json.tmp"),
      join(mirror, name + ".snapshot.json"),
    );
  }
};
try {
  const { SimulationSession } = await server.ssrLoadModule(
    "/src/core/simulation.ts",
  );
  const { generate } = await server.ssrLoadModule("/src/core/generate.ts");
  const { parseProject } = await server.ssrLoadModule("/src/core/model.ts");
  const { validate, routeSegments } = await server.ssrLoadModule(
    "/src/core/geometry.ts",
  );
  const { routesConflict } = await server.ssrLoadModule(
    "/src/core/pbd/repair.ts",
  );
  const { directionalLayers } = await server.ssrLoadModule(
    "/src/core/pbd/board-sweep.ts",
  );
  const sources = [];
  async function collect(directory) {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await collect(path);
      else if (/\.(ts|cu|py|mjs)$/.test(path))
        sources.push([path, await readFile(path)]);
    }
  }
  await collect("src/core");
  await collect("gpu");
  await collect("scripts/lib");
  const fingerprint = createHash("sha256");
  for (const [path, content] of sources) {
    fingerprint.update(path.replaceAll("\\", "/"));
    fingerprint.update(content);
  }
  let commit = null;
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {}
  const metadata = {
    backend,
    commit,
    sourceSha256: fingerprint.digest("hex"),
    node: process.version,
    platform: os.platform(),
    cpu: os.cpus()[0]?.model,
    started: new Date().toISOString(),
  };
  await atomic(join(output, "status.json"), {
    state: "starting",
    metadata,
    results,
  });
  if (backend === "cuda") {
    oracle = await createCudaOracle({ routeSegments, routesConflict });
    metadata.gpu = oracle.info;
    const parity = await checkGpuParity(oracle, {
      routesConflict,
      directionalLayers,
    });
    await atomic(join(output, "gpu-parity.json"), parity);
    if (!parity.passed)
      throw new Error(
        "CPU/GPU collision parity failed; routing was not started",
      );
    await log({
      event: "gpu-parity-passed",
      device: oracle.info,
      checks: parity.results,
    });
  }
  let resume = args.resume
    ? JSON.parse(await readFile(resolve(args.resume), "utf8"))
    : null;
  if (resume)
    cases = [
      [
        resume.project.seed,
        resume.project.components.length,
        resume.project.layers,
      ],
    ];
  for (const [seed, count, layers] of cases) {
    if (interrupted) break;
    const name = `${backend}-${seed}-${count}-${layers}`;
    activeName = name;
    const start = performance.now();
    const session = (activeSession = new SimulationSession());
    session.handle({
      version: 1,
      session: 1,
      type: "initialize",
      ...(resume
        ? { snapshot: resume }
        : { project: generate(seed, count, layers) }),
    });
    session.handle({ version: 1, session: 1, type: "run" });
    const timing = { preparationMs: 0, searchMs: 0, otherMs: 0, maxBatchMs: 0 };
    const statsBefore = oracle ? { ...oracle.stats } : null;
    let batches = 0,
      lastCheckpoint = -1,
      firstClear = null,
      regressions = 0;
    await log({ event: "case-start", name, resumed: !!resume });
    await atomic(join(output, "status.json"), {
      state: "running",
      current: name,
      metadata,
      results,
    });
    await checkpoint(name, session);
    while (session.running && !interrupted && batches < 2200000) {
      const phase = session.solver.sweep?.state.phase;
      const began = performance.now();
      const frame = oracle
        ? await session.advanceAccelerated(oracle)
        : session.advance();
      const ms = performance.now() - began;
      timing.maxBatchMs = Math.max(timing.maxBatchMs, ms);
      if (
        phase === "preparing" ||
        (!phase && frame.sweep?.phase === "preparing")
      )
        timing.preparationMs += ms;
      else if (phase === "searching") timing.searchMs += ms;
      else timing.otherMs += ms;
      batches++;
      if (!frame.report.violations.length && firstClear === null)
        firstClear = frame.project.tick;
      if (firstClear !== null && frame.report.violations.length) regressions++;
      const iteration =
        session.solver.sweep?.iteration ?? session.solver.project.tick;
      if (
        iteration !== lastCheckpoint &&
        (iteration % checkpointEvery === 0 || !session.running)
      ) {
        lastCheckpoint = iteration;
        await checkpoint(name, session);
        await log({
          event: "progress",
          name,
          batches,
          tick: frame.project.tick,
          sweep: frame.sweep,
        });
      }
    }
    await checkpoint(name, session);
    const frame = session.frame();
    const project = parseProject(JSON.stringify(session.solver.project));
    const saved = validate(project),
      live = validate(session.solver.getLiveProject(), undefined, true);
    const snapshot = session.solver.snapshot();
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          project: snapshot.project,
          routes: snapshot.routes,
          supervisor: snapshot.supervisor,
          sweep: snapshot.sweep,
          events: snapshot.events,
          decisions: snapshot.decisions,
        }),
      )
      .digest("hex");
    const result = {
      name,
      seed,
      count,
      layers,
      backend,
      passed:
        frame.stopReason === "solved" &&
        !saved.violations.length &&
        !live.violations.length &&
        !regressions,
      stopReason: interrupted ? "interrupted" : frame.stopReason,
      tick: project.tick,
      batches,
      firstClear,
      regressions,
      liveViolations: live.violations.length,
      savedViolations: saved.violations.length,
      vias: saved.vias,
      elapsedMs: Math.round(performance.now() - start),
      timing,
      stateSha256: fingerprint,
      accelerator: oracle
        ? Object.fromEntries(
            Object.entries(oracle.stats).map(([k, v]) => [
              k,
              v - statsBefore[k],
            ]),
          )
        : null,
    };
    results.push(result);
    await atomic(join(output, name + ".result.json"), result);
    await atomic(join(output, name + ".project.json"), project);
    await log({ event: "case-finished", ...result });
    resume = null;
  }
  const state = interrupted
    ? "interrupted"
    : results.length === cases.length && results.every((r) => r.passed)
      ? "passed"
      : "completed-with-failures";
  await atomic(join(output, "status.json"), {
    state,
    metadata,
    finished: new Date().toISOString(),
    results,
  });
  if (state !== "passed") process.exitCode = interrupted ? 130 : 1;
} catch (error) {
  if (activeSession?.solver)
    await checkpoint(activeName, activeSession).catch(() => {});
  await atomic(join(output, "status.json"), {
    state: "error",
    backend,
    error: String(error),
    results,
  });
  await log({ event: "error", error: String(error) });
  process.exitCode = 1;
} finally {
  oracle?.close();
  await server.close();
}
