use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::state::{HookConfig, WhitelistEntry};

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct RemoveFromWhitelist<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"config", mint.key().as_ref()],
        bump = config.bump,
        constraint = authority.key() == config.authority
    )]
    pub config: Account<'info, HookConfig>,

    #[account(
        mut,
        close = authority,
        seeds = [b"whitelist", mint.key().as_ref(), wallet.as_ref()],
        bump = whitelist_entry.bump
    )]
    pub whitelist_entry: Account<'info, WhitelistEntry>,

    pub mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(_ctx: Context<RemoveFromWhitelist>, _wallet: Pubkey) -> Result<()> {
    Ok(())
}
