use crate::utils::{
    get_config_address, get_extra_account_meta_list_address, get_whitelist_entry_address,
};
use anchor_client::{
    solana_sdk::pubkey::Pubkey,
    Program,
};
use anchor_lang::solana_program::system_program;
use anyhow::Result;
use alien_id_transfer_hook::state::HookConfig;
use std::sync::Arc;
use anchor_client::solana_sdk::signature::Keypair;

pub fn handle_info(program: &Program<Arc<Keypair>>, mint: Pubkey) -> Result<()> {
    let program_id = program.id();
    let (config_address, _) = get_config_address(&mint, &program_id);
    let (extra_account_meta_list_address, _) =
        get_extra_account_meta_list_address(&mint, &program_id);

    println!("\n=== Transfer Hook Config ===\n");
    println!("Mint:       {}", mint);
    println!("Config PDA: {}", config_address);

    match program.account::<HookConfig>(config_address) {
        Err(_) => {
            println!("Status:     not initialized");
            return Ok(());
        }
        Ok(config) => {
            println!("Authority:  {}", config.authority);
            println!("Credential: {}", config.credential);
            println!("Schema:     {}", config.schema);
            println!("SAS Program:{}", config.sas_program);
        }
    }

    let extra_meta_exists = program
        .rpc()
        .get_account(&extra_account_meta_list_address)
        .is_ok();
    println!(
        "\nExtraAccountMetaList ({}): {}",
        extra_account_meta_list_address,
        if extra_meta_exists {
            "initialized"
        } else {
            "not initialized"
        }
    );

    Ok(())
}

pub fn handle_initialize_config(
    program: &Program<Arc<Keypair>>,
    mint: Pubkey,
    credential: Pubkey,
    schema: Pubkey,
    sas_program: Pubkey,
) -> Result<()> {
    let program_id = program.id();
    let (config_address, _) = get_config_address(&mint, &program_id);

    println!("Initializing config for mint: {}", mint);

    let tx = program
        .request()
        .accounts(alien_id_transfer_hook::accounts::InitializeConfig {
            authority: program.payer(),
            config: config_address,
            mint,
            system_program: system_program::ID,
        })
        .args(alien_id_transfer_hook::instruction::InitializeConfig {
            credential,
            schema,
            sas_program,
        })
        .send()?;

    println!("Config PDA: {}", config_address);
    println!("Transaction successful: {}", tx);
    println!("\nNext steps:");
    println!(
        "  1. Initialize ExtraAccountMetaList:\n     admin-cli init-extra-account-meta-list --mint {}",
        mint
    );
    println!(
        "  2. (Optional) Add wallets to whitelist:\n     admin-cli add-to-whitelist --mint {} --wallet <WALLET>",
        mint
    );
    Ok(())
}

pub fn handle_update_config(
    program: &Program<Arc<Keypair>>,
    mint: Pubkey,
    credential: Pubkey,
    schema: Pubkey,
    sas_program: Pubkey,
) -> Result<()> {
    let program_id = program.id();
    let (config_address, _) = get_config_address(&mint, &program_id);
    let (extra_account_meta_list_address, _) =
        get_extra_account_meta_list_address(&mint, &program_id);

    println!("Updating config for mint: {}", mint);

    let tx = program
        .request()
        .accounts(alien_id_transfer_hook::accounts::UpdateConfig {
            authority: program.payer(),
            config: config_address,
            mint,
            extra_account_meta_list: extra_account_meta_list_address,
        })
        .args(alien_id_transfer_hook::instruction::UpdateConfig {
            credential,
            schema,
            sas_program,
        })
        .send()?;

    println!("Transaction successful: {}", tx);
    Ok(())
}

pub fn handle_init_extra_account_meta_list(
    program: &Program<Arc<Keypair>>,
    mint: Pubkey,
) -> Result<()> {
    let program_id = program.id();
    let (config_address, _) = get_config_address(&mint, &program_id);
    let (extra_account_meta_list_address, _) =
        get_extra_account_meta_list_address(&mint, &program_id);

    println!("Initializing ExtraAccountMetaList for mint: {}", mint);

    let tx = program
        .request()
        .accounts(
            alien_id_transfer_hook::accounts::InitializeExtraAccountMetaList {
                payer: program.payer(),
                extra_account_meta_list: extra_account_meta_list_address,
                mint,
                config: config_address,
                system_program: system_program::ID,
            },
        )
        .args(alien_id_transfer_hook::instruction::InitializeExtraAccountMetaList {})
        .send()?;

    println!(
        "ExtraAccountMetaList PDA: {}",
        extra_account_meta_list_address
    );
    println!("Transaction successful: {}", tx);
    Ok(())
}

pub fn handle_add_to_whitelist(
    program: &Program<Arc<Keypair>>,
    mint: Pubkey,
    wallet: Pubkey,
) -> Result<()> {
    let program_id = program.id();
    let (config_address, _) = get_config_address(&mint, &program_id);
    let (whitelist_entry_address, _) = get_whitelist_entry_address(&mint, &wallet, &program_id);

    println!("Adding {} to whitelist for mint: {}", wallet, mint);

    let tx = program
        .request()
        .accounts(alien_id_transfer_hook::accounts::AddToWhitelist {
            authority: program.payer(),
            config: config_address,
            whitelist_entry: whitelist_entry_address,
            mint,
            system_program: system_program::ID,
        })
        .args(alien_id_transfer_hook::instruction::AddToWhitelist { wallet })
        .send()?;

    println!("WhitelistEntry PDA: {}", whitelist_entry_address);
    println!("Transaction successful: {}", tx);
    Ok(())
}

pub fn handle_transfer_authority(
    program: &Program<Arc<Keypair>>,
    mint: Pubkey,
    new_authority: Pubkey,
) -> Result<()> {
    let program_id = program.id();
    let (config_address, _) = get_config_address(&mint, &program_id);

    println!("Transferring authority for mint: {}", mint);
    println!("New authority: {}", new_authority);

    let tx = program
        .request()
        .accounts(alien_id_transfer_hook::accounts::TransferAuthority {
            authority: program.payer(),
            new_authority,
            config: config_address,
            mint,
        })
        .args(alien_id_transfer_hook::instruction::TransferAuthority {})
        .send()?;

    println!("Transaction successful: {}", tx);
    Ok(())
}

pub fn handle_remove_from_whitelist(
    program: &Program<Arc<Keypair>>,
    mint: Pubkey,
    wallet: Pubkey,
) -> Result<()> {
    let program_id = program.id();
    let (config_address, _) = get_config_address(&mint, &program_id);
    let (whitelist_entry_address, _) = get_whitelist_entry_address(&mint, &wallet, &program_id);

    println!("Removing {} from whitelist for mint: {}", wallet, mint);

    let tx = program
        .request()
        .accounts(alien_id_transfer_hook::accounts::RemoveFromWhitelist {
            authority: program.payer(),
            config: config_address,
            whitelist_entry: whitelist_entry_address,
            mint,
            system_program: system_program::ID,
        })
        .args(alien_id_transfer_hook::instruction::RemoveFromWhitelist { wallet })
        .send()?;

    println!("Transaction successful: {}", tx);
    Ok(())
}
