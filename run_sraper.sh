#!/bin/bash

# RUNNING SCRAPER WITH DOCKER
#
# Usage:
#   ./run_sraper.sh scrape "https://us-store.msi.com/PC-Components/MAG-A650BN"
#   ./run_sraper.sh crawl --refresh false
#   ./run_sraper.sh search "A520M-A PRO"
#   ./run_sraper.sh compare "MAG Z890 TOMAHAWK WIFI" "PRO Z890-P WIFI"
#   ./run_sraper.sh serve
#   ./run_sraper.sh test

set -Eeuo pipefail

script="${1:-test}"
if (( $# > 0 )); then
  shift
fi

cleanup() {
  echo "Cleaning up..."
  docker compose down --remove-orphans >/dev/null 2>&1 || true
  echo "Done."
}

trap cleanup EXIT HUP ERR SIGINT SIGTERM

echo "Starting the service"
printf 'Command: npm run %q --' "$script"
printf ' %q' "$@"
printf '\n'

# Pass each argument as a real argv entry. Do not serialize arguments through
# environment variables or eval; URLs/spaces/quotes must survive unchanged.
docker compose run --rm --build scraper npm run "$script" -- "$@"
