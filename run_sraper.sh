#!/bin/bash

# Input parameters:
#
#     Data clearing when exiting
#   - $1 - command to run, e.g.:
#          "scrape"
#          "crawl -- --refresh false"
#          "search A520M-A PRO"
#          "compare -- MAG Z890 TOMAHAWK WIFI PRO Z890-P WIFI"
#          "serve" # if you need a scrapper service
#          "test"

command_to_run="${1:-false}"

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


