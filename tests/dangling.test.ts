import { describe, it, expect } from "vitest";
import { generate } from "../src/core/generate";
import { validate, routeLength, distance, rope, simplify, connectWaypoints } from "../src/core/geometry";
import { Solver } from "../src/core/solver";
import type { Point, Project } from "../src/core/model";

function getOpenColumnX(padX: number, preferOuter = false): number {
  if (padX < 18000) return preferOuter ? 3200 : 18500;
  if (padX < 40000) return preferOuter ? 18500 : 45000;
  if (padX < 85000) return preferOuter ? 95000 : 74000;
  return preferOuter ? 116500 : 95000;
}

function generateDanglingRoutes(p: Project): Project {
  const p2: Project = structuredClone(p);
  p2.routes = [];
  const pads = p2.components.flatMap((c) => c.pads);
  const count = p.routes.length;

  for (let idx = 0; idx < count; idx++) {
    const orig = p.routes[idx];
    const a = pads.find((pad) => pad.id === orig.terminals[0])!;
    const b = pads.find((pad) => pad.id === orig.terminals[1])!;
    const compA = p2.components.find((c) => c.id === a.component);
    const compB = p2.components.find((c) => c.id === b.component);

    const aExitsNorth =
      compA?.kind === "DIP" ? a.y <= compA.y + 2000 : a.y < p2.height / 2;
    const bExitsNorth =
      compB?.kind === "DIP" ? b.y <= compB.y + 2000 : b.y < p2.height / 2;

    const escA = { x: a.x, y: aExitsNorth ? a.y - 1200 : a.y + 1200 };
    const escB = { x: b.x, y: bExitsNorth ? b.y - 1200 : b.y + 1200 };

    const channelChoices = [
      3200 + (idx % 3) * 700, // North perimeter
      17500 + (idx % 3) * 700, // North corridor
      54500 + (idx % 3) * 700, // South corridor
      p2.height - 3200 - (idx % 3) * 700, // South perimeter
    ];
    const yChan = channelChoices[idx % channelChoices.length];

    const colA = getOpenColumnX(a.x, idx % 3 === 0);
    const colB = getOpenColumnX(b.x, idx % 3 === 1);

    const waypoints = [
      a,
      escA,
      { x: colA, y: escA.y },
      { x: colA, y: yChan },
      { x: colB, y: yChan },
      { x: colB, y: escB.y },
      escB,
      b,
    ];

    const points = connectWaypoints(waypoints);
    const control = {
      x: Math.round((a.x + b.x) / 2),
      y: yChan,
    };

    p2.routes.push({
      id: orig.id,
      terminals: [a.id, b.id],
      layer: orig.layer,
      width: orig.width,
      points,
      control,
      pressure: 0,
      vias: [],
    });
  }
  return p2;
}

describe("loose dangling initialization", () => {
  it("tests 4-channel dangling routes", () => {
    const p16 = generate(42017, 16, 2);
    const pDang = generateDanglingRoutes(p16);
    const vDang = validate(pDang);
    console.log("Dangling 16-comp 2-layer violations:", vDang.violations.length);
    console.log("Wall violations:", vDang.violations.filter(v => v.kind === "wall").length);
    expect(vDang.violations.filter(v => v.kind === "wall").length).toBe(0);

    const p19 = generateDanglingRoutes(generate(19, 4, 1));
    const v19 = validate(p19);
    console.log("Seed 19 violations details:", v19.violations);
    for (const r of p19.routes) {
      console.log(r.id, "points:", r.points.length, r.points);
    }
  });
});
