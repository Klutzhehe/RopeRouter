import { describe, it, expect } from "vitest";
import { Solver } from "../src/core/solver";
import { validate } from "../src/core/geometry";
import type { Project } from "../src/core/model";

describe("Physical Collision Repulsion & Obstacle Expulsion Wiggling", () => {
  it("pushes two overlapping parallel traces apart until completely separated", () => {
    // Two horizontal routes placed on L1 with insufficient clearance (gap = 0.1 mm, requires 0.35 mm)
    const p: Project = {
      version: 1,
      units: "um",
      name: "wiggle-traces",
      seed: 42,
      width: 100000,
      height: 80000,
      layers: 2,
      clearance: 350,
      components: [
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
      ],
      routes: [
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
      ],
      walls: [],
      settings: { strength: 1.0, snaps: true },
      tick: 0,
      rng: 42,
    };

    // Initial state: N01 and N02 overlap along y=24900 and y=25000 (gap is only 100 um, < 600 um required)
    const initialReport = validate(p);
    expect(initialReport.violations.length).toBeGreaterThan(0);
    expect(initialReport.violations.some((v) => v.kind === "trace")).toBe(true);

    const solver = new Solver(p);
    // Run solver ticks: the physical repulsion wiggling should slide them apart
    for (let t = 0; t < 25; t++) {
      solver.step();
      if (validate(solver.project).violations.length === 0) break;
    }

    const finalReport = validate(solver.project);
    expect(finalReport.violations.length).toBe(0);
    expect(solver.events.some((e) => e.text.includes("wiggled") || e.text.includes("pushed"))).toBe(true);
  });

  it("expels a trace penetrating a keepout wall outward until clear", () => {
    // Route N01 has an interior segment that passes through a protected copper wall
    const p: Project = {
      version: 1,
      units: "um",
      name: "wiggle-wall",
      seed: 99,
      width: 100000,
      height: 80000,
      layers: 1,
      clearance: 350,
      components: [
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
      ],
      routes: [
        {
          id: "N01",
          terminals: ["P1A", "P1B"],
          layer: 0,
          width: 250,
          points: [
            { x: 12000, y: 22000 },
            { x: 25000, y: 22000 },
            { x: 25000, y: 35000 },
            { x: 70000, y: 35000 },
            { x: 70000, y: 22000 },
            { x: 82000, y: 22000 },
          ],
          control: { x: 47500, y: 35000 },
          pressure: 0,
        },
      ],
      walls: [
        // Protected wall intersecting y=35000
        {
          id: "W_KEEPOUT",
          x: 40000,
          y: 34500,
          w: 15000,
          h: 6000,
          layers: [0],
        },
      ],
      settings: { strength: 1.0, snaps: true },
      tick: 0,
      rng: 99,
    };

    const initialReport = validate(p);
    expect(initialReport.violations.some((v) => v.kind === "wall")).toBe(true);

    const solver = new Solver(p);
    for (let t = 0; t < 25; t++) {
      solver.step();
      if (validate(solver.project).violations.length === 0) break;
    }

    const finalReport = validate(solver.project);
    expect(finalReport.violations.filter((v) => v.kind === "wall").length).toBe(0);
  });
});
