import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkGpuParity } from "./lib/gpu-parity.mjs";
import { createCudaOracle } from "./lib/cuda-oracle.mjs";
const directory = resolve(process.argv[2] ?? "artifacts/gpu-parity");
await mkdir(directory, { recursive: true });
const server = await createServer({
  server: { middlewareMode: true, watch: null, hmr: false },
  appType: "custom",
});
let oracle;
try {
  const { routeSegments } = await server.ssrLoadModule("/src/core/geometry.ts");
  const { routesConflict } = await server.ssrLoadModule(
    "/src/core/pbd/repair.ts",
  );
  const { directionalLayers } = await server.ssrLoadModule(
    "/src/core/pbd/board-sweep.ts",
  );
  oracle = await createCudaOracle({ routeSegments, routesConflict });
  const result = await checkGpuParity(oracle, {
    routesConflict,
    directionalLayers,
  });
  await writeFile(
    resolve(directory, "parity.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  await writeFile(
    resolve(directory, "parity.json"),
    JSON.stringify({ passed: false, error: String(error) }, null, 2),
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  oracle?.close();
  await server.close();
}
