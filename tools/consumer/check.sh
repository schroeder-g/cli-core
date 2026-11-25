#!/bin/sh
# Checks the package as a program installs it: packed, under pnpm's
# isolated node_modules, which reaches only what the manifest declares,
# its declarations emitted under bundler and nodenext resolution. It runs
# outside the repository, whose own node_modules would otherwise leak in.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -R "$here/package.json" "$here"/tsconfig*.json "$here/src" "$work"
(cd "$here/../.." && npm pack --silent --pack-destination "$work" >/dev/null)
mv "$work"/four7-cli-core-*.tgz "$work/cli-core.tgz"
cd "$work"
pnpm install --ignore-workspace --lockfile=false
pnpm exec tsc -p tsconfig.json
pnpm exec tsc -p tsconfig.nodenext.json
bun test
