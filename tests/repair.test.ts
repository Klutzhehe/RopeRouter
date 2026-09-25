import { expect, it } from "vitest";
import { generate } from "../src/core/generate";
import { validate, contactPoint } from "../src/core/geometry";
import { Solver } from "../src/core/solver";
import type { Project } from "../src/core/model";

function crossing(): Project {
  const p = generate(2, 4, 1);
  p.walls = [];
  const ends = [
    { x: 10000, y: 20000 },
    { x: 100000, y: 20000 },
    { x: 55000, y: 10000 },
    { x: 55000, y: 30000 },
  ];
  p.components = ends.map((v, i) => ({
    id: `U${i}`,
    kind: "PASSIVE" as const,
    x: v.x - 1000,
    y: v.y - 1000,
    w: 4000,
    h: 4000,
    pads: [
      {
        ...v,
        id: `U${i}.1`,
        component: `U${i}`,
        radius: 550,
        net: i < 2 ? "A" : "B",
      },
      {
        x: v.x + 2500,
        y: v.y + 2000,
        id: `U${i}.2`,
        component: `U${i}`,
        radius: 550,
        net: null,
      },
    ],
  }));
  p.routes = [
    {
      id: "A",
      terminals: ["U0.1", "U1.1"],
      layer: 0,
      width: 300,
      control: { x: 55000, y: 20000 },
      points: ends.slice(0, 2),
      pressure: 0,
    },
    {
      id: "B",
      terminals: ["U2.1", "U3.1"],
      layer: 0,
      width: 300,
      control: { x: 55000, y: 20000 },
      points: ends.slice(2),
      pressure: 0,
    },
  ];
  return p;
}
it("places the diagnostic at the actual crossing", () =>
  expect(
    contactPoint(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 20, y: -10 },
      { x: 20, y: 10 },
    ),
  ).toEqual({ x: 20, y: 0 }));
it("repairs a same-layer crossing by going around a wire endpoint", () => {
  const s = new Solver(crossing());
  expect(validate(s.project).violations.some((v) => v.kind === "trace")).toBe(
    true,
  );
  // Large escapes wait for sustained stalling, rather than firing every 3 ticks.
  for (let i = 0; i < 60; i++) s.step();
  expect(validate(s.project).violations).toEqual([]);
  expect(s.events.some((e) => e.text.includes("cleared all conflicts"))).toBe(
    true,
  );
  expect(s.project.routes.every((r) => r.layer === 0)).toBe(true);
});
it("rejects a shorter snap that would leave a same-layer crossing", () => {
  const p = crossing();
  p.routes[0].points = [
    { x: 10000, y: 20000 },
    { x: 10000, y: 40000 },
    { x: 100000, y: 40000 },
    { x: 100000, y: 20000 },
  ];
  const s = new Solver(p),
    before = structuredClone(s.project);
  expect(
    s.tryCommit(0, [
      { x: 10000, y: 20000 },
      { x: 100000, y: 20000 },
    ]),
  ).toBe(false);
  expect(s.project).toEqual(before);
});
it("rejects a snap clearing one wall but still intersecting another", () => {
  const p = crossing();
  p.routes = p.routes.slice(0, 1);
  p.components = p.components.slice(0, 2);
  p.walls = [
    { id: "W1", x: 35000, y: 15000, w: 10000, h: 10000, layers: [0] },
    { id: "W2", x: 65000, y: 15000, w: 10000, h: 10000, layers: [0] },
  ];
  const s = new Solver(p),
    before = structuredClone(s.project);
  expect(
    s.tryCommit(0, [
      { x: 10000, y: 20000 },
      { x: 10000, y: 30000 },
      { x: 50000, y: 30000 },
      { x: 50000, y: 20000 },
      { x: 100000, y: 20000 },
    ]),
  ).toBe(false);
  expect(s.project).toEqual(before);
});
it("does not invent a solution through a full-height wall", () => {
  const p = crossing();
  p.routes = p.routes.slice(0, 1);
  p.components = p.components.slice(0, 2);
  p.walls = [
    { id: "barrier", x: 50000, y: 0, w: 5000, h: p.height, layers: [0] },
  ];
  const s = new Solver(p);
  for (let i = 0; i < 30; i++) s.step();
  expect(validate(s.project).violations.some((v) => v.kind === "wall")).toBe(
    true,
  );
  expect(s.best).toBeNull();
});
it("never introduces a conflict on a previously clear route", () => {
  const s = new Solver(generate(31, 8, 4));
  for (let tick = 0; tick < 40; tick++) {
    const before = structuredClone(s.project);
    s.step();
    for (const r of s.project.routes) {
      const old = before.routes.find((a) => a.id === r.id)!;
      if (JSON.stringify(old.points) !== JSON.stringify(r.points))
        expect(validate(s.project, r.id).violations).toEqual([]);
    }
  }
});
