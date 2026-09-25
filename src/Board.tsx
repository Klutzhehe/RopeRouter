import { useEffect, useRef } from "react";
import {
  COLORS,
  type Project,
  type Report,
  type Violation,
} from "./core/model";
import { pointSegment, routeSegments, segments } from "./core/geometry";

export function Board({
  project,
  visible,
  selected,
  onSelect,
  showViolations,
  fitKey,
  report,
  focused,
}: {
  project: Project;
  visible: number[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  showViolations: boolean;
  fitKey: number;
  report: Report;
  focused: { violation: Violation; nonce: number } | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    bubble = useRef<HTMLDivElement>(null),
    bubbleTitle = useRef<HTMLElement>(null),
    bubbleText = useRef<HTMLParagraphElement>(null),
    reveal = useRef<(v: Violation, focus?: boolean) => void>(() => {}),
    latest = useRef({
      project,
      visible,
      selected,
      onSelect,
      showViolations,
      report,
    }),
    draw = useRef(() => {}),
    camera = useRef({ zoom: 1, x: 0, y: 0 });
  latest.current = {
    project,
    visible,
    selected,
    onSelect,
    showViolations,
    report,
  };
  useEffect(() => {
    draw.current();
  }, [project, visible, selected, showViolations, report]);
  useEffect(() => {
    if (focused) reveal.current(focused.violation, true);
  }, [focused]);
  useEffect(() => {
    camera.current = { zoom: 1, x: 0, y: 0 };
    draw.current();
  }, [fitKey]);
  useEffect(() => {
    const el = canvas.current!,
      ctx = el.getContext("2d")!;
    let bounds = el.getBoundingClientRect(),
      frame = 0;
    const refreshBounds = () => {
      bounds = el.getBoundingClientRect();
      draw.current();
    };
    let hideTimer: ReturnType<typeof setTimeout> | undefined,
      hoverKey = "",
      shownKey = "";
    const key = (v: Violation) => `${v.kind}:${v.objects.join(":")}`;
    const hide = () => {
      bubble.current?.classList.remove("visible");
      shownKey = "";
    };
    let transform = { s: 1, x: 0, y: 0 },
      drag: {
        x: number;
        y: number;
        cx: number;
        cy: number;
        moved: boolean;
      } | null = null;
    const render = () => {
      frame = 0;
      const {
          project: p,
          visible,
          selected,
          showViolations,
          report,
        } = latest.current,
        { width: w, height: h } = bounds,
        dpr = window.devicePixelRatio || 1;
      if (w <= 0 || h <= 0) return;
      if (
        el.width !== Math.round(w * dpr) ||
        el.height !== Math.round(h * dpr)
      ) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#15191a";
      ctx.fillRect(0, 0, w, h);
      const s =
          Math.min((w - 100) / p.width, (h - 100) / p.height) *
          camera.current.zoom,
        x = (w - p.width * s) / 2 + camera.current.x,
        y = (h - p.height * s) / 2 + camera.current.y;
      transform = { s, x, y };
      ctx.translate(x, y);
      ctx.scale(s, s);
      ctx.fillStyle = "#1b2423";
      ctx.fillRect(0, 0, p.width, p.height);
      ctx.strokeStyle = "#536360";
      ctx.lineWidth = 1 / s;
      ctx.strokeRect(0, 0, p.width, p.height);
      ctx.fillStyle = "#34403d";
      ctx.beginPath();
      for (let gx = 2500; gx < p.width; gx += 2500)
        for (let gy = 2500; gy < p.height; gy += 2500) {
          ctx.moveTo(gx + 0.7 / s, gy);
          ctx.arc(gx, gy, 0.7 / s, 0, Math.PI * 2);
        }
      ctx.fill();
      ctx.font = `${10 / s}px 'Segoe UI', sans-serif`;
      ctx.fillStyle = "#7e918b";
      ctx.fillText(
        `${p.width / 1000} × ${p.height / 1000} mm`,
        0,
        p.height + 18 / s,
      );
      for (const wall of p.walls) {
        if (!wall.layers.some((l) => visible.includes(l))) continue;
        ctx.fillStyle = "#394340";
        ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
        ctx.save();
        ctx.beginPath();
        ctx.rect(wall.x, wall.y, wall.w, wall.h);
        ctx.clip();
        ctx.strokeStyle = "#4b5652";
        ctx.lineWidth = 1 / s;
        ctx.beginPath();
        for (let k = -wall.h; k < wall.w; k += 2200) {
          ctx.moveTo(wall.x + k, wall.y);
          ctx.lineTo(wall.x + k + wall.h, wall.y + wall.h);
        }
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = "#bac4bc";
        ctx.font = `${10 / s}px 'Segoe UI'`;
        ctx.fillText("PROTECTED", wall.x + 1000, wall.y + wall.h / 2);
      }
      for (const c of p.components) {
        ctx.fillStyle = "#202827";
        ctx.strokeStyle = "#5f6d68";
        ctx.lineWidth = 1 / s;
        ctx.fillRect(c.x, c.y, c.w, c.h);
        ctx.strokeRect(c.x, c.y, c.w, c.h);
        ctx.font = `${10 / s}px 'Segoe UI'`;
        ctx.fillStyle = "#a4b0aa";
        ctx.fillText(c.id, c.x, c.y - 900);
      }
      for (const r of p.routes) {
        const segs = routeSegments(r);
        const hasVisible = segs.some((seg) => visible.includes(seg.layer));
        if (!hasVisible) continue;
        ctx.globalAlpha = selected && selected !== r.id ? 0.18 : 0.86;
        ctx.lineWidth =
          Math.max(r.width, 1.5 / s) + (selected === r.id ? 1 / s : 0);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        const invalid = report.violations.some((v) => v.objects.includes(r.id));
        ctx.setLineDash(invalid ? [5 / s, 4 / s] : []);
        for (const seg of segs) {
          if (!visible.includes(seg.layer)) continue;
          ctx.strokeStyle = COLORS[seg.layer] ?? COLORS[0];
          ctx.beginPath();
          ctx.moveTo(seg.a.x, seg.a.y);
          ctx.lineTo(seg.b.x, seg.b.y);
          ctx.stroke();
        }
        if (selected === r.id) {
          for (const v of r.points) {
            ctx.fillStyle = "#edf4ed";
            ctx.fillRect(v.x - 2 / s, v.y - 2 / s, 4 / s, 4 / s);
          }
        }
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // Render explicit through-vias as annular copper rings with drill holes
      for (const r of p.routes) {
        for (const v of r.vias ?? []) {
          if (!visible.includes(v.fromLayer) && !visible.includes(v.toLayer))
            continue;
          ctx.fillStyle = COLORS[v.toLayer] ?? COLORS[v.fromLayer] ?? "#c8ac85";
          ctx.beginPath();
          ctx.arc(v.x, v.y, v.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#15191a";
          ctx.beginPath();
          ctx.arc(v.x, v.y, v.drill / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#536360";
          ctx.lineWidth = 1 / s;
          ctx.stroke();
        }
      }
      for (const pad of p.components.flatMap((c) => c.pads)) {
        ctx.fillStyle = pad.net ? "#d5c6a1" : "#7e826d";
        ctx.beginPath();
        ctx.arc(pad.x, pad.y, pad.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#182220";
        ctx.beginPath();
        ctx.arc(pad.x, pad.y, 220, 0, Math.PI * 2);
        ctx.fill();
      }
      if (showViolations) {
        ctx.strokeStyle = "#f4847c";
        ctx.lineWidth = 1.2 / s;
        ctx.beginPath();
        for (const v of report.violations) {
          if (
            !v.objects.some((id) =>
              p.routes.some((r) => r.id === id && visible.includes(r.layer)),
            )
          )
            continue;
          ctx.moveTo(v.point.x + 5 / s, v.point.y);
          ctx.arc(v.point.x, v.point.y, 5 / s, 0, Math.PI * 2);
        }
        ctx.stroke();
      }
      if (shownKey) {
        const issue = report.violations.find((v) => key(v) === shownKey);
        if (!issue) {
          hide();
        } else positionBubble(issue);
      }
    };
    draw.current = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };
    const positionBubble = (v: Violation) => {
      const node = bubble.current;
      if (!node) return;
      const box = bounds;
      node.style.left = `${Math.max(10, Math.min(box.width - Math.min(310, box.width - 20) - 10, transform.x + v.point.x * transform.s + 14))}px`;
      node.style.top = `${Math.max(100, Math.min(box.height - 150, transform.y + v.point.y * transform.s - 40))}px`;
    };
    reveal.current = (v, focus = false) => {
      if (focus) {
        camera.current.x =
          -(v.point.x - latest.current.project.width / 2) * transform.s;
        camera.current.y =
          -(v.point.y - latest.current.project.height / 2) * transform.s;
        draw.current();
      }
      if (!bubble.current || !bubbleTitle.current || !bubbleText.current)
        return;
      bubbleTitle.current.textContent = `${v.kind === "trace" ? "Trace conflict" : v.kind === "self" ? "Rope folds over itself" : v.kind === "wall" ? "Protected region" : v.kind === "pad" ? "Pad clearance" : "Geometry violation"}${v.layer !== undefined ? ` · L${v.layer + 1}` : ""}`;
      bubbleText.current.textContent = v.message;
      positionBubble(v);
      shownKey = key(v);
      bubble.current.classList.add("visible");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, 5500);
    };
    const observer = new ResizeObserver((entries) => {
      if (entries[0]?.contentRect) {
        bounds = entries[0].contentRect;
        draw.current();
      } else refreshBounds();
    });
    observer.observe(el);
    window.addEventListener("resize", refreshBounds);
    window.addEventListener("scroll", refreshBounds, true);
    const down = (e: PointerEvent) => {
      bounds = el.getBoundingClientRect();
      hide();
      el.setPointerCapture(e.pointerId);
      drag = {
        x: e.clientX,
        y: e.clientY,
        cx: camera.current.x,
        cy: camera.current.y,
        moved: false,
      };
    };
    const move = (e: PointerEvent) => {
      if (!drag) {
        const box = bounds,
          point = {
            x: (e.clientX - box.left - transform.x) / transform.s,
            y: (e.clientY - box.top - transform.y) / transform.s,
          };
        const nearby = latest.current.report.violations
          .filter(
            (v) =>
              (v.layer === undefined ||
                latest.current.visible.includes(v.layer)) &&
              Math.hypot(v.point.x - point.x, v.point.y - point.y) *
                transform.s <
                14,
          )
          .sort(
            (a, b) =>
              Math.hypot(a.point.x - point.x, a.point.y - point.y) -
              Math.hypot(b.point.x - point.x, b.point.y - point.y),
          )[0];
        const next = nearby ? key(nearby) : "";
        if (next !== hoverKey) {
          hoverKey = next;
          if (nearby) reveal.current(nearby);
          else {
            clearTimeout(hideTimer);
            hideTimer = setTimeout(hide, 350);
          }
        }
        return;
      }
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 3) drag.moved = true;
      camera.current.x = drag.cx + dx;
      camera.current.y = drag.cy + dy;
      draw.current();
    };
    const up = (e: PointerEvent) => {
      if (drag && !drag.moved) {
        const box = bounds,
          point = {
            x: (e.clientX - box.left - transform.x) / transform.s,
            y: (e.clientY - box.top - transform.y) / transform.s,
          };
        let nearest: string | null = null,
          min = 8 / transform.s;
        for (const r of latest.current.project.routes)
          for (const seg of routeSegments(r)) {
            if (!latest.current.visible.includes(seg.layer)) continue;
            const d = pointSegment(point, seg.a, seg.b);
            if (d < min) {
              min = d;
              nearest = r.id;
            }
          }
        latest.current.onSelect(nearest);
        const violation = latest.current.report.violations.find((v) =>
          v.objects.includes(nearest ?? ""),
        );
        if (violation) reveal.current(violation);
      }
      drag = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = bounds,
        mx = e.clientX - box.left - box.width / 2,
        my = e.clientY - box.top - box.height / 2,
        old = camera.current.zoom,
        next = Math.max(0.4, Math.min(6, old * Math.exp(-e.deltaY * 0.001)));
      camera.current.x = mx - ((mx - camera.current.x) * next) / old;
      camera.current.y = my - ((my - camera.current.y) * next) / old;
      camera.current.zoom = next;
      draw.current();
    };
    const leave = () => {
      hoverKey = "";
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, 350);
    };
    el.addEventListener("pointerleave", leave);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    draw.current();
    return () => {
      cancelAnimationFrame(frame);
      draw.current = () => {};
      window.removeEventListener("resize", refreshBounds);
      window.removeEventListener("scroll", refreshBounds, true);
      clearTimeout(hideTimer);
      el.removeEventListener("pointerleave", leave);
      observer.disconnect();
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
    };
  }, []);
  return (
    <>
      <canvas
        ref={canvas}
        aria-label="PCB routing viewport. Drag to pan, scroll to zoom, click a trace to select."
      />
      <div
        ref={bubble}
        className="violation-bubble"
        role="tooltip"
        aria-live="polite"
      >
        <strong ref={bubbleTitle} />
        <p ref={bubbleText} />
        <span>Unresolved · no overlapping route will be accepted</span>
      </div>
    </>
  );
}
