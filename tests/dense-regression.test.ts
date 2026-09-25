import { expect, it } from "vitest";
import { generate } from "../src/core/generate";
import { Solver } from "../src/core/solver";
import { SimulationSession } from "../src/core/simulation";
import { validate } from "../src/core/geometry";
import { PbdEngine } from "../src/core/pbd/pbd-engine";
import { crossingFixture } from "./fixtures/crossing";

it.each([
  [12, 4],
  [16, 2],
])(
  "solves seed 42017 with %i components and %i layers through the actual worker lifecycle",
  (count, layers) => {
    const session = new SimulationSession();
    session.handle({
      version: 1,
      session: 1,
      type: "initialize",
      project: generate(42017, count, layers),
    });
    session.handle({ version: 1, session: 1, type: "run" });
    let wasClear = false;
    while (session.running && session.solver!.project.tick < 150) {
      // Restore after candidate caches have warmed; derived caches must not
      // change the next deterministic simulation result.
      const replay =
        session.solver!.project.tick === 29
          ? Solver.restore(session.solver!.snapshot())
          : null;
      const frame = session.advance()!;
      if (replay) {
        replay.step();
        expect(session.solver!.snapshot()).toEqual(replay.snapshot());
      }
      if (wasClear) expect(frame.report.violations).toEqual([]);
      if (!frame.report.violations.length) wasClear = true;
    }
    expect(session.frame()).toMatchObject({
      running: false,
      stopReason: "solved",
      representation: "quantized",
    });
    expect(validate(session.solver!.project).violations).toEqual([]);
    expect(session.solver!.pbdEngine.getCrossings()).toEqual([]);
    for (let i = 0; i < 30; i++) {
      session.handle({ version: 1, session: 1, type: "step" });
      expect(session.frame()!.report.violations).toEqual([]);
    }
  },
  120000,
);

it("coordinated replacements reject all participants together when one remains blocked", () => {
  const p = crossingFixture(2);
  const engine = new PbdEngine(p);
  const before = structuredClone(engine.routes);
  const [a, b] = engine.toRoutes();
  expect(
    engine.tryReplaceRoutes(
      [
        { ...a, layer: 1 },
        { ...b, layer: 1 },
      ],
      1,
      "coordinated-test",
    ),
  ).toBe(false);
  expect(engine.routes).toEqual(before);
  expect(
    engine.tryReplaceRoutes([{ ...a, layer: 1 }, b], 1, "coordinated-test"),
  ).toBe(true);
  expect(validate(engine.getProject(), undefined, true).violations).toEqual([]);
});
