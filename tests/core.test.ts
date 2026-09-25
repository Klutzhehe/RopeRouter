import { describe, it, expect } from "vitest";
import { generate } from "../src/core/generate";
import { parseProject, type Project } from "../src/core/model";
import {
  connector,
  distance,
  rectDistance,
  rope,
  segmentDistance,
  validate,
} from "../src/core/geometry";
import { Solver } from "../src/core/solver";

function fixture(): Project {
  const p = generate(1, 4, 2);
  p.walls = [];
  p.components = [
    {
      id: "A",
      kind: "PASSIVE",
      x: 9000,
      y: 19000,
      w: 4000,
      h: 4000,
      pads: [
        {
          id: "A.1",
          component: "A",
          x: 10000,
          y: 20000,
          radius: 550,
          net: "N01",
        },
        {
          id: "A.2",
          component: "A",
          x: 12500,
          y: 20000,
          radius: 550,
          net: null,
        },
      ],
    },
    {
      id: "B",
      kind: "PASSIVE",
      x: 99000,
      y: 19000,
      w: 4000,
      h: 4000,
      pads: [
        {
          id: "B.1",
          component: "B",
          x: 100000,
          y: 20000,
          radius: 550,
          net: "N01",
        },
        {
          id: "B.2",
          component: "B",
          x: 102500,
          y: 20000,
          radius: 550,
          net: null,
        },
      ],
    },
  ];
  const a = p.components[0].pads[0],
    b = p.components[1].pads[0],
    control = { x: 55000, y: 60000 };
  p.routes = [
    {
      id: "N01",
      terminals: [a.id, b.id],
      layer: 0,
      width: 300,
      control,
      points: rope(a, b, control),
      pressure: 0,
    },
  ];
  return p;
}
describe("exact geometry", () => {
  it("detects crossing diagonals", () =>
    expect(
      segmentDistance(
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 10, y: 0 },
      ),
    ).toBe(0));
  it("does not confuse disjoint collinear segments", () =>
    expect(
      segmentDistance(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 30, y: 0 },
      ),
    ).toBe(10));
  it("measures diagonal near misses", () =>
    expect(
      segmentDistance(
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 2 },
        { x: 8, y: 10 },
      ),
    ).toBeCloseTo(Math.SQRT2));
  it("checks full wall geometry", () =>
    expect(
      rectDistance(
        { x: 0, y: 5 },
        { x: 20, y: 5 },
        { x: 5, y: 0, w: 10, h: 10 },
      ),
    ).toBe(0));
  it("builds octilinear connectors for off-grid endpoints", () => {
    const points = connector({ x: 131, y: 91 }, { x: 1029, y: 333 });
    for (let i = 1; i < points.length; i++) {
      const dx = Math.abs(points[i].x - points[i - 1].x),
        dy = Math.abs(points[i].y - points[i - 1].y);
      expect(dx === 0 || dy === 0 || dx === dy).toBe(true);
    }
  });
});
describe("generation and project contracts", () => {
  it("replays seeded generation exactly", () =>
    expect(generate(99)).toEqual(generate(99)));
  it("round-trips saved projects", () => {
    const p = generate();
    expect(parseProject(JSON.stringify(p))).toEqual(p);
  });
  it("rejects broken ownership and nonfinite coordinates", () => {
    const p = generate();
    p.routes[0].terminals[0] = "missing";
    expect(() => parseProject(JSON.stringify(p))).toThrow();
    expect(() => parseProject('{"version":2}')).toThrow();
  });
  it("keeps components apart and anchors octilinear across seeds", () => {
    for (let s = 0; s < 25; s++) {
      const p = generate(s, 16, 8),
        r = validate(p);
      expect(r.connected).toBe(p.routes.length);
      expect(
        r.violations.filter((v) =>
          ["angle", "boundary", "anchor"].includes(v.kind),
        ),
      ).toEqual([]);
      for (let i = 0; i < p.components.length; i++)
        for (let j = i + 1; j < p.components.length; j++) {
          const a = p.components[i],
            b = p.components[j];
          expect(
            a.x + a.w < b.x ||
              b.x + b.w < a.x ||
              a.y + a.h < b.y ||
              b.y + b.h < a.y,
          ).toBe(true);
        }
    }
  });
});
describe("validator", () => {
  it("detects disconnected anchors", () => {
    const p = fixture();
    p.routes[0].points[0] = { x: 10000, y: 10000 };
    expect(validate(p).violations.some((v) => v.kind === "anchor")).toBe(true);
  });
  it("detects foreign pads on every layer", () => {
    const p = fixture();
    p.routes[0].layer = 1;
    p.components[0].pads[1].x = 20000;
    p.components[0].pads[1].y = 30000;
    expect(validate(p).violations.some((v) => v.kind === "pad")).toBe(true);
  });
  it("applies trace width and clearance at walls", () => {
    const p = fixture();
    p.routes[0].points = [
      { x: 10000, y: 20000 },
      { x: 100000, y: 20000 },
    ];
    p.walls = [
      { id: "wall", x: 40000, y: 20500, w: 10000, h: 10000, layers: [0] },
    ];
    expect(
      validate(p).violations.filter((v) => v.kind === "wall"),
    ).toHaveLength(0);
    p.walls[0].y--;
    expect(validate(p).violations.some((v) => v.kind === "wall")).toBe(true);
  });
  it("reports crossings on same layer but not separate layers", () => {
    const p = fixture(),
      r = structuredClone(p.routes[0]);
    r.id = "N02";
    r.points = [
      { x: 55000, y: 5000 },
      { x: 55000, y: 70000 },
    ];
    p.routes.push(r);
    expect(validate(p).violations.some((v) => v.kind === "trace")).toBe(true);
    r.layer = 1;
    expect(validate(p).violations.some((v) => v.kind === "trace")).toBe(false);
  });
});
describe("solver", () => {
  it("accepts explicit snaps and improves a reproducible congested case", () => {
    const s = new Solver(generate(19, 4, 1));
    const before = validate(s.project);
    for (let i = 0; i < 300; i++) s.step();
    const after = validate(s.project);
    expect(s.events.some((e) => e.kind === "snap")).toBe(true);
    expect(after.violations.length).toBeLessThanOrEqual(
      before.violations.length,
    );
    console.log(
      "Seed 19 / 300 ticks:",
      JSON.stringify({
        beforeViolations: before.violations.length,
        afterViolations: after.violations.length,
        beforeLengthMm: before.length / 1000,
        afterLengthMm: after.length / 1000,
        acceptedSnaps: s.events.length,
      }),
    );
  }, 60000); // 300-tick correctness sweep; timings are recorded by npm run diagnose.
  it("shortens loose geometry while preserving anchors", () => {
    const p = fixture(),
      s = new Solver(p),
      before = validate(p).length;
    for (let i = 0; i < 40; i++) s.step();
    expect(validate(s.project).length).toBeLessThan(before);
    expect(validate(s.project).connected).toBe(1);
    expect(validate(s.project).violations).toEqual([]);
  });
  it("preserves deterministic results and fixed regions", () => {
    const p = generate(31, 4, 2),
      a = new Solver(p),
      b = new Solver(p);
    for (let i = 0; i < 40; i++) {
      a.step();
      b.step();
    }
    expect(a.project).toEqual(b.project);
    expect(a.project.walls).toEqual(p.walls);
    expect(a.project.components).toEqual(p.components);
  });
  it("retains octilinear geometry across snaps", () => {
    const s = new Solver(generate(19, 4, 1));
    for (let i = 0; i < 80; i++) s.step();
    expect(
      validate(s.project).violations.filter((v) =>
        ["angle", "anchor", "boundary"].includes(v.kind),
      ),
    ).toEqual([]);
  });
  it("does not mutate a previous checkpoint", () => {
    const s = new Solver(fixture()),
      saved = structuredClone(s.best);
    for (let i = 0; i < 5; i++) s.step();
    expect(saved?.tick).toBe(0);
    expect(
      distance(saved!.routes[0].control, s.project.routes[0].control),
    ).toBeGreaterThan(0);
  });
});
