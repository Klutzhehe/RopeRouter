import { expect, it } from "vitest";
import { BoardSweep, type ConflictOracle } from "../src/core/pbd/board-sweep";
import { routesConflict } from "../src/core/pbd/repair";
import { crossingFixture } from "./fixtures/crossing";
import { SimulationSession } from "../src/core/simulation";

const exact: ConflictOracle = {
  async conflicts(candidates, others, clearance) {
    return Uint8Array.from(
      candidates.flatMap((a) =>
        others.map((b) =>
          a.id !== b.id && routesConflict(a, b, clearance) ? 1 : 0,
        ),
      ),
    );
  },
};

it("accelerated scoring keeps the CPU proposal sequence and full sweep state", async () => {
  const board = crossingFixture(2);
  const cpu = new BoardSweep(board);
  for (let i = 0; i < board.routes.length; i++) cpu.initializeRoute(i);
  const accelerated = new BoardSweep(board, cpu.snapshot());
  // Separate batch sizes must consume exactly the same RNG tie decisions.
  for (let i = 0; i < 20 && cpu.state.phase === "searching"; i++) {
    cpu.step();
    do {
      await accelerated.advanceAccelerated(exact, 1024);
    } while (accelerated.state.evaluation);
    expect(accelerated.snapshot()).toEqual(cpu.snapshot());
  }
  expect(accelerated.state.phase).toBe("solved");
});

it("restores a partially accelerated evaluation in either backend", async () => {
  const board = crossingFixture(2);
  const sweep = new BoardSweep(board);
  for (let i = 0; i < board.routes.length; i++) sweep.initializeRoute(i);
  await sweep.advanceAccelerated(exact, 7);
  const snapshot = sweep.snapshot();
  expect(snapshot.evaluation?.cursor).toBe(7);
  const restored = new BoardSweep(board, snapshot);
  do {
    sweep.advance(24);
  } while (sweep.state.evaluation);
  do {
    await restored.advanceAccelerated(exact, 31);
  } while (restored.state.evaluation);
  expect(restored.snapshot()).toEqual(sweep.snapshot());
});

it("does not trust a false zero-conflict accelerator result at the commit boundary", async () => {
  const board = crossingFixture(2),
    sweep = new BoardSweep(board);
  for (let i = 0; i < board.routes.length; i++) sweep.initializeRoute(i);
  sweep.state.working = structuredClone(board.routes);
  await sweep.advanceAccelerated({
    async conflicts(a, b) {
      return new Uint8Array(a.length * b.length);
    },
  });
  expect(sweep.state.phase).toBe("stalled");
  expect(sweep.report().violations.length).toBeGreaterThan(0);
});

it("rejects malformed accelerator output and leaves live state untouched", async () => {
  const session = new SimulationSession();
  session.handle({
    version: 1,
    session: 1,
    type: "initialize",
    project: crossingFixture(2),
  });
  const sweep = (session.solver!.sweep = new BoardSweep(
    session.solver!.project,
  ));
  for (let i = 0; i < 2; i++) sweep.initializeRoute(i);
  session.handle({ version: 1, session: 1, type: "run" });
  const before = structuredClone(session.solver!.pbdEngine.routes);
  await expect(
    session.advanceAccelerated({
      async conflicts() {
        return Uint8Array.from([7]);
      },
    }),
  ).rejects.toThrow(/matrix/);
  expect(session.solver!.pbdEngine.routes).toEqual(before);
});
