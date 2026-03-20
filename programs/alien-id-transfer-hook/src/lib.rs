use anchor_lang::prelude::*;
use spl_transfer_hook_interface::{
    instruction::{
        ExecuteInstruction, InitializeExtraAccountMetaListInstruction, TransferHookInstruction,
    },
};
use spl_discriminator::SplDiscriminate;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use instructions::*;

#[cfg(not(feature = "no-entrypoint"))]
use solana_security_txt::security_txt;

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "WALIEN Transfer Hook program",
    project_url: "https://alien.org/",
    contacts: "email:aliensol@eti.gg, twitter:@alienorg",
    policy: "https://alien.org/sol-security-policy",
    preferred_languages: "en",
    source_code: "https://github.com/alien-id/solana-sas-extension"
}

declare_id!("BBuax7pfatrjWLx2KLNrKopdQz9eLmtDcC93wughEP7F");

#[program]
pub mod alien_id_transfer_hook {

    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        credential: Pubkey,
        schema: Pubkey,
        sas_program: Pubkey,
    ) -> Result<()> {
        initialize_config::handler(ctx, credential, schema, sas_program)
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        credential: Pubkey,
        schema: Pubkey,
        sas_program: Pubkey,
    ) -> Result<()> {
        update_config::handler(ctx, credential, schema, sas_program)
    }

    pub fn add_to_whitelist(ctx: Context<AddToWhitelist>, wallet: Pubkey) -> Result<()> {
        add_to_whitelist::handler(ctx, wallet)
    }

    pub fn remove_from_whitelist(ctx: Context<RemoveFromWhitelist>, wallet: Pubkey) -> Result<()> {
        remove_from_whitelist::handler(ctx, wallet)
    }

    pub fn transfer_authority(ctx: Context<TransferAuthority>) -> Result<()> {
        transfer_authority::handler(ctx)
    }

    #[instruction(discriminator = InitializeExtraAccountMetaListInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        initialize_extra_account_meta_list::handler(ctx)
    }


    #[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        transfer_hook::handler(ctx, amount)
    }
}
