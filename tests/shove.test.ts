import { describe, expect, it } from "vitest";
import { generate } from "../src/core/generate";
import { routeLength, validate } from "../src/core/geometry";
import { Solver } from "../src/core/solver";
import type { Project } from "../src/core/model";

function parallelShoveFixture(): Project {
  const p = generate(42, 4, 1);
  p.walls = [];
  p.clearance = 350;

  // Route A has a jog upwards: (10000, 20000) -> (30000, 20000) -> (30000, 25000) -> (70000, 25000) -> (70000, 20000) -> (90000, 20000)
  // Route B runs parallel right above Route A's jog: (25000, 25800) -> (75000, 25800)
  // Route B has open space above it (up to y=40000).
  // Route A wants to slide its jog further up or Route B slides up to let Route A tighten.
  const padsA = [
    { x: 10000, y: 20000, id: "UA.1", component: "UA", radius: 500, net: "NA" },
    { x: 90000, y: 20000, id: "UA.2", component: "UA", radius: 500, net: "NA" },
  ];
  const padsB = [
    { x: 20000, y: 35000, id: "UB.1", component: "UB", radius: 500, net: "NB" },
    { x: 80000, y: 35000, id: "UB.2", component: "UB", radius: 500, net: "NB" },
  ];

  p.components = [
    {
      id: "UA",
      kind: "PASSIVE",
      x: 9000,
      y: 19000,
      w: 82000,
      h: 2000,
      pads: padsA,
    },
    {
      id: "UB",
      kind: "PASSIVE",
      x: 19000,
      y: 34000,
      w: 62000,
      h: 2000,
      pads: padsB,
    },
  ];

  p.routes = [
    {
      id: "NA",
      terminals: ["UA.1", "UA.2"],
      layer: 0,
      width: 300,
      points: [
        { x: 10000, y: 20000 },
        { x: 30000, y: 20000 },
        { x: 35000, y: 25000 },
        { x: 65000, y: 25000 },
        { x: 70000, y: 20000 },
        { x: 90000, y: 20000 },
      ],
      control: { x: 50000, y: 25000 },
      pressure: 0,
    },
    {
      id: "NB",
      terminals: ["UB.1", "UB.2"],
      layer: 0,
      width: 300,
      // Route B runs closely above Route A's segment at y=25000:
      // required margin: (300+300)/2 + 350 = 650. At y=25800, gap is 800 > 650.
      points: [
        { x: 20000, y: 35000 },
        { x: 29200, y: 25800 },
        { x: 70800, y: 25800 },
        { x: 80000, y: 35000 },
      ],
      control: { x: 50000, y: 25800 },
      pressure: 0,
    },
  ];

  return p;
}

describe("Coordinated multi-net push-and-shove", () => {
  it("atomically commits coordinated mutations when clear", () => {
    const p = parallelShoveFixture();
    const s = new Solver(p);
    expect(validate(s.project).violations).toEqual([]);

    // Net B is shoved upwards to y=27000 (shortening B by ~994 um)
    // Net A shifts upwards to y=25200 (lengthening A by ~165 um)
    // Net total length decreases by ~828 um, maintaining 1800 um clearance
    const mutA = [
      { x: 10000, y: 20000 },
      { x: 30000, y: 20000 },
      { x: 35200, y: 25200 },
      { x: 64800, y: 25200 },
      { x: 70000, y: 20000 },
      { x: 90000, y: 20000 },
    ];
    const mutB = [
      { x: 20000, y: 35000 },
      { x: 28000, y: 27000 },
      { x: 72000, y: 27000 },
      { x: 80000, y: 35000 },
    ];

    const success = s.tryCommitCoordinated(
      [
        { index: 0, points: mutA },
        { index: 1, points: mutB },
      ],
      false,
    );
    expect(success).toBe(true);
    expect(validate(s.project).violations).toEqual([]);
    expect(s.project.routes[0].points[2].y).toBe(25200);
    expect(s.project.routes[1].points[1].y).toBe(27000);
  });

  it("rolls back all routes atomically if one candidate violates clearance", () => {
    const p = parallelShoveFixture();
    // Add a wall blocking route B above y=26500
    p.walls = [
      { id: "W_BLOCK", x: 40000, y: 26500, w: 20000, h: 5000, layers: [0] },
    ];
    const s = new Solver(p);
    const before = structuredClone(s.project);

    // Mutation A is fine, but Mutation B would hit the wall
    const mutA = [
      { x: 10000, y: 20000 },
      { x: 30000, y: 20000 },
      { x: 35000, y: 25100 },
      { x: 65000, y: 25100 },
      { x: 70000, y: 20000 },
      { x: 90000, y: 20000 },
    ];
    const mutB = [
      { x: 20000, y: 35000 },
      { x: 29200, y: 27000 },
      { x: 70800, y: 27000 },
      { x: 80000, y: 35000 },
    ];

    const success = s.tryCommitCoordinated(
      [
        { index: 0, points: mutA },
        { index: 1, points: mutB },
      ],
      false,
    );
    expect(success).toBe(false);
    // Entire project is restored to its exact before state
    expect(s.project).toEqual(before);
  });

  it("rejects non-octilinear coordinates or anchor displacement in coordinated proposals", () => {
    const p = parallelShoveFixture();
    const s = new Solver(p);
    // Non-octilinear candidate
    const nonOctilinear = [
      { x: 10000, y: 20000 },
      { x: 30000, y: 20000 },
      { x: 35000, y: 27123 }, // non-45 diagonal
      { x: 65000, y: 27123 },
      { x: 70000, y: 20000 },
      { x: 90000, y: 20000 },
    ];
    expect(
      s.tryCommitCoordinated([
        { index: 0, points: nonOctilinear },
        { index: 1, points: p.routes[1].points },
      ]),
    ).toBe(false);

    // Anchor moved candidate
    const anchorMoved = [
      { x: 10500, y: 20000 },
      ...p.routes[0].points.slice(1),
    ];
    expect(
      s.tryCommitCoordinated([
        { index: 0, points: anchorMoved },
        { index: 1, points: p.routes[1].points },
      ]),
    ).toBe(false);
  });

  it("relieves congested parallel routes by shoving the neighbor", () => {
    const p = parallelShoveFixture();
    const s = new Solver(p);
    const beforeLength = routeLength(s.project.routes[0]) + routeLength(s.project.routes[1]);

    // Step the simulation
    for (let tick = 0; tick < 50; tick++) {
      s.step();
      expect(validate(s.project).violations).toEqual([]);
    }

    const afterLength = routeLength(s.project.routes[0]) + routeLength(s.project.routes[1]);
    expect(afterLength).toBeLessThanOrEqual(beforeLength);
    expect(validate(s.project).violations).toEqual([]);
  });
});
