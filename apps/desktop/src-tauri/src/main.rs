#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")] // hide console on Windows in release

mod migrations;
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Deserialize)]
struct AssistantChatMessage {
    role: String,
    text: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct AssistantContextChunkPayload {
    id: String,
    title: String,
    kind: String,
    summary: String,
    #[serde(default)]
    content: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct AssistantChatRequest {
    messages: Vec<AssistantChatMessage>,
    #[serde(default)]
    context_chunks: Vec<AssistantContextChunkPayload>,
}

#[derive(Debug, Serialize)]
struct AssistantChatResponse {
    message: String,
}

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

#[tauri::command]
fn assistant_chat(payload: AssistantChatRequest) -> Result<AssistantChatResponse, String> {
    let last_user_message = payload
        .messages
        .iter()
        .rev()
        .find(|message| message.role.eq_ignore_ascii_case("user"))
        .map(|message| message.text.trim().to_string())
        .unwrap_or_else(|| "(no user question provided)".to_string());

    let mut summary_lines: Vec<String> = Vec::new();
    for chunk in payload.context_chunks.iter() {
        summary_lines.push(format!("- {}: {}", chunk.title, chunk.summary));
    }

    let context_summary = if summary_lines.is_empty() {
        "(no context selected)".to_string()
    } else {
        summary_lines.join("\n")
    };

    let response = format!(
        "**Tauri mock assistant**\n\nLatest question:\n{}\n\nContext summary:\n{}\n\nThis is a simulated response from the desktop backend. Replace this command with a real model integration in future iterations.",
        last_user_message,
        context_summary
    );

    Ok(AssistantChatResponse { message: response })
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:rdv_local.db", migrations::migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            set_secret,
            get_secret,
            delete_secret,
            assistant_chat
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
