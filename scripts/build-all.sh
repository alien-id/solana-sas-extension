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

build_sbf_projects() {
    local dir="$1"

    while IFS= read -r cargo_toml; do
        local project_dir
        project_dir="$(dirname "$cargo_toml")"
        if grep -q 'cdylib' "$cargo_toml" 2>/dev/null; then
            echo "Building SBF project in: $project_dir"
            (cd "$project_dir" && cargo build-sbf)
        fi
    done < <(find "$dir" -name "Cargo.toml" -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/target/*")
}

build_sbf_projects "$ROOT/external/solana-attestation-signer/external/solana-attestation-service"
build_anchor_projects "$ROOT"
echo "All programs built."
