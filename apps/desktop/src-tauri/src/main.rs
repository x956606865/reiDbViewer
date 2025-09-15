#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")] // hide console on Windows in release

mod migrations;

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:rdv_local.db", migrations::migrations())
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

