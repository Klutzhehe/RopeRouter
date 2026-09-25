import { validate } from "../geometry";
import type { PbdEngine } from "./pbd-engine";

export interface LayerEvent {
  tick: number;
  netId: string;
  fromLayer: number;
  toLayer: number;
  text: string;
}

/** Via mutations use the same full-route transaction as planar topology changes. */
export class LayeringManager {
  viaRadius = 450;
  viaDrill = 300;

  evaluateLayers(engine: PbdEngine, tick: number): LayerEvent[] {
    if (tick % 10 !== 0 || engine.layers <= 1) return [];
    const events: LayerEvent[] = [];
    for (const current of [...engine.routes]) {
      const live = engine.getProject(tick);
      const route = live.routes.find((r) => r.id === current.id)!;
      const invalid = validate(live, route.id, true).violations.length > 0;
      if (route.vias?.length && !invalid) {
        if (
          engine.tryReplaceRoute({ ...route, vias: [] }, tick, "via-collapse")
        ) {
          events.push({
            tick,
            netId: route.id,
            fromLayer: -1,
            toLayer: route.layer,
            text: `Layer gravity: validated via collapse on ${route.id}`,
          });
        }
      } else if (
        invalid &&
        current.pressure > 3000 &&
        !route.vias?.length &&
        route.points.length >= 5
      ) {
        const a = route.points[Math.floor(route.points.length * 0.25)];
        const b = route.points[Math.floor(route.points.length * 0.75)];
        for (let layer = 0; layer < engine.layers; layer++) {
          if (layer === route.layer) continue;
          const vias = [
            {
              ...a,
              fromLayer: route.layer,
              toLayer: layer,
              radius: this.viaRadius,
              drill: this.viaDrill,
            },
            {
              ...b,
              fromLayer: layer,
              toLayer: route.layer,
              radius: this.viaRadius,
              drill: this.viaDrill,
            },
          ];
          if (engine.tryReplaceRoute({ ...route, vias }, tick, "via-bypass")) {
            events.push({
              tick,
              netId: route.id,
              fromLayer: route.layer,
              toLayer: layer,
              text: `Layer bypass: validated ${route.id} on L${layer + 1}`,
            });
            break;
          }
        }
      }
    }
    return events;
  }
}
