use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::state::HookConfig;

#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    #[account(
        constraint = authority.key() == config.authority
    )]
    pub authority: Signer<'info>,

    /// CHECK: The new authority; validated by the caller.
    pub new_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"config", mint.key().as_ref()],
        bump = config.bump
    )]
    pub config: Account<'info, HookConfig>,

    pub mint: InterfaceAccount<'info, Mint>,
}

pub(crate) fn handler(ctx: Context<TransferAuthority>) -> Result<()> {
    ctx.accounts.config.authority = ctx.accounts.new_authority.key();
    Ok(())
}
