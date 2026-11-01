#!/bin/bash
# bump-dependencies.sh — bump every dependency in the workspace (root package
# + example/) to its latest version, regenerate the example's Payload
# types/importmap, and run the package's checks.
#
# Usage (from the repo root):
#   ./.claude/skills/bump-dependencies/bump-dependencies.sh
#
# peerDependencies are left alone on purpose: `payload: ^3.0.0` is an
# intentionally broad install matrix and must not be narrowed to the
# current minor.

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }

if [ ! -f pnpm-workspace.yaml ] || [ ! -f example/package.json ]; then
    log_error "Run this from the repo root (pnpm-workspace.yaml + example/ expected)."
    exit 2
fi

FAILED_STEPS=()
run_step() {
    local name=$1
    shift
    log_info "$name"
    if ! "$@"; then
        log_error "$name failed"
        FAILED_STEPS+=("$name")
        return 1
    fi
    return 0
}

# 1. Bump dependencies + devDependencies in every workspace package.
#    `pnpm up` keeps the specifier style, so exact pins (payload 3.x.y, next)
#    stay exact and caret ranges stay caret.
run_step "Updating dependencies (root + example)" pnpm -r up --latest || {
    log_error "FAILED: dependency update"
    exit 1
}
run_step "Reinstalling to settle the lockfile" pnpm install || exit 1

# 2. Regenerate the example app's Payload artifacts against the new versions.
run_step "Generating Payload types (example)" pnpm --filter payload-content-cli-example generate:types
run_step "Generating Payload importmap (example)" pnpm --filter payload-content-cli-example generate:importmap

# 3. Package checks.
run_step "Typecheck" pnpm typecheck
run_step "Lint" pnpm lint
run_step "Tests" pnpm test

# 4. Smoke-test the example dev server (needs MongoDB; warn only).
if command -v timeout >/dev/null 2>&1; then TIMEOUT_CMD=timeout
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_CMD=gtimeout
else TIMEOUT_CMD=""; fi

if [ -n "$TIMEOUT_CMD" ]; then
    log_info "Smoke-testing example dev server"
    $TIMEOUT_CMD 30s pnpm example:dev >/dev/null 2>&1 &
    pid=$!
    sleep 10
    if kill -0 "$pid" 2>/dev/null; then
        log_info "Dev server started successfully"
        kill "$pid" 2>/dev/null || true
    else
        log_warning "Dev server exited early — start it manually with 'pnpm example:dev' to inspect"
    fi
else
    log_warning "timeout command not found, skipping dev server smoke test (macOS: brew install coreutils)"
fi

echo
log_info "========================================="
log_info "SUMMARY REPORT"
log_info "========================================="
if [ ${#FAILED_STEPS[@]} -gt 0 ]; then
    for s in "${FAILED_STEPS[@]}"; do echo -e "${RED}✗${NC} $s"; done
    log_error "FAILED"
    exit 1
fi
echo -e "${GREEN}✓${NC} SUCCESS"
exit 0
