#!/usr/bin/env python3
"""Collect exact npm/Go dependency notices; --check verifies the committed snapshot.

Run npm ci in frontend first. Downloads use the Go module proxy and official
upstream license files only, cached under the system temporary directory.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import re
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "frontend/app/features/licenses/catalog.generated.json"
SOURCES = ROOT / "scripts/license-sources.json"
INPUTS = ["frontend/package-lock.json", "backend/go.mod", "compose.yaml",
          "backend/Dockerfile", "frontend/Dockerfile", "frontend/app/root.tsx",
          "scripts/license-sources.json", "scripts/generate-licenses.py"]
NOTICE = re.compile(r"^(licen[cs]e|copying|notice|copyright|patents)([.\-_]|$)", re.I)
CACHE = Path(tempfile.gettempdir()) / "mobile-tracer-license-cache"


def hashes():
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
            for name in INPUTS}


def download(url):
    CACHE.mkdir(exist_ok=True)
    path = CACHE / hashlib.sha256(url.encode()).hexdigest()
    if not path.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "mobile-tracer-license-collector"})
        with urllib.request.urlopen(request, timeout=90) as response:
            raw = response.read()
        path.write_bytes(raw)
    return path.read_bytes()


def notices(files):
    # Preserve upstream copyright and notice text verbatim, without duplicate files.
    result, seen = [], set()
    for name, raw in sorted(files):
        text = raw.decode("utf-8", errors="replace")
        if text.strip() and text not in seen:
            result.append({"file": name, "text": text})
            seen.add(text)
    return result


def module_versions():
    return re.findall(r"^\s*([^\s()]+)\s+(v[^\s]+)",
                      (ROOT / "backend/go.mod").read_text(), re.M)


def npm_entries():
    packages = json.loads((ROOT / "frontend/package-lock.json").read_text())["packages"]
    entries = {}
    for location, info in packages.items():
        if not location:
            continue
        name = location.rsplit("node_modules/", 1)[1]
        version = info["version"]
        identity = f"npm:{name}@{version}"
        if identity in entries:
            continue
        directory = ROOT / "frontend" / location
        metadata = json.loads((directory / "package.json").read_text()) if directory.exists() else {}
        if metadata and metadata.get("version") != version:
            raise ValueError(f"Run npm ci: installed version differs for {name}")
        files = [(p.name, p.read_bytes()) for p in directory.iterdir()
                 if p.is_file() and NOTICE.match(p.name)] if directory.exists() else []
        license_name = info["license"]
        license_url = f"https://www.npmjs.com/package/{name}/v/{version}"
        if name in ("gsap", "@gsap/react"):
            license_url = "https://gsap.com/standard-license/"
            license_name = "GSAP Standard License"
        # Firebase's npm distributions omit a root LICENSE; use its release's
        # repository license rather than substituting another package's notice.
        if not files and (name == "firebase" or name.startswith("@firebase/")):
            firebase_version = packages["node_modules/firebase"]["version"]
            license_url = f"https://raw.githubusercontent.com/firebase/firebase-js-sdk/firebase%40{firebase_version}/LICENSE"
            files = [("LICENSE", download(license_url))]
        entries[identity] = {
            "id": identity, "name": name, "version": version,
            "ecosystem": "npm", "license": license_name,
            "url": f"https://www.npmjs.com/package/{name}/v/{version}",
            "licenseUrl": license_url, "notices": notices(files),
        }
    return list(entries.values())


def identify_license(text):
    if "Apache License" in text and "Version 2.0" in text:
        return "Apache-2.0"
    if "Permission is hereby granted, free of charge" in text:
        return "MIT"
    if "Redistribution and use in source and binary forms" in text:
        return "BSD-3-Clause" if "Neither the name" in text or "neither the name" in text else "BSD-2-Clause"
    if "Mozilla Public License" in text:
        return "MPL-2.0"
    return ""


def go_entry(module):
    name, version = module
    escape = lambda value: re.sub(r"[A-Z]", lambda m: "!" + m[0].lower(), value)
    url = f"https://proxy.golang.org/{escape(name)}/@v/{escape(version)}.zip"
    with zipfile.ZipFile(io.BytesIO(download(url))) as archive:
        prefix = f"{name}@{version}/"
        files = []
        for path in archive.namelist():
            relative = path.removeprefix(prefix)
            if "/" not in relative and NOTICE.match(relative):
                files.append((relative, archive.read(path)))
    collected = notices(files)
    if not collected:
        raise ValueError(f"No upstream license found in Go module {name}@{version}")
    license_name = identify_license("\n".join(n["text"] for n in collected))
    return {
        "id": f"go:{name}@{version}", "name": name, "version": version,
        "ecosystem": "go", "license": license_name,
        "url": f"https://pkg.go.dev/{name}@{version}",
        "licenseUrl": f"https://pkg.go.dev/{name}@{version}?tab=licenses",
        "notices": collected,
    }


def source_entry(source):
    return {**source, "id": f"{source['ecosystem']}:{source['name']}@{source['version']}",
            "notices": notices([("LICENSE", download(source["licenseUrl"]))])}


def expected_ids():
    packages = json.loads((ROOT / "frontend/package-lock.json").read_text())["packages"]
    expected = {f"npm:{k.rsplit('node_modules/', 1)[1]}@{v['version']}"
                for k, v in packages.items() if k}
    expected.update(f"go:{name}@{version}" for name, version in module_versions())
    expected.update(f"{s['ecosystem']}:{s['name']}@{s['version']}"
                    for s in json.loads(SOURCES.read_text()))
    return expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        catalog = json.loads(OUTPUT.read_text())
        if catalog["inputs"] != hashes() or {p["id"] for p in catalog["packages"]} != expected_ids():
            raise SystemExit("License catalog is stale. Run npm ci, then python3 scripts/generate-licenses.py")
        print(f"License catalog is current: {len(catalog['packages'])} entries")
        return
    print("Collecting npm, Go and infrastructure licenses...", flush=True)
    with ThreadPoolExecutor(max_workers=6) as pool:
        entries = npm_entries() + list(pool.map(go_entry, module_versions()))
        entries += list(pool.map(source_entry, json.loads(SOURCES.read_text())))
    entries.sort(key=lambda p: (p["name"].lower(), p["ecosystem"], p["version"]))
    if {p["id"] for p in entries} != expected_ids():
        raise SystemExit("License collection is incomplete")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({"inputs": hashes(), "packages": entries}, ensure_ascii=False, indent=2) + "\n")
    print(f"Wrote {len(entries)} licenses to {OUTPUT.relative_to(ROOT)}", flush=True)


if __name__ == "__main__":
    main()
