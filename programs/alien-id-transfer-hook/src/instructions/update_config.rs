use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

use crate::{constants::ATTESTATION_SEED, state::HookConfig};

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

    /// CHECK: ExtraAccountMetaList Account, re-initialized atomically with config update
    #[account(
        mut,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: AccountInfo<'info>,
}

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

    let account_metas = vec![
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal { bytes: b"config".to_vec() },
                Seed::AccountKey { index: 1 },
            ],
            false,
            false,
        )?,
        ExtraAccountMeta::new_with_pubkey(&credential, false, false)?,
        ExtraAccountMeta::new_with_pubkey(&schema, false, false)?,
        ExtraAccountMeta::new_with_pubkey(&sas_program, false, false)?,
        ExtraAccountMeta::new_external_pda_with_seeds(
            8,
            &[
                Seed::Literal { bytes: ATTESTATION_SEED.to_vec() },
                Seed::AccountKey { index: 6 },
                Seed::AccountKey { index: 7 },
                Seed::AccountKey { index: 3 },
            ],
            false,
            false,
        )?,
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal { bytes: b"whitelist".to_vec() },
                Seed::AccountKey { index: 1 },
                Seed::AccountKey { index: 3 },
            ],
            false,
            false,
        )?,
    ];

    let mut data = ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?;
    data.fill(0);
    ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &account_metas)?;

    Ok(())
}
