use anchor_lang::prelude::*;

/// Marks a wallet as whitelisted for a given mint, bypassing attestation checks.
/// PDA seeds: ["whitelist", mint, wallet]
#[account]
pub struct WhitelistEntry {
    pub wallet: Pubkey,
    pub bump: u8,
}

impl WhitelistEntry {
    pub const LEN: usize = 8 + 32 + 1;
}
