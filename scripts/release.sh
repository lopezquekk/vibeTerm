#!/bin/bash
set -e

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh <version>"
  echo "Example: ./scripts/release.sh 1.1.0"
  exit 1
fi

echo "Releasing v$VERSION..."

# Update package.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" package.json

# Update tauri.conf.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json

# Update Cargo.toml (only first occurrence = [package] version)
sed -i '' "1,/^version = /s/^version = \".*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml

echo "Bumped version to $VERSION in package.json, tauri.conf.json, Cargo.toml"

git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "chore: release v$VERSION"
git tag "v$VERSION"

echo ""
echo "Ready to push. Run:"
echo "  git push && git push --tags"
