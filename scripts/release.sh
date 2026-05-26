#!/usr/bin/env bash
# Bump version, commit, tag, push. GH Actions then publishes a Release.
#
# Usage:  scripts/release.sh patch    # 2.0.1 → 2.0.2
#         scripts/release.sh minor    # 2.0.x → 2.1.0
#         scripts/release.sh major    # 2.x.x → 3.0.0
#         scripts/release.sh 2.5.3    # explicit version

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${1:-}" ]]; then
  echo "Usage: $0 <patch|minor|major|<explicit-version>>"
  exit 1
fi

# Refuse to release with dirty working tree.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash first."
  git status --short
  exit 1
fi

# Make sure we're on main and up to date.
branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$branch" != "main" ]]; then
  echo "Not on main (currently $branch). Switch first or release from main."
  exit 1
fi
git pull --ff-only

# Bump version. npm version writes package.json, commits, and tags.
new_version=$(npm version "$1" --no-git-tag-version)
git add package.json
git commit -m "release: $new_version"
git tag -a "$new_version" -m "$new_version"

echo
echo "Created commit + tag $new_version. Push with:"
echo
echo "  git push && git push --tags"
echo
echo "GitHub Actions will create the Release automatically once the tag arrives."
