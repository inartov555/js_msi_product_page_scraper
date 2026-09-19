#!/bin/bash

# Input parameters:
#
#     Data clearing when exiting
#   - $1 - true - delete the DB data after stopping the service;
#          false - preserve the DB data after stopping the service;
#          default = false
#
#     Clearing cache before starting service
#   - $2 - true - starting service WITHOUT cached data (allows to start the service faster);
#          false - starting the service WITH cache (cache is cleared)
#          default = false
#
#     !!! Clearing Docker data (ALL Docker images, Docker network settings, etc.), and restarting the Docker service
#   - $3 - true - clearing all docker data (network, images, etc.)
#          false - Docker starts with new data
#          default = false
#
# Exported variables in the setup.sh file: HOST_ARTIFACTS, ROOT_VENV, TEST_VENV, COPIED_PROJECT_PATH

clean_data_at_exit="${1:-false}"
clear_cache="${2:-false}"
clear_docker_data_and_restart="${3:-false}"

SUPERUSER_USERNAME="${DJANGO_SUPERUSER_USERNAME:-admin}"
SUPERUSER_EMAIL="${DJANGO_SUPERUSER_EMAIL:-admin@example.com}"
SUPERUSER_PASSWORD="${DJANGO_SUPERUSER_PASSWORD:-changeme123}"

set -Eeuo pipefail

cleanup_data() {
  echo "Cleaning up..."
  # Shutting down services
  docker compose down -v --remove-orphans
  if ! [[ "$ORIGINAL_PROJECT_PATH" -ef "$(pwd)" ]]; then
    echo "Returning to the original project path to be able to run the test again with new changes, if there are any"
    cd "$ORIGINAL_PROJECT_PATH"
  fi
  echo "Done."
}

ORIGINAL_PROJECT_PATH="$(pwd)"
source ./setup.sh || { echo "setup.sh failed"; exit 1; }
if [[ $? -ne 0 ]]; then
  exit 1
fi

cleanup() {
  if ! [[ "$ORIGINAL_PROJECT_PATH" -ef "$(pwd)" ]]; then
    echo "Returning to the original project path to be able to run the test again with new changes, if there are any"
    cd "$ORIGINAL_PROJECT_PATH"
  fi
}

echo "Setting the exit function..."
case "$clean_data_at_exit" in
  true)
    echo "DB will be cleaned up when stopping the service"
    trap cleanup_data EXIT HUP ERR SIGINT SIGTERM
    ;;
  *)
    echo "DB will be preserved when stopping the service"
    trap cleanup EXIT HUP ERR SIGINT SIGTERM
esac

case "$clear_docker_data_and_restart" in
  true)
    echo "Docker data clearing started. Docker will be restarted after that"
    docker system prune -a --volumes
    sudo systemctl restart docker
    exit 0
    ;;
  *)
    echo "Docker starts with existing settings and images"
esac

echo "Building images..."
case "$clear_cache" in
  true)
    echo "Cache will be cleared when starting the service"
    docker compose build db --no-cache
    docker compose build backend --no-cache
    docker compose build frontend --no-cache
    ;;
  *)
    echo "Cache will be preserved when starting the service"
    docker compose build db
    docker compose build backend
    docker compose build frontend
esac

echo "Making migrations (one-off container)..."
docker compose run --rm backend python manage.py makemigrations profiles

echo "Applying migrations..."
docker compose run --rm backend python manage.py migrate --noinput

echo "Ensuring superuser exists…"
docker compose run --rm \
  -e DJANGO_SUPERUSER_USERNAME="$SUPERUSER_USERNAME" \
  -e DJANGO_SUPERUSER_EMAIL="$SUPERUSER_EMAIL" \
  -e DJANGO_SUPERUSER_PASSWORD="$SUPERUSER_PASSWORD" \
  backend python manage.py shell <<'PY' || echo "Superuser step skipped (non-fatal)."
from django.contrib.auth import get_user_model
import os
U = get_user_model()
u, created = U.objects.get_or_create(
    username=os.environ["DJANGO_SUPERUSER_USERNAME"],
    defaults={"email": os.environ["DJANGO_SUPERUSER_EMAIL"]}
)
if created:
    u.set_password(os.environ["DJANGO_SUPERUSER_PASSWORD"])
    u.is_staff = u.is_superuser = True
    u.save()
    print("Superuser created.")
else:
    print("Superuser already exists.")
PY

echo "Starting the service"
docker compose up

# If you need to start the website as a daemon and be independent of the terminal closing
# echo "Starting Postgres..."
# docker compose up -d db

# echo "Starting backend & frontend..."
# docker compose up -d backend
# docker compose up -d frontend
