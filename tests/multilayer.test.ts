import { describe, expect, it } from "vitest";
import { generate } from "../src/core/generate";
import { routeSegments, validate } from "../src/core/geometry";
import { Solver } from "../src/core/solver";
import type { Project } from "../src/core/model";

function twoLayerCrossingFixture(): Project {
  const p = generate(77, 4, 2); // 2 layers available
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
  // Both routes initially placed on layer 0, causing a crossing violation
  p.routes = [
    {
      id: "A",
      terminals: ["U0.1", "U1.1"],
      layer: 0,
      width: 300,
      control: { x: 55000, y: 20000 },
      points: ends.slice(0, 2),
      pressure: 0,
      vias: [],
    },
    {
      id: "B",
      terminals: ["U2.1", "U3.1"],
      layer: 0,
      width: 300,
      control: { x: 55000, y: 20000 },
      points: ends.slice(2),
      pressure: 0,
      vias: [],
    },
  ];
  return p;
}

describe("Multilayer routing & through-vias (Stage 5)", () => {
  it("resolves a crossing by discrete layer reassignment", () => {
    const p = twoLayerCrossingFixture();
    expect(validate(p).violations.some((v) => v.kind === "trace")).toBe(true);

    const s = new Solver(p);
    // Move route B to layer 1
    const committed = s.tryCommitLayer(1, 1);
    expect(committed).toBe(true);
    expect(s.project.routes[1].layer).toBe(1);

    // Crossing is completely resolved because routes are on different copper layers
    const report = validate(s.project);
    expect(report.violations).toEqual([]);
    expect(report.occupied).toBe(2);
  });

  it("rejects an invalid or out-of-range layer assignment", () => {
    const p = twoLayerCrossingFixture();
    const s = new Solver(p);
    expect(s.tryCommitLayer(0, 5)).toBe(false); // only 2 layers exist (0, 1)
    expect(s.tryCommitLayer(0, -1)).toBe(false);
    expect(s.tryCommitLayer(0, 0)).toBe(false); // same layer
  });

  it("rejects a through-via that intersects protected copper on an intermediate layer", () => {
    const p = twoLayerCrossingFixture();
    p.layers = 4; // 4 layer board
    // Protected wall on layer 2 only
    p.walls = [
      { id: "INTERNAL_WALL", x: 40000, y: 15000, w: 20000, h: 10000, layers: [2] },
    ];
    // Route A is on layer 0, with a via at (50000, 20000) transitioning to layer 1
    p.routes[0].points = [
      { x: 10000, y: 20000 },
      { x: 50000, y: 20000 },
      { x: 100000, y: 20000 },
    ];
    p.routes[0].vias = [
      {
        x: 50000,
        y: 20000,
        fromLayer: 0,
        toLayer: 1,
        drill: 300,
        radius: 450,
      },
    ];

    // Even though route A routes between layer 0 and layer 1, the through-via drills
    // through layer 2 where INTERNAL_WALL lives.
    const report = validate(p);
    const wallViol = report.violations.find((v) => v.kind === "wall");
    expect(wallViol).toBeDefined();
    expect(wallViol?.objects).toContain("INTERNAL_WALL");
    expect(wallViol?.layer).toBe(2);
  });

  it("detects via clearance violations against foreign traces and pads", () => {
    const p = twoLayerCrossingFixture();
    p.routes[0].points = [
      { x: 10000, y: 20000 },
      { x: 55000, y: 20000 },
      { x: 100000, y: 20000 },
    ];
    // Place a via at (55000, 20000) directly on the crossing with route B (which has pad / segment at (55000, 20000))
    p.routes[0].vias = [
      {
        x: 55000,
        y: 20000,
        fromLayer: 0,
        toLayer: 1,
        drill: 300,
        radius: 450,
      },
    ];
    const report = validate(p);
    expect(report.violations.some((v) => v.kind === "trace" && v.objects.includes("B"))).toBe(true);
  });

  it("preserves terminal anchor connection when transitioning layers", () => {
    const p = twoLayerCrossingFixture();
    const s = new Solver(p);
    s.tryCommitLayer(1, 1);
    expect(s.project.routes[1].points[0]).toEqual({ x: 55000, y: 10000 });
    expect(s.project.routes[1].points.at(-1)).toEqual({ x: 55000, y: 30000 });
    expect(validate(s.project).connected).toBe(2);
  });

  it("inserts and collapses via bypasses cleanly", () => {
    const p = twoLayerCrossingFixture();
    p.routes[0].points = [
      { x: 10000, y: 20000 },
      { x: 40000, y: 20000 },
      { x: 70000, y: 20000 },
      { x: 100000, y: 20000 },
    ];
    // Net B crosses at x=55000 on layer 0
    const s = new Solver(p);
    // Insert via bypass on route A between index 1 (40000) and index 2 (70000) to layer 1
    const bypassed = s.tryCommitViaBypass(0, 1, 2, 1);
    expect(bypassed).toBe(true);
    expect(s.project.routes[0].vias?.length).toBe(2);

    // Segment between (40000, 20000) and (70000, 20000) is now on layer 1!
    const segs = routeSegments(s.project.routes[0]);
    expect(segs[0].layer).toBe(0);
    expect(segs[1].layer).toBe(1);
    expect(segs[2].layer).toBe(0);

    // Crossing with route B (on layer 0) is bypassed!
    expect(validate(s.project).violations).toEqual([]);
    expect(validate(s.project).vias).toBe(2);

    // Now remove route B so layer 0 is clear, and verify via collapse
    s.project.routes.splice(1, 1);
    const collapsed = s.tryCollapseVias(0);
    expect(collapsed).toBe(true);
    expect(s.project.routes[0].vias).toEqual([]);
    expect(validate(s.project).vias).toBe(0);
  });
});
