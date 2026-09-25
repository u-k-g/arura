"""Refresh the small, local search index for Arura's curated Iconoir icons."""

import csv
import io
import json
import re
import urllib.request
from pathlib import Path


REVISION = "d7dfa4d0341df0670bfed9fc24221c9d7ef2112e"
ROOT = Path(__file__).resolve().parent.parent
CHOICES = ROOT / "shared/essentialIcons.ts"
OUTPUT = ROOT / "shared/essentialIconSearchData.ts"

source = CHOICES.read_text()
names = re.findall(r'\["([^"]+)", "[^"]+"\]', source.split("] as const;")[0])
reserved = set(
    re.findall(
        r'"([^"]+)"', source.split("const reservedIcons = new Set([")[1].split("]);")[0]
    )
)
url = f"https://raw.githubusercontent.com/iconoir-icons/iconoir/{REVISION}/iconoir.com/icons.csv"
with urllib.request.urlopen(url) as response:
    rows = {
        row["filename"]: row
        for row in csv.DictReader(io.StringIO(response.read().decode()))
    }

lines = [
    "// Categories and tags from Iconoir's iconoir.com/icons.csv at " + REVISION + ".",
    "// This index contains only the curated Essentials icons.",
    "export const essentialIconSearchData: Record<string, string> = {",
]
for name in names:
    if name in reserved:
        continue
    if name not in rows:
        raise ValueError(f"Missing Iconoir search metadata for {name}")
    row = rows[name]
    terms = " ".join((row["category"], row["tags"].replace(",", " ")))
    lines.append(f"  {json.dumps(name)}: {json.dumps(terms)},")
lines.append("};")
OUTPUT.write_text("\n".join(lines) + "\n")
