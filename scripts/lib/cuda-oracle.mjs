import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

/** A persistent local child process, not a network service or remote worker. */
export async function createCudaOracle({
  python = process.env.ROUTER_PYTHON || "python3",
  routeSegments,
  routesConflict,
  onStderr = (text) => process.stderr.write(text),
}) {
  const child = spawn(
    python,
    ["-u", fileURLToPath(new URL("../../gpu/cuda_server.py", import.meta.url))],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  const pending = new Map();
  let serial = 0,
    registry = new WeakMap(),
    count = 0,
    owners = new Map(),
    stopped = false;
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const fail = (error) => {
    stopped = true;
    readyReject(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.on("error", fail);
  child.on("exit", (code, signal) =>
    fail(
      new Error(
        `CUDA service exited (${code ?? signal}); check the CUDA log. No CPU fallback was used.`,
      ),
    ),
  );
  child.stderr.on("data", (data) => onStderr(data.toString()));
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (message.type === "ready") {
        readyResolve(message);
        return;
      }
      const request = pending.get(message.id);
      if (!request) throw new Error("Unexpected CUDA response");
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error));
      else request.resolve(message);
    } catch (error) {
      fail(error);
      child.kill();
    }
  });
  const info = await ready.catch((error) => {
    child.kill();
    throw error;
  });
  const rpc = (payload) =>
    new Promise((resolve, reject) => {
      if (stopped) {
        reject(new Error("CUDA service is not running"));
        return;
      }
      const id = ++serial;
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, ...payload }) + "\n", (error) => {
        if (error) {
          pending.delete(id);
          reject(error);
        }
      });
    });
  const stats = {
    calls: 0,
    pairs: 0,
    kernelMs: 0,
    wallMs: 0,
    boundaryFallbacks: 0,
    cacheResets: 0,
  };
  const oracle = {
    info,
    stats,
    async conflicts(candidates, others, clearance) {
      const start = performance.now();
      const unique = [...new Set([...candidates, ...others])];
      if (
        count + unique.filter((r) => !registry.has(r)).length >
        info.maxRoutes
      ) {
        await rpc({ op: "reset" });
        registry = new WeakMap();
        count = 0;
        stats.cacheResets++;
      }
      if (unique.length > info.maxRoutes)
        throw new Error("Collision batch exceeds GPU registry capacity");
      const add = [];
      for (const route of unique)
        if (!registry.has(route)) {
          if (!owners.has(route.id)) owners.set(route.id, owners.size);
          const index = count++;
          registry.set(route, index);
          add.push({
            index,
            owner: owners.get(route.id),
            width: route.width,
            segments: routeSegments(route).map((s) => [
              s.a.x,
              s.a.y,
              s.b.x,
              s.b.y,
              s.layer,
            ]),
            vias: (route.vias ?? []).map((v) => [v.x, v.y, v.radius]),
          });
        }
      const response = await rpc({
        op: "matrix",
        add,
        candidates: candidates.map((r) => registry.get(r)),
        others: others.map((r) => registry.get(r)),
        clearance,
      });
      const matrix = Uint8Array.from(Buffer.from(response.data, "base64"));
      if (
        matrix.length !== candidates.length * others.length ||
        response.rows !== candidates.length ||
        response.columns !== others.length
      )
        throw new Error("CUDA returned an invalid matrix shape");
      for (let i = 0; i < matrix.length; i++) {
        if (matrix[i] === 2) {
          const a = candidates[Math.floor(i / others.length)],
            b = others[i % others.length];
          matrix[i] = a.id !== b.id && routesConflict(a, b, clearance) ? 1 : 0;
          stats.boundaryFallbacks++;
        } else if (matrix[i] > 1)
          throw new Error("CUDA returned an invalid collision classification");
      }
      stats.calls++;
      stats.pairs += matrix.length;
      stats.kernelMs += response.kernelMs;
      stats.wallMs += performance.now() - start;
      return matrix;
    },
    close() {
      lines.close();
      child.stdin.end();
      child.kill();
    },
  };
  return oracle;
}
