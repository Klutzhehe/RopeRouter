import { crossingFixture } from "./fixtures/crossing";
import { describe, it, expect } from "vitest";
import { generate } from "../src/core/generate";
import { PbdEngine } from "../src/core/pbd/pbd-engine";
import { TopologicalSupervisor } from "../src/core/pbd/topological-snap";
import { quantizeRoutePoints, quantizeProject } from "../src/core/pbd/quantize";
import { validate } from "../src/core/geometry";
import type { Project } from "../src/core/model";

describe("PBD Rope Routing Engine", () => {
  it("initializes routes and maintains fixed anchor positions", () => {
    const project = generate(42, 6, 2);
    const engine = new PbdEngine(project);

    expect(engine.routes.length).toBe(project.routes.length);

    for (let i = 0; i < engine.routes.length; i++) {
      const orig = project.routes[i];
      const pbdR = engine.routes[i];
      // Anchors must match exactly
      expect(pbdR.nodes[0].x).toBe(orig.points[0].x);
      expect(pbdR.nodes[0].y).toBe(orig.points[0].y);
      expect(pbdR.nodes[0].invMass).toBe(0);

      const lastPbd = pbdR.nodes.at(-1)!;
      const lastOrig = orig.points.at(-1)!;
      expect(lastPbd.x).toBe(lastOrig.x);
      expect(lastPbd.y).toBe(lastOrig.y);
      expect(lastPbd.invMass).toBe(0);
    }
  });

  it("relaxes ropes under tension and pulls them straight when unobstructed", () => {
    const project = generate(101, 2, 2);
    // Clear obstacles
    project.walls = [];
    project.components = [];

    const engine = new PbdEngine(project);
    // Add some slack to route 0
    engine.routes[0].nodes = [
      {
        x: 10000,
        y: 10000,
        prevX: 10000,
        prevY: 10000,
        invMass: 0,
        layer: 0,
        netId: "N01",
      },
      {
        x: 30000,
        y: 50000,
        prevX: 30000,
        prevY: 50000,
        invMass: 1,
        layer: 0,
        netId: "N01",
      },
      {
        x: 50000,
        y: 10000,
        prevX: 50000,
        prevY: 10000,
        invMass: 0,
        layer: 0,
        netId: "N01",
      },
    ];

    // Step 20 times
    for (let t = 1; t <= 20; t++) {
      engine.step(t, 5);
    }

    const mid = engine.routes[0].nodes[1];
    // With no obstacles, middle node should be pulled close to the straight line y = 10000
    expect(mid.y).toBeLessThan(25000);
  });

  it("deflects around circular pads satisfying clearance", () => {
    const project = generate(202, 2, 2);
    project.walls = [];
    // Place a pad directly in the path between (10000, 20000) and (50000, 20000)
    project.components = [
      {
        id: "C1",
        kind: "PASSIVE",
        x: 25000,
        y: 15000,
        w: 10000,
        h: 10000,
        pads: [
          {
            id: "C1.1",
            component: "C1",
            x: 30000,
            y: 20000,
            radius: 2000,
            net: "FOREIGN",
          },
        ],
      },
    ];

    const engine = new PbdEngine(project);
    engine.routes[0].nodes = [
      {
        x: 10000,
        y: 20000,
        prevX: 10000,
        prevY: 20000,
        invMass: 0,
        layer: 0,
        netId: "N01",
      },
      {
        x: 30000,
        y: 20000,
        prevX: 30000,
        prevY: 20000,
        invMass: 1,
        layer: 0,
        netId: "N01",
      },
      {
        x: 50000,
        y: 20000,
        prevX: 50000,
        prevY: 20000,
        invMass: 0,
        layer: 0,
        netId: "N01",
      },
    ];

    for (let t = 1; t <= 30; t++) {
      engine.step(t, 5);
    }

    const mid = engine.routes[0].nodes[1];
    const distToPad = Math.hypot(mid.x - 30000, mid.y - 20000);
    const minRequired = 2000 + engine.routes[0].width / 2 + engine.drcClearance;
    expect(distToPad).toBeGreaterThanOrEqual(minRequired - 10);
  });

  it("quantizes continuous free-angle points to strict 45/90 octilinear geometry", () => {
    // Arbitrary continuous non-octilinear points
    const freeAnglePoints = [
      { x: 10000, y: 10000 },
      { x: 23154, y: 35891 },
      { x: 50000, y: 60000 },
    ];

    const quantized = quantizeRoutePoints(freeAnglePoints);

    // Verify all resulting segments are strictly octilinear
    for (let i = 1; i < quantized.length; i++) {
      const dx = Math.abs(quantized[i].x - quantized[i - 1].x);
      const dy = Math.abs(quantized[i].y - quantized[i - 1].y);
      const isOctilinear = dx === 0 || dy === 0 || dx === dy;
      expect(isOctilinear).toBe(true);
      expect(Number.isInteger(quantized[i].x)).toBe(true);
      expect(Number.isInteger(quantized[i].y)).toBe(true);
    }
  });

  it("detects crossings and executes topological snaps", () => {
    const project = crossingFixture(2);
    const engine = new PbdEngine(project);

    const supervisor = new TopologicalSupervisor();
    // Simulate 3 ticks of persistent crossing
    let events: any[] = [];
    for (let t = 1; t <= 4; t++) {
      const tickEvents = supervisor.checkAndSnap(engine, t);
      if (tickEvents.length > 0) events = tickEvents;
    }

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].text).toContain("Topological snap");
    expect(validate(engine.getProject(), undefined, true).violations).toEqual(
      [],
    );
  });
});
