import { expect, it } from "vitest";
import { BoardSweep, directionalLayers } from "../src/core/pbd/board-sweep";
import { PbdEngine } from "../src/core/pbd/pbd-engine";
import { generate } from "../src/core/generate";
import { validate } from "../src/core/geometry";
import { Solver } from "../src/core/solver";
import { crossingFixture } from "./fixtures/crossing";

it("resumes in the middle of an evaluated sweep without changing live copper", () => {
  const solver = new Solver(generate(42017, 12, 4));
  const before = structuredClone(solver.pbdEngine.routes);
  // Stop inside the first candidate scan, not merely at a completed route.
  while (!solver.sweep?.state.evaluation) solver.step();
  expect(solver.pbdEngine.routes).toEqual(before);
  const snapshot = solver.snapshot();
  const restored = Solver.restore(snapshot);
  for (let i = 0; i < 4; i++) {
    solver.step();
    restored.step();
  }
  expect(restored.snapshot()).toEqual(solver.snapshot());
}, 60000);

it("keeps an impossible full-height barrier unresolved", () => {
  const board = crossingFixture(2);
  board.walls = [
    { id: "sealed", x: 45000, y: 0, w: 10000, h: board.height, layers: [0, 1] },
  ];
  const sweep = new BoardSweep(board);
  sweep.advance();
  expect(sweep.state.phase).toBe("stalled");
  expect(sweep.state.reason).toContain("No statically clear");
  expect(sweep.working).toEqual([]);
});

it("checks via barrels on all layers before committing a layered sweep", () => {
  const board = crossingFixture(2);
  const first = board.routes[0];
  const candidate = directionalLayers(
    {
      ...first,
      points: [
        first.points[0],
        { x: 30000, y: 21250 },
        { x: 30000, y: 30000 },
        { x: 90000, y: 30000 },
        first.points[1],
      ],
    },
    0,
    1,
  );
  board.routes[1] = {
    ...board.routes[1],
    layer: 1,
    points: [
      board.routes[1].points[0],
      { x: 30000, y: 21250 },
      board.routes[1].points.at(-1)!,
    ],
  };
  const engine = new PbdEngine(board);
  const before = structuredClone(engine.routes);
  expect(engine.tryReplaceRoute(candidate, 1, "sweep-test")).toBe(false);
  expect(engine.routes).toEqual(before);
  expect(
    validate(
      { ...board, routes: [candidate, board.routes[1]] },
      candidate.id,
      true,
    ).violations.some((v) => v.kind === "trace"),
  ).toBe(true);
});
