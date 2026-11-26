"""Build and assemble tagged desktop releases. Publish only the checked draft."""
import base64
import hashlib
import json
import os
import plistlib
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
TAURI = ROOT / "src-tauri"
REPOSITORY = "yexiyue/castglean"
TAG = os.environ.get("RELEASE_TAG", "")
TARGETS = {
    "darwin-aarch64": "aarch64-apple-darwin",
    "windows-x86_64": "x86_64-pc-windows-msvc",
    "windows-x86_64-cuda": "x86_64-pc-windows-msvc",
}
TAG_PATTERN = r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-rc\.([1-9][0-9]*))?"


def command(*args, capture=False, env=None):
    executable = shutil.which(args[0]) or args[0]
    return subprocess.run(
        [executable, *args[1:]], cwd=ROOT, check=True,
        text=True, capture_output=capture, env=env,
    ).stdout


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def release_version():
    if not re.fullmatch(TAG_PATTERN, TAG):
        raise SystemExit("Expected a stable or rc SemVer tag")
    version = TAG[1:]
    import tomllib
    manifest = tomllib.loads((TAURI / "Cargo.toml").read_text(encoding="utf-8"))
    versions = (read_json(TAURI / "tauri.conf.json")["version"],
                read_json(ROOT / "package.json")["version"], manifest["package"]["version"])
    if any(value != version for value in versions):
        raise SystemExit(f"Tag {TAG} disagrees with app versions {versions}")
    if not (ROOT / f".github/release-notes/{TAG}.md").is_file():
        raise SystemExit(f"Missing reviewed release notes for {TAG}")
    return version


def files_by_target(version, target):
    if target == "darwin-aarch64":
        return f"CastGlean_{version}_aarch64.dmg", f"CastGlean_{version}_aarch64.app.tar.gz"
    suffix = "-cuda" if target.endswith("-cuda") else ""
    name = f"CastGlean_{version}_x64{suffix}-setup.exe"
    return name, name


def only_file(directory, pattern):
    files = list(directory.glob(pattern))
    if len(files) != 1 or not files[0].is_file() or not files[0].stat().st_size:
        raise SystemExit(f"Expected exactly one nonempty {pattern} in {directory}")
    return files[0]


def cuda_resources(staging):
    cuda = Path(os.environ["CUDA_PATH"])
    # Match the NVRTC loader name and skip the alternate DLL shipped by CUDA 13.
    patterns = ("cudart64_*.dll", "cublas64_*.dll", "cublasLt64_*.dll",
                "curand64_*.dll", "nvrtc64_*_0.dll", "nvrtc-builtins64_*.dll")
    resources = {}
    root = cuda / "bin"
    # CUDA 13 Windows installations may place these runtime libraries in bin/x64.
    for pattern in patterns:
        matches = sorted(root.rglob(pattern))
        if len(matches) != 1 or not matches[0].is_file():
            raise SystemExit(f"Expected exactly one CUDA redistributable matching {pattern}: {matches}")
        path = matches[0]
        resources[str(path)] = path.name
    notice = staging / "NVIDIA-CUDA-NOTICE.txt"
    notice.write_text(
        "Contains NVIDIA CUDA Toolkit redistributable libraries.\n"
        "Copyright NVIDIA Corporation. See the CUDA Toolkit EULA and its redistribution supplement.\n"
        "https://docs.nvidia.com/cuda/archive/13.0.2/eula/index.html\n", encoding="utf-8",
    )
    resources[str(notice)] = notice.name
    for component in ("cuda_cudart", "cuda_nvrtc", "libcublas", "libcurand"):
        for license_file in (cuda / "licenses" / component).glob("*"):
            if license_file.is_file():
                resources[str(license_file)] = f"licenses/{component}/{license_file.name}"
    return resources


def validate_windows_imports(executable, runtimes):
    bundled = {name.lower() for name in runtimes.values() if name.lower().endswith(".dll")}
    for path in [executable, *(Path(path) for path in runtimes if path.lower().endswith(".dll"))]:
        imports = command("dumpbin", "/DEPENDENTS", str(path), capture=True)
        for name in re.findall(r"^\s+([\w.-]+\.dll)\s*$", imports, re.M | re.I):
            library = name.lower()
            if library.startswith(("cuda", "nvcuda", "cublas", "curand", "nvrtc", "nvjitlink")):
                if library == "nvcuda.dll" and bundled:
                    continue
                if library not in bundled:
                    raise SystemExit(f"Unshipped CUDA import {name} in {path.name}")


def check_macos_package(dmg, archive, product_name, prerelease):
    with tempfile.TemporaryDirectory(prefix="castglean-macos-update-") as temp:
        command("tar", "-xf", str(archive), "-C", temp)
        app = Path(temp) / f"{product_name}.app"
        command("codesign", "--verify", "--deep", "--strict", str(app))
        if not prerelease:
            command("xcrun", "stapler", "validate", str(app))
        contents = app / "Contents"
        with (contents / "Info.plist").open("rb") as info:
            executable = plistlib.load(info)["CFBundleExecutable"]
        if Path(executable).name != executable:
            raise SystemExit("Invalid app executable name in update archive")
        command("lipo", "-verify_arch", "arm64", str(contents / "MacOS" / executable))
    if prerelease:
        return
    validation = subprocess.run(
        ["xcrun", "stapler", "validate", str(dmg)], capture_output=True, text=True,
    )
    if validation.returncode:
        # The app is notarized by Tauri. Some bundler versions leave the DMG ticket to distribution CI.
        submission = subprocess.run([
            "xcrun", "notarytool", "submit", str(dmg), "--wait", "--output-format", "json",
            "--apple-id", os.environ["APPLE_ID"], "--password", os.environ["APPLE_PASSWORD"],
            "--team-id", os.environ["APPLE_TEAM_ID"],
        ], capture_output=True, text=True)
        # Keep credentials and the command with secret arguments out of error output.
        try:
            report = json.loads(submission.stdout)
        except ValueError:
            report = {}
        if submission.returncode or report.get("status") != "Accepted":
            raise SystemExit(f"DMG notarization not accepted (submission {report.get('id', 'unknown')})")
        command("xcrun", "stapler", "staple", str(dmg))
        command("xcrun", "stapler", "validate", str(dmg))


def build(target, output):
    version = release_version()
    prerelease = "-rc." in TAG
    feed_tag = os.environ.get("RC_FEED_TAG", "")
    if prerelease and not (re.fullmatch(TAG_PATTERN, feed_tag) and "-rc." in feed_tag):
        raise SystemExit("Candidate requires an explicit candidate feed tag")
    feed = f"download/{feed_tag}" if prerelease else "latest/download"
    if not os.environ.get("TAURI_SIGNING_PRIVATE_KEY", "").strip():
        raise SystemExit("Missing updater signing private key")
    if not os.environ.get("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "").strip():
        raise SystemExit("Missing updater signing private key password")
    public_key = os.environ["CASTGLEAN_UPDATE_PUBLIC_KEY"].strip()
    base64.b64decode(public_key, validate=True)
    if not public_key:
        raise SystemExit("Missing updater public key")

    output.mkdir(parents=True, exist_ok=False)
    staging = TAURI / "target" / "desktop-release-config"
    staging.mkdir(parents=True, exist_ok=True)
    config = {
        "bundle": {
            "createUpdaterArtifacts": True,
            "resources": {str(ROOT / "LICENSE"): "CastGlean-LICENSE.txt",
                          str(ROOT / ".github/release-notes/THIRD-PARTY.md"): "THIRD-PARTY.md"},
        },
        "plugins": {"updater": {
            "pubkey": public_key,
            "requireSignedVersion": True,
            "endpoints": [f"https://github.com/{REPOSITORY}/releases/{feed}/latest.json"],
        }},
    }
    if prerelease:
        config["identifier"] = "com.yexiyue.castglean.rc"
        config["productName"] = "CastGlean RC"
        if target == "darwin-aarch64":
            config["bundle"]["macOS"] = {"signingIdentity": "-"}
    if target.startswith("windows-"):
        windows = {"nsis": {"installMode": "currentUser"}}
        if not prerelease:
            windows.update(
                certificateThumbprint=os.environ["WINDOWS_CERT_THUMBPRINT"],
                digestAlgorithm="sha256",
                timestampUrl="http://timestamp.digicert.com",
                tsp=True,
            )
        config["bundle"]["windows"] = windows
    if target == "darwin-aarch64" and not prerelease:
        for name in ("APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY",
                     "APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"):
            if not os.environ.get(name, "").strip():
                raise SystemExit(f"Missing stable macOS signing setting {name}")
    runtimes = cuda_resources(staging) if target.endswith("-cuda") else {}
    config["bundle"]["resources"].update(runtimes)
    config_file = staging / f"{target}.json"
    env = os.environ | {"CASTGLEAN_UPDATE_CHANNEL": "candidate" if prerelease else "stable"}
    platform = TARGETS[target]
    bundle = "app,dmg" if target == "darwin-aarch64" else "nsis"
    args = ["exec", "tauri", "build", "--target", platform, "--bundles", bundle, "--config", str(config_file)]
    for license_file in (ROOT / "licenses").glob("*.txt"):
        config["bundle"]["resources"][str(license_file)] = f"licenses/{license_file.name}"
    write_json(config_file, config)
    if target.endswith("-cuda"):
        args += ["--features", "windows-cuda"]
    command("pnpm", *args, "--", "--locked", env=env)
    bundle_root = TAURI / "target" / platform / "release" / "bundle"
    install_name, update_name = files_by_target(version, target)
    if install_name != update_name:
        dmg = only_file(bundle_root / "dmg", "*.dmg")
        update = only_file(bundle_root / "macos", "*.app.tar.gz")
        check_macos_package(dmg, update, config.get("productName", "CastGlean"), prerelease)
        shutil.copyfile(dmg, output / install_name)
    else:
        update = only_file(bundle_root / "nsis", "*-setup.exe")
        executable = bundle_root.parent / "castglean.exe"
        if not prerelease:
            command("signtool", "verify", "/pa", "/tw", str(executable))
            command("signtool", "verify", "/pa", "/tw", str(update))
        validate_windows_imports(executable, runtimes)
    shutil.copyfile(update, output / update_name)
    signature = only_file(update.parent, f"{update.name}.sig")
    shutil.copyfile(signature, output / f"{update_name}.sig")
    write_json(output / "target.json", {
        "target": target, "platform": platform, "tag": TAG,
        "commit": command("git", "rev-parse", "HEAD", capture=True).strip(),
        "talechime": command("git", "-C", "../talechime", "rev-parse", "HEAD", capture=True).strip(),
        "run": os.environ["GITHUB_RUN_ID"], "runner": os.environ.get("ImageOS"),
        "updaterPublicKey": public_key,
        "imageVersion": os.environ.get("ImageVersion"),
        "toolchain": command("rustc", "--version", capture=True).strip(),
        "cuda": command("nvcc", "--version", capture=True).strip() if target.endswith("-cuda") else None,
        "cudaComputeCapability": os.environ.get("CUDA_COMPUTE_CAP") if target.endswith("-cuda") else None,
        "sha256": {name: digest(output / name) for name in sorted({install_name, update_name, f"{update_name}.sig"})},
    })


def verify_update(package, signature, public_key, version):
    with tempfile.TemporaryDirectory(prefix="castglean-updater-") as temp:
        directory = Path(temp)
        key_path = directory / "updater.pub"
        key_path.write_bytes(base64.b64decode(public_key, validate=True))
        signature_path = directory / "updater.sig"
        decoded = base64.b64decode(signature, validate=True)
        signature_path.write_bytes(decoded)
        comments = [line for line in decoded.decode("utf-8").splitlines() if line.startswith("trusted comment: ")]
        if len(comments) != 1 or f"version:{version}" not in comments[0].split("\t"):
            raise SystemExit(f"Missing signed version on {package.name}")
        command("minisign", "-V", "-q", "-p", str(key_path), "-x", str(signature_path), "-m", str(package))


def assemble(inbox, output, source_runs=None):
    version = release_version()
    output.mkdir(parents=True, exist_ok=False)
    notes = (ROOT / f".github/release-notes/{TAG}.md").read_text(encoding="utf-8")
    summary = notes.strip().split("\n\n", 1)[0]
    base_url = f"https://github.com/{REPOSITORY}/releases/download/{TAG}"
    platforms, manifests = {}, {}
    signing_key = None
    commit = command("git", "rev-parse", "HEAD", capture=True).strip()
    pinned_engine = read_json(ROOT / ".github/desktop-build.json")["talechime"]
    if source_runs is None:
        source_runs = dict.fromkeys(TARGETS, os.environ["GITHUB_RUN_ID"])
    if set(source_runs) != set(TARGETS):
        raise SystemExit("Source run IDs must cover all three release targets")
    for target in TARGETS:
        staging = inbox / target
        manifest = read_json(staging / "target.json")
        if (manifest["target"], manifest["tag"], manifest["commit"], manifest["talechime"], manifest["run"]) != (
            target, TAG, commit, pinned_engine, source_runs[target]
        ):
            raise SystemExit(f"Build identity mismatch for {target}")
        installer, update_file = files_by_target(version, target)
        sig = f"{update_file}.sig"
        names = {installer, update_file, sig}
        if names != set(manifest["sha256"]):
            raise SystemExit(f"Unexpected manifest files for {target}")
        for name in sorted(names):
            path = staging / name
            if digest(path) != manifest["sha256"][name] or (output / name).exists():
                raise SystemExit(f"Invalid or duplicate asset {name}")
            shutil.copyfile(path, output / name)
        signature = (output / sig).read_text(encoding="utf-8").strip()
        if not signature:
            raise SystemExit(f"Missing signature for {target}")
        if signing_key is None:
            signing_key = manifest["updaterPublicKey"]
        if manifest["updaterPublicKey"] != signing_key:
            raise SystemExit(f"Conflicting updater key for {target}")
        verify_update(output / update_file, signature, signing_key, version)
        platforms[target] = {"signature": signature, "url": f"{base_url}/{update_file}"}
        manifests[target] = manifest
    source_date = command("git", "show", "-s", "--format=%cI", capture=True).strip()
    write_json(output / "latest.json", {
        "version": version, "notes": summary, "pub_date": source_date, "platforms": platforms,
    })
    write_json(output / "build-manifest.json", {"tag": TAG, "targets": manifests})
    shutil.copyfile(ROOT / ".github/release-notes/THIRD-PARTY.md", output / "THIRD-PARTY.md")
    shutil.copyfile(ROOT / "LICENSE", output / "CastGlean-LICENSE.txt")
    with (output / "SHA256SUMS").open("w", encoding="utf-8") as checksums:
        for path in sorted(p for p in output.iterdir() if p.name != "SHA256SUMS"):
            checksums.write(f"{digest(path)}  {path.name}\n")


if __name__ == "__main__":
    mode, *args = sys.argv[1:]
    if mode == "build":
        build(args[0], Path(args[1]).resolve())
    elif mode == "assemble":
        assemble(*[Path(arg).resolve() for arg in args])
    else:
        raise SystemExit(f"Unknown mode {mode}")
