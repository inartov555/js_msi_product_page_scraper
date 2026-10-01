#!/bin/bash

# RUNNING SCRAPER WITH DOCKER

# Input parameters:
#
#   - $1 - command to run, e.g.:
#          crawl --refresh false  # if false - use existing catalog, if true - crawl the MSI web site and collect all product into new catalog
#          scrape https://us-store.msi.com/Motherboards/Kit-Intel-Z890-II  # collect data of a product
#          compare "MAG Z890 TOMAHAWK WIFI" "PRO Z890-P WIFI"
#          search "Motherboards"
#          serve  # if you need to make API calls to a scraper service
#          test
#
#     Full Docker data cleanup (!!! It will remove all Docker data for all projects !!!): docker system prune -a --volumes; sudo systemctl restart docker

command_name="${1:-}"

if [[ -z "$command_name" ]]; then
    echo "ERROR: no command provided"
    exit 1
fi

shift

if (( $# > 0 )); then
    printf -v command_args '%q ' "$@"
    command_args="${command_args% }"
    command_to_run="$command_name -- $command_args"
else
    command_to_run="$command_name"
fi

set -Eeuo pipefail

cleanup() {
  echo "Cleaning up..."
  echo "Done."
}

echo "Setting the exit function..."
trap cleanup EXIT HUP ERR SIGINT SIGTERM

echo "Starting the service"
echo "Command: npm run $command_to_run"
SCRAPER_COMMAND="$command_to_run" docker compose up --build
# If you need to store console output log to a file
# SCRAPER_COMMAND="$command_to_run" docker compose up --build 2>&1 | tee log_output.txt
