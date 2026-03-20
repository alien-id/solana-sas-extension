use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::state::HookConfig;

#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    #[account(
        mut,
        constraint = authority.key() == config.authority
    )]
    pub authority: Signer<'info>,

    /// CHECK: Stored as pending; must sign accept_authority to become active.
    pub new_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        realloc = HookConfig::LEN,
        realloc::payer = authority,
        realloc::zero = false,
        seeds = [b"config", mint.key().as_ref()],
        bump = config.bump
    )]
    pub config: Account<'info, HookConfig>,

    pub mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(ctx: Context<TransferAuthority>) -> Result<()> {
    ctx.accounts.config.pending_authority = ctx.accounts.new_authority.key();
    Ok(())
}
