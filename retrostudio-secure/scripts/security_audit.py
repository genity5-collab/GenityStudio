"""Static release gate for accidental secret and private-engine exposure."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FILES = [ROOT / "ui.html", *sorted((ROOT / "static").glob("*.js")), *sorted((ROOT / "static").glob("*.css"))]
FORBIDDEN = {
    "Supabase service role": re.compile(r"service[_-]?role", re.IGNORECASE),
    "Private encoder module": re.compile(r"private_encoder|encode_luau|loadstring", re.IGNORECASE),
    "Private Roblox key": re.compile(r"ROBLOX_OPEN_CLOUD_API_KEY", re.IGNORECASE),
    "Hard-coded JWT": re.compile(r"eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}"),
    "Private OpenAI-style key": re.compile(r"sk-[a-zA-Z0-9]{20,}"),
}


def main() -> int:
    findings: list[str] = []
    for path in PUBLIC_FILES:
        text = path.read_text(encoding="utf-8", errors="replace")
        for label, pattern in FORBIDDEN.items():
            if pattern.search(text):
                findings.append(f"{label} found in public file: {path.relative_to(ROOT)}")
    legacy = [path for path in ROOT.glob("*.html") if path.name != "ui.html"]
    if legacy:
        findings.extend(f"Legacy browser source remains: {path.relative_to(ROOT)}" for path in legacy)
    if findings:
        print("Security audit failed:", *findings, sep="\n- ")
        return 1
    print("Security audit passed: public files contain no detected secrets or private engine source.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
