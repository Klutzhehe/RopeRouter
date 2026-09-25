import { useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipForward,
  ArrowCounterClockwise,
  FloppyDisk,
  FolderOpen,
  SlidersHorizontal,
  ArrowsOut,
  Stack,
  Circuitry,
  Shuffle,
  X,
  Eye,
  EyeSlash,
} from "@phosphor-icons/react";
import { COMPONENT_COUNTS, generate } from "./core/generate";
import {
  COLORS,
  parseProject,
  type Project,
  type Violation,
} from "./core/model";
import { routeLength, validate } from "./core/geometry";
import type { SolverEvent } from "./core/solver";
import { Board } from "./Board";
import {
  parseSimulationSnapshot,
  type SolverSnapshot,
} from "./core/simulation-state";

export default function App() {
  const [project, setProject] = useState(() => generate()),
    initial = useRef(project),
    worker = useRef<Worker | null>(null),
    session = useRef(1);
  const requestId = useRef(0);
  const importedSimulation = useRef<SolverSnapshot | undefined>(undefined);
  const [sweep, setSweep] = useState<{
    phase: string;
    prepared: number;
    total: number;
    iteration: number;
    conflicts: number;
  } | null>(null);
  const [stopReason, setStopReason] = useState<string | null>(null);
  const [running, setRunning] = useState(false),
    [ready, setReady] = useState(false),
    [events, setEvents] = useState<SolverEvent[]>([]),
    [best, setBest] = useState<Project | null>(null);
  const [seed, setSeed] = useState(42017),
    [count, setCount] = useState(12),
    [layers, setLayers] = useState(4),
    [visible, setVisible] = useState([0, 1, 2, 3]),
    [selected, setSelected] = useState<string | null>(null),
    [inspector, setInspector] = useState(true),
    [issues, setIssues] = useState(true),
    [focused, setFocused] = useState<{
      violation: Violation;
      nonce: number;
    } | null>(null),
    [fit, setFit] = useState(0),
    [message, setMessage] = useState(""),
    file = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState(() => validate(project));
  const route = project.routes.find((r) => r.id === selected),
    startLength = useMemo(
      () => validate(initial.current).length,
      [project.seed, fit],
    );
  useEffect(() => {
    const w = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onmessage = (e) => {
      if (e.data.version !== 1 || e.data.session !== session.current) return;
      if (e.data.type === "error") {
        setMessage(e.data.message);
        return;
      }
      if (e.data.type === "snapshot") {
        download(
          e.data.snapshot,
          `rope-router-simulation-${e.data.snapshot.project.seed}-tick-${e.data.snapshot.project.tick}.json`,
        );
        setMessage(
          "Simulation exported at a worker tick boundary: particles, parameters, topology state, reports, and recent decisions. Open it to replay.",
        );
        return;
      }
      if (e.data.type === "saved-project") {
        download(e.data.project, `rope-router-${e.data.project.seed}.json`);
        setMessage(
          "Stored project geometry saved. Use Export simulation to capture the live particles and replay state.",
        );
        return;
      }
      if (e.data.type === "progress") {
        setSweep(e.data.sweep);
        setProject((p) => ({ ...p, tick: e.data.tick }));
        return;
      }
      if (e.data.type !== "frame") return;
      setProject(e.data.project);
      setReport(e.data.report);
      setRunning(e.data.running);
      setEvents(e.data.events);
      setBest(e.data.best);
      setReady(true);
      setStopReason(e.data.stopReason);
      setSweep(e.data.sweep ?? null);
    };
    w.onerror = (e) => {
      setMessage(`Simulation worker failed: ${e.message}`);
      setRunning(false);
      setReady(false);
    };
    w.postMessage({
      version: 1,
      session: session.current,
      type: "initialize",
      project: initial.current,
    });
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, []);
  const command = (type: string) =>
    worker.current?.postMessage({
      version: 1,
      session: session.current,
      type,
      requestId: ++requestId.current,
    });
  const configure = (settings: Project["settings"]) =>
    worker.current?.postMessage({
      version: 1,
      session: session.current,
      type: "configure",
      settings,
    });
  function replace(p: Project, resetInitial = true, snapshot?: SolverSnapshot) {
    session.current++;
    setReady(false);
    setRunning(false);
    setProject(p);
    setReport(validate(p));
    setEvents([]);
    setBest(null);
    if (resetInitial) {
      initial.current = structuredClone(p);
      importedSimulation.current = snapshot;
    }
    setVisible(Array.from({ length: p.layers }, (_, i) => i));
    setSelected(null);
    setFocused(null);
    setSeed(p.seed);
    setLayers(p.layers);
    setFit((v) => v + 1);
    worker.current?.postMessage({
      version: 1,
      session: session.current,
      type: "initialize",
      project: p,
      snapshot,
    });
  }
  function download(data: unknown, filename: string) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function load(f?: File) {
    if (!f) return;
    try {
      if (f.size > 20_000_000) throw new Error("File exceeds the 20 MB limit.");
      const text = await f.text();
      if (JSON.parse(text).kind === "rope-router-simulation") {
        const snapshot = parseSimulationSnapshot(text);
        replace(snapshot.project, true, snapshot);
        setMessage(
          "Simulation loaded. Particle state and deterministic continuation restored; paused for inspection.",
        );
        return;
      }
      const p = parseProject(text);
      replace(p);
      setMessage("Project loaded. Reset returns to this imported snapshot.");
    } catch (e) {
      setMessage(
        `Could not load project: ${e instanceof Error ? e.message : "Invalid file"}`,
      );
    } finally {
      if (file.current) file.current.value = "";
    }
  }
  return (
    <div className="app">
      <header>
        <div className="brand">
          <Circuitry size={25} />
          <strong>
            Rope<span>Router</span>
          </strong>
          <span className="divider" />
          <span className="workspace-name">Routing lab</span>
        </div>
        <div className="file-actions">
          <button onClick={() => file.current?.click()}>
            <FolderOpen />
            Open
          </button>
          <button disabled={!ready} onClick={() => command("save-project")}>
            <FloppyDisk />
            Save project
          </button>
          <button disabled={!ready} onClick={() => command("snapshot")}>
            Export simulation
          </button>
          <button
            className={inspector ? "active" : ""}
            aria-label="Toggle inspector"
            onClick={() => setInspector((v) => !v)}
          >
            <SlidersHorizontal />
          </button>
        </div>
      </header>
      <div className="toolbar">
        <div className="document">
          <span className="status-dot" />
          <span>Seed {project.seed}</span>
          <span className="muted">/</span>
          <span className="muted">Sandbox</span>
        </div>
        <div className="transport">
          <button
            className="primary"
            disabled={!ready}
            onClick={() => command(running ? "pause" : "run")}
          >
            {running ? <Pause weight="fill" /> : <Play weight="fill" />}
            {running ? "Pause" : "Run simulation"}
          </button>
          <button disabled={!ready} onClick={() => command("step")}>
            <SkipForward />
            Step
          </button>
          <button
            disabled={!ready}
            onClick={() => command("quantize")}
            title="Snap continuous ropes to strict 45°/90° octilinear traces"
          >
            <Circuitry />
            Quantize
          </button>
          <button
            onClick={() =>
              replace(
                structuredClone(initial.current),
                false,
                importedSimulation.current,
              )
            }
            aria-label="Reset simulation"
          >
            <ArrowCounterClockwise />
          </button>
        </div>
        <span className="tick" data-testid="tick">
          Tick {project.tick.toString().padStart(5, "0")}
        </span>
      </div>
      <main className={inspector ? "" : "collapsed"}>
        <section className="viewport">
          <Board
            project={project}
            visible={visible}
            selected={selected}
            onSelect={setSelected}
            showViolations={issues}
            fitKey={fit}
            report={report}
            focused={focused}
          />
          <div className="canvas-heading">
            <span>BOARD VIEW</span>
            <strong>
              {running
                ? sweep?.phase === "preparing"
                  ? `Preparing board sweep · ${sweep.prepared}/${sweep.total} nets`
                  : sweep?.phase === "searching"
                    ? `Board sweep · ${sweep.iteration} adjustments · ${sweep.conflicts} candidate conflicts`
                    : "Tightening ropes"
                : stopReason === "budget-exhausted"
                  ? "Tick budget reached · unresolved"
                  : stopReason === "quantization-rejected"
                    ? "Quantization rejected · live state retained"
                    : stopReason === "solved"
                      ? "Validated solution"
                      : project.tick
                        ? "Simulation paused"
                        : "Ready to explore"}
            </strong>
          </div>
          <div className="layer-controls">
            <span>
              <Stack size={15} /> Layers
            </span>
            {Array.from({ length: project.layers }, (_, i) => (
              <button
                key={i}
                aria-label={`Toggle layer ${i + 1}`}
                aria-pressed={visible.includes(i)}
                className={visible.includes(i) ? "layer on" : "layer"}
                style={{ "--layer": COLORS[i] } as React.CSSProperties}
                onClick={() =>
                  setVisible((v) =>
                    v.includes(i) ? v.filter((l) => l !== i) : [...v, i],
                  )
                }
              >
                <i />L{i + 1}
              </button>
            ))}
          </div>
          <div className="canvas-bottom">
            <span>
              Drag to pan <b>·</b> Scroll to zoom <b>·</b> Click a net to
              inspect
            </span>
            <button onClick={() => setFit((v) => v + 1)}>
              <ArrowsOut />
              Fit board
            </button>
          </div>
          <div className="route-legend">
            <span className="legend-solid" />
            Clear route <span className="legend-draft" />
            Unresolved draft
          </div>
        </section>
        {inspector && (
          <aside>
            <div className="inspector-title">
              <h1>Simulation</h1>
              <span>EXPERIMENTAL</span>
            </div>
            <section className="settings">
              <h2>Generate a board</h2>
              <label>
                Random seed
                <input
                  aria-label="Random seed"
                  type="number"
                  min="0"
                  max="4294967295"
                  value={seed}
                  onChange={(e) =>
                    setSeed(
                      Math.max(0, Math.min(4294967295, Number(e.target.value))),
                    )
                  }
                />
              </label>
              <div className="field-pair">
                <label>
                  Components
                  <select
                    aria-label="Components"
                    value={count}
                    onChange={(e) => setCount(+e.target.value)}
                  >
                    {COMPONENT_COUNTS.map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Initial layers
                  <select
                    aria-label="Initial layers"
                    value={layers}
                    onChange={(e) => setLayers(+e.target.value)}
                  >
                    {[1, 2, 4, 6, 8].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                className="wide"
                onClick={() => {
                  replace(generate(seed, count, layers));
                  setMessage(
                    "Generated a reproducible board with loose two-pin nets.",
                  );
                }}
              >
                <Shuffle />
                Generate board
              </button>
            </section>
            <section className="settings">
              <h2>Rope behavior</h2>
              <label>
                Tightening strength{" "}
                <output>{project.settings.strength.toFixed(1)}×</output>
                <input
                  aria-label="Tightening strength"
                  type="range"
                  min="0.1"
                  max="2"
                  step="0.1"
                  value={project.settings.strength}
                  onChange={(e) =>
                    configure({
                      ...project.settings,
                      strength: +e.target.value,
                    })
                  }
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={project.settings.snaps}
                  onChange={(e) =>
                    configure({ ...project.settings, snaps: e.target.checked })
                  }
                />
                Allow rope & wall snaps
              </label>
              <p>
                Snaps must land fully clear. Blocked ropes try bends around the
                obstacle; same-layer overlaps are rejected.
              </p>
              <div className="upcoming">
                <span>Adaptive layer reduction</span>
                <span>Upcoming</span>
              </div>
            </section>
            <section className="settings">
              <h2>
                {route ? `${route.id} · selected net` : "Current geometry"}
              </h2>
              {route ? (
                <dl>
                  <div>
                    <dt>Terminals</dt>
                    <dd>{route.terminals.join(" → ")}</dd>
                  </div>
                  <div>
                    <dt>Layer</dt>
                    <dd>L{route.layer + 1}</dd>
                  </div>
                  <div>
                    <dt>Length</dt>
                    <dd>{(routeLength(route) / 1000).toFixed(1)} mm</dd>
                  </div>
                  <div>
                    <dt>Blocked ticks</dt>
                    <dd>{route.pressure}</dd>
                  </div>
                </dl>
              ) : (
                <dl>
                  <div>
                    <dt>Trace length</dt>
                    <dd>{(report.length / 1000).toFixed(1)} mm</dd>
                  </div>
                  <div>
                    <dt>Length reduction</dt>
                    <dd>
                      {startLength
                        ? ((1 - report.length / startLength) * 100).toFixed(1)
                        : "0.0"}
                      %
                    </dd>
                  </div>
                  <div>
                    <dt>Layers used / available</dt>
                    <dd>
                      {report.occupied} / {project.layers}
                    </dd>
                  </div>
                  <div>
                    <dt>Through vias</dt>
                    <dd>{report.vias}</dd>
                  </div>
                  <div>
                    <dt>Anchored nets</dt>
                    <dd>
                      {report.connected} / {project.routes.length}
                    </dd>
                  </div>
                </dl>
              )}
              <button
                className="wide subtle"
                onClick={() => setIssues((v) => !v)}
              >
                {issues ? <EyeSlash /> : <Eye />}
                {issues ? "Hide" : "Show"} violation markers
              </button>
              <p className={report.violations.length ? "warning" : "success"}>
                {report.violations.length
                  ? `${report.violations.length} geometric violations · unresolved`
                  : "Valid within prototype geometry rules"}
              </p>
              {report.violations.length > 0 && (
                <details className="violation-list" open>
                  <summary>
                    Explain violations ({report.violations.length})
                  </summary>
                  <div>
                    {report.violations
                      .filter((v) => !selected || v.objects.includes(selected))
                      .map((v, i) => (
                        <button
                          key={`${v.kind}-${v.objects.join("-")}`}
                          onClick={() => {
                            setIssues(true);
                            if (v.layer !== undefined)
                              setVisible((old) =>
                                old.includes(v.layer!)
                                  ? old
                                  : [...old, v.layer!],
                              );
                            setFocused({ violation: v, nonce: Date.now() });
                          }}
                        >
                          <span>
                            {v.objects.join(" / ")}
                            {v.layer !== undefined ? ` · L${v.layer + 1}` : ""}
                          </span>
                          <small>{v.message}</small>
                        </button>
                      ))}
                  </div>
                </details>
              )}
              {best && (
                <button className="wide" onClick={() => replace(best, false)}>
                  Restore best valid snapshot
                </button>
              )}
            </section>
            <section className="settings activity">
              <h2>
                Recent snaps <span>{events.length}</span>
              </h2>
              {events.length ? (
                events
                  .slice(-4)
                  .reverse()
                  .map((e, i) => (
                    <div key={`${e.tick}-${i}`}>
                      <span>{e.text}</span>
                      <small>Tick {e.tick}</small>
                    </div>
                  ))
              ) : (
                <p>
                  Accepted snap operations will appear here as the simulation
                  runs.
                </p>
              )}
            </section>
            <div className="prototype-note">
              Prototype scope: circular through-hole pads, two-pin nets, and
              through-vias. KiCad, LCSC, and layer evacuation are upcoming.
            </div>
          </aside>
        )}
      </main>
      <footer>
        <span className={running ? "live" : ""}>
          <i />
          {running ? "SOLVING" : ready ? "PAUSED" : "INITIALIZING"}
        </span>
        <span>{project.components.length} components</span>
        <span>{project.routes.length} nets</span>
        <span>{report.occupied} trace layers</span>
        <span>{report.vias} vias</span>
        <span className="footer-right">
          0° / 45° / 90° <b>·</b> Discrete layers <b>·</b> No pathfinding
        </span>
      </footer>
      {message && (
        <div role="status" className="toast">
          <span>{message}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setMessage("")}
          >
            <X />
          </button>
        </div>
      )}
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => void load(e.target.files?.[0])}
      />
    </div>
  );
}
