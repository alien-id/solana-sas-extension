use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::state::{HookConfig, WhitelistEntry};

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct AddToWhitelist<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"config", mint.key().as_ref()],
        bump = config.bump,
        constraint = authority.key() == config.authority
    )]
    pub config: Account<'info, HookConfig>,

    #[account(
        init,
        payer = authority,
        space = WhitelistEntry::LEN,
        seeds = [b"whitelist", mint.key().as_ref(), wallet.as_ref()],
        bump
    )]
    pub whitelist_entry: Account<'info, WhitelistEntry>,

    pub mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(ctx: Context<AddToWhitelist>, wallet: Pubkey) -> Result<()> {
    let entry = &mut ctx.accounts.whitelist_entry;
    entry.wallet = wallet;
    entry.bump = ctx.bumps.whitelist_entry;
    Ok(())
}
