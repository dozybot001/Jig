#!/usr/bin/env bash
# Installs Apple's push signing key (.p8) for the relay over administrator SSH. The key travels on
# standard input, never in a command argument, and is stored readable by the relay's user alone.
# It takes effect with the next release: npm run relay:publish
# Usage: deploy/relay/install-apns-key.sh ~/.tenon-keys/apns/AuthKey_XXXXXXXXXX.p8 XXXXXXXXXX TEAMID
set -Eeuo pipefail
fail() { printf 'install-apns-key: %s\n' "$*" >&2; exit 1; }
[[ "$#" -eq 3 ]] || fail 'usage: install-apns-key.sh <AuthKey_XXXXXXXXXX.p8> <key id> <team id>'
key_file="$1"; key_id="$2"; team_id="$3"
[[ "$key_id" =~ ^[A-Z0-9]{10}$ && "$team_id" =~ ^[A-Z0-9]{10}$ ]] || fail 'the key id and the team id are 10 letters and digits'
grep -q 'BEGIN PRIVATE KEY' "$key_file" || fail 'this is not an APNs .p8 key'
cd "$(dirname "$0")/../.."
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o HostKeyAlias=wesaid-prod \
	-o UserKnownHostsFile=deploy/relay/known_hosts wesaid-prod \
	sudo -n bash -c "'set -Eeuo pipefail
		umask 077
		install -d -m 0700 /opt/jig-relay /opt/jig-relay/config
		cat > /opt/jig-relay/config/apns.p8.candidate
		grep -q \"BEGIN PRIVATE KEY\" /opt/jig-relay/config/apns.p8.candidate
		chown 70980:70980 /opt/jig-relay/config/apns.p8.candidate
		chmod 0400 /opt/jig-relay/config/apns.p8.candidate
		mv /opt/jig-relay/config/apns.p8.candidate /opt/jig-relay/config/apns.p8
		printf \"APNS_KEY_FILE=/run/secrets/apns.p8\nAPNS_KEY_ID=%s\nAPNS_TEAM_ID=%s\n\" $key_id $team_id > /opt/jig-relay/config/relay.env.candidate
		chmod 0600 /opt/jig-relay/config/relay.env.candidate
		mv /opt/jig-relay/config/relay.env.candidate /opt/jig-relay/config/relay.env'" < "$key_file"
printf 'APNs key %s installed. It takes effect with the next release: npm run relay:publish\n' "$key_id"
