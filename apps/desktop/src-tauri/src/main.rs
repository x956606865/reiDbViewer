#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")] // hide console on Windows in release

mod migrations;
use tauri::Manager;

#[tauri::command]
fn set_secret(account: String, secret: String) -> Result<(), String> {
    let entry = keyring::Entry::new("dev.reidbview.desktop", &account).map_err(|e| e.to_string())?;
    entry.set_password(&secret).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_secret(account: String) -> Result<String, String> {
    let entry = keyring::Entry::new("dev.reidbview.desktop", &account).map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_secret(account: String) -> Result<(), String> {
    let entry = keyring::Entry::new("dev.reidbview.desktop", &account).map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:rdv_local.db", migrations::migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![set_secret, get_secret, delete_secret])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
