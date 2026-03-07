#!/bin/bash

set -e

ROOT="$(git rev-parse --show-toplevel)"
TOML="$ROOT/Anchor.toml"
EXT_SAS="$ROOT/external/solana-attestation-signer"

echo "Syncing keys in root project..."
(cd "$ROOT" && anchor keys sync)

echo "Syncing keys in external/solana-attestation-signer..."
(cd "$EXT_SAS" && anchor keys sync && anchor build)

HOOK_KEY=$(solana-keygen pubkey "$ROOT/target/deploy/alien_id_transfer_hook-keypair.json")
CRED_KEY=$(solana-keygen pubkey "$EXT_SAS/target/deploy/credential_signer-keypair.json")
SESS_KEY=$(solana-keygen pubkey "$EXT_SAS/target/deploy/session_registry-keypair.json")

echo "Resolved keys:"
echo "  alien_id_transfer_hook = $HOOK_KEY"
echo "  credential_signer      = $CRED_KEY"
echo "  session_registry       = $SESS_KEY"

sed -i '' "/^\[programs\.localnet\]/,/^\[/ {
    s|^alien_id_transfer_hook = \".*\"|alien_id_transfer_hook = \"$HOOK_KEY\"|
    s|^credential_signer = \".*\"|credential_signer = \"$CRED_KEY\"|
    s|^session_registry = \".*\"|session_registry = \"$SESS_KEY\"|
}" "$TOML"

update_genesis() {
    local so_path="$1"
    local new_addr="$2"
    awk -v so="$so_path" -v addr="$new_addr" '
        /^address = / { addr_line = NR; saved = $0; next }
        $0 ~ "program = \"" so "\"" {
            print "address = \"" addr "\""
            print
            next
        }
        addr_line == NR - 1 { print saved }
        { print }
    ' "$TOML" > "$TOML.tmp" && mv "$TOML.tmp" "$TOML"
}

update_genesis "external/solana-attestation-signer/target/deploy/credential_signer.so" "$CRED_KEY"
update_genesis "external/solana-attestation-signer/target/deploy/session_registry.so" "$SESS_KEY"

echo "Anchor.toml [programs.localnet] and [[test.genesis]] updated."
