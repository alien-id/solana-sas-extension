#!/bin/bash

set -e

load_submodules() {
    local dir="${1:-.}"

    echo "Initializing submodules in: $dir"
    git -C "$dir" submodule update --init

    while IFS= read -r submodule_path; do
        [ -z "$submodule_path" ] && continue
        local full_path="$dir/$submodule_path"
        if [ -f "$full_path/.gitmodules" ]; then
            load_submodules "$full_path"
        fi
    done < <(git -C "$dir" config --file .gitmodules --get-regexp 'submodule\..*\.path' 2>/dev/null | awk '{print $2}')
}

load_submodules "$(git rev-parse --show-toplevel)"
echo "All submodules loaded."
