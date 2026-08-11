#!/usr/bin/env bash
#
# Local dev needs this: RDS has no public IP and PostgREST is published nowhere, so
# `SUPABASE_URL=http://localhost:8000` in the root .env only resolves while this tunnel is up.
# Without it every query fails with a bare `fetch failed`.
#
#   pnpm db:tunnel      # leave it running in its own terminal, then `pnpm dev`
#
# Two things this handles that the hand-written command in docs/database-on-aws.md did not:
#
#   1. `-L 8000:pgrst-proxy:8000` CANNOT WORK. `pgrst-proxy` is a compose-network alias,
#      resolvable only from inside another container on that network — from the EC2 host it
#      fails with "Temporary failure in name resolution" and the forward silently accepts
#      connections that then die. The host CAN route to the container's IP directly, so the
#      IP is looked up per run rather than written down: it changes whenever the container
#      is recreated.
#   2. EC2 Instance Connect keys authenticate for ~60 seconds, so the key is pushed again
#      immediately before each of the two SSH connections rather than once at the top.
#
# Needs: aws CLI logged in, ssh. No pem file — Instance Connect pushes a throwaway key.

set -euo pipefail

REGION=us-east-2
INSTANCE_ID=i-004d93d88f687effa
AZ=us-east-2a
HOST=3.149.1.222
USER=ubuntu
CONTAINER=deploy-pgrst-proxy-1
LOCAL_PORT="${DB_TUNNEL_PORT:-8000}"

KEY_DIR="${TMPDIR:-/tmp}/dgipr-db-tunnel"
KEY="$KEY_DIR/id_ed25519"

mkdir -p "$KEY_DIR"
if [ ! -f "$KEY" ]; then
  ssh-keygen -t ed25519 -f "$KEY" -N "" -q
fi
chmod 600 "$KEY"

# aws.exe on Windows cannot read a Git-Bash /tmp path, so hand it a native one.
if command -v cygpath >/dev/null 2>&1; then
  KEY_PUB_PARAM="file://$(cygpath -m "$KEY.pub")"
else
  KEY_PUB_PARAM="file://$KEY.pub"
fi

push_key() {
  aws ec2-instance-connect send-ssh-public-key \
    --region "$REGION" --instance-id "$INSTANCE_ID" \
    --instance-os-user "$USER" --availability-zone "$AZ" \
    --ssh-public-key "$KEY_PUB_PARAM" >/dev/null
}

echo "Resolving $CONTAINER on the box..."
push_key
PROXY_IP=$(ssh -i "$KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=15 "$USER@$HOST" \
  "sudo docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $CONTAINER" \
  | tr -d '\r')

if [ -z "$PROXY_IP" ]; then
  echo "Could not resolve $CONTAINER's IP — is the container running?" >&2
  exit 1
fi

echo "Tunnelling localhost:$LOCAL_PORT -> $PROXY_IP:8000 (Ctrl-C to stop)"
push_key
exec ssh -i "$KEY" -o StrictHostKeyChecking=no -o ServerAliveInterval=30 \
  -o ExitOnForwardFailure=yes -N \
  -L "$LOCAL_PORT:$PROXY_IP:8000" "$USER@$HOST"
