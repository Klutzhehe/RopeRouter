from pathlib import Path
import json
import nbformat as nbf

nb=nbf.v4.new_notebook()
nb.metadata={"kernelspec":{"display_name":"Python 3","name":"python3"},"language_info":{"name":"python"},"colab":{"name":"RouterV2_GPU.ipynb","provenance":[]},"accelerator":"GPU"}
cells=[]
def md(text):cells.append(nbf.v4.new_markdown_cell(text))
def code(text):cells.append(nbf.v4.new_code_cell(text))
md('''# RouterV2: CUDA routing benchmark

This runs the repository's actual TypeScript solver with **CUDA route-collision batches**, using CuPy as the local GPU bridge. Generation, geometric mutations, random choices, and the final validator remain in TypeScript. Merely selecting a GPU does not accelerate ordinary JavaScript.

1. Upload this repository to GitHub, then open this notebook in Colab (File → Open notebook → GitHub, or upload this `.ipynb`).
2. Choose **Runtime → Change runtime type → GPU**. A T4 is sufficient to try; GPU availability varies.
3. Enter the GitHub URL below, optionally pin a branch/tag/commit, then run all cells.

The run stops before routing if GPU initialization or CPU/GPU collision parity fails. There is no silent CPU fallback. The optional CPU baseline measures end-to-end speedup; a GPU is **not guaranteed** to win. Detailed progress is written to files; this notebook does not poll jobs or use keep-alive workarounds.

Colab runtimes can terminate. Enable Drive checkpoints below for long runs. Do not close a runtime expecting its local files to persist. No repository or notebook is published automatically.''')
code('''# Configuration — fill in your repository URL after uploading it.
REPO_URL = ""  # @param {type:"string"}
GIT_REF = ""  # @param {type:"string"}
PRIVATE_REPO = False  # @param {type:"boolean"}
SAVE_TO_DRIVE = False  # @param {type:"boolean"}
RUN_CPU_BASELINE = True  # @param {type:"boolean"}

# [seed, component/net count, layers]. Start with one 100-net case.
# Add [42017, 200, 2] or [99, 200, 4] once the first benchmark passes.
CASES = [[42017, 100, 2]]
CHECKPOINT_EVERY = 100  # coordinated adjustments, not wall-clock polling
RESUME_SNAPSHOT = ""  # optional local/Drive path to an unfinished .snapshot.json
WORKSPACE = "/content/RouterV2"

# For a private repo, put a read-only GitHub token in Colab Secrets as
# GITHUB_TOKEN and enable PRIVATE_REPO. Never paste a token into REPO_URL.
''')
md('''## Clone the selected source revision

Tokens, if needed, are passed through a temporary Git credential prompt helper. They are not embedded in the repository URL, notebook output, or Git configuration. Existing local edits are not force-reset.''')
code('''import os, sys, re, json, shutil, subprocess, tempfile, pathlib, datetime
from pathlib import Path

if not re.fullmatch(r"https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/?", REPO_URL):
    raise ValueError("Enter an HTTPS GitHub repository URL without a token or query string.")
if GIT_REF and (GIT_REF.startswith("-") or not re.fullmatch(r"[A-Za-z0-9_./-]+", GIT_REF)):
    raise ValueError("Use a branch, tag, or full commit SHA for GIT_REF.")
repo = Path(WORKSPACE)
env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
helper = None
try:
    if PRIVATE_REPO:
        from google.colab import userdata
        env["ROUTER_GITHUB_TOKEN"] = userdata.get("GITHUB_TOKEN")
        helper = tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False)
        helper.write("#!/usr/bin/env python3\\nimport os,sys\\nprint('x-access-token' if 'username' in sys.argv[1].lower() else os.environ['ROUTER_GITHUB_TOKEN'])\\n")
        helper.close()
        os.chmod(helper.name, 0o700)
        env["GIT_ASKPASS"] = helper.name
    if not repo.exists():
        subprocess.run(["git", "clone", "--", REPO_URL, str(repo)], env=env, check=True)
    else:
        origin = subprocess.check_output(["git", "-C", str(repo), "remote", "get-url", "origin"], text=True).strip()
        normalize = lambda value: value.rstrip("/").removesuffix(".git").lower()
        if normalize(origin) != normalize(REPO_URL):
            raise RuntimeError("WORKSPACE contains a different repository. Choose another directory.")
        subprocess.run(["git", "-C", str(repo), "fetch", "origin"], env=env, check=True)
        subprocess.run(["git", "-C", str(repo), "remote", "set-head", "origin", "--auto"], env=env, check=True)
    subprocess.run(["git", "-C", str(repo), "checkout", "--detach", GIT_REF or "origin/HEAD"], env=env, check=True)
finally:
    env.pop("ROUTER_GITHUB_TOKEN", None)
    env.pop("GIT_ASKPASS", None)
    if helper:
        Path(helper.name).unlink(missing_ok=True)
commit = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
print("Source commit:", commit)
if not (repo / "scripts/run-colab.mjs").is_file():
    raise RuntimeError("This revision does not include the CUDA/Colab setup. Upload the new files first.")
''')
md('''## Install the pinned Node runtime and CUDA bridge

Node 22.18.0 matches the tested project runtime. Its official archive is verified against Node's SHA-256 manifest. The CuPy package is selected from the installed CUDA toolkit version. This cell fails if the runtime has no NVIDIA GPU; it does not continue with a misleading GPU label.''')
code('''import hashlib, tarfile, urllib.request, importlib.metadata

subprocess.run(["nvidia-smi"], check=True)
if shutil.which("nvcc") is None:
    raise RuntimeError("CUDA toolkit not found. Select a standard Colab NVIDIA GPU runtime.")
toolkit = subprocess.check_output(["nvcc", "--version"], text=True)
match = re.search(r"release (\\d+)\\.", toolkit)
if not match or int(match.group(1)) not in (12, 13):
    raise RuntimeError("This notebook supports CUDA toolkits 12 and 13.")
cuda_major = int(match.group(1))
expected_cupy = f"cupy-cuda{cuda_major}x"
installed = {dist.metadata["Name"].lower() for dist in importlib.metadata.distributions() if dist.metadata["Name"]}
wrong = sorted(installed.intersection({"cupy", "cupy-cuda11x", "cupy-cuda12x", "cupy-cuda13x"}) - {expected_cupy})
if wrong:
    subprocess.run([sys.executable, "-m", "pip", "uninstall", "-y", *wrong], check=True)
subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(repo / f"gpu/requirements-cuda{cuda_major}.txt")], check=True)

NODE_VERSION = "22.18.0"
archive_name = f"node-v{NODE_VERSION}-linux-x64.tar.xz"
base_url = f"https://nodejs.org/dist/v{NODE_VERSION}/"
tools = Path("/content/router-tools")
tools.mkdir(exist_ok=True)
node_root = tools / f"node-v{NODE_VERSION}-linux-x64"
if not (node_root / "bin/node").exists():
    archive = tools / archive_name
    urllib.request.urlretrieve(base_url + archive_name, archive)
    manifest = urllib.request.urlopen(base_url + "SHASUMS256.txt", timeout=60).read().decode()
    expected_hash = next(line.split()[0] for line in manifest.splitlines() if line.split()[-1] == archive_name)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected_hash:
        raise RuntimeError("Node archive checksum mismatch")
    with tarfile.open(archive) as bundle:
        bundle.extractall(tools, filter="data")
os.environ["PATH"] = str(node_root / "bin") + os.pathsep + os.environ["PATH"]
os.environ["ROUTER_PYTHON"] = sys.executable
subprocess.run(["node", "--version"], check=True)
subprocess.run(["npm", "ci"], cwd=repo, check=True)
# Install only the headless routing dependencies. No browser or tunnel is needed.
''')
md('''## Results and optional persistent checkpoints

Use a fresh run directory for each benchmark. Drive receives compact resumable checkpoints; active computation and logs remain on the runtime's local disk. To resume later, set `RESUME_SNAPSHOT` to a saved checkpoint path and rerun; CPU/GPU backends share the same snapshot format.''')
code('''RUN_ID = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
run_root = repo / "artifacts" / "colab" / RUN_ID
run_root.mkdir(parents=True, exist_ok=False)
checkpoint_dir = None
if SAVE_TO_DRIVE:
    from google.colab import drive
    drive.mount("/content/drive")
    checkpoint_dir = Path("/content/drive/MyDrive/RouterV2/checkpoints") / RUN_ID
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
print("Results:", run_root)
if checkpoint_dir:
    print("Persistent checkpoints:", checkpoint_dir)
''')
md('''## Run parity checks, routing, and the optional baseline

The CUDA runner first tests mid-segment crossings, different layers, collinear/degenerate segments, unequal widths, via barrels, and near-clearance boundaries against the CPU predicate. Near-boundary GPU results are rechecked on the CPU. Every solved board still passes the original CPU validator and schema checks.

Leave this cell running normally; there is no status-polling loop. Progress is emitted by the solver and written to `run.log` / `status.json`. Candidate generation and some validation remain CPU-bound. CUDA double precision and transfer overhead can limit speedup, especially for small boards or GPUs with low FP64 throughput.''')
code('''exit_codes = {}
backends = ["cpu", "cuda"] if RUN_CPU_BASELINE and not RESUME_SNAPSHOT else ["cuda"]
try:
    preflight = subprocess.run(["node", "scripts/gpu-parity.mjs", str(run_root / "preflight")], cwd=repo)
    exit_codes["preflight"] = preflight.returncode
    if preflight.returncode:
        raise RuntimeError("GPU preflight failed. Run the download cell to retain the diagnostic output.")
    for backend in backends:
        destination = run_root / backend
        destination.mkdir(exist_ok=True)
        # The baseline covers the first configured case; CUDA runs all configured cases.
        selected_cases = CASES[:1] if backend == "cpu" else CASES
        command = ["node", "scripts/run-colab.mjs", f"--backend={backend}",
                   f"--output={destination}", f"--cases={json.dumps(selected_cases)}",
                   f"--checkpoint-every={CHECKPOINT_EVERY}"]
        if checkpoint_dir:
            command.append(f"--checkpoint-dir={checkpoint_dir / backend}")
        if RESUME_SNAPSHOT:
            command.append(f"--resume={RESUME_SNAPSHOT}")
        print("Starting", backend, "routing. Progress and outcomes follow below.", flush=True)
        # This waits for the process itself; it does not poll or keep Colab artificially alive.
        completed = subprocess.run(command, cwd=repo)
        exit_codes[backend] = completed.returncode
finally:
    (run_root / "launch-results.json").write_text(json.dumps({"commit": commit, "exitCodes": exit_codes}, indent=2))
print("Finished commands:", exit_codes)
''')
md('''## Compare outcomes and download the evidence

A speedup above 1 means the CUDA run was faster end-to-end on this runtime. The state hash must also match for CPU/GPU equivalence. Kernel time alone is not the application speedup. Failure, interruption, or a missing result is reported explicitly.''')
code('''from google.colab import files

summaries = {}
for backend in ("cpu", "cuda"):
    path = run_root / backend / "status.json"
    if path.exists():
        summaries[backend] = json.loads(path.read_text())
comparison = []
for cpu in summaries.get("cpu", {}).get("results", []):
    for gpu in summaries.get("cuda", {}).get("results", []):
        if (cpu["seed"], cpu["count"], cpu["layers"]) == (gpu["seed"], gpu["count"], gpu["layers"]):
            comparison.append({"seed": cpu["seed"], "nets": cpu["count"], "layers": cpu["layers"],
                "cpuSeconds": round(cpu["elapsedMs"] / 1000, 2), "cudaSeconds": round(gpu["elapsedMs"] / 1000, 2),
                "endToEndSpeedup": round(cpu["elapsedMs"] / max(1, gpu["elapsedMs"]), 3),
                "bothSolved": cpu["passed"] and gpu["passed"],
                "identicalState": cpu["stateSha256"] == gpu["stateSha256"]})
report = {"states": {key: value.get("state") for key, value in summaries.items()}, "comparisons": comparison}
(run_root / "comparison.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
for item in comparison:
    if item["endToEndSpeedup"] < 1:
        print("CUDA was slower for this case/device; do not infer a GPU speedup.")
archive = shutil.make_archive(str(run_root), "zip", root_dir=run_root)
if checkpoint_dir:
    shutil.copy2(archive, checkpoint_dir / Path(archive).name)
files.download(archive)
if any(code != 0 for code in exit_codes.values()) or summaries.get("cuda", {}).get("state") != "passed" or any(not item["identicalState"] or not item["bothSolved"] for item in comparison):
    raise RuntimeError("Verification is incomplete or failed. Keep the downloaded logs/checkpoints for diagnosis.")
''')
md('''## References

- [Colab GPU usage and runtime limits](https://research.google.com/colaboratory/faq.html)
- [CuPy installation and CUDA package selection](https://docs.cupy.dev/en/stable/install.html)
- [CuPy RawKernel](https://docs.cupy.dev/en/stable/reference/generated/cupy.RawKernel.html)

This is a hybrid experimental accelerator. It does not change the board constraints, add routing layers, replace the solver with pathfinding, or treat a low candidate-conflict count as a valid final board.''')
nb.cells=cells
nbf.validate(nb)
Path('colab/RouterV2_GPU.ipynb').write_text(nbf.writes(nb),encoding='utf-8')
import ast
for cell in nb.cells:
 if cell.cell_type=='code':ast.parse(cell.source)
print('Notebook schema and all Python cells validated:',len(nb.cells),'cells')
