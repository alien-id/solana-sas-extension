# solana-sas-extension

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
| `solana_attestation_service.json` | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` | [solana-attestation-service/solana-attestation-service](https://github.com/solana-attestation-service/solana-attestation-service) — `idl/solana_attestation_service.json` |

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