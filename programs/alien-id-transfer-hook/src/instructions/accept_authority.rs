use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::error::TransferHookError;
use crate::state::HookConfig;

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    #[account(
        constraint = pending_authority.key() == config.pending_authority @ TransferHookError::NoPendingAuthority
    )]
    pub pending_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config", mint.key().as_ref()],
        bump = config.bump
    )]
    pub config: Account<'info, HookConfig>,

    pub mint: InterfaceAccount<'info, Mint>,
}

pub(crate) fn handler(ctx: Context<AcceptAuthority>) -> Result<()> {
    require!(
        ctx.accounts.config.pending_authority != Pubkey::default(),
        TransferHookError::NoPendingAuthority
    );

    ctx.accounts.config.authority = ctx.accounts.config.pending_authority;
    ctx.accounts.config.pending_authority = Pubkey::default();

    Ok(())
}
