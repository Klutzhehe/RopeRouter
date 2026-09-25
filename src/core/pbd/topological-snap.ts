import type { Point, Route } from "../model";
import { connectWaypoints, routeLength, validate } from "../geometry";
import type { PbdEngine } from "./pbd-engine";
import { ConflictRepair } from "./repair";

export interface SnapEvent {
  tick: number;
  netId: string;
  blockerId: string;
  text: string;
}

/** Bounded geometric mutations, not pathfinding. Proposals never mutate the live board
 * until the entire replacement (anchors, reconnects, pads, walls and other nets) passes DRC. */
export class TopologicalSupervisor {
  consecutiveCrossingTicks = new Map<string, number>();
  lastCheckedTick = -1;
  private conflictRepair = new ConflictRepair();

  checkAndSnap(engine: PbdEngine, tick: number): SnapEvent[] {
    if (tick === this.lastCheckedTick) return [];
    this.lastCheckedTick = tick;
    const events: SnapEvent[] = [];
    const project = engine.getProject(tick);
    const report = validate(project, undefined, true);
    const active = new Map<string, { target: string; blocker: string }>();
    for (const v of report.violations) {
      if (!["trace", "wall", "pad"].includes(v.kind) || v.objects.length < 2)
        continue;
      const [target, blocker] = v.objects;
      if (!project.routes.some((r) => r.id === target)) continue;
      active.set(JSON.stringify([...v.objects].sort()), { target, blocker });
    }
    for (const key of this.consecutiveCrossingTicks.keys()) {
      if (!active.has(key)) this.consecutiveCrossingTicks.delete(key);
    }
    for (const [key, { target, blocker }] of active) {
      const count = (this.consecutiveCrossingTicks.get(key) ?? 0) + 1;
      this.consecutiveCrossingTicks.set(key, count);
      if (count !== 3 && count % 15 !== 0) continue;
      // Try both participants; pressure does not establish which net can escape.
      for (const [id, obstruction] of [
        [target, blocker],
        [blocker, target],
      ]) {
        const live = engine.getProject(tick);
        const route = live.routes.find((r) => r.id === id);
        if (!route || !validate(live, id, true).violations.length) continue;
        if (this.repair(engine, route, obstruction, tick)) {
          events.push({
            tick,
            netId: id,
            blockerId: obstruction,
            text: `Topological snap: ${id} cleared all conflicts around ${obstruction}`,
          });
          break;
        }
      }
    }
    if (tick % 3 === 0) {
      const ids = this.conflictRepair.repair(engine, tick);
      if (ids.length)
        events.push({
          tick,
          netId: ids[0],
          blockerId: "conflict-group",
          text: `Topological snap: ${ids.join(", ")} cleared all conflicts with terminal-aware geometry`,
        });
    }
    return events;
  }

  private repair(
    engine: PbdEngine,
    route: Route,
    blockerId: string,
    tick: number,
  ): boolean {
    // Through-hole terminals in this prototype permit whole-net migration.
    for (let layer = 0; layer < engine.layers; layer++) {
      if (layer === route.layer) continue;
      if (
        engine.tryReplaceRoute(
          { ...route, layer, vias: [] },
          tick,
          "layer-snap",
        )
      )
        return true;
    }
    // Vias are mandatory pinned topology. Planar replacement of them needs a
    // segment-level transaction; do not silently delete them for a planar detour.
    if (route.vias?.length) return false;
    const board = engine.getProject(tick);
    const other = board.routes.find((r) => r.id === blockerId);
    const wall = board.walls.find((w) => w.id === blockerId);
    const pad = board.components
      .flatMap((c) => c.pads)
      .find((p) => p.id === blockerId);
    let points: Point[], radius: number;
    if (other) {
      points = other.points;
      // Include terminal copper, not only trace centerlines.
      radius = Math.max(
        other.width / 2,
        ...board.components
          .flatMap((c) => c.pads)
          .filter((p) => p.net === other.id)
          .map((p) => p.radius),
      );
    } else if (wall) {
      points = [
        { x: wall.x, y: wall.y },
        { x: wall.x + wall.w, y: wall.y + wall.h },
      ];
      radius = 0;
    } else if (pad) {
      points = [pad];
      radius = pad.radius;
    } else return false;
    const margin = Math.ceil(
      radius +
        route.width / 2 +
        board.clearance +
        engine.octilinearBuffer +
        250,
    );
    const left = Math.floor(Math.min(...points.map((p) => p.x)) - margin);
    const right = Math.ceil(Math.max(...points.map((p) => p.x)) + margin);
    const top = Math.floor(Math.min(...points.map((p) => p.y)) - margin);
    const bottom = Math.ceil(Math.max(...points.map((p) => p.y)) + margin);
    const nw = { x: left, y: top },
      ne = { x: right, y: top };
    const sw = { x: left, y: bottom },
      se = { x: right, y: bottom };
    const a = route.points[0],
      b = route.points.at(-1)!;
    const proposals: Route[] = [];
    for (const waypoints of [
      [nw, ne],
      [sw, se],
      [nw, sw],
      [ne, se],
    ]) {
      for (const path of [waypoints, [...waypoints].reverse()]) {
        for (const diagonalFirst of [false, true]) {
          const pts = connectWaypoints([a, ...path, b], diagonalFirst);
          proposals.push({
            ...route,
            points: pts,
            control: pts[Math.floor(pts.length / 2)],
            pressure: 0,
          });
        }
      }
    }
    proposals.sort((a, b) => routeLength(a) - routeLength(b));
    for (const proposal of proposals) {
      if (engine.tryReplaceRoute(proposal, tick, "planar-snap")) return true;
    }
    return false;
  }
}
