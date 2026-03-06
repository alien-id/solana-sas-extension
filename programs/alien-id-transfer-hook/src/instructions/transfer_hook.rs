use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::{
    constants::ATTESTATION_DISCRIMINATOR,
    error::TransferHookError,
    state::HookConfig,
};

// Order of accounts matters for this struct.
// The first 4 accounts are the accounts required for token transfer (source, mint, destination, owner)
// Remaining accounts are the extra accounts required from the ExtraAccountMetaList account
// These accounts are provided via CPI to this program from the token2022 program
#[derive(Accounts)]
pub struct TransferHook<'info> {
    // Intentionally requires owner == source_token.owner, which blocks delegated
    // transfers. Attestations are identity-bound, so only the attested wallet
    // owner should be able to initiate transfers.
    #[account(
        token::mint = mint,
        token::authority = owner,
    )]
    pub source_token: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        token::mint = mint,
    )]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: source token account owner, can be SystemAccount or PDA owned by another program
    pub owner: UncheckedAccount<'info>,
    /// CHECK: ExtraAccountMetaList Account
    #[account(
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    /// Config PDA for this mint, holds the canonical credential/schema/sas_program
    #[account(
        seeds = [b"config", mint.key().as_ref()],
        bump = config.bump
    )]
    pub config: Account<'info, HookConfig>,
    /// CHECK: SAS Credential account, validated against config.credential
    pub credential: UncheckedAccount<'info>,
    /// CHECK: SAS Schema account, validated against config.schema
    pub schema: UncheckedAccount<'info>,
    /// CHECK: SAS program, validated against config.sas_program
    pub sas_program: UncheckedAccount<'info>,
    /// CHECK: Attestation PDA owned by the SAS program, address is verified by
    /// ExtraAccountMetaList derivation using seeds ["attestation", credential, schema, owner]
    pub attestation: UncheckedAccount<'info>,
    /// CHECK: Whitelist entry PDA (seeds: ["whitelist", mint, owner]).
    /// If owned by this program the owner is whitelisted and attestation is skipped.
    pub whitelist_entry: UncheckedAccount<'info>,
}

pub(crate) fn handler(ctx: Context<TransferHook>, _amount: u64) -> Result<()> {
    if ctx.accounts.whitelist_entry.owner == ctx.program_id {
        let (expected_pda, _) = Pubkey::find_program_address(
            &[
                b"whitelist",
                ctx.accounts.mint.key().as_ref(),
                ctx.accounts.owner.key().as_ref(),
            ],
            ctx.program_id,
        );
        require!(
            ctx.accounts.whitelist_entry.key() == expected_pda,
            TransferHookError::InvalidWhitelistEntry
        );
        msg!("Whitelisted owner, skipping attestation: {}", ctx.accounts.owner.key());
        return Ok(());
    }

    let config = &ctx.accounts.config;

    require!(
        ctx.accounts.credential.key() == config.credential,
        TransferHookError::CredentialMismatch
    );
    require!(
        ctx.accounts.schema.key() == config.schema,
        TransferHookError::SchemaMismatch
    );
    require!(
        ctx.accounts.sas_program.key() == config.sas_program,
        TransferHookError::SasProgramMismatch
    );

    let attestation = &ctx.accounts.attestation;

    require!(
        attestation.owner == &config.sas_program,
        TransferHookError::InvalidAttestation
    );

    let data = attestation.try_borrow_data()?;

    require!(data.len() > 1, TransferHookError::InvalidAttestation);

    require!(
        data[0] == ATTESTATION_DISCRIMINATOR,
        TransferHookError::InvalidAttestation
    );

    // layout after discriminator:
    // nonce(32) + credential(32) + schema(32) + data_len(4) + data(n) + signer(32) + expiry(8)
    let base_offset: usize = 1 + 32 + 32 + 32;

    require!(
        data.len() >= base_offset + 4,
        TransferHookError::InvalidAttestation
    );

    let data_field_len =
        u32::from_le_bytes(data[base_offset..base_offset + 4].try_into().unwrap()) as usize;

    let expiry_offset = base_offset + 4 + data_field_len + 32;

    require!(
        data.len() >= expiry_offset + 8,
        TransferHookError::InvalidAttestation
    );

    let expiry =
        i64::from_le_bytes(data[expiry_offset..expiry_offset + 8].try_into().unwrap());

    // expiry == 0 is treated as a never-expiring attestation; the clock check is skipped.
    if expiry != 0 {
        let clock = Clock::get()?;
        require!(
            expiry > clock.unix_timestamp,
            TransferHookError::AttestationExpired
        );
    }

    msg!("Attestation verified for owner: {}", ctx.accounts.owner.key());

    Ok(())
}
