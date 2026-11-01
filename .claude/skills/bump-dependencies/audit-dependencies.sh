#!/bin/bash
# audit-dependencies.sh — `pnpm audit` for the workspace (root package + example/).
#
# The repo has a single pnpm-lock.yaml at the root, so one `pnpm audit` covers
# every workspace package. This wraps it in a compact table (one row per
# advisory, most severe first) and a severity-gated exit code.
#
# Usage (from the repo root):
#   ./.claude/skills/bump-dependencies/audit-dependencies.sh [severity]
#
#   severity (optional): low | moderate | high | critical
#     Exit non-zero only when an advisory at or above this level remains.
#     Default: any advisory (low) fails. Use `high` for a CI gate that
#     tolerates dev-only moderate/low noise.

set -uo pipefail

THRESHOLD="${1:-low}"
# macOS ships bash 3.2 (no associative arrays); use a case lookup.
rank_of() {
    case "$1" in
        low) echo 1 ;; moderate) echo 2 ;; high) echo 3 ;; critical) echo 4 ;;
        *) echo 1 ;;
    esac
}
MIN_RANK="$(rank_of "$THRESHOLD")"

if [ ! -f pnpm-lock.yaml ]; then
    echo "No pnpm-lock.yaml found. Run this from the repo root." >&2
    exit 2
fi

TMP_JSON="$(mktemp)"
trap 'rm -f "$TMP_JSON"' EXIT

pnpm audit --json > "$TMP_JSON" 2>/dev/null || true

python3 - "$TMP_JSON" "$MIN_RANK" <<'PY'
import sys, json
from collections import defaultdict

path = sys.argv[1]
min_rank = int(sys.argv[2])
RANK = {"low": 1, "moderate": 2, "high": 3, "critical": 4, "info": 0}

try:
    data = json.load(open(path))
except Exception:
    print("Could not parse `pnpm audit --json` output (registry unreachable?).", file=sys.stderr)
    sys.exit(2)

if data.get("error"):
    print(f"pnpm audit failed: {data['error']}", file=sys.stderr)
    sys.exit(2)

adv = data.get("advisories") or {}
if not adv:
    print("\n✓ No known vulnerabilities.")
    sys.exit(0)

rows = []
for a in adv.values():
    sev = a.get("severity", "info")
    patched = a.get("patched_versions", "") or ""
    fixable = "yes" if patched and patched != "<0.0.0" else "NO"
    paths = {p for f in a.get("findings") or [] for p in f.get("paths") or []}
    rows.append((RANK.get(sev, 0), sev, a.get("module_name", "?"),
                 (a.get("vulnerable_versions") or "")[:15],
                 patched[:13], fixable, len(paths),
                 (a.get("title") or "").strip()[:46], a.get("url", "")))
rows.sort(key=lambda r: (-r[0], r[2]))

print(f"\n{'sev':<9}{'package':<22}{'vulnerable':<16}{'patched':<14}{'fix':<5}{'#path':<6}title")
print("-" * 100)
worst = 0
for rank, sev, mod, vuln, patched, fixable, n, title, url in rows:
    worst = max(worst, rank)
    print(f"{sev:<9}{mod:<22}{vuln:<16}{patched:<14}{fixable:<5}{n:<6}{title}")
    print(f"{'':<9}{url}")

tot = defaultdict(int)
for r in rows:
    tot[r[1]] += 1
print(f"\n{len(rows)} unique advisories: " + ", ".join(f"{k} {v}" for k, v in
      sorted(tot.items(), key=lambda kv: -RANK.get(kv[0], 0))))

# Exit non-zero when anything at/above the threshold remains.
sys.exit(1 if worst >= min_rank else 0)
PY
