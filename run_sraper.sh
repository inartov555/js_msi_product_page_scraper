#!/bin/bash

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

command_to_run="${1:-false}"

set -Eeuo pipefail

cleanup() {
  echo "Cleaning up..."
  echo "Done."
}

echo "Setting the exit function..."
trap cleanup EXIT HUP ERR SIGINT SIGTERM

echo "Starting the service"
SCRAPER_COMMAND="crawl -- --refresh false" docker compose up --build


