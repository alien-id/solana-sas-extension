# solana-sas-extension

## Overview

This project implements a **Solana Token-2022 Transfer Hook** that enforces cross-chain identity verification for token transfers. Before any token transfer is executed, the hook verifies that the sender's wallet holds a valid **attestation** — a cryptographic credential proving the wallet owner has an associated account on an Alien chain.

### Transfer Hook Logic

The transfer hook intercepts every token transfer and performs the following checks:

1. **Attestation existence** — confirms that a valid attestation account exists for the sender's Solana wallet, issued by the [Solana Attestation Service (SAS)](https://github.com/solana-attestation-service/solana-attestation-service).
2. **Issuer verification** — validates that the attestation was signed by our **external credential signer** (via [solana-attestation-signer](https://github.com/alien-id/solana-attestation-signer)), ensuring only credentials issued by the authorised party are accepted.
3. **Cross-chain account proof** — the attestation itself encodes proof that the wallet owner controls an account on the alien chain, binding the Solana identity to the external identity.

If any of these checks fail, the transfer is rejected by the on-chain program.

The hook also validates that the attestation account layout matches the expected SAS format (correct discriminator, valid `credential` and `schema` fields) and that the attestation has not expired (`expiry == 0` is treated as never-expiring).

> **Note:** Delegated transfers are not supported — only the direct token account owner may transfer, preventing circumvention of the attestation check via delegate accounts.

### TransferHookAccount Extension

Every Token-2022 token account that belongs to a mint with a transfer hook enabled automatically carries the **`TransferHookAccount`** extension. Token-2022 sets a `transferring` flag on the source token account for the duration of a transfer CPI and clears it immediately after.

The hook program reads this flag as the very first step via `assert_is_transferring`. If the flag is not set it means the hook instruction was invoked **directly** (not as part of a real token transfer), and the transaction is rejected with `IsNotCurrentlyTransferring`.

This guard is essential for security: without it, anyone could call the hook instruction in isolation, potentially manipulating accounts or bypassing checks by crafting a custom invocation outside of an actual transfer flow.

### Whitelisting

Certain wallets can be **exempted from attestation checks** via a per-mint whitelist managed by the hook authority. A whitelisted wallet bypasses all attestation verification on every transfer.

- **Whitelist entries** are PDAs with seeds `["whitelist", mint, wallet]` owned by this program.
- The hook detects a whitelisted sender by checking whether the `whitelist_entry` account is owned by the hook program and its address matches the expected PDA derivation.
- Only the **hook authority** (stored in `HookConfig`) can add or remove whitelist entries.

This mechanism is intended for administrative wallets (e.g., liquidity pools) that should not be subject to cross-chain identity verification.

### On-Chain State

| Account | Seeds | Description |
|---|---|---|
| `HookConfig` | `["config", mint]` | Per-mint config storing `authority`, `credential`, `schema`, `sas_program` |
| `ExtraAccountMetaList` | `["extra-account-metas", mint]` | Declares the additional accounts injected into every transfer CPI |
| `WhitelistEntry` | `["whitelist", mint, wallet]` | Marks a wallet as whitelisted; closing this account removes the wallet from the whitelist |

### Key Programs Involved

| Program | Role |
|---|---|
| **Transfer Hook** (this repo) | Enforces attestation checks on every token transfer |
| **Solana Attestation Service** | Issues and stores on-chain attestation accounts |
| **Credential Signer** | External signer that co-signs attestations, proving alien-chain account ownership |
| **Session Registry** | Tracks active credential sessions used during verification |

### Program Instructions

| Instruction | Authority | Description |
|---|---|---|
| `initialize_config` | Mint authority | Creates the `HookConfig` PDA for a mint, setting the initial `credential`, `schema`, and `sas_program`. Can only be called by the current mint authority. |
| `initialize_extra_account_meta_list` | Hook authority | Allocates and populates the `ExtraAccountMetaList` PDA that tells Token-2022 which extra accounts to inject into every transfer CPI. |
| `update_config` | Hook authority | Updates `credential`, `schema`, and `sas_program` in the config **and** atomically re-initialises the `ExtraAccountMetaList` to reflect the new values. |
| `transfer_authority` | Hook authority | Transfers the hook authority role to a new pubkey by updating `HookConfig.authority`. |
| `add_to_whitelist` | Hook authority | Creates a `WhitelistEntry` PDA for the given wallet, exempting it from attestation checks on all future transfers. |
| `remove_from_whitelist` | Hook authority | Closes the `WhitelistEntry` PDA for the given wallet, revoking its exemption and reclaiming rent to the authority. |
| `initialize_extra_account_meta_list` *(SPL discriminator)* | Token-2022 | Standard SPL Transfer Hook interface entrypoint used during mint setup. |
| `transfer_hook` *(Execute discriminator)* | Token-2022 (CPI) | Called automatically by Token-2022 on every transfer. Performs whitelist check, then attestation verification if the sender is not whitelisted. |

## Deploy

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create the Walien mint:**
   ```bash
   npm run deploy:1:create-mint
   ```

3. **Initialize the transfer hook:**
   ```bash
   npm run deploy:2:init-hook
   ```

4. **Mint 100 million tokens to admin wallet:**
   ```bash
   spl-token mint 9zEQFhTG4Jx9SGxLzaoiyTqutVhHzdDFqdXGxUrAUESE \
     100000000 \
     --url devnet \
     --mint-authority ~/.config/solana/id.json
   ```

## Running Tests

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run tests:**
   ```bash
   anchor test
   ```

## IDLs

External program IDLs are vendored in the [`idl/`](./idl/) directory for local setup and testing:

| File | Program | Source |
|---|---|---|
| `credential_signer.json` | `GKn6Gu6ZVD4M5s1csUZS2gdUCoWJyy5PcFRtbvNXKV2` | [alien-id/solana-attestation-signer](https://github.com/alien-id/solana-attestation-signer) — `target/idl/credential_signer.json` |
| `session_registry.json` | `5pHXF7jCcRDS4672BwpVJyeuYToiGpEnuJBRxLmKemA` | [alien-id/solana-attestation-signer](https://github.com/alien-id/solana-attestation-signer) — `target/idl/session_registry.json` |
| `solana_attestation_service.json` | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` | [solana-attestation-service/solana-attestation-service](https://github.com/solana-foundation/solana-attestation-service) — `idl/solana_attestation_service.json` |

Compiled binaries (`.so` files) used in local tests are in [`binaries/`](./binaries/).

## Upgrading the Transfer Hook Program

The Transfer Hook extension is **baked into the mint at creation time** and cannot be removed, but the hook program ID can be updated using the transfer hook authority.

### Update the hook program on an existing mint

```ts
import { createUpdateTransferHookInstruction } from "@solana/spl-token";

const updateHookIx = createUpdateTransferHookInstruction(
  mintKeypair.publicKey,  // mint
  admin.publicKey,        // transfer hook authority
  newProgramId,           // new hook program ID
  [],                     // multisig signers
  TOKEN_2022_PROGRAM_ID
);
```

Set `newProgramId` to `PublicKey.default` (`1111...`) to disable the hook entirely.

### Migration steps after upgrading

Upgrading to a new program ID requires migrating each mint's on-chain state:

1. Deploy the new hook program and note its program ID
2. Call `updateTransferHook` on each affected mint (requires transfer hook authority)
3. Call `initialize_config` on the new program for each mint
4. Call `initialize_extra_account_meta_list` on the new program for each mint — the `ExtraAccountMetaList` PDA is program-scoped so a new one must be created under the new program

> **Note:** The old program's `HookConfig` and `ExtraAccountMetaList` PDAs can be closed after migration to reclaim rent.
