#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")] // hide console on Windows in release

mod migrations;

use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

const SYSTEM_PROMPT: &str = "You are the Rei DbView desktop assistant. You must operate strictly in read-only mode.\n\nRules:\n1. Never propose SQL statements that modify data, schema, permissions, or run maintenance commands. Only SELECT/WITH queries are allowed.\n2. Prefer summarising findings, suggesting safe diagnostics, or giving high-level guidance.\n3. When asked for SQL, double-check that it is read-only and explain the logic alongside it.\n4. If the user asks for destructive behaviour, decline politely and remind them of the read-only policy.\n5. Always respect sensitive information—strip or mask secrets, API keys, or personal data in your responses.\n";

const MAX_CONTEXT_CHUNKS: usize = 6;

fn sanitize_markdown_text(input: &str) -> String {
    input.replace('&', "&amp;").replace('<', "&lt;")
}

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
    content: Value,
}

#[derive(Debug, Deserialize)]
struct AssistantProviderSettings {
    provider: String,
    model: String,
    temperature: f32,
    #[serde(default)]
    max_tokens: Option<u32>,
    #[serde(default, rename = "baseUrl")]
    base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AssistantChatRequest {
    messages: Vec<AssistantChatMessage>,
    #[serde(default)]
    context_chunks: Vec<AssistantContextChunkPayload>,
    provider: AssistantProviderSettings,
}

#[derive(Debug, Serialize, Clone)]
struct SafetyTrigger {
    kind: String,
    pattern: String,
    r#match: String,
}

#[derive(Debug, Serialize, Clone)]
struct SafetyEvaluation {
    severity: String,
    triggers: Vec<SafetyTrigger>,
}

#[derive(Debug, Serialize)]
struct SimulatedToolInput {
    sql: String,
}

#[derive(Debug, Serialize)]
struct SimulatedToolResult {
    columns: Vec<String>,
    rows: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<String>,
}

#[derive(Debug, Serialize)]
struct SimulatedToolCall {
    id: String,
    name: String,
    kind: String,
    input: SimulatedToolInput,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<SimulatedToolResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Debug, Serialize)]
struct ResponseUsage {
    #[serde(skip_serializing_if = "Option::is_none")]
    prompt_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    completion_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total_tokens: Option<u32>,
}

#[derive(Debug, Serialize)]
struct AssistantChatResponse {
    message: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tool_calls: Vec<SimulatedToolCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    safety: Option<SafetyEvaluation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    usage: Option<ResponseUsage>,
}

#[derive(Debug, Serialize)]
struct OpenAiMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct OpenAiChatRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoiceMessage {
    content: Value,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiChoiceMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAiUsage {
    #[serde(default)]
    prompt_tokens: Option<u32>,
    #[serde(default)]
    completion_tokens: Option<u32>,
    #[serde(default)]
    total_tokens: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatResponse {
    choices: Vec<OpenAiChoice>,
    #[serde(default)]
    usage: Option<OpenAiUsage>,
}

const BLOCK_PATTERNS: &[(&str, &str)] = &[
    (r"(?i)\bDROP\s+(?:TABLE|SCHEMA|DATABASE)\b", "write_sql"),
    (r"(?i)\bDELETE\s+FROM\b", "write_sql"),
    (r"(?i)\bTRUNCATE\s+TABLE\b", "write_sql"),
    (r"(?i)\bALTER\s+TABLE\b", "write_sql"),
    (r"(?i)\bINSERT\s+INTO\b", "write_sql"),
    (r#"(?i)\bUPDATE\s+[\w".]+"#, "write_sql"),
    (r"(?i)\bPG_TERMINATE_BACKEND\b", "unsafe_command"),
    (r"(?i)\bPG_CANCEL_BACKEND\b", "unsafe_command"),
];

const WARN_PATTERNS: &[(&str, &str)] = &[
    (r"APP_ENCRYPTION_KEY\s*=", "secret"),
    (r"DATABASE_URL\s*=", "secret"),
    (r"AWS_(?:ACCESS|SECRET|SESSION)_KEY", "secret"),
    (r"STRIPE_(?:SECRET|PUBLISHABLE)_KEY", "secret"),
];

fn ensure_supported_provider(provider: &str) -> Result<(), String> {
    if provider.eq_ignore_ascii_case("openai") || provider.eq_ignore_ascii_case("lmstudio") {
        Ok(())
    } else {
        Err("unsupported_provider".to_string())
    }
}

fn load_provider_secret(provider: &str) -> Result<String, String> {
    let account = format!("assistant:{}", provider);
    let entry = keyring::Entry::new("dev.reidbview.desktop", &account).map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}

fn resolve_base_url(settings: &AssistantProviderSettings) -> String {
    let fallback = if settings.provider.eq_ignore_ascii_case("lmstudio") {
        "http://127.0.0.1:1234/v1"
    } else {
        "https://api.openai.com/v1"
    };
    let candidate = settings
        .base_url
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback);
    candidate.trim_end_matches('/').to_string()
}

fn model_error_response(detail: String) -> AssistantChatResponse {
    AssistantChatResponse {
        message: format!("⚠️ 无法调用模型：{}", detail),
        tool_calls: Vec::new(),
        safety: Some(SafetyEvaluation {
            severity: "warn".to_string(),
            triggers: vec![SafetyTrigger {
                kind: "unsafe_command".to_string(),
                pattern: "model_error".to_string(),
                r#match: detail,
            }],
        }),
        usage: None,
    }
}

fn missing_api_key_response() -> AssistantChatResponse {
    AssistantChatResponse {
        message: "尚未配置 OpenAI API Key。请在助手设置中填写后重试。".to_string(),
        tool_calls: Vec::new(),
        safety: Some(SafetyEvaluation {
            severity: "warn".to_string(),
            triggers: vec![SafetyTrigger {
                kind: "secret".to_string(),
                pattern: "missing_api_key".to_string(),
                r#match: "OpenAI API key not found".to_string(),
            }],
        }),
        usage: None,
    }
}

async fn post_openai_chat(
    base_url: &str,
    bearer: Option<&str>,
    request_body: &OpenAiChatRequest,
) -> Result<OpenAiChatResponse, String> {
    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let client = Client::new();
    let mut request = client.post(endpoint).json(request_body);
    if let Some(token) = bearer {
        request = request.bearer_auth(token);
    }
    let response = request.send().await.map_err(|err| err.to_string())?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|err| err.to_string())?;
    if !status.is_success() {
        let message = body
            .get("error")
            .and_then(|err| err.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("模型返回未知错误")
            .to_string();
        return Err(message);
    }
    serde_json::from_value(body).map_err(|err| err.to_string())
}

fn value_as_str<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key)?.as_str()
}

fn value_as_bool(value: &Value, key: &str) -> Option<bool> {
    value.get(key)?.as_bool()
}

fn format_schema_table_chunk(chunk: &AssistantContextChunkPayload) -> Option<String> {
    let schema = value_as_str(&chunk.content, "schema")?;
    let table = value_as_str(&chunk.content, "table")?;
    let columns = chunk.content.get("columns")?.as_array()?;

    let mut column_defs: Vec<String> = Vec::new();
    let mut primary_keys: Vec<String> = Vec::new();
    let mut foreign_keys: Vec<String> = Vec::new();

    for column in columns {
        let name = value_as_str(column, "name")?;
        let data_type = value_as_str(column, "dataType").unwrap_or("text");
        let nullable = value_as_bool(column, "nullable").unwrap_or(true);
        let is_primary = value_as_bool(column, "isPrimaryKey").unwrap_or(false);
        let is_foreign = value_as_bool(column, "isForeignKey").unwrap_or(false);

        let mut definition = format!("  \"{}\" {}", name, data_type);
        if !nullable {
            definition.push_str(" NOT NULL");
        }

        column_defs.push(definition);

        if is_primary {
            primary_keys.push(format!("\"{}\"", name));
        }

        if is_foreign {
            if let Some(references) = column.get("references") {
                if let (Some(ref_schema), Some(ref_table), Some(ref_column)) = (
                    references.get("schema").and_then(Value::as_str),
                    references.get("table").and_then(Value::as_str),
                    references.get("column").and_then(Value::as_str),
                ) {
                    foreign_keys.push(format!(
                        "  FOREIGN KEY (\"{}\") REFERENCES \"{}\".\"{}\" (\"{}\")",
                        name, ref_schema, ref_table, ref_column
                    ));
                }
            }
        }
    }

    if column_defs.is_empty() {
        return None;
    }

    if !primary_keys.is_empty() {
        column_defs.push(format!("  PRIMARY KEY ({})", primary_keys.join(", ")));
    }

    column_defs.extend(foreign_keys);

    let ddl = format!(
        "CREATE TABLE \"{}\".\"{}\" (\n{}\n);",
        schema,
        table,
        column_defs.join(",\n")
    );

    let mut lines: Vec<String> = Vec::new();
    let schema_label = sanitize_markdown_text(schema);
    let table_label = sanitize_markdown_text(table);
    lines.push(format!(
        "Table \"{}\".\"{}\" — {}",
        schema_label,
        table_label,
        sanitize_markdown_text(&chunk.summary)
    ));
    lines.push("```sql".to_string());
    lines.push(ddl);
    lines.push("```".to_string());

    Some(lines.join("\n"))
}

fn format_context_chunks(chunks: &[AssistantContextChunkPayload]) -> Option<String> {
    if chunks.is_empty() {
        return None;
    }
    let mut blocks: Vec<String> = Vec::new();
    for (idx, chunk) in chunks.iter().take(MAX_CONTEXT_CHUNKS).enumerate() {
        if chunk.kind == "schema-table" {
            if let Some(formatted) = format_schema_table_chunk(chunk) {
                blocks.push(format!("{}. {}", idx + 1, formatted));
                continue;
            }
        }

        let mut line = format!(
            "{}. {} — {}",
            idx + 1,
            sanitize_markdown_text(&chunk.title),
            sanitize_markdown_text(&chunk.summary)
        );
        if !chunk.content.is_null() {
            let content_str = chunk.content.to_string();
            let trimmed = if content_str.len() > 240 {
                format!("{}…", &content_str[..240])
            } else {
                content_str
            };
            line.push_str(&format!("\n   content: {}", sanitize_markdown_text(&trimmed)));
        }
        blocks.push(line);
    }
    if chunks.len() > MAX_CONTEXT_CHUNKS {
        blocks.push(format!(
            "(+{} more context chunks omitted)",
            chunks.len() - MAX_CONTEXT_CHUNKS
        ));
    }
    Some(format!("Context summary:\n{}", blocks.join("\n")))
}

fn build_openai_messages(payload: &AssistantChatRequest) -> Vec<OpenAiMessage> {
    let mut messages = Vec::new();
    messages.push(OpenAiMessage {
        role: "system".to_string(),
        content: SYSTEM_PROMPT.to_string(),
    });
    if let Some(context) = format_context_chunks(&payload.context_chunks) {
        messages.push(OpenAiMessage {
            role: "system".to_string(),
            content: context,
        });
    }
    for entry in &payload.messages {
        let role = match entry.role.as_str() {
            "assistant" => "assistant",
            "system" => "system",
            _ => "user",
        };
        if entry.text.trim().is_empty() {
            continue;
        }
        messages.push(OpenAiMessage {
            role: role.to_string(),
            content: entry.text.clone(),
        });
    }
    messages
}

fn extract_message_text(choice: &OpenAiChoice) -> String {
    match &choice.message.content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => {
            let mut combined = String::new();
            for part in parts {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    combined.push_str(text);
                } else if let Some(text) = part.as_str() {
                    combined.push_str(text);
                }
            }
            combined
        }
        other => other.to_string(),
    }
}

fn evaluate_response_safety(text: &str) -> SafetyEvaluation {
    let mut triggers: Vec<SafetyTrigger> = Vec::new();

    for (pattern, kind) in BLOCK_PATTERNS.iter() {
        if let Ok(regex) = Regex::new(pattern) {
            if let Some(found) = regex.find(text) {
                triggers.push(SafetyTrigger {
                    kind: kind.to_string(),
                    pattern: pattern.to_string(),
                    r#match: found.as_str().to_string(),
                });
            }
        }
    }

    for (pattern, kind) in WARN_PATTERNS.iter() {
        if let Ok(regex) = Regex::new(pattern) {
            if let Some(found) = regex.find(text) {
                triggers.push(SafetyTrigger {
                    kind: kind.to_string(),
                    pattern: pattern.to_string(),
                    r#match: found.as_str().to_string(),
                });
            }
        }
    }

    if triggers.is_empty() {
        return SafetyEvaluation {
            severity: "none".to_string(),
            triggers,
        };
    }

    let has_blocker = triggers
        .iter()
        .any(|trigger| trigger.kind == "write_sql" || trigger.kind == "unsafe_command");

    let severity = if has_blocker {
        "block"
    } else {
        "warn"
    };

    SafetyEvaluation {
        severity: severity.to_string(),
        triggers,
    }
}

fn strip_sql_comments(sql: &str) -> String {
    let without_block = Regex::new(r"(?s)/\*.*?\*/").unwrap().replace_all(sql, "").to_string();
    Regex::new(r"--.*").unwrap().replace_all(&without_block, "").to_string()
}

fn is_read_only_sql(sql: &str) -> bool {
    let stripped = strip_sql_comments(sql);
    let normalized = stripped.trim();
    if normalized.is_empty() {
        return false;
    }
    let lowered = normalized.to_lowercase();
    let disallowed = [
        " insert ",
        " update ",
        " delete ",
        " drop ",
        " truncate ",
        " alter ",
        " create ",
        " grant ",
        " revoke ",
        " comment ",
        " merge ",
        " call ",
        " do ",
        " begin ",
        " commit ",
        " rollback ",
    ];
    for keyword in disallowed.iter() {
        if lowered.contains(keyword) {
            return false;
        }
    }
    lowered.starts_with("select ") || lowered.starts_with("with ")
}

fn generate_tool_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("tool_{:x}", now)
}

fn simulate_tool_calls(text: &str) -> Vec<SimulatedToolCall> {
    let code_block_re = match Regex::new(r"```(?:sql|postgresql|postgres)?\s*([\s\S]*?)```") {
        Ok(re) => re,
        Err(_) => return Vec::new(),
    };
    if let Some(captures) = code_block_re.captures(text) {
        if let Some(m) = captures.get(1) {
            let sql = m.as_str().trim();
            if sql.is_empty() {
                return Vec::new();
            }
            if is_read_only_sql(sql) {
                let rows = vec![
                    json!({"example": "total_rows", "detail": 123}),
                    json!({"example": "sample_value", "detail": "demo"}),
                    json!({"example": "note", "detail": "Simulated result (no live query executed)"}),
                ];
                return vec![SimulatedToolCall {
                    id: generate_tool_id(),
                    name: "readonly-sql-preview".to_string(),
                    kind: "sql_preview".to_string(),
                    input: SimulatedToolInput {
                        sql: sql.to_string(),
                    },
                    status: "success".to_string(),
                    result: Some(SimulatedToolResult {
                        columns: vec!["example".to_string(), "detail".to_string()],
                        rows,
                        summary: Some("Simulated execution result. Connect a read-only pool to enable live execution.".to_string()),
                    }),
                    message: None,
                }];
            } else {
                return vec![SimulatedToolCall {
                    id: generate_tool_id(),
                    name: "readonly-sql-preview".to_string(),
                    kind: "sql_preview".to_string(),
                    input: SimulatedToolInput {
                        sql: sql.to_string(),
                    },
                    status: "error".to_string(),
                    result: None,
                    message: Some("Only read-only SELECT/WITH statements are allowed.".to_string()),
                }];
            }
        }
    }
    Vec::new()
}

fn format_blocked_message(safety: &SafetyEvaluation) -> String {
    let reasons: Vec<String> = safety
        .triggers
        .iter()
        .map(|trigger| trigger.r#match.clone())
        .collect();
    let joined = reasons.join(", ");
    format!(
        "⚠️ 已阻止可能的危险回答。触发关键词: {}。请重新尝试，以只读查询或描述性请求的方式表达。",
        if joined.is_empty() { "unknown".to_string() } else { joined }
    )
}

#[tauri::command]
async fn set_secret(account: String, secret: String) -> Result<(), String> {
    let entry = keyring::Entry::new("dev.reidbview.desktop", &account).map_err(|e| e.to_string())?;
    entry.set_password(&secret).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_secret(account: String) -> Result<String, String> {
    let entry = keyring::Entry::new("dev.reidbview.desktop", &account).map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_secret(account: String) -> Result<(), String> {
    let entry = keyring::Entry::new("dev.reidbview.desktop", &account).map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())
}

#[tauri::command]
async fn has_secret(account: String) -> Result<bool, String> {
    let entry = keyring::Entry::new("dev.reidbview.desktop", &account).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(secret) => Ok(!secret.is_empty()),
        Err(err) => {
            let msg = err.to_string();
            let lowered = msg.to_lowercase();
            if lowered.contains("no entry found") || lowered.contains("no matching entry found") {
                Ok(false)
            } else {
                Err(msg)
            }
        }
    }
}

#[tauri::command]
async fn assistant_chat(payload: AssistantChatRequest) -> Result<AssistantChatResponse, String> {
    ensure_supported_provider(&payload.provider.provider)?;
    let provider_name = payload.provider.provider.to_lowercase();
    let base_url = resolve_base_url(&payload.provider);
    let messages = build_openai_messages(&payload);
    let request_body = OpenAiChatRequest {
        model: payload.provider.model.clone(),
        messages,
        temperature: payload.provider.temperature,
        max_tokens: payload.provider.max_tokens,
    };
    let chat_response = match provider_name.as_str() {
        "openai" => {
            let api_key = match load_provider_secret(&payload.provider.provider) {
                Ok(secret) => secret,
                Err(_) => return Ok(missing_api_key_response()),
            };
            match post_openai_chat(&base_url, Some(api_key.as_str()), &request_body).await {
                Ok(response) => response,
                Err(detail) => return Ok(model_error_response(detail)),
            }
        }
        "lmstudio" => {
            let token = load_provider_secret(&payload.provider.provider)
                .unwrap_or_else(|_| "lm-studio".to_string());
            let bearer = if token.trim().is_empty() {
                "lm-studio".to_string()
            } else {
                token
            };
            match post_openai_chat(&base_url, Some(bearer.as_str()), &request_body).await {
                Ok(response) => response,
                Err(detail) => {
                    let lowered = detail.to_lowercase();
                    let friendly = if lowered.contains("connection refused")
                        || lowered.contains("could not connect")
                        || lowered.contains("connection reset")
                        || lowered.contains("timed out")
                    {
                        format!(
                            "无法连接到 LM Studio 服务。请确认已运行 `lms server start` 并监听 {}。原始错误：{}",
                            base_url,
                            detail
                        )
                    } else {
                        format!("LM Studio 返回错误：{}", detail)
                    };
                    return Ok(model_error_response(friendly));
                }
            }
        }
        _ => return Err("unsupported_provider".to_string()),
    };

    let choice = chat_response
        .choices
        .get(0)
        .ok_or_else(|| "model_returned_no_choices".to_string())?;
    let assistant_text = extract_message_text(choice);

    let safety = evaluate_response_safety(&assistant_text);
    let mut final_message = assistant_text.clone();

    let tool_calls = if safety.severity == "block" {
        Vec::new()
    } else {
        simulate_tool_calls(&assistant_text)
    };

    if safety.severity == "block" {
        final_message = format_blocked_message(&safety);
    } else if safety.severity == "warn" {
        final_message.push_str("\n\n> ⚠️ 检测到可能的敏感信息，请谨慎处理。");
    }

    let usage = chat_response.usage.map(|usage| ResponseUsage {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
    });

    Ok(AssistantChatResponse {
        message: final_message,
        tool_calls,
        safety: Some(safety),
        usage,
    })
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
            has_secret,
            assistant_chat
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
