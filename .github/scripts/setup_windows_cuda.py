"""Provision nvcc and CUDA libraries from NVIDIA's pinned Windows ZIP packages."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

BASE = "https://developer.download.nvidia.com/compute/cuda/redist/"
COMPONENTS = (
    "cuda_cccl", "cuda_crt", "cuda_cudart", "cuda_nvcc", "cuda_nvrtc",
    "libcublas", "libcurand", "libnvjitlink", "libnvptxcompiler", "libnvvm",
)


def download(url, destination, checksum):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=90) as response, destination.open("wb") as stream:
                shutil.copyfileobj(response, stream)
            with destination.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != checksum:
                    raise ValueError(f"Checksum mismatch for {url}")
            return destination
        except OSError:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def unpack(archive, component, root):
    with zipfile.ZipFile(archive) as zipped:
        for member in zipped.infolist():
            parts = PurePosixPath(member.filename).parts[1:]
            if not parts or member.is_dir():
                continue
            if any(part in ("", ".", "..") or ":" in part or "\\" in part for part in parts):
                raise ValueError(f"Unexpected archive path {member.filename}")
            if parts[0].upper().startswith(("LICENSE", "EULA")):
                parts = ("licenses", component, *parts)
            elif parts[0] == "lib" and (len(parts) == 2 or parts[1] != "x64"):
                parts = ("lib", "x64", *parts[1:])
            destination = root.joinpath(*parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            with zipped.open(member) as source, destination.open("wb") as target:
                shutil.copyfileobj(source, target)


def setup(pins_path):
    pins = json.loads(pins_path.read_text(encoding="utf-8"))
    root = Path(os.environ["RUNNER_TEMP"]) / f"castglean-cuda-{pins['cuda']}"
    root.mkdir()
    with tempfile.TemporaryDirectory(dir=root.parent) as staging:
        staging = Path(staging)
        release = json.loads(
            download(BASE + f"redistrib_{pins['cuda']}.json", staging / "manifest.json",
                     pins["cuda_manifest_sha256"]).read_text(encoding="utf-8")
        )
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            tasks = {
                component: executor.submit(
                    download, BASE + package["relative_path"], staging / f"{component}.zip", package["sha256"]
                )
                for component in COMPONENTS
                for package in [release[component]["windows-x86_64"]]
            }
            for component, task in tasks.items():
                unpack(task.result(), component, root)
    for needed in ("bin/nvcc.exe", "include/cuda.h", "lib/x64/cuda.lib",
                   "lib/x64/cudart.lib", "lib/x64/cublas.lib", "lib/x64/cublasLt.lib",
                   "lib/x64/curand.lib", "lib/x64/nvrtc.lib"):
        if not (root / needed).is_file():
            raise SystemExit(f"CUDA Toolkit is missing {needed}")
    # The ONNX Runtime used by Kokoro is built with the dynamic MSVC CRT.
    # NVCC otherwise emits /MT objects, which MSVC rejects at final link (LNK2038).
    runtime_flags = "-Xcompiler=/MD"
    with tempfile.TemporaryDirectory(dir=root.parent) as probe:
        probe_dir = Path(probe)
        source = probe_dir / "runtime.cu"
        source.write_text("#include <vector>\n__global__ void probe() {}\n", encoding="utf-8")
        obj = probe_dir / "runtime.obj"
        env = os.environ | {"CUDA_PATH": str(root), "NVCC_APPEND_FLAGS": runtime_flags}
        subprocess.run([
            str(root / "bin/nvcc.exe"), "-std=c++17", "-arch", f"sm_{pins['cuda_cap']}",
            "-c", str(source), "-o", str(obj),
        ], env=env, check=True)
        directs = subprocess.check_output(["dumpbin", "/DIRECTIVES", str(obj)], text=True)
        if "RuntimeLibrary=MD_DynamicRelease" not in directs or "RuntimeLibrary=MT_StaticRelease" in directs:
            raise SystemExit("CUDA objects must use the dynamic MSVC CRT (/MD)")
    with Path(os.environ["GITHUB_ENV"]).open("a", encoding="utf-8") as stream:
        print(f"CUDA_PATH={root}", file=stream)
        print(f"NVCC_APPEND_FLAGS={runtime_flags}", file=stream)
    with Path(os.environ["GITHUB_PATH"]).open("a", encoding="utf-8") as stream:
        print(root / "bin", file=stream)


if __name__ == "__main__":
    setup(Path(sys.argv[1]))
