#!/usr/bin/env bash
#
# Cron wrapper for health-check.js. Run it from this directory on the EC2 box:
#
#   ./health-check.sh          # print the report (nothing at all if healthy)
#
# Install it as a daily 09:00 IST digest (`crontab -e` as the ubuntu user):
#
#   TZ=Asia/Kolkata
#   0 9 * * * cd /home/ubuntu/mahasamvad-content-platform/deploy && ./health-check.sh
#
# Cron mails its user only when a job WRITES OUTPUT, and health-check.js prints nothing
# when there is nothing wrong -- so a quiet mailbox is the healthy state and there is no
# daily "all clear" to start ignoring. If no local MTA is configured (the default on a
# fresh Ubuntu AMI), read the appended log instead:
#
#   tail -n 100 ~/dgipr-health.log
#
# WHY IT RUNS INSIDE THE API CONTAINER
# ------------------------------------
# RDS has no public IP and PostgREST is `expose:`-only -- neither is reachable from the
# host. The api container already sits on the compose network AND already holds
# SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.prod, so exec'ing into it needs no
# tunnel, no psql on the host, and no second copy of the credentials.
#
# The script is PIPED IN rather than baked into the image, so editing it takes effect on
# the next run with no rebuild and no deploy -- the same reason the compose file lives on
# the box rather than inside the image.
set -uo pipefail

cd "$(dirname "$0")"

LOG="${DGIPR_HEALTH_LOG:-$HOME/dgipr-health.log}"

if [ ! -f health-check.js ]; then
  echo "health-check.sh: health-check.js not found beside this script." >&2
  exit 2
fi

# `exec -T` = no TTY, so stdin is forwarded and cron (which has no TTY) works.
# Node with no script argument evaluates piped stdin.
output="$(docker compose exec -T api node < health-check.js 2>&1)"
status=$?

# A dead or restarting api container is itself worth reporting -- that is the loudest
# possible "the platform is not working", and it is exactly the case where the report
# would otherwise be silent for the wrong reason.
if [ $status -ne 0 ] && [ -z "$output" ]; then
  output="health-check: could not exec into the api container (exit $status). Is it running? \`docker compose ps api\`"
fi

[ -z "$output" ] && exit 0   # healthy: print nothing, log nothing, mail nothing

{
  echo "----- $(TZ=Asia/Kolkata date '+%Y-%m-%d %H:%M:%S %Z') -----"
  echo "$output"
  echo
} >>"$LOG" 2>/dev/null || true

echo "$output"
exit $status
