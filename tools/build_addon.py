#!/usr/bin/env python3
"""Package the add-on as dist/anki_mermaid.ankiaddon.

Anki expects the add-on's files at the root of the zip, with no enclosing
folder and no bytecode caches.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "anki_mermaid"
TARGET = ROOT / "dist" / "anki_mermaid.ankiaddon"
SKIPPED_NAMES = {"__pycache__", "meta.json", ".DS_Store"}


def main() -> None:
    TARGET.parent.mkdir(exist_ok=True)
    files = sorted(
        path
        for path in SOURCE.rglob("*")
        if path.is_file() and not SKIPPED_NAMES.intersection(path.relative_to(SOURCE).parts)
    )
    with zipfile.ZipFile(TARGET, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(SOURCE).as_posix())
    size_mb = TARGET.stat().st_size / 1_000_000
    print(f"Wrote {TARGET.relative_to(ROOT)} ({len(files)} files, {size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
