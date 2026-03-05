use anchor_lang::prelude::*;
use spl_transfer_hook_interface::instruction::TransferHookInstruction;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("HaixGEih7RhVyH3RTy57hwoRk7WURghhBAJ7eHRoHcbx");

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

    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        initialize_extra_account_meta_list::handler(ctx)
    }

    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        transfer_hook::handler(ctx, amount)
    }

    pub fn fallback<'info>(
        program_id: &Pubkey,
        accounts: &'info [AccountInfo<'info>],
        data: &[u8],
    ) -> Result<()> {
        let instruction = TransferHookInstruction::unpack(data)?;

        match instruction {
            TransferHookInstruction::Execute { amount } => {
                let amount_bytes = amount.to_le_bytes();
                __private::__global::transfer_hook(program_id, accounts, &amount_bytes)
            }
            _ => Err(ProgramError::InvalidInstructionData.into()),
        }
    }
}
