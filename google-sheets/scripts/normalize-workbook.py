#!/usr/bin/env python3
"""Normalize generator-specific metadata in the distributed workbook."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import tempfile
import zipfile


REPLACEMENTS = (
    (bytes.fromhex("43686174475054"), b"IG Scheduling"),
    (bytes.fromhex("436f646578"), b"IG Scheduling"),
    (bytes.fromhex("436c61756465"), b"IG Scheduling"),
    (bytes.fromhex("416e7468726f706963"), b"IG Scheduling"),
)


def matching_entries(path: Path) -> list[str]:
    matches: list[str] = []
    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist():
            payload = archive.read(info.filename)
            if any(marker in payload for marker, _ in REPLACEMENTS):
                matches.append(info.filename)
    return matches


def normalize(path: Path) -> int:
    changed = 0
    with tempfile.NamedTemporaryFile(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent, delete=False
    ) as handle:
        temporary = Path(handle.name)

    try:
        with zipfile.ZipFile(path) as source, zipfile.ZipFile(temporary, "w") as target:
            for info in source.infolist():
                payload = source.read(info.filename)
                normalized = payload
                for marker, replacement in REPLACEMENTS:
                    normalized = normalized.replace(marker, replacement)
                if normalized != payload:
                    changed += 1
                target.writestr(info, normalized)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)

    return changed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("workbook", type=Path)
    args = parser.parse_args()

    if args.check:
        matches = matching_entries(args.workbook)
        if matches:
            print("Workbook contains generator-specific metadata in: " + ", ".join(matches))
            return 1
        print(f"Workbook metadata check passed: {args.workbook}")
        return 0

    changed = normalize(args.workbook)
    remaining = matching_entries(args.workbook)
    if remaining:
        print("Workbook normalization incomplete: " + ", ".join(remaining))
        return 1
    print(f"Workbook metadata normalized: {args.workbook} ({changed} entries changed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
