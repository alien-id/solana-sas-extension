# solana-sas-extension

## Running Tests

1. **Load submodules:**
   ```bash
   ./scripts/load-submodules.sh
   ```

2. **Build programs:**
   ```bash
   ./scripts/build-all.sh
   ```

3. **Sync keys** in the current project and external anchor:
   ```bash
   anchor keys sync
   ```

   > **Note:** After syncing keys, the program IDs in `Anchor.toml` (both `[programs.*]` and `[[test.genesis]]` addresses) must match the addresses baked into the compiled `.so` files via `declare_id!`. If tests fail with `DeclaredProgramIdMismatch`, run the following to get the actual addresses and update `Anchor.toml` and the program ID constants in `tests/alien-id-transfer-hook.ts` accordingly:
   > ```bash
   > solana-keygen pubkey external/solana-attestation-signer/target/deploy/credential_signer-keypair.json
   > solana-keygen pubkey external/solana-attestation-signer/target/deploy/session_registry-keypair.json
   > ```

4. **Install dependencies:**
   ```bash
   yarn
   ```

5. **Run tests:**
   ```bash
   anchor test
   ```

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