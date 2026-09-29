#!/bin/bash

# RUNNING SCRAPER WITH DOCKER

# Input parameters:
#
#   - $1 - command to run, e.g.:
#          "scrape"
#          "crawl -- --refresh false"
#          "search A520M-A PRO"
#          "compare -- MAG Z890 TOMAHAWK WIFI PRO Z890-P WIFI"
#          "serve" # if you need a scrapper service
#          "test"
#
#     Full Docker data cleanup (!!! It will remove all Docker data for all projects !!!): docker system prune -a --volumes; sudo systemctl restart docker

command_to_run="${*:-test}"
# Preserving the string parameters when they contain space characters
if [[ $# -ne 0 ]]; then
    printf -v command_to_run '%q ' "$@"
    command_to_run="${command_to_run% }"
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
