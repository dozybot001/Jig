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
# Until the first release after the rename moves it (release.py), the relay's folder is still the
# one from before; the key goes there and moves with it, so the server never holds two folders.
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o HostKeyAlias=wesaid-prod \
	-o UserKnownHostsFile=deploy/relay/known_hosts wesaid-prod \
	sudo -n bash -c "'set -Eeuo pipefail
		umask 077
		if [[ -d /opt/jig-relay && ! -L /opt/jig-relay ]]; then cd /opt/jig-relay; else install -d -m 0700 /opt/yew-relay; cd /opt/yew-relay; fi
		install -d -m 0700 config
		cat > config/apns.p8.candidate
		grep -q \"BEGIN PRIVATE KEY\" config/apns.p8.candidate
		chown 70980:70980 config/apns.p8.candidate
		chmod 0400 config/apns.p8.candidate
		mv config/apns.p8.candidate config/apns.p8
		printf \"APNS_KEY_FILE=/run/secrets/apns.p8\nAPNS_KEY_ID=%s\nAPNS_TEAM_ID=%s\n\" $key_id $team_id > config/relay.env.candidate
		chmod 0600 config/relay.env.candidate
		mv config/relay.env.candidate config/relay.env'" < "$key_file"
printf 'APNs key %s installed. It takes effect with the next release: npm run relay:publish\n' "$key_id"
