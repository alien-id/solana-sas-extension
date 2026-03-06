use anchor_lang::{
    prelude::*,
    system_program::{create_account, CreateAccount},
};
use anchor_spl::token_interface::Mint;
use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

use crate::{constants::ATTESTATION_SEED, state::HookConfig};

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(
        mut,
        constraint = payer.key() == config.authority @ crate::error::TransferHookError::Unauthorized
    )]
    pub payer: Signer<'info>,

    /// CHECK: ExtraAccountMetaList Account, must use these seeds
    #[account(
        mut,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: AccountInfo<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [b"config", mint.key().as_ref()],
        bump = config.bump
    )]
    pub config: Account<'info, HookConfig>,

    pub system_program: Program<'info, System>,
}

/// Initializes the ExtraAccountMetaList, baking in the credential, schema,
/// and sas_program from the current config.
pub(crate) fn handler(ctx: Context<InitializeExtraAccountMetaList>) -> Result<()> {
    let config = &ctx.accounts.config;

    // index 0-3 are the accounts required for token transfer (source, mint, destination, owner)
    // index 4 is address of ExtraAccountMetaList account
    let account_metas = vec![
        // index 5: config PDA (seeds: ["config", mint])
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal {
                    bytes: b"config".to_vec(),
                },
                Seed::AccountKey { index: 1 }, // mint index
            ],
            false,
            false,
        )?,
        // index 6: SAS credential (static pubkey from config)
        ExtraAccountMeta::new_with_pubkey(&config.credential, false, false)?,
        // index 7: SAS schema (static pubkey from config)
        ExtraAccountMeta::new_with_pubkey(&config.schema, false, false)?,
        // index 8: SAS program (static pubkey from config)
        ExtraAccountMeta::new_with_pubkey(&config.sas_program, false, false)?,
        // index 9: attestation PDA owned by the SAS program
        // seeds: ["attestation", credential, schema, owner]
        // the nonce used when creating the attestation must be the token owner's pubkey
        ExtraAccountMeta::new_external_pda_with_seeds(
            8, // SAS program index
            &[
                Seed::Literal {
                    bytes: ATTESTATION_SEED.to_vec(),
                },
                Seed::AccountKey { index: 6 }, // credential index
                Seed::AccountKey { index: 7 }, // schema index
                Seed::AccountKey { index: 3 }, // owner index (used as nonce)
            ],
            false,
            false,
        )?,
        // index 10: whitelist entry PDA (seeds: ["whitelist", mint, owner])
        // may or may not be initialized; hook checks ownership to determine whitelist status
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal {
                    bytes: b"whitelist".to_vec(),
                },
                Seed::AccountKey { index: 1 }, // mint index
                Seed::AccountKey { index: 3 }, // owner index
            ],
            false,
            false,
        )?,
    ];

    let account_size = ExtraAccountMetaList::size_of(account_metas.len())? as u64;

    let mint = ctx.accounts.mint.key();
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"extra-account-metas",
        mint.as_ref(),
        &[ctx.bumps.extra_account_meta_list],
    ]];

    if ctx.accounts.extra_account_meta_list.data_is_empty() {
        let lamports = Rent::get()?.minimum_balance(account_size as usize);

        create_account(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                CreateAccount {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.extra_account_meta_list.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            lamports,
            account_size,
            ctx.program_id,
        )?;
    }

    ExtraAccountMetaList::init::<ExecuteInstruction>(
        &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
        &account_metas,
    )?;

    Ok(())
}
