#!/usr/bin/env bash
# Publishes Jig's relay (M3 plan, section 5). The exact clean main commit is pushed to Gitee
# first; the server then fetches that commit and builds the release itself. Nothing is uploaded
# from this Mac. Run it as: npm run relay:publish
set -Eeuo pipefail
cd "$(dirname "$0")/../.."
[[ "$(git symbolic-ref --short HEAD)" == main ]] || { echo 'Publish from main.' >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo 'Commit the complete release before publishing.' >&2; exit 1; }
release="$(git rev-parse HEAD)"
# A secret scan over the whole history, a dependency audit and the checks block a release.
gitleaks git --no-banner --redact --log-level warn .
npm audit --prefix relay --omit=dev --audit-level=high
npm run check >/dev/null
# origin pushes to Gitee and GitHub. Only Gitee carries the release; GitHub is a mirror.
git push origin main || echo 'A push reported an error; checking Gitee.' >&2
gitee="$(git ls-remote https://gitee.com/dozybot/jig.git refs/heads/main | cut -f1)"
[[ "$gitee" == "$release" ]] || { echo "Gitee main is ${gitee:-unreadable}, not $release." >&2; exit 1; }
# Both the server's and Gitee's host keys come from the repository, never a scan.
gitee_keys="$(grep '^gitee\.com ' deploy/relay/known_hosts | base64 | tr -d '\n')"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o HostKeyAlias=wesaid-prod \
	-o UserKnownHostsFile=deploy/relay/known_hosts \
	wesaid-prod sudo -n bash -s -- "$release" "$gitee_keys" < deploy/relay/release-from-gitee.sh
