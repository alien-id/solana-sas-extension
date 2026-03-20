use anchor_lang::prelude::*;

/// Admin-controlled config that defines which SAS credential and schema
/// are required to transfer this token. Stored per-mint.
#[account]
pub struct HookConfig {
    /// Admin who can update this config
    pub authority: Pubkey,
    /// SAS Credential account pubkey
    pub credential: Pubkey,
    /// SAS Schema account pubkey
    pub schema: Pubkey,
    /// SAS program ID
    pub sas_program: Pubkey,
    /// Bump for this PDA
    pub bump: u8,
    /// Pending authority awaiting acceptance (Pubkey::default() = none)
    pub pending_authority: Pubkey,
}

impl HookConfig {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 32 + 1 + 32;
}
