use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::state::HookConfig;

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        constraint = authority.key() == config.authority
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config", mint.key().as_ref()],
        bump = config.bump
    )]
    pub config: Account<'info, HookConfig>,

    pub mint: InterfaceAccount<'info, Mint>,
}

/// Admin updates the credential/schema/sas_program in the config.
/// Note: after updating you must also reinitialize the ExtraAccountMetaList
/// so the new values are reflected in PDA resolution.
pub(crate) fn handler(
    ctx: Context<UpdateConfig>,
    credential: Pubkey,
    schema: Pubkey,
    sas_program: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.credential = credential;
    config.schema = schema;
    config.sas_program = sas_program;
    Ok(())
}
