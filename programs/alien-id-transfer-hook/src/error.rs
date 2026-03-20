use anchor_lang::prelude::*;

#[error_code]
pub enum TransferHookError {
    #[msg("Attestation account is missing or not owned by the SAS program")]
    InvalidAttestation,
    #[msg("Attestation has expired")]
    AttestationExpired,
    #[msg("Credential account does not match the hook config")]
    CredentialMismatch,
    #[msg("Schema account does not match the hook config")]
    SchemaMismatch,
    #[msg("SAS program does not match the hook config")]
    SasProgramMismatch,
    #[msg("Authority must be the mint authority to initialize config")]
    UnauthorizedMintAuthority,
    #[msg("Whitelist entry PDA does not match expected derivation")]
    InvalidWhitelistEntry,
    #[msg("Only the config authority can perform this action")]
    Unauthorized,
    #[msg("Source token account is not currently transferring")]
    IsNotCurrentlyTransferring,
    #[msg("Transfer not allowed: must be the token account owner or an approved delegate")]
    UnauthorizedTransferAuthority,
    #[msg("No pending authority transfer is in progress")]
    NoPendingAuthority,
}
