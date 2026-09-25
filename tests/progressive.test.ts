import { describe, it, expect } from "vitest";
import { PbdEngine } from "../src/core/pbd/pbd-engine";
import { TopologicalSupervisor } from "../src/core/pbd/topological-snap";
import { Solver } from "../src/core/solver";
import { validate, routeLength } from "../src/core/geometry";
import { quantizeProject } from "../src/core/pbd/quantize";
import type { Project, Route } from "../src/core/model";

function createEmptyProject(layers = 1): Project {
  return {
    version: 1,
    units: "um",
    name: "progressive-test",
    seed: 1234,
    width: 100000,
    height: 60000,
    layers,
    clearance: 350,
    components: [],
    routes: [],
    walls: [],
    settings: { strength: 1, snaps: true },
    tick: 0,
    rng: 1234,
  };
}

describe("Tier 1: Single Wire (1-Wire) Scenarios", () => {
  it("1-wire: straight unobstructed wire pulls taut into clean geodesic", () => {
    const p = createEmptyProject(1);
    p.components = [
      {
        id: "U1",
        kind: "PASSIVE",
        x: 8000,
        y: 18000,
        w: 4000,
        h: 4000,
        pads: [{ id: "P1A", component: "U1", x: 10000, y: 20000, radius: 550, net: "N01" }],
      },
      {
        id: "U2",
        kind: "PASSIVE",
        x: 88000,
        y: 18000,
        w: 4000,
        h: 4000,
        pads: [{ id: "P1B", component: "U2", x: 90000, y: 20000, radius: 550, net: "N01" }],
      },
    ];
    // Start with a large intentional slack/jog at y = 45000
    p.routes = [
      {
        id: "N01",
        terminals: ["P1A", "P1B"],
        layer: 0,
        width: 300,
        points: [
          { x: 10000, y: 20000 },
          { x: 50000, y: 45000 },
          { x: 90000, y: 20000 },
        ],
        control: { x: 50000, y: 45000 },
        pressure: 0,
      },
    ];

    const solver = new Solver(p);
    const initialLen = routeLength(solver.getLiveProject().routes[0]);

    for (let t = 0; t < 40; t++) {
      solver.step();
    }

    const live = solver.getLiveProject();
    const finalLen = routeLength(live.routes[0]);
    // Wire should pull taut towards straight 80000 um length
    expect(finalLen).toBeLessThan(initialLen - 5000);
    // All interior nodes should have relaxed down towards y = 20000 (from 45000)
    for (const pt of live.routes[0].points) {
      expect(pt.y).toBeLessThan(38000);
    }
    const report = validate(solver.project);
    expect(report.violations).toEqual([]);
  });

  it("1-wire: deflects smoothly around a circular foreign pad without shorting", () => {
    const p = createEmptyProject(1);
    p.components = [
      {
        id: "U1",
        kind: "PASSIVE",
        x: 8000,
        y: 18000,
        w: 4000,
        h: 4000,
        pads: [{ id: "P1A", component: "U1", x: 10000, y: 20000, radius: 550, net: "N01" }],
      },
      {
        id: "U2",
        kind: "PASSIVE",
        x: 88000,
        y: 18000,
        w: 4000,
        h: 4000,
        pads: [{ id: "P1B", component: "U2", x: 90000, y: 20000, radius: 550, net: "N01" }],
      },
      // Foreign pad placed directly on the centerline: (50000, 20000)
      {
        id: "U_BLOCK",
        kind: "PASSIVE",
        x: 48000,
        y: 18000,
        w: 4000,
        h: 4000,
        pads: [{ id: "P_FOREIGN", component: "U_BLOCK", x: 50000, y: 20000, radius: 1000, net: "FOREIGN" }],
      },
    ];
    p.routes = [
      {
        id: "N01",
        terminals: ["P1A", "P1B"],
        layer: 0,
        width: 300,
        points: [
          { x: 10000, y: 20000 },
          { x: 90000, y: 20000 },
        ],
        control: { x: 50000, y: 20000 },
        pressure: 0,
      },
    ];

    const solver = new Solver(p);
    for (let t = 0; t < 30; t++) {
      solver.step();
    }

    const live = solver.getLiveProject();
    // Distance from every point to (50000, 20000) must exceed pad.radius + clearance + width/2
    const reqDist = 1000 + 350 + 150; // 1500 um
    for (const pt of live.routes[0].points) {
      if (Math.abs(pt.x - 50000) < 500) {
        const d = Math.hypot(pt.x - 50000, pt.y - 20000);
        expect(d).toBeGreaterThanOrEqual(reqDist - 50);
      }
    }
  });

  it("1-wire: expels itself out of a rectangular keepout wall into open corridor", () => {
    const p = createEmptyProject(1);
    p.components = [
      {
        id: "U1",
        kind: "PASSIVE",
        x: 8000,
        y: 28000,
        w: 4000,
        h: 4000,
        pads: [{ id: "P1A", component: "U1", x: 10000, y: 30000, radius: 550, net: "N01" }],
      },
      {
        id: "U2",
        kind: "PASSIVE",
        x: 88000,
        y: 28000,
        w: 4000,
        h: 4000,
        pads: [{ id: "P1B", component: "U2", x: 90000, y: 30000, radius: 550, net: "N01" }],
      },
    ];
    // Keepout wall directly spanning y=20000..40000 in the middle
    p.walls = [
      {
        id: "KEEPOUT",
        x: 40000,
        y: 20000,
        w: 20000,
        h: 20000,
        layers: [0],
      },
    ];
    p.routes = [
      {
        id: "N01",
        terminals: ["P1A", "P1B"],
        layer: 0,
        width: 300,
        points: [
          { x: 10000, y: 30000 },
          { x: 90000, y: 30000 },
        ],
        control: { x: 50000, y: 30000 },
        pressure: 0,
      },
    ];

    const solver = new Solver(p);
    for (let t = 0; t < 40; t++) {
      solver.step();
    }

    const live = solver.getLiveProject();
    // Verify no node is inside the wall box
    const margin = 300 / 2 + p.clearance;
    for (const pt of live.routes[0].points) {
      const inX = pt.x > 40000 - margin && pt.x < 60000 + margin;
      const inY = pt.y > 20000 - margin && pt.y < 40000 + margin;
      expect(inX && inY).toBe(false);
    }
  });

  it("1-wire: navigates cleanly around a fixed barrier in the middle", () => {
    const p = createEmptyProject(1);
    p.components = [
      {
        id: "U1",
        kind: "PASSIVE",
        x: 18000,
        y: 28000,
        w: 4000,
        h: 4000,
        pads: [{ id: "P1A", component: "U1", x: 20000, y: 30000, radius: 550, net: "N01" }],
      },
      {
        id: "U2",
        kind: "PASSIVE",
        x: 78000,
        y: 28000,
        w: 4000,
        h: 4000,
        pads: [{ id: "P1B", component: "U2", x: 80000, y: 30000, radius: 550, net: "N01" }],
      },
    ];
    // Vertical barrier from y=15000 to y=45000
    p.walls = [
      {
        id: "BARRIER",
        x: 48000,
        y: 15000,
        w: 4000,
        h: 30000,
        layers: [0],
      },
    ];
    p.routes = [
      {
        id: "N01",
        terminals: ["P1A", "P1B"],
        layer: 0,
        width: 300,
        points: [
          { x: 20000, y: 30000 },
          { x: 80000, y: 30000 },
        ],
        control: { x: 50000, y: 30000 },
        pressure: 0,
      },
    ];

    const solver = new Solver(p);
    for (let t = 0; t < 50; t++) {
      solver.step();
    }

    const live = solver.getLiveProject();
    // Route must detour North (y < 15000) or South (y > 45000)
    const midXPoints = live.routes[0].points.filter((pt) => Math.abs(pt.x - 50000) < 3000);
    expect(midXPoints.length).toBeGreaterThan(0);
    for (const pt of midXPoints) {
      const cleared = pt.y < 15000 - 300 || pt.y > 45000 + 300;
      expect(cleared).toBe(true);
    }
  });
});

describe("Tier 2: Two Wire (2-Wire) Scenarios", () => {
  it("2-wire: pushes two overlapping parallel traces apart until completely separated", () => {
    const p = createEmptyProject(1);
    p.components = [
      {
        id: "U1",
        kind: "PASSIVE",
        x: 10000,
        y: 20000,
        w: 4000,
        h: 4000,
        pads: [
          { id: "P1A", component: "U1", x: 12000, y: 22000, radius: 450, net: "N01" },
        ],
      },
      {
        id: "U2",
        kind: "PASSIVE",
        x: 80000,
        y: 20000,
        w: 4000,
        h: 4000,
        pads: [
          { id: "P1B", component: "U2", x: 82000, y: 22000, radius: 450, net: "N01" },
        ],
      },
      {
        id: "U3",
        kind: "PASSIVE",
        x: 10000,
        y: 25000,
        w: 4000,
        h: 4000,
        pads: [
          { id: "P2A", component: "U3", x: 12000, y: 27000, radius: 450, net: "N02" },
        ],
      },
      {
        id: "U4",
        kind: "PASSIVE",
        x: 80000,
        y: 25000,
        w: 4000,
        h: 4000,
        pads: [
          { id: "P2B", component: "U4", x: 82000, y: 27000, radius: 450, net: "N02" },
        ],
      },
    ];
    // N01 and N02 overlap along y=24900 and y=25000 (gap is only 100 um, < 600 um required)
    p.routes = [
      {
        id: "N01",
        terminals: ["P1A", "P1B"],
        layer: 0,
        width: 250,
        points: [
          { x: 12000, y: 22000 },
          { x: 20000, y: 22000 },
          { x: 20000, y: 24900 },
          { x: 74000, y: 24900 },
          { x: 74000, y: 22000 },
          { x: 82000, y: 22000 },
        ],
        control: { x: 47000, y: 24900 },
        pressure: 0,
      },
      {
        id: "N02",
        terminals: ["P2A", "P2B"],
        layer: 0,
        width: 250,
        points: [
          { x: 12000, y: 27000 },
          { x: 20000, y: 27000 },
          { x: 20000, y: 25000 },
          { x: 74000, y: 25000 },
          { x: 74000, y: 27000 },
          { x: 82000, y: 27000 },
        ],
        control: { x: 47000, y: 25000 },
        pressure: 0,
      },
    ];

    const solver = new Solver(p);
    for (let t = 0; t < 25; t++) {
      solver.step();
      if (validate(solver.project).violations.length === 0) break;
    }

    const report = validate(solver.project);
    expect(report.violations.length).toBe(0);
    expect(solver.events.some((e) => e.text.includes("wiggled") || e.text.includes("pushed"))).toBe(true);
  });

  it("2-wire: resolves perpendicular crossing on multi-layer board via layer migration", () => {
    const p = createEmptyProject(2);
    p.components = [
      {
        id: "UA",
        kind: "PASSIVE",
        x: 8000,
        y: 18000,
        w: 4000,
        h: 4000,
        pads: [{ id: "PA1", component: "UA", x: 10000, y: 20000, radius: 500, net: "NA" }],
      },
      {
        id: "UB",
        kind: "PASSIVE",
        x: 88000,
        y: 18000,
        w: 4000,
        h: 4000,
        pads: [{ id: "PA2", component: "UB", x: 90000, y: 20000, radius: 500, net: "NA" }],
      },
      {
        id: "UC",
        kind: "PASSIVE",
        x: 48000,
        y: 8000,
        w: 4000,
        h: 4000,
        pads: [{ id: "PB1", component: "UC", x: 50000, y: 10000, radius: 500, net: "NB" }],
      },
      {
        id: "UD",
        kind: "PASSIVE",
        x: 48000,
        y: 48000,
        w: 4000,
        h: 4000,
        pads: [{ id: "PB2", component: "UD", x: 50000, y: 50000, radius: 500, net: "NB" }],
      },
    ];
    // NA and NB intersect at (50000, 20000) on layer 0
    p.routes = [
      {
        id: "NA",
        terminals: ["PA1", "PA2"],
        layer: 0,
        width: 300,
        points: [
          { x: 10000, y: 20000 },
          { x: 90000, y: 20000 },
        ],
        control: { x: 50000, y: 20000 },
        pressure: 0,
      },
      {
        id: "NB",
        terminals: ["PB1", "PB2"],
        layer: 0,
        width: 300,
        points: [
          { x: 50000, y: 10000 },
          { x: 50000, y: 50000 },
        ],
        control: { x: 50000, y: 30000 },
        pressure: 0,
      },
    ];

    const solver = new Solver(p);
    for (let t = 0; t < 15; t++) {
      solver.step();
      if (validate(solver.project).violations.length === 0) break;
    }

    const report = validate(solver.project);
    // One of the routes should have migrated to layer 1
    const layers = new Set(solver.project.routes.map((r) => r.layer));
    expect(layers.size).toBe(2);
  });

  it("2-wire: resolves perpendicular crossing on single-layer board via detour around wire tip", () => {
    const p = createEmptyProject(1);
    p.components = [
      {
        id: "UA",
        kind: "PASSIVE",
        x: 8000,
        y: 18000,
        w: 4000,
        h: 4000,
        pads: [{ id: "PA1", component: "UA", x: 10000, y: 20000, radius: 500, net: "NA" }],
      },
      {
        id: "UB",
        kind: "PASSIVE",
        x: 88000,
        y: 18000,
        w: 4000,
        h: 4000,
        pads: [{ id: "PA2", component: "UB", x: 90000, y: 20000, radius: 500, net: "NA" }],
      },
      {
        id: "UC",
        kind: "PASSIVE",
        x: 48000,
        y: 8000,
        w: 4000,
        h: 4000,
        pads: [{ id: "PB1", component: "UC", x: 50000, y: 10000, radius: 500, net: "NB" }],
      },
      {
        id: "UD",
        kind: "PASSIVE",
        x: 48000,
        y: 48000,
        w: 4000,
        h: 4000,
        pads: [{ id: "PB2", component: "UD", x: 50000, y: 50000, radius: 500, net: "NB" }],
      },
    ];
    // NA and NB intersect at (50000, 20000) on single layer 0
    p.routes = [
      {
        id: "NA",
        terminals: ["PA1", "PA2"],
        layer: 0,
        width: 300,
        points: [
          { x: 10000, y: 20000 },
          { x: 90000, y: 20000 },
        ],
        control: { x: 50000, y: 20000 },
        pressure: 0,
      },
      {
        id: "NB",
        terminals: ["PB1", "PB2"],
        layer: 0,
        width: 300,
        points: [
          { x: 50000, y: 10000 },
          { x: 50000, y: 50000 },
        ],
        control: { x: 50000, y: 30000 },
        pressure: 0,
      },
    ];

    const solver = new Solver(p);
    for (let t = 0; t < 30; t++) {
      solver.step();
      if (validate(solver.project).violations.length === 0) break;
    }

    const report = validate(solver.project);
    expect(report.violations.length).toBe(0);
    expect(solver.project.routes.every((r) => r.layer === 0)).toBe(true);
  });
});

describe("Tier 3: Multi-Wire & Progressive Scaling", () => {
  it("4-wire: parallel bus traces maintain clearance through a corridor", () => {
    const p = createEmptyProject(1);
    const busY = [15000, 20000, 25000, 30000];
    p.components = [];
    p.routes = [];

    for (let i = 0; i < 4; i++) {
      const y = busY[i];
      const netId = `BUS_${i}`;
      p.components.push(
        {
          id: `U_IN_${i}`,
          kind: "PASSIVE",
          x: 8000,
          y: y - 2000,
          w: 4000,
          h: 4000,
          pads: [{ id: `IN_${i}`, component: `U_IN_${i}`, x: 10000, y, radius: 450, net: netId }],
        },
        {
          id: `U_OUT_${i}`,
          kind: "PASSIVE",
          x: 88000,
          y: y - 2000,
          w: 4000,
          h: 4000,
          pads: [{ id: `OUT_${i}`, component: `U_OUT_${i}`, x: 90000, y, radius: 450, net: netId }],
        },
      );
      p.routes.push({
        id: netId,
        terminals: [`IN_${i}`, `OUT_${i}`],
        layer: 0,
        width: 250,
        points: [
          { x: 10000, y },
          { x: 90000, y },
        ],
        control: { x: 50000, y },
        pressure: 0,
      });
    }

    const solver = new Solver(p);
    for (let t = 0; t < 20; t++) {
      solver.step();
    }

    const report = validate(solver.project);
    expect(report.violations).toEqual([]);
  });
});
