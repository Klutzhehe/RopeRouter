import { expect, it } from "vitest";
import { COMPONENT_COUNTS, generate } from "../src/core/generate";
import { parseProject } from "../src/core/model";
import { validate } from "../src/core/geometry";
import { repairCandidates } from "../src/core/pbd/repair";
import { crossingFixture } from "./fixtures/crossing";

it.each(COMPONENT_COUNTS.filter((n) => n > 16))(
  "generates exactly %i components and nets within a valid expanded board",
  (count) => {
    for (const seed of [1, 99, 42017]) {
      const project = generate(seed, count, 4);
      expect(project.components).toHaveLength(count);
      expect(project.routes).toHaveLength(count);
      expect(project).toEqual(generate(seed, count, 4));
      expect(parseProject(JSON.stringify(project))).toEqual(project);
      expect(
        validate(project).violations.filter((v) =>
          ["boundary", "anchor", "angle"].includes(v.kind),
        ),
      ).toEqual([]);
      for (const a of project.components) {
        for (const b of [
          ...project.components.filter((b) => b.id !== a.id),
          ...project.walls,
        ]) {
          expect(
            a.x + a.w < b.x ||
              b.x + b.w < a.x ||
              a.y + a.h < b.y ||
              b.y + b.h < a.y,
          ).toBe(true);
        }
      }
    }
  },
);

it("rejects unsupported counts instead of silently dropping components", () => {
  for (const count of [0, 201, 2.5, NaN])
    expect(() => generate(1, count)).toThrow(/Component count/);
});

it("reuses geometry only across layers with identical obstacles", () => {
  const board = crossingFixture(3);
  board.walls = [
    {
      id: "layer-zero-barrier",
      x: 45000,
      y: 0,
      w: 10000,
      h: board.height,
      layers: [0],
    },
  ];
  const route = board.routes[0];
  const candidates = repairCandidates(board, route);
  expect(candidates.filter((c) => c.layer === 0)).toEqual([]);
  const one = candidates.filter((c) => c.layer === 1);
  const two = candidates.filter((c) => c.layer === 2);
  expect(one.length).toBeGreaterThan(0);
  expect(two.map((c) => ({ ...c, layer: 1 }))).toEqual(one);
  for (const candidate of candidates) {
    expect(
      validate({ ...board, routes: [candidate] }, candidate.id).violations,
    ).toEqual([]);
  }
}, 15000);
