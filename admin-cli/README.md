# admin-cli

Admin CLI for the `alien-id-transfer-hook` Solana program. Allows the mint authority / config authority to configure the transfer hook, manage the SAS attestation requirements, and maintain a per-mint wallet whitelist.

## Build

```bash
cargo build -p admin-cli
# binary is at: target/debug/admin-cli
```

## Global Flags

| Flag | Default | Description |
|---|---|---|
| `-k, --keypair <PATH>` | `~/.config/solana/id.json` | Path to keypair JSON file |
| `--keypair-base58-file <PATH>` | — | Path to file containing a base58-encoded keypair (mutually exclusive with `--keypair`) |
| `-c, --cluster <CLUSTER>` | `devnet` | Cluster: `devnet`, `mainnet`, `localnet`, or a custom RPC URL |
| `-o, --override-program-id <PUBKEY>` | — | Override the default program ID |

---

## Commands

### `info`

Print the current state of the transfer hook config and ExtraAccountMetaList for a given mint.

```bash
admin-cli info --mint <MINT>
```

---

### `initialize-config`

Initialize the hook config PDA for a mint. The signer must be the **mint authority**.

Sets which SAS `credential`, `schema`, and `sas_program` are required for token transfers.

```bash
admin-cli initialize-config \
  --mint <MINT> \
  --credential <CREDENTIAL_PUBKEY> \
  --schema <SCHEMA_PUBKEY> \
  --sas-program <SAS_PROGRAM_PUBKEY>
```

After running this command, follow the printed **Next steps** to finish setup:
1. Run `init-extra-account-meta-list` to register the hook accounts on-chain.
2. Optionally add whitelisted wallets with `add-to-whitelist`.

---

### `update-config`

Update the `credential`, `schema`, and/or `sas_program` in an existing config. The signer must be the **config authority** (set during `initialize-config`).

> **Note:** After updating the config you must re-run `init-extra-account-meta-list` so the new values are reflected in PDA resolution during transfers.

```bash
admin-cli update-config \
  --mint <MINT> \
  --credential <CREDENTIAL_PUBKEY> \
  --schema <SCHEMA_PUBKEY> \
  --sas-program <SAS_PROGRAM_PUBKEY>
```

---

### `init-extra-account-meta-list`

Initialize (or reinitialize) the `ExtraAccountMetaList` account for a mint. This account is required by the SPL transfer hook interface and bakes in the current `credential`, `schema`, and `sas_program` from the config.

Must be run **after** `initialize-config` and **again after any** `update-config`.

```bash
admin-cli init-extra-account-meta-list --mint <MINT>
```

---

### `add-to-whitelist`

Add a wallet to the per-mint whitelist. Whitelisted wallets bypass SAS attestation checks on transfer.

The signer must be the **config authority**.

```bash
admin-cli add-to-whitelist --mint <MINT> --wallet <WALLET_PUBKEY>
```

---

### `remove-from-whitelist`

Remove a previously whitelisted wallet. The wallet will again be subject to SAS attestation checks on transfer.

The signer must be the **config authority**.

```bash
admin-cli remove-from-whitelist --mint <MINT> --wallet <WALLET_PUBKEY>
```

---

## Typical Setup Flow

```bash
# 1. Initialize the hook config (signer = mint authority)
admin-cli -c devnet initialize-config \
  --mint <MINT> \
  --credential <CREDENTIAL> \
  --schema <SCHEMA> \
  --sas-program <SAS_PROGRAM>

# 2. Register the extra accounts required by the transfer hook
admin-cli -c devnet init-extra-account-meta-list --mint <MINT>

# 3. (Optional) Whitelist wallets that should bypass attestation
admin-cli -c devnet add-to-whitelist --mint <MINT> --wallet <WALLET>

# 4. Inspect current state at any time
admin-cli -c devnet info --mint <MINT>
```
