#!/bin/bash
# bump-dependencies.sh: bump every dependency in the workspace (root package +
# example/) to its latest version, then run the same checks as CI.
#
# Usage (from the repo root):
#   ./.claude/skills/bump-dependencies/bump-dependencies.sh           # bump, then check
#   ./.claude/skills/bump-dependencies/bump-dependencies.sh --check   # check only
#
# Exit codes: 0 all green, 1 a check failed, 2 the environment isn't ready.
#
# peerDependencies are left alone on purpose: `payload: ^3.0.0` is an
# intentionally broad install matrix and must not be narrowed to the
# current minor.

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

if [ ! -f pnpm-workspace.yaml ] || [ ! -f example/package.json ]; then
    log_error "Run this from the repo root (pnpm-workspace.yaml + example/ expected)."
    exit 2
fi

# Always a dedicated local database: the seed step writes to it, so an inherited
# DATABASE_URL must not be used.
PORT=3939
export DATABASE_URL="mongodb://localhost:27017/payload-content-cli-bump"
export PAYLOAD_SECRET="bump-test-secret"
export PAYLOAD_URL="http://localhost:$PORT"
export PAYLOAD_API_KEY="test-api-key-for-development"

if ! (exec 3<>/dev/tcp/localhost/27017) 2>/dev/null; then
    log_error "MongoDB isn't running on localhost:27017."
    exit 2
fi
if (exec 3<>"/dev/tcp/localhost/$PORT") 2>/dev/null; then
    log_error "Port $PORT is in use. Stop the running dev server first."
    exit 2
fi

if [ "${1:-}" != "--check" ]; then
    log_info "Updating dependencies (root + example)"
    pnpm -r up --latest && pnpm install || {
        log_error "FAILED: dependency update"
        exit 1
    }
fi

# Wrong versions make every later result meaningless, so these stop the run.
log_info "Peer dependencies"
if ! pnpm peers check; then
    log_error "FAILED: unmet peers. Pin what they need, then rerun with --check."
    exit 1
fi

log_info "Root and example pins"
if ! node -e '
  const read = (file) => {
    const pkg = JSON.parse(require("node:fs").readFileSync(file, "utf8"));
    return { ...pkg.dependencies, ...pkg.devDependencies };
  };
  const root = read("package.json");
  const example = read("example/package.json");
  const mismatches = Object.keys(root).filter(
    (name) =>
      /^(payload|@payloadcms\/.*|next|react|react-dom)$/.test(name) &&
      name in example &&
      root[name] !== example[name],
  );
  for (const name of mismatches) {
    console.error(`${name}: root ${root[name]}, example ${example[name]}`);
  }
  process.exit(mismatches.length ? 1 : 0);
'; then
    log_error "FAILED: root and example must pin the same versions. Fix them, then rerun with --check."
    exit 1
fi

FAILED_STEPS=()
run_step() {
    local name=$1
    shift
    log_info "$name"
    if ! "$@"; then
        log_error "$name failed"
        FAILED_STEPS+=("$name")
    fi
}

run_step "Generate Payload types (example)" pnpm --filter payload-content-cli-example generate:types
run_step "Generate Payload importmap (example)" pnpm --filter payload-content-cli-example generate:importmap
run_step "Format" pnpm format:check
run_step "Lint" pnpm lint
run_step "Typecheck" pnpm typecheck
run_step "Build" pnpm build

# The integration tests run against the example app.
set -m
DEV_LOG="$(mktemp)"
pnpm example:dev >"$DEV_LOG" 2>&1 &
DEV_PID=$!
set +m
trap 'kill -- "-$DEV_PID" 2>/dev/null' EXIT

log_info "Waiting for the example app"
READY=""
for _ in $(seq 1 60); do
    if curl -s -o /dev/null -m 30 "$PAYLOAD_URL/api/access"; then
        READY=1
        break
    fi
    kill -0 "$DEV_PID" 2>/dev/null || break
    sleep 2
done

if [ -n "$READY" ]; then
    run_step "Seed" pnpm example:seed
    run_step "Tests" pnpm test
else
    log_error "The example app didn't start. Its log: $DEV_LOG"
    FAILED_STEPS+=("Example app")
fi

echo
if [ ${#FAILED_STEPS[@]} -gt 0 ]; then
    for step in "${FAILED_STEPS[@]}"; do echo -e "${RED}✗${NC} $step"; done
    log_error "FAILED"
    exit 1
fi
echo -e "${GREEN}✓${NC} SUCCESS"
