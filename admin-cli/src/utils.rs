use anchor_client::solana_sdk::pubkey::Pubkey;

pub(crate) fn get_config_address(mint: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"config", mint.as_ref()], program_id)
}

pub(crate) fn get_extra_account_meta_list_address(mint: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"extra-account-metas", mint.as_ref()], program_id)
}

pub(crate) fn get_whitelist_entry_address(
    mint: &Pubkey,
    wallet: &Pubkey,
    program_id: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"whitelist", mint.as_ref(), wallet.as_ref()], program_id)
}
