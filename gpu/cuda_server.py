"""Persistent CUDA collision service over stdin/stdout. No network server.

The TypeScript solver owns all geometry generation, RNG, decisions and commits.
This process only answers finite route-pair collision questions on a CUDA GPU.
"""
import base64
import json
import os
from pathlib import Path
import sys
import sysconfig

# Support isolated Windows test environments using NVIDIA's runtime wheels.
_dll_handles = []
if os.name == "nt":
    root = Path(sysconfig.get_paths()["purelib"]) / "nvidia"
    for directory in root.glob("*/bin"):
        _dll_handles.append(os.add_dll_directory(str(directory)))
    runtime = root / "cuda_runtime"
    if runtime.exists():
        os.environ.setdefault("CUDA_PATH", str(runtime))

import numpy as np
import cupy as cp


class Registry:
    BYTES_PER_ROUTE = 31 * 5 * 8 + 30 * 3 * 8 + 8 + 3 * 4

    def __init__(self):
        self.max_routes = max(1024, int(os.environ.get("ROUTER_GPU_CACHE_MB", "256")) * 1024**2 // self.BYTES_PER_ROUTE)
        self.size = 0
        self.capacity = 0
        self.arrays = None
        self.kernel = cp.RawKernel(Path(__file__).with_name("conflicts.cu").read_text(), "conflict_matrix", options=("--std=c++11", "--fmad=false"))
        self.kernel.compile()

    def reset(self):
        self.arrays = None
        self.size = self.capacity = 0
        cp.get_default_memory_pool().free_all_blocks()

    def reserve(self, required):
        if required > self.max_routes:
            raise ValueError("GPU geometry cache limit exceeded; client must reset its registry")
        if required <= self.capacity:
            return
        capacity = min(self.max_routes, max(1024, self.capacity * 2, required))
        arrays = [cp.empty((capacity, 31, 5), dtype=cp.float64), cp.empty(capacity, dtype=cp.int32),
                  cp.empty(capacity, dtype=cp.float64), cp.empty((capacity, 30, 3), dtype=cp.float64),
                  cp.empty(capacity, dtype=cp.int32), cp.empty(capacity, dtype=cp.int32)]
        if self.arrays is not None:
            for new, old in zip(arrays, self.arrays):
                new[:self.size] = old[:self.size]
        self.arrays = arrays
        self.capacity = capacity
        cp.get_default_memory_pool().free_all_blocks()

    def add(self, routes):
        if not routes:
            return
        n = len(routes)
        packed = [np.zeros((n, 31, 5), dtype=np.float64), np.empty(n, dtype=np.int32),
                  np.empty(n, dtype=np.float64), np.zeros((n, 30, 3), dtype=np.float64),
                  np.empty(n, dtype=np.int32), np.empty(n, dtype=np.int32)]
        for i, route in enumerate(routes):
            if route["index"] != self.size + i:
                raise ValueError("Noncontiguous geometry registration")
            ns, nv = len(route["segments"]), len(route["vias"])
            if not 1 <= ns <= 31 or not 0 <= nv <= 30:
                raise ValueError("Geometry exceeds supported 32-point / 30-via route format")
            packed[0][i, :ns] = route["segments"]
            packed[1][i] = ns
            packed[2][i] = route["width"]
            if nv:
                packed[3][i, :nv] = route["vias"]
            packed[4][i] = nv
            packed[5][i] = route["owner"]
        if not all(np.isfinite(array).all() for array in packed):
            raise ValueError("Nonfinite geometry")
        self.reserve(self.size + n)
        for destination, source in zip(self.arrays, packed):
            destination[self.size:self.size+n] = cp.asarray(source)
        self.size += n

    def matrix(self, request):
        self.add(request.get("add", []))
        rows, columns = len(request["candidates"]), len(request["others"])
        ids = request["candidates"] + request["others"]
        if any(not isinstance(i, int) or i < 0 or i >= self.size for i in ids):
            raise ValueError("Unregistered route")
        output = cp.empty(rows * columns, dtype=cp.uint8)
        kernel_ms = 0.0
        if rows and columns:
            candidates = cp.asarray(request["candidates"], dtype=cp.int32)
            others = cp.asarray(request["others"], dtype=cp.int32)
            start, end = cp.cuda.Event(), cp.cuda.Event()
            start.record()
            self.kernel(((rows*columns+127)//128,), (128,), (*self.arrays, candidates, others, np.int32(rows), np.int32(columns), np.float64(request["clearance"]), output))
            end.record()
            end.synchronize()
            kernel_ms = cp.cuda.get_elapsed_time(start, end)
        data = base64.b64encode(cp.asnumpy(output).tobytes()).decode("ascii")
        return {"data": data, "rows": rows, "columns": columns, "kernelMs": kernel_ms, "registered": self.size}


def main():
    registry = Registry()
    properties = cp.cuda.runtime.getDeviceProperties(cp.cuda.Device().id)
    name = properties["name"]
    if isinstance(name, bytes):
        name = name.decode()
    print(json.dumps({"type": "ready", "backend": "cuda", "device": name, "cupy": cp.__version__,
                      "cudaRuntime": cp.cuda.runtime.runtimeGetVersion(), "driver": cp.cuda.runtime.driverGetVersion(),
                      "maxRoutes": registry.max_routes, "precision": "float64"}), flush=True)
    for line in sys.stdin:
        request = json.loads(line)
        try:
            if request["op"] == "reset":
                registry.reset()
                result = {"reset": True}
            elif request["op"] == "matrix":
                result = registry.matrix(request)
            else:
                raise ValueError("Unknown CUDA operation")
            print(json.dumps({"id": request["id"], **result}), flush=True)
        except Exception as error:
            print(json.dumps({"id": request.get("id"), "error": f"{type(error).__name__}: {error}"}), flush=True)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
