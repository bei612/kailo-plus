#!/usr/bin/env bash

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# Use the fixed workspace manager/lock, including the webpack build dependencies.
# Hooks belong to the development checkout, not to a source-only release context.
expected_pnpm=$(node -p 'require("./package.json").packageManager.split("@")[1].split("+")[0]')
test "$(pnpm --version)" = "$expected_pnpm"
export HUSKY=0
# Git-pinned SDK packages run their original npm prepare/build inside install;
# they also need their own development toolchain, before the production bundle.
NODE_ENV=development pnpm install --frozen-lockfile --prod=false
export NODE_ENV=production

# The root GUI has four original producers; its "all" script omits the CSS.
pnpm --dir gui.ajax run build-boot-prod
pnpm --dir gui.ajax run build-core-prod
pnpm --dir gui.ajax run build-libs-prod
pnpm --dir gui.ajax run build-css-prod

# Follow the original "*.*" workspace paths, not package names (some native
# plugins share a name). NODE_ENV disables watching; the original "build"
# scripts, unlike some build-prod scripts, do not mutate the Git index.
for package in *.*; do
    if [ -f "$package/package.json" ] && [ "$package" != gui.ajax ]; then
        pnpm --dir "$package" run build
    fi
done
