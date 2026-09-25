import { expect, it } from "vitest";
import { Solver } from "../src/core/solver";
import { validate } from "../src/core/geometry";
import { crossingFixture } from "./fixtures/crossing";
import { PbdEngine, segmentContact } from "../src/core/pbd/pbd-engine";
import { TopologicalSupervisor } from "../src/core/pbd/topological-snap";
import { parseSimulationSnapshot } from "../src/core/simulation-state";
import { SimulationSession } from "../src/core/simulation";
import { quantizeRoutePoints } from "../src/core/pbd/quantize";

it.each([
  [1, false],
  [2, false],
  [1, true],
] as const)(
  "resolves live mid-segment crossings and keeps them resolved (%i layers, reversed=%s)",
  (layers, reversed) => {
    const solver = new Solver(crossingFixture(layers, reversed));
    let firstClear: number | null = null;
    for (let tick = 1; tick <= 100; tick++) {
      solver.step();
      const report = validate(solver.getLiveProject(), undefined, true);
      if (!report.violations.length && firstClear === null) firstClear = tick;
      if (firstClear !== null)
        expect(
          report.violations,
          `live geometry regressed at tick ${tick}`,
        ).toEqual([]);
    }
    expect(firstClear).not.toBeNull();
    expect(validate(solver.quantize()).violations).toEqual([]);
    solver.step();
    expect(
      validate(solver.getLiveProject(), undefined, true).violations,
    ).toEqual([]);
  },
);

it("finds interior segment contact even when every endpoint is outside clearance", () => {
  const c = segmentContact(
    { x: 0, y: 1000 },
    { x: 2000, y: 1000 },
    { x: 1000, y: 0 },
    { x: 1000, y: 2000 },
  );
  expect(c).toMatchObject({ distance: 0, s: 0.5, t: 0.5 });
  expect(
    segmentContact(
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
      { x: 1000, y: 0 },
      { x: 4000, y: 0 },
    ).distance,
  ).toBe(0);
});

it("counts one persistent contact per tick and clears stale contacts", () => {
  const engine = new PbdEngine(crossingFixture());
  const supervisor = new TopologicalSupervisor();
  expect(supervisor.checkAndSnap(engine, 1)).toEqual([]);
  expect(supervisor.checkAndSnap(engine, 1)).toEqual([]);
  expect([...supervisor.consecutiveCrossingTicks.values()]).toEqual([1]);
  engine.routes[1].layer = 1;
  supervisor.checkAndSnap(engine, 2);
  expect(supervisor.consecutiveCrossingTicks.size).toBe(0);
});

it("rejects migration onto a layer whose wall blocks the middle of a segment", () => {
  const project = crossingFixture(2);
  project.walls.push({
    id: "upper-wall",
    x: 40000,
    y: 19000,
    w: 10000,
    h: 4000,
    layers: [1],
  });
  const engine = new PbdEngine(project);
  const before = structuredClone(engine.routes);
  expect(
    engine.tryReplaceRoute(
      { ...engine.toRoutes()[0], layer: 1 },
      1,
      "test-migration",
    ),
  ).toBe(false);
  expect(engine.routes).toEqual(before);
  expect(
    engine.decisions.at(-1)?.reasons.some((r) => r.includes("upper-wall")),
  ).toBe(true);
});

it("remeshing preserves sharp detours and never deletes a mandatory via", () => {
  const engine = new PbdEngine(crossingFixture(2));
  const r = engine.routes[0];
  r.nodes = [
    { x: 10000, y: 21250 },
    { x: 50000, y: 15000 },
    { x: 50500, y: 14000 },
    { x: 51000, y: 15000 },
    { x: 90000, y: 21250 },
  ].map((p, i) => ({
    ...p,
    prevX: p.x,
    prevY: p.y,
    invMass: i === 0 || i === 4 || i === 2 ? 0 : 1,
    layer: 0,
    netId: r.id,
  }));
  engine.remesh();
  expect(
    r.nodes.some((n) => n.x === 50500 && n.y === 14000 && n.invMass === 0),
  ).toBe(true);
  expect(r.nodes.some((n) => n.x === 51000 && n.y === 15000)).toBe(true);
});

it("round-trips the complete solver state and continues identically", () => {
  const solver = new Solver(crossingFixture());
  for (let i = 0; i < 2; i++) solver.step();
  const snapshot = parseSimulationSnapshot(JSON.stringify(solver.snapshot()));
  const restored = Solver.restore(snapshot);
  expect(restored.snapshot()).toEqual(solver.snapshot());
  for (let i = 0; i < 20; i++) {
    solver.step();
    restored.step();
    expect(restored.snapshot()).toEqual(solver.snapshot());
  }
  snapshot.routes[0].nodes[0].x++;
  expect(() => Solver.restore(snapshot)).toThrow(/anchors/);
});

it("rejects invalid quantization without replacing either live or accepted geometry", () => {
  const solver = new Solver(crossingFixture());
  const live = solver.getLiveProject(),
    accepted = structuredClone(solver.project);
  solver.quantize();
  expect(solver.lastQuantization?.accepted).toBe(false);
  expect(solver.getLiveProject()).toEqual(live);
  expect(solver.project).toEqual(accepted);
});

it("preserves multiple collinear via vertices during quantization", () => {
  const points = [
    { x: 1000, y: 1000 },
    { x: 2000, y: 1000 },
    { x: 3000, y: 1000 },
    { x: 4000, y: 1000 },
  ];
  expect(
    quantizeRoutePoints(points, undefined, undefined, points.slice(1, 3)),
  ).toEqual(points);
});

it("validates missing via vertices and mismatched layer transitions", () => {
  const p = crossingFixture(2);
  p.routes[0].vias = [
    { x: 33333, y: 21250, fromLayer: 1, toLayer: 0, drill: 300, radius: 450 },
  ];
  expect(validate(p).violations.some((v) => v.kind === "via")).toBe(true);
});

it("exports running state without pausing and discards stale-session commands", () => {
  const session = new SimulationSession();
  session.handle({
    version: 1,
    session: 7,
    type: "initialize",
    project: crossingFixture(),
  });
  session.handle({ version: 1, session: 7, type: "run" });
  session.advance();
  const response = session.handle({
    version: 1,
    session: 7,
    type: "snapshot",
    requestId: 42,
  });
  expect(response).toMatchObject({
    type: "snapshot",
    session: 7,
    requestId: 42,
    snapshot: {
      project: { tick: 1 },
      runtime: { running: true },
      routes: session.solver!.pbdEngine.routes,
    },
  });
  expect(session.running).toBe(true);
  expect(session.handle({ version: 1, session: 6, type: "pause" })).toBeNull();
  session.advance();
  expect(session.solver!.project.tick).toBe(2);
});

it("stops honestly at a tick budget and leaves unresolved live geometry available", () => {
  const session = new SimulationSession();
  session.maxTicks = 1;
  session.handle({
    version: 1,
    session: 1,
    type: "initialize",
    project: crossingFixture(),
  });
  session.handle({ version: 1, session: 1, type: "run" });
  const frame = session.advance();
  expect(frame).toMatchObject({
    running: false,
    stopReason: "budget-exhausted",
    representation: "live",
  });
  expect(frame!.report.violations.length).toBeGreaterThan(0);
  expect(session.solver!.lastQuantization).toBeNull();
});

it("only announces solved after a successful quantization and supports resume", () => {
  const session = new SimulationSession();
  session.handle({
    version: 1,
    session: 1,
    type: "initialize",
    project: crossingFixture(2),
  });
  session.handle({ version: 1, session: 1, type: "run" });
  for (let i = 0; i < 60 && session.running; i++) session.advance();
  expect(session.frame()).toMatchObject({
    stopReason: "solved",
    representation: "quantized",
    report: { violations: [] },
  });
  session.handle({ version: 1, session: 1, type: "step" });
  expect(session.frame()!.report.violations).toEqual([]);
});

it("configuration changes preserve particles and snapshot imports preserve stopping counters", () => {
  const session = new SimulationSession();
  session.handle({
    version: 1,
    session: 1,
    type: "initialize",
    project: crossingFixture(2),
  });
  session.handle({ version: 1, session: 1, type: "run" });
  for (let i = 0; i < 6; i++) session.advance();
  const before = structuredClone(session.solver!.pbdEngine.routes);
  session.handle({
    version: 1,
    session: 1,
    type: "configure",
    settings: { strength: 0.5, snaps: false },
  });
  expect(session.solver!.pbdEngine.routes).toEqual(before);
  expect(session.running).toBe(true);
  const response = session.handle({ version: 1, session: 1, type: "snapshot" });
  if (!response || !("snapshot" in response))
    throw new Error("Missing snapshot");
  const restored = new SimulationSession();
  restored.handle({
    version: 1,
    session: 2,
    type: "initialize",
    snapshot: parseSimulationSnapshot(JSON.stringify(response.snapshot)),
  });
  expect(restored.running).toBe(false);
  expect(restored.cleanTicks).toBe(session.cleanTicks);
  expect(restored.solver!.snapshot()).toEqual(session.solver!.snapshot());
});

it("affected-route validation includes foreign through-via copper", () => {
  const p = crossingFixture(2);
  p.routes[1].layer = 1;
  p.routes[1].points = [
    { x: 51250, y: 10000 },
    { x: 51250, y: 21250 },
    { x: 51250, y: 50000 },
  ];
  p.routes[1].vias = [
    { x: 51250, y: 21250, fromLayer: 1, toLayer: 0, radius: 450, drill: 300 },
  ];
  expect(
    validate(p, "A", true).violations.some((v) =>
      v.message.startsWith("Through via"),
    ),
  ).toBe(true);
});
