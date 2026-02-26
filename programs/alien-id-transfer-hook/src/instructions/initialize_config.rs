use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{error::TransferHookError, state::HookConfig};

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = HookConfig::LEN,
        seeds = [b"config", mint.key().as_ref()],
        bump
    )]
    pub config: Account<'info, HookConfig>,

    #[account(
        constraint = mint.mint_authority.contains(&authority.key()) @ TransferHookError::UnauthorizedMintAuthority
    )]
    pub mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(
    ctx: Context<InitializeConfig>,
    credential: Pubkey,
    schema: Pubkey,
    sas_program: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.credential = credential;
    config.schema = schema;
    config.sas_program = sas_program;
    config.bump = ctx.bumps.config;
    Ok(())
}
