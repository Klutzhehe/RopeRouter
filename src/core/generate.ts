import { random, type Project } from "./model";
import { rope, connectWaypoints } from "./geometry";

export const COMPONENT_COUNTS = [
  4, 8, 12, 16, 20, 24, 32, 40, 64, 100, 200,
] as const;

function getOpenColumnX(padX: number, preferOuter = false): number {
  if (padX < 18000) return preferOuter ? 3200 : 18500;
  if (padX < 40000) return preferOuter ? 18500 : 45000;
  if (padX < 85000) return preferOuter ? 95000 : 74000;
  return preferOuter ? 116500 : 95000;
}

export function generate(
  seed = 42017,
  count = 12,
  layers = 4,
  loose = false,
): Project {
  if (!Number.isInteger(count) || count < 1 || count > 200)
    throw new RangeError("Component count must be an integer from 1 to 200.");
  // Preserve existing seeded boards; larger boards add equally spaced rows.
  const columns = count <= 40 ? 6 : Math.ceil(Math.sqrt(count)) + 2;
  const rows = Math.max(4, Math.ceil(count / (columns - 2)));
  const p: Project = {
    version: 1,
    units: "um",
    name: "Untitled routing study",
    seed: seed >>> 0,
    rng: seed >>> 0,
    width: 120000 + (columns - 6) * 19000,
    height: 80000 + (rows - 4) * 17500,
    layers,
    clearance: 350,
    components: [],
    routes: [],
    walls: [
      {
        id: "DDR corridor",
        x: 53000,
        y: 26000,
        w: 14000,
        h: 26000,
        layers: Array.from({ length: layers }, (_, i) => i),
      },
    ],
    settings: { strength: 1, snaps: true },
    tick: 0,
  };
  const cells = Array.from({ length: rows * columns }, (_, i) => i).filter(
    (i) => i % columns !== 2 && i % columns !== 3,
  );
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(random(p) * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  for (let i = 0; i < count; i++) {
    const cell = cells[i],
      x = 5000 + (cell % columns) * 19000 + Math.floor(random(p) * 2000),
      y = 6500 + Math.floor(cell / columns) * 17500;
    const kind = i % 3 === 0 ? "DIP" : i % 3 === 1 ? "HEADER" : "PASSIVE",
      n = kind === "DIP" ? 8 : kind === "HEADER" ? 4 : 2,
      id = `U${i + 1}`,
      w = kind === "DIP" ? 8500 : 6500,
      h = kind === "DIP" ? 6500 : 3500;
    const pads = Array.from({ length: n }, (_, k) => ({
      id: `${id}.${k + 1}`,
      component: id,
      x: x + 1000 + (kind === "DIP" ? Math.floor(k / 2) * 2100 : k * 1500),
      y: y + 1000 + (kind === "DIP" ? (k % 2) * 4500 : 0),
      radius: 550,
      net: null as string | null,
    }));
    p.components.push({ id, kind, x, y, w, h, pads });
  }
  const pads = p.components.flatMap((c) => c.pads);
  for (let i = pads.length - 1; i > 0; i--) {
    const j = Math.floor(random(p) * (i + 1));
    [pads[i], pads[j]] = [pads[j], pads[i]];
  }
  const used = new Set<string>();
  for (const a of pads) {
    if (p.routes.length >= count || used.has(a.id)) continue;
    const b = pads.find(
      (b) => b.component !== a.component && !used.has(b.id) && b.id !== a.id,
    );
    if (!b) continue;
    const id = `N${String(p.routes.length + 1).padStart(2, "0")}`;
    a.net = b.net = id;
    used.add(a.id);
    used.add(b.id);

    if (!loose) {
      const control = {
        x: Math.round((a.x + b.x) / 2),
        y: Math.round((a.y + b.y) / 2),
      };
      p.routes.push({
        id,
        terminals: [a.id, b.id],
        layer: p.routes.length % layers,
        width: 300,
        points: rope(a, b, control),
        control,
        pressure: 0,
        vias: [],
      });
    } else {
      const compA = p.components.find((c) => c.id === a.component);
      const compB = p.components.find((c) => c.id === b.component);

      const aExitsNorth =
        compA?.kind === "DIP" ? a.y <= compA.y + 2000 : a.y < p.height / 2;
      const bExitsNorth =
        compB?.kind === "DIP" ? b.y <= compB.y + 2000 : b.y < p.height / 2;

      const escA = { x: a.x, y: aExitsNorth ? a.y - 1200 : a.y + 1200 };
      const escB = { x: b.x, y: bExitsNorth ? b.y - 1200 : b.y + 1200 };

      const idx = p.routes.length;
      const channelChoices = [
        3200 + (idx % 3) * 700, // North perimeter
        17500 + (idx % 3) * 700, // North corridor
        54500 + (idx % 3) * 700, // South corridor
        p.height - 3200 - (idx % 3) * 700, // South perimeter
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

      p.routes.push({
        id,
        terminals: [a.id, b.id],
        layer: p.routes.length % layers,
        width: 300,
        points,
        control,
        pressure: 0,
        vias: [],
      });
    }
  }
  return p;
}
