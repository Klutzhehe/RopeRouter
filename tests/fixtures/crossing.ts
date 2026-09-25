import type { Project, Point } from "../../src/core/model";

/** Schema-valid fixture; crossing falls midway between sampled particles. */
export function crossingFixture(layers = 1, reverse = false): Project {
  const ends: Point[] = [
    { x: 10000, y: 21250 },
    { x: 90000, y: 21250 },
    { x: 51250, y: 10000 },
    { x: 51250, y: 50000 },
  ];
  return {
    version: 1,
    units: "um",
    name: "mid-segment-crossing",
    seed: 1,
    rng: 1,
    width: 100000,
    height: 60000,
    layers,
    clearance: 350,
    tick: 0,
    settings: { strength: 1, snaps: true },
    walls: [],
    components: ends.map((p, i) => ({
      id: `U${i}`,
      kind: "PASSIVE",
      x: p.x - 1000,
      y: p.y - 1000,
      w: 4000,
      h: 4000,
      pads: [
        {
          ...p,
          id: `P${i}`,
          component: `U${i}`,
          radius: 500,
          net: i < 2 ? "A" : "B",
        },
        {
          x: p.x + 2000,
          y: p.y + 2000,
          id: `NC${i}`,
          component: `U${i}`,
          radius: 500,
          net: null,
        },
      ],
    })),
    routes: [0, 1].map((i) => ({
      id: i === 0 ? "A" : "B",
      terminals: (reverse
        ? [`P${2 * i + 1}`, `P${2 * i}`]
        : [`P${2 * i}`, `P${2 * i + 1}`]) as [string, string],
      layer: 0,
      width: 300,
      pressure: 0,
      control: { x: 51250, y: 21250 },
      points: reverse
        ? ends.slice(2 * i, 2 * i + 2).reverse()
        : ends.slice(2 * i, 2 * i + 2),
    })),
  };
}
