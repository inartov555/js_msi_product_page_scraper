#!/usr/bin/env bash
set -Eeuo pipefail

# End-to-end smoke tests for the public ./run_sraper.sh interface.
#
# These tests intentionally use the real Docker wrapper and, except for
# `crawl --refresh false`, talk to the live MSI US store. They are kept out of
# `npm test` so the fast/unit suite stays deterministic and does not recursively
# start Docker from inside Docker.
#
# Run:
#   npm run test:real
#   # or
#   ./test/real-app-usage.sh
#
# Optional for local/CI runs where a full live recrawl is too expensive:
#   REAL_APP_SKIP_REFRESH=true ./test/real-app-usage.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

HOST_PORT="${SCRAPER_HOST_PORT:-3000}"
BASE_URL="http://127.0.0.1:${HOST_PORT}"
PRODUCT_URL='https://us-store.msi.com/Motherboards/Kit-Intel-Z890-II'
PRODUCT_ONE='MAG Z890 TOMAHAWK WIFI'
PRODUCT_TWO='PRO Z890-P WIFI'

for command in docker curl node; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ERROR: required command is not installed: $command" >&2
    exit 1
  fi
done

if ! docker info >/dev/null 2>&1; then
  echo 'ERROR: Docker is not running or is not accessible.' >&2
  exit 1
fi

BACKUP_DIR="$(mktemp -d)"
SERVER_LOG="${BACKUP_DIR}/serve.log"
SERVER_PID=''

backup_output() {
  for name in catalog.json single-product.json comparison.csv search.csv; do
    if [[ -f "output/$name" ]]; then
      cp -p "output/$name" "$BACKUP_DIR/$name"
    fi
  done
}

restore_output() {
  for name in catalog.json single-product.json comparison.csv search.csv; do
    if [[ -f "$BACKUP_DIR/$name" ]]; then
      cp -p "$BACKUP_DIR/$name" "output/$name"
    fi
  done
}

stop_server() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  SERVER_PID=''
  docker compose down --remove-orphans >/dev/null 2>&1 || true
}

cleanup() {
  local status=$?
  stop_server
  restore_output
  rm -rf "$BACKUP_DIR"
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

backup_output

step() {
  printf '\n\033[1;36m==> %s\033[0m\n' "$*"
}

assert_catalog() {
  node --input-type=module <<'NODE'
import fs from 'node:fs';
const catalog = JSON.parse(fs.readFileSync('output/catalog.json', 'utf8'));
if (!Array.isArray(catalog.products) || catalog.products.length === 0) {
  throw new Error('output/catalog.json does not contain products');
}
console.log(`catalog OK: ${catalog.products.length} products`);
NODE
}

assert_scraped_product() {
  node --input-type=module <<'NODE'
import fs from 'node:fs';
const product = JSON.parse(fs.readFileSync('output/single-product.json', 'utf8'));
const expectedUrl = 'https://us-store.msi.com/Motherboards/Kit-Intel-Z890-II';
if (product.url !== expectedUrl) throw new Error(`unexpected product URL: ${product.url}`);
if (!product.title) throw new Error('scraped product has no title');
if (!Array.isArray(product.specs) || product.specs.length === 0) throw new Error('scraped product has no specs');
console.log(`scrape OK: ${product.title}, specs=${product.specs.length}`);
NODE
}

assert_comparison() {
  node --input-type=module <<'NODE'
import fs from 'node:fs';
const csv = fs.readFileSync('output/comparison.csv', 'utf8');
for (const expected of ['MAG Z890 TOMAHAWK WIFI', 'PRO Z890-P WIFI']) {
  if (!csv.includes(expected)) throw new Error(`comparison is missing ${expected}`);
}
const lines = csv.trim().split(/\r?\n/);
if (lines.length < 2) throw new Error('comparison contains no parameter rows');
console.log(`compare OK: ${lines.length - 1} parameter rows`);
NODE
}

assert_search() {
  node --input-type=module <<'NODE'
import fs from 'node:fs';
const csv = fs.readFileSync('output/search.csv', 'utf8');
const lines = csv.trim().split(/\r?\n/);
if (lines.length < 2) throw new Error('search returned no rows');
if (!/Motherboards/i.test(csv)) throw new Error('search result does not contain Motherboards');
console.log(`search OK: ${lines.length - 1} rows`);
NODE
}

wait_for_api() {
  local deadline=$((SECONDS + 120))
  until curl --silent --fail "${BASE_URL}/health" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo 'ERROR: API did not become ready.' >&2
      echo '--- serve log ---' >&2
      cat "$SERVER_LOG" >&2 || true
      return 1
    fi
    if [[ -n "$SERVER_PID" ]] && ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo 'ERROR: serve command exited before the API became ready.' >&2
      cat "$SERVER_LOG" >&2 || true
      return 1
    fi
    sleep 1
  done
}

assert_api_json() {
  local file="$1"
  local kind="$2"
  node --input-type=module - "$file" "$kind" <<'NODE'
import fs from 'node:fs';
const [file, kind] = process.argv.slice(2);
const body = JSON.parse(fs.readFileSync(file, 'utf8'));

if (kind === 'health') {
  if (body.ok !== true) throw new Error('health.ok is not true');
  if (!Number.isInteger(body.products) || body.products < 1) throw new Error('health.products is invalid');
} else if (kind === 'products') {
  if (!Number.isInteger(body.count) || body.count < 1) throw new Error('products count is invalid');
  if (!Array.isArray(body.products) || body.products.length !== body.count) throw new Error('products payload/count mismatch');
  if (!body.products.every((product) => product.title && product.url)) throw new Error('product result is missing title/url');
} else if (kind === 'compare') {
  if (!Array.isArray(body.products) || body.products.length !== 2) throw new Error('compare must return two products');
  const titles = body.products.map((product) => product.title);
  for (const expected of ['MAG Z890 TOMAHAWK WIFI', 'PRO Z890-P WIFI']) {
    if (!titles.includes(expected)) throw new Error(`compare response is missing ${expected}`);
  }
  if (!Array.isArray(body.rows) || body.rows.length < 1) throw new Error('compare response has no rows');
} else {
  throw new Error(`unknown assertion kind: ${kind}`);
}

console.log(`${kind} API OK`);
NODE
}

step './run_sraper.sh crawl --refresh false'
./run_sraper.sh crawl --refresh false
assert_catalog

if [[ "${REAL_APP_SKIP_REFRESH:-false}" =~ ^(1|true|yes)$ ]]; then
  step 'SKIP ./run_sraper.sh crawl --refresh true (REAL_APP_SKIP_REFRESH=true)'
else
  step './run_sraper.sh crawl --refresh true'
  ./run_sraper.sh crawl --refresh true
  assert_catalog
fi

step "./run_sraper.sh scrape ${PRODUCT_URL}"
./run_sraper.sh scrape "$PRODUCT_URL"
assert_scraped_product

step "./run_sraper.sh compare \"${PRODUCT_ONE}\" \"${PRODUCT_TWO}\""
./run_sraper.sh compare "$PRODUCT_ONE" "$PRODUCT_TWO"
assert_comparison

step './run_sraper.sh search "Motherboards"'
./run_sraper.sh search 'Motherboards'
assert_search

step './run_sraper.sh serve + real HTTP API calls'
SCRAPER_HOST_PORT="$HOST_PORT" ./run_sraper.sh serve >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
wait_for_api

HEALTH_JSON="${BACKUP_DIR}/health.json"
PRODUCTS_JSON="${BACKUP_DIR}/products.json"
COMPARE_JSON="${BACKUP_DIR}/compare.json"

curl --silent --show-error --fail "${BASE_URL}/health" > "$HEALTH_JSON"
assert_api_json "$HEALTH_JSON" health

curl --silent --show-error --fail --get \
  --data-urlencode 'category=Motherboards' \
  --data-urlencode 'limit=5' \
  "${BASE_URL}/products" > "$PRODUCTS_JSON"
assert_api_json "$PRODUCTS_JSON" products

curl --silent --show-error --fail --get \
  --data-urlencode "id=${PRODUCT_ONE}" \
  --data-urlencode "id=${PRODUCT_TWO}" \
  "${BASE_URL}/compare" > "$COMPARE_JSON"
assert_api_json "$COMPARE_JSON" compare

# Also exercise API validation/error handling.
status="$(curl --silent --output "${BACKUP_DIR}/bad-compare.json" --write-out '%{http_code}' \
  --get --data-urlencode "id=${PRODUCT_ONE}" "${BASE_URL}/compare")"
[[ "$status" == '400' ]] || { echo "ERROR: expected /compare with one id to return 400, got $status" >&2; exit 1; }

status="$(curl --silent --output "${BACKUP_DIR}/not-found.json" --write-out '%{http_code}' "${BASE_URL}/does-not-exist")"
[[ "$status" == '404' ]] || { echo "ERROR: expected unknown endpoint to return 404, got $status" >&2; exit 1; }

stop_server

step './run_sraper.sh test'
./run_sraper.sh test

printf '\n\033[1;32mAll real application usage tests passed.\033[0m\n'
