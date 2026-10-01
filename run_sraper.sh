#!/bin/bash

# RUNNING SCRAPER WITH DOCKER

# Input parameters:
#
#   - $1 - command to run, e.g.:
#          scrape -- --refresh false
#          crawl -- https://us-store.msi.com/Motherboards/Kit-Intel-Z890-II
#          search "A520M-A PRO"
#          compare "MAG Z890 TOMAHAWK WIFI" "PRO Z890-P WIFI"
#          serve  # if you need to make API calls to a scraper service
#          test
#
#     Full Docker data cleanup (!!! It will remove all Docker data for all projects !!!): docker system prune -a --volumes; sudo systemctl restart docker

# command_to_run="${*:-NONE}"
# Preserving the string parameters when they contain space characters
# if [[ $# -ne 0 ]]; then
#    printf -v command_to_run '%q ' "$@"
#    command_to_run="${command_to_run% }"
# else
#    echo "ERROR: no command provided"
#    exit 1
# fi

command_name="${1:-NONE}"
shift

printf -v command_args '%q ' "$@"
command_args="${command_args% }"

if [[ -n "$command_args" ]]; then
    command_to_run="$command_name -- $command_args"
else
    command_to_run="$command_name"
fi

set -Eeuo pipefail

operation_start_epoch_ms=$(date +%s%3N)
operation_start_time=$(date --iso-8601=milliseconds)

format_duration() {
  local total_ms="$1"
  local hours=$((total_ms / 3600000))
  local minutes=$(((total_ms % 3600000) / 60000))
  local seconds=$(((total_ms % 60000) / 1000))
  local milliseconds=$((total_ms % 1000))

  printf '%02d:%02d:%02d.%03d' "$hours" "$minutes" "$seconds" "$milliseconds"
}

cleanup() {
  local exit_code=$?
  local operation_end_epoch_ms
  local operation_end_time
  local total_ms

  operation_end_epoch_ms=$(date +%s%3N)
  operation_end_time=$(date --iso-8601=milliseconds)
  total_ms=$((operation_end_epoch_ms - operation_start_epoch_ms))

  echo "Cleaning up..."
  echo "Operation end time:   $operation_end_time"
  echo "Total time:           $(format_duration "$total_ms")"
  echo "Done."

  return "$exit_code"
}

echo "Setting the exit function..."
trap cleanup EXIT

echo "Operation start time: $operation_start_time"
echo "Starting the service"
echo "Command: npm run $command_to_run"
SCRAPER_COMMAND="$command_to_run" docker compose up --build
