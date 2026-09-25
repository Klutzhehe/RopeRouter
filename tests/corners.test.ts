import { expect, it } from "vitest";
import { generate } from "../src/core/generate";
import {
  acuteCorner,
  cornerSweepClear,
  localShortcuts,
  routeLength,
  shortcutSweepClear,
  validate,
} from "../src/core/geometry";
import { Solver } from "../src/core/solver";
import type { Point, Project } from "../src/core/model";

export function hairpinFixture(): Project {
  const p = generate(10, 4, 4);
  p.settings.snaps = false;
  p.walls = [
    { id: "protected", x: 35000, y: 15000, w: 30000, h: 43000, layers: [3] },
  ];
  const ends = [
    { x: 10000, y: 40000 },
    { x: 80000, y: 10000 },
  ];
  p.components = ends.map((v, i) => ({
    id: `P${i}`,
    kind: "PASSIVE" as const,
    x: v.x - 1000,
    y: v.y - 1000,
    w: 4000,
    h: 4000,
    pads: [
      { ...v, id: `P${i}.1`, component: `P${i}`, radius: 550, net: "pink" },
      {
        x: v.x + 2500,
        y: v.y - 500,
        id: `P${i}.2`,
        component: `P${i}`,
        radius: 550,
        net: null,
      },
    ],
  }));
  p.routes = [
    {
      id: "pink",
      terminals: ["P0.1", "P1.1"],
      width: 300,
      layer: 3,
      control: { x: 80000, y: 40000 },
      points: [
        ends[0],
        { x: 30000, y: 60000 },
        { x: 100000, y: 60000 },
        { x: 80000, y: 40000 },
        ends[1],
      ],
      pressure: 0,
    },
  ];
  return p;
}
const countAcute = (points: Point[]) =>
  points.slice(1, -1).filter((b, i) => acuteCorner(points[i], b, points[i + 2]))
    .length;
it("detects an acute inside corner separately from legal segment headings", () => {
  expect(acuteCorner({ x: 0, y: 10 }, { x: 20, y: 10 }, { x: 10, y: 0 })).toBe(
    true,
  );
  expect(acuteCorner({ x: 0, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 0 })).toBe(
    false,
  );
});
it("generates two-segment shortcuts without disturbing neighboring anchors", () => {
  const points = [
    { x: 0, y: 10 },
    { x: 30, y: 10 },
    { x: 20, y: 0 },
    { x: 20, y: -20 },
  ];
  expect(
    localShortcuts(points).some(
      (edit) =>
        JSON.stringify(edit.points) ===
        JSON.stringify([
          { x: 0, y: 10 },
          { x: 10, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: -20 },
        ]),
    ),
  ).toBe(true);
});
it("tightens a multi-bend pink hairpin with snapping disabled, preserving protected copper", () => {
  const p = hairpinFixture(),
    s = new Solver(p),
    before = routeLength(p.routes[0]);
  expect(validate(p).violations).toEqual([]);
  expect(countAcute(p.routes[0].points)).toBe(1);
  for (let i = 0; i < 100; i++) {
    s.step();
    expect(validate(s.project).violations).toEqual([]);
  }
  expect(routeLength(s.project.routes[0])).toBeLessThan(before - 1000);
  expect(countAcute(s.project.routes[0].points)).toBe(0);
  expect(s.project.walls).toEqual(p.walls);
  expect(s.project.components).toEqual(p.components);
});
it("checks a protected island entirely within the swept patch", () => {
  const p = hairpinFixture(),
    r = p.routes[0];
  p.walls = [
    { id: "island", x: 70000, y: 49000, w: 1000, h: 1000, layers: [3] },
  ];
  expect(
    cornerSweepClear(p, r, [
      { x: 60000, y: 60000 },
      { x: 100000, y: 60000 },
      { x: 60000, y: 20000 },
    ]),
  ).toBe(false);
});
it("rejects a local shortcut whose endpoint route is clear but crosses an island during motion", () => {
  const p = hairpinFixture(),
    r = p.routes[0];
  p.walls = [
    { id: "island", x: 69000, y: 44000, w: 1000, h: 1000, layers: [3] },
  ];
  expect(
    shortcutSweepClear(p, r, [
      { x: 50000, y: 60000 },
      { x: 100000, y: 60000 },
      { x: 80000, y: 20000 },
      { x: 50000, y: 30000 },
    ]),
  ).toBe(false);
  p.walls[0].layers = [0];
  expect(
    shortcutSweepClear(p, r, [
      { x: 50000, y: 60000 },
      { x: 100000, y: 60000 },
      { x: 80000, y: 20000 },
      { x: 50000, y: 30000 },
    ]),
  ).toBe(true);
});
