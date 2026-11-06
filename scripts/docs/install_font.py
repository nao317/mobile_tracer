#!/usr/bin/env python3
"""Fetch the exact Noto font used by retained PDFs, verifying downloaded and cached bytes."""
import argparse
import hashlib
from pathlib import Path
import subprocess
import tempfile

# Noto Sans CJK 2.004. This TTC is identical to Ubuntu's existing documentation font.
FONT_URL = "https://raw.githubusercontent.com/notofonts/noto-cjk/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/OTC/NotoSansCJK-Regular.ttc"
FONT_SHA256 = "b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a"


def verified(path):
    return path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == FONT_SHA256


def prepare_font(target):
    target = Path(target)
    if verified(target):
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target.parent, suffix=".tmp", delete=False) as output:
        temporary = Path(output.name)
    try:
        subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error",
                        "--connect-timeout", "15", "--max-time", "240", "--retry", "1",
                        "--retry-max-time", "240", "--output", str(temporary), FONT_URL], check=True)
        if not verified(temporary):
            raise ValueError("Downloaded Noto font does not match the pinned SHA256")
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    downloaded = prepare_font(args.target)
    print("Noto font downloaded and verified." if downloaded else "Cached Noto font verified; no download needed.")
