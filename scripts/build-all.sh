#!/bin/bash

set -e

ROOT="$(git rev-parse --show-toplevel)"

build_anchor_projects() {
    local dir="$1"

    while IFS= read -r anchor_toml; do
        local project_dir
        project_dir="$(dirname "$anchor_toml")"
        echo "Building Anchor project in: $project_dir"
        (cd "$project_dir" && anchor build)
    done < <(find "$dir" -name "Anchor.toml" -not -path "*/node_modules/*" -not -path "*/.git/*")
}

build_anchor_projects "$ROOT"
echo "All Anchor programs built."
