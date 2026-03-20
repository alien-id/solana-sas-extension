use admin_cli::handlers::{
    handle_accept_authority, handle_add_to_whitelist, handle_info,
    handle_init_extra_account_meta_list, handle_initialize_config, handle_remove_from_whitelist,
    handle_transfer_authority, handle_update_config,
};
use anchor_client::solana_sdk::pubkey::Pubkey;
use anchor_client::{
    solana_sdk::signature::{read_keypair_file, Keypair, Signer},
    Client, Cluster, Program,
};
use anchor_client::solana_sdk::commitment_config::CommitmentConfig;
use anyhow::{anyhow, Result};
use bs58;
use clap::{Parser, Subcommand};
use alien_id_transfer_hook::id;
use std::fs;
use std::sync::Arc;

#[derive(Parser)]
#[command(name = "admin-cli")]
#[command(about = "Admin CLI for alien-id-transfer-hook program", long_about = None)]
struct Cli {
    #[arg(short, long, default_value = "~/.config/solana/id.json")]
    keypair: String,

    #[arg(long, conflicts_with = "keypair")]
    keypair_base58_file: Option<String>,

    #[arg(short, long, default_value = "devnet")]
    cluster: String,

    #[arg(long, short)]
    override_program_id: Option<String>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Info {
        #[arg(long)]
        mint: String,
    },
    InitializeConfig {
        #[arg(long)]
        mint: String,
        #[arg(long)]
        credential: String,
        #[arg(long)]
        schema: String,
        #[arg(long)]
        sas_program: String,
    },
    UpdateConfig {
        #[arg(long)]
        mint: String,
        #[arg(long)]
        credential: String,
        #[arg(long)]
        schema: String,
        #[arg(long)]
        sas_program: String,
    },
    InitExtraAccountMetaList {
        #[arg(long)]
        mint: String,
    },
    AddToWhitelist {
        #[arg(long)]
        mint: String,
        #[arg(long)]
        wallet: String,
    },
    RemoveFromWhitelist {
        #[arg(long)]
        mint: String,
        #[arg(long)]
        wallet: String,
    },
    TransferAuthority {
        #[arg(long)]
        mint: String,
        #[arg(long)]
        new_authority: String,
    },
    AcceptAuthority {
        #[arg(long)]
        mint: String,
    },
}

fn get_program_client(
    keypair_path: &str,
    keypair_base58_file: Option<&str>,
    cluster_str: &str,
    program_id: Pubkey,
) -> Result<(Program<Arc<Keypair>>, Arc<Keypair>)> {
    let keypair = if let Some(base58_path) = keypair_base58_file {
        let content = fs::read_to_string(shellexpand::tilde(base58_path).to_string())
            .map_err(|e| anyhow!("Failed to read keypair: {}", e))?;
        let bytes = bs58::decode(content.trim())
            .into_vec()
            .map_err(|e| anyhow!("Failed to decode base58 keypair: {}", e))?;
        Keypair::try_from(bytes.as_slice()).map_err(|e| anyhow!("Failed to create keypair: {}", e))?
    } else {
        read_keypair_file(shellexpand::tilde(keypair_path).to_string())
            .map_err(|e| anyhow!("Failed to read keypair file: {}", e))?
    };
    println!("Using keypair: {}", keypair.pubkey());

    let cluster = match cluster_str {
        "mainnet" => Cluster::Mainnet,
        "devnet" => Cluster::Devnet,
        "localnet" | "localhost" => Cluster::Localnet,
        url => Cluster::Custom(url.to_string(), url.to_string()),
    };

    let keypair = Arc::new(keypair);
    let client = Client::new_with_options(cluster, keypair.clone(), CommitmentConfig::confirmed());
    let program = client.program(program_id)?;
    Ok((program, keypair))
}

fn parse_pubkey(s: &str, field: &str) -> Result<Pubkey> {
    s.parse::<Pubkey>()
        .map_err(|e| anyhow!("Invalid {}: {}", field, e))
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    let program_id = if let Some(override_id) = cli.override_program_id.as_deref() {
        parse_pubkey(override_id, "override program id")?
    } else {
        id()
    };

    let (program, _keypair) = get_program_client(
        &cli.keypair,
        cli.keypair_base58_file.as_deref(),
        &cli.cluster,
        program_id,
    )?;

    match cli.command {
        Commands::Info { mint } => {
            let mint = parse_pubkey(&mint, "mint")?;
            handle_info(&program, mint)?;
        }
        Commands::InitializeConfig {
            mint,
            credential,
            schema,
            sas_program,
        } => {
            let mint = parse_pubkey(&mint, "mint")?;
            let credential = parse_pubkey(&credential, "credential")?;
            let schema = parse_pubkey(&schema, "schema")?;
            let sas_program = parse_pubkey(&sas_program, "sas-program")?;
            handle_initialize_config(&program, mint, credential, schema, sas_program)?;
        }
        Commands::UpdateConfig {
            mint,
            credential,
            schema,
            sas_program,
        } => {
            let mint = parse_pubkey(&mint, "mint")?;
            let credential = parse_pubkey(&credential, "credential")?;
            let schema = parse_pubkey(&schema, "schema")?;
            let sas_program = parse_pubkey(&sas_program, "sas-program")?;
            handle_update_config(&program, mint, credential, schema, sas_program)?;
        }
        Commands::InitExtraAccountMetaList { mint } => {
            let mint = parse_pubkey(&mint, "mint")?;
            handle_init_extra_account_meta_list(&program, mint)?;
        }
        Commands::AddToWhitelist { mint, wallet } => {
            let mint = parse_pubkey(&mint, "mint")?;
            let wallet = parse_pubkey(&wallet, "wallet")?;
            handle_add_to_whitelist(&program, mint, wallet)?;
        }
        Commands::RemoveFromWhitelist { mint, wallet } => {
            let mint = parse_pubkey(&mint, "mint")?;
            let wallet = parse_pubkey(&wallet, "wallet")?;
            handle_remove_from_whitelist(&program, mint, wallet)?;
        }
        Commands::TransferAuthority { mint, new_authority } => {
            let mint = parse_pubkey(&mint, "mint")?;
            let new_authority = parse_pubkey(&new_authority, "new-authority")?;
            handle_transfer_authority(&program, mint, new_authority)?;
        }
        Commands::AcceptAuthority { mint } => {
            let mint = parse_pubkey(&mint, "mint")?;
            handle_accept_authority(&program, mint)?;
        }
    }

    Ok(())
}
