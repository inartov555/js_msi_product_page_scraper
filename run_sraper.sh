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
#          test:unit  # only unit tests
#          test:e2e   # only end-to-end tests
#          test:all   # all available tests
#
#     Full Docker data cleanup (!!! It will remove all Docker data for all projects !!!): docker system prune -a --volumes; sudo systemctl restart docker

command_name="${1:-}"

if [[ -z "$command_name" ]]; then
    echo "ERROR: no command provided"
    exit 1
fi

shift

set -Eeuo pipefail

cleanup() {
  echo "Cleaning up..."
  echo "Done."
}

echo "Setting the exit function..."
trap cleanup EXIT HUP ERR SIGINT SIGTERM

if [[ "${SCRAPER_IN_CONTAINER:-}" == "1" || -f /.dockerenv ]]; then
    echo "Starting the service (current container)"
    if (( $# > 0 )); then
        printf 'Command: npm run %q --' "$command_name"
        printf ' %q' "$@"
        printf '\n'
        npm run "$command_name" -- "$@"
    else
        echo "Command: npm run $command_name"
        npm run "$command_name"
    fi
    exit $?
fi

if (( $# > 0 )); then
    printf -v command_args '%q ' "$@"
    command_args="${command_args% }"
    command_to_run="$command_name -- $command_args"
else
    command_to_run="$command_name"
fi

if [[ ! -f .env ]]; then
    if [[ -f .env.example ]]; then
        env_template=.env.example
    elif [[ -f env.example ]]; then
        env_template=env.example
    else
        echo "ERROR: none of .env, .env.example, or env.example exists"
        exit 1
    fi

    echo ".env not found, creating it from $env_template..."
    cp "$env_template" .env
fi

# docker-compose bind mounts ./output into /scraper/output. Run the container
# with the invoking user's uid/gid so CI and local output files are writable
# without making the directory world-writable.
mkdir -p output
export HOST_UID="${HOST_UID:-$(id -u)}"
export HOST_GID="${HOST_GID:-$(id -g)}"

echo "Starting the service"
echo "Command: npm run $command_to_run"
SCRAPER_COMMAND="$command_to_run" docker compose up --build --abort-on-container-exit --exit-code-from scraper
# If you need to store console output log to a file
# SCRAPER_COMMAND="$command_to_run" docker compose up --build 2>&1 | tee log_output.txt
