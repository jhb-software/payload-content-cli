#!/bin/bash
# audit-dependencies.sh: `pnpm audit` for the workspace (root package + example/),
# as one row per advisory, most severe first.
#
# The `ships` column says whether an advisory reaches people who install the
# package, i.e. whether a path to it starts at a root `dependencies` entry.
#
# The `fix` column says whether a patched release exists: `yes`, `NO` (pnpm's
# `<0.0.0` marker for "no patched release"), or `?` (no patched range in the
# advisory data, so treat it as fixable until its vulnerable range proves
# otherwise).
#
# Usage (from the repo root):
#   ./.claude/skills/bump-dependencies/audit-dependencies.sh
#
# Exit codes:
#   0  no fixable advisory remains (unfixable ones may still be listed)
#   1  at least one fixable (or `?`) advisory remains
#   2  the audit couldn't run or its output couldn't be parsed; never "clean"

set -uo pipefail

if [ ! -f pnpm-lock.yaml ]; then
    echo "No pnpm-lock.yaml found. Run this from the repo root." >&2
    exit 2
fi

TMP_JSON="$(mktemp)"
trap 'rm -f "$TMP_JSON"' EXIT

pnpm audit --json > "$TMP_JSON" 2>/dev/null || true

python3 -I - "$TMP_JSON" <<'PY'
import json, sys

RANK = {"critical": 4, "high": 3, "moderate": 2, "low": 1, "info": 0}

try:
    data = json.load(open(sys.argv[1]))
except Exception:
    print("Could not parse `pnpm audit --json` output (registry unreachable?).", file=sys.stderr)
    sys.exit(2)

if not isinstance(data, dict) or data.get("error") or "advisories" not in data:
    detail = data.get("error") if isinstance(data, dict) and data.get("error") else str(data)[:200]
    print(f"pnpm audit failed: {detail}", file=sys.stderr)
    sys.exit(2)

advisories = (data.get("advisories") or {}).values()
if not advisories:
    print("No known vulnerabilities.")
    sys.exit(0)

shipped = json.load(open("package.json")).get("dependencies") or {}

def fix(advisory):
    patched = advisory.get("patched_versions") or ""
    return "NO" if patched == "<0.0.0" else ("yes" if patched else "?")

def ships(advisory):
    paths = (p for f in advisory.get("findings") or [] for p in f.get("paths") or [])
    return any(p.split(">")[:1] == ["."] and p.split(">")[1:2] and p.split(">")[1] in shipped for p in paths)

rows = sorted(
    (
        (
            a.get("severity", "info"),
            a.get("module_name", "?"),
            "yes" if ships(a) else "no",
            fix(a),
            a.get("vulnerable_versions") or "",
            a.get("patched_versions") or "none",
            (a.get("title") or "").strip(),
            a.get("url", ""),
        )
        for a in advisories
    ),
    key=lambda r: (-RANK.get(r[0], 0), r[1]),
)

header = ("sev", "package", "ships", "fix", "vulnerable", "patched")
widths = [max(len(row[i]) for row in [header, *rows]) + 2 for i in range(len(header))]
line = lambda cells: "".join(cell.ljust(width) for cell, width in zip(cells, widths))

print(line(header) + "title")
for row in rows:
    print(line(row[:6]) + row[6])
    print(" " * widths[0] + row[7])

counts = {}
for row in rows:
    counts[row[0]] = counts.get(row[0], 0) + 1
summary = ", ".join(f"{sev} {counts[sev]}" for sev in RANK if sev in counts)
reaching = sum(row[2] == "yes" for row in rows)
fixable = sum(row[3] != "NO" for row in rows)
print(f"\n{len(rows)} advisories ({summary}), {reaching} reach installers, {fixable} fixable")
if fixable:
    print(f"{fixable} fixable advisories remain. Fix them before reporting or opening a PR.")
    sys.exit(1)
print("No fixable advisories remain. List the unfixable ones above in the report and PR.")
sys.exit(0)
PY
