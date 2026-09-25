# CUDA benchmarks in Google Colab

GPU acceleration is experimental. The new CUDA backend evaluates many route-pair collision checks together. The existing TypeScript solver still generates candidates, chooses mutations, maintains snapshots, and independently validates complete boards. Selecting a GPU runtime alone would not accelerate the original JavaScript implementation.

## Run after uploading this repository

1. Upload the source, including `gpu/`, `scripts/lib/`, `scripts/run-colab.mjs`, `scripts/gpu-parity.mjs`, the package lockfile, and `colab/RouterV2_GPU.ipynb`. Generated artifacts, dependencies, and local virtual environments are ignored by Git.
2. Open Google Colab, choose **File → Open notebook → GitHub**, and select `colab/RouterV2_GPU.ipynb` from your repository. Alternatively upload that notebook directly.
3. Choose **Runtime → Change runtime type → GPU**.
4. Enter `REPO_URL` in the configuration cell. Optionally set `GIT_REF` to pin the revision. For private repositories, enable `PRIVATE_REPO` and add a read-only `GITHUB_TOKEN` through Colab Secrets.
5. Leave `RUN_CPU_BASELINE=True` for the first run. The default case has 100 components/nets and two layers. Enable `SAVE_TO_DRIVE` for persistent checkpoints.
6. Run all cells. The notebook installs dependencies, performs a GPU preflight, runs the CPU baseline and CUDA cases, then downloads results as a ZIP. Processes run directly and write progress to files; there is no polling loop.

Set `CASES = [[42017,100,2], [42017,200,2], [99,200,4]]` to test the larger published fixtures. The CPU baseline covers the first case only. To compare another case, put it first or run it separately. Do not infer general reliability from one seed.

## Evidence and failure handling

Before CUDA routing, 36,300 route-pair checks exercise mid-segment intersections, layer separation, collinear and degenerate segments, unequal widths, vias, and clearance boundaries against the CPU predicate. Float64 CUDA calculations disable FMA contraction; results close to clearance boundaries are delegated back to the original CPU predicate. A mismatch or unavailable GPU stops execution rather than silently using CPU under a CUDA label.

Each run saves hardware/software metadata, source revision and hashes, parity results, progress logs, per-case timings, final project files, and resumable solver snapshots. A solved result requires independent live and saved geometry validation and no regression after reaching a clear board. CPU/GPU comparison also requires matching final state hashes. Inspect `comparison.json`: a speedup ratio above 1 means CUDA was faster end-to-end for that case on that runtime. Kernel duration alone is not the application speedup.

For an interrupted run, set `RESUME_SNAPSHOT` to an unfinished checkpoint in Drive and run the notebook again. Keep the same source revision. Snapshots use the same format as CPU runs. Checkpoints are taken at iteration boundaries, so an interrupted preparation phase may need to be repeated. Local runtime files are ephemeral; download the ZIP or enable Drive persistence.

GPU speedup is not yet established. Candidate preparation, some conflict bookkeeping, and final validation remain on CPU. Small batches, transfers, and low double-precision GPU throughput may make CUDA slower. Acceleration does not fix an unsolved topology or guarantee that every board routes.

## Local commands

Use a Python environment with the matching CUDA/CuPy dependencies and set `ROUTER_PYTHON` to its interpreter. The notebook installs these automatically on Colab.

```sh
npm run test:gpu
node scripts/run-colab.mjs --backend=cpu --cases='[[42017,16,2]]' --output=artifacts/colab/cpu
node scripts/run-colab.mjs --backend=cuda --cases='[[42017,16,2]]' --output=artifacts/colab/cuda
```

`colab/build-notebook.py` regenerates the notebook and validates its schema and Python cell syntax; it requires `nbformat` in the development environment.

## Verification status

The four accelerator integration tests pass, including deterministic CPU/oracle agreement, restoration mid-batch, malformed accelerator output rejection, and independent rejection of false conflict-free results. The production build passes. Notebook schema and cell syntax validate. Actual CUDA execution is pending: the initial local CuPy installation hit a package-download timeout. Neither an end-to-end GPU pass nor a measured speedup is claimed.

References: [Colab GPU and runtime FAQ](https://research.google.com/colaboratory/faq.html), [CuPy installation](https://docs.cupy.dev/en/stable/install.html), [CuPy RawKernel](https://docs.cupy.dev/en/stable/reference/generated/cupy.RawKernel.html).
