use csv::Writer;
use futures::TryStreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::postgres::{PgArguments, PgPool, PgPoolOptions};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{Arguments, Row, SqlitePool};
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::async_runtime;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{fs as tokio_fs, time::sleep};
use uuid::Uuid;
use zip::write::FileOptions;
use zip::CompressionMethod;

#[derive(Clone, Default)]
pub struct ApiScriptManager {
    inner: Arc<ApiScriptManagerInner>,
}

#[derive(Default)]
struct ApiScriptManagerInner {
    active: Mutex<Option<ActiveRun>>,
}

struct ActiveRun {
    run_id: String,
    _script_id: String,
    cancel_flag: Arc<AtomicBool>,
}

const CACHE_SUBDIR: &str = "api-script-runs";
const CSV_SPLIT_THRESHOLD: usize = 50_000;
const DEFAULT_DB_TIMEOUT_MS: i64 = 10_000;
const LOG_FILE_NAME: &str = "run.log";
const MANIFEST_FILE_NAME: &str = "manifest.json";
const ZIP_FILE_NAME: &str = "result.zip";
const BODY_TEMPLATE_PLACEHOLDER: &str = "{{batch}}";
const RESPONSE_EXCERPT_LIMIT: usize = 512;

impl ApiScriptManager {
    fn try_begin(&self, run_id: String, script_id: String) -> Result<Arc<AtomicBool>, String> {
        let mut guard = self
            .inner
            .active
            .lock()
            .map_err(|_| "manager_poisoned".to_string())?;
        if guard.is_some() {
            return Err("已有脚本任务正在执行，请稍后重试。".to_string());
        }
        let cancel_flag = Arc::new(AtomicBool::new(false));
        *guard = Some(ActiveRun {
            run_id,
            _script_id: script_id,
            cancel_flag: cancel_flag.clone(),
        });
        Ok(cancel_flag)
    }

    fn finish(&self, run_id: &str) {
        if let Ok(mut guard) = self.inner.active.lock() {
            if guard
                .as_ref()
                .map(|current| current.run_id == run_id)
                .unwrap_or(false)
            {
                *guard = None;
            }
        }
    }

    fn request_cancel(&self, run_id: &str) -> Result<(), String> {
        let guard = self
            .inner
            .active
            .lock()
            .map_err(|_| "manager_poisoned".to_string())?;
        if let Some(active) = guard.as_ref() {
            if active.run_id != run_id {
                return Err("指定的任务已不存在或正在执行其他脚本。".to_string());
            }
            active.cancel_flag.store(true, Ordering::SeqCst);
            return Ok(());
        }
        Err("当前没有正在执行的脚本任务。".to_string())
    }
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteApiScriptArgs {
    pub script_id: String,
    pub query_id: String,
    pub run_signature: String,
    pub executed_sql: String,
    pub params: Vec<Value>,
    pub executed_at: i64,
    #[allow(dead_code)]
    pub user_conn_id: String,
    pub connection_dsn: String,
    pub base_sql: String,
    pub base_params: Vec<Value>,
}

#[derive(Debug, Clone, Serialize)]
struct ScriptRunEvent {
    run_id: String,
    status: String,
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<Value>,
}

#[derive(Debug, Clone)]
struct ApiScriptRecord {
    id: String,
    query_id: String,
    name: String,
    method: String,
    endpoint: String,
    headers: Vec<ApiScriptHeader>,
    body_template: Option<String>,
    fetch_size: i64,
    send_batch_size: i64,
    sleep_ms: i64,
    request_timeout_ms: i64,
    error_policy: String,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
struct ApiScriptHeader {
    key: String,
    value: String,
    sensitive: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct RunSummary {
    total_batches: u32,
    processed_batches: u32,
    request_count: u32,
    success_rows: u64,
    error_rows: u64,
    total_rows: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct ManifestFiles {
    success_parts: Vec<String>,
    error_parts: Vec<String>,
    logs: Vec<String>,
    manifest: String,
}

#[derive(Debug, Deserialize, Default)]
struct ManifestFileSection {
    #[serde(default)]
    successParts: Vec<String>,
    #[serde(default)]
    errorParts: Vec<String>,
    #[serde(default)]
    logs: Vec<String>,
    #[serde(default)]
    manifest: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct ManifestDocument {
    #[serde(default)]
    files: ManifestFileSection,
}

#[derive(Debug, Default, Clone)]
struct RunProgress {
    total_batches: Option<u32>,
    processed_batches: Option<u32>,
    request_count: u32,
    success_rows: u64,
    error_rows: u64,
    processed_rows: u64,
    current_batch: Option<u32>,
}

struct RunCompletion {
    status: String,
    message: Option<String>,
    summary: RunSummary,
    output_dir: Option<String>,
    manifest_path: Option<String>,
    zip_path: Option<String>,
    started_at: i64,
    finished_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RequestLogEntry {
    timestamp: i64,
    fetch_index: u32,
    request_index: u32,
    request_size: usize,
    start_row: u64,
    end_row: u64,
    status: Option<u16>,
    duration_ms: u128,
    error: Option<String>,
    response_excerpt: Option<String>,
}

struct BatchOutcome {
    success_rows: u64,
    error_rows: u64,
    should_abort: bool,
    error_message: Option<String>,
    cancelled: bool,
}

struct RunLogger {
    writer: BufWriter<File>,
}

impl RunLogger {
    fn new(path: &Path) -> Result<Self, String> {
        let file = File::create(path).map_err(map_io_error)?;
        Ok(Self {
            writer: BufWriter::new(file),
        })
    }

    fn log(&mut self, entry: &RequestLogEntry) -> Result<(), String> {
        let line = serde_json::to_string(entry).map_err(map_json_error)?;
        self.writer
            .write_all(line.as_bytes())
            .and_then(|_| self.writer.write_all(b"\n"))
            .map_err(map_io_error)
    }

    fn finish(mut self) -> Result<(), String> {
        self.writer.flush().map_err(map_io_error)
    }
}

struct CsvPartWriter {
    dir: PathBuf,
    prefix: &'static str,
    threshold: usize,
    extra_headers: Vec<String>,
    current_rows: usize,
    filenames: Vec<String>,
    writer: Option<Writer<BufWriter<File>>>,
    total_rows: u64,
}

impl CsvPartWriter {
    fn new(dir: &Path, prefix: &'static str, threshold: usize, extra_headers: Vec<String>) -> Self {
        Self {
            dir: dir.to_path_buf(),
            prefix,
            threshold,
            extra_headers,
            current_rows: 0,
            filenames: Vec::new(),
            writer: None,
            total_rows: 0,
        }
    }

    fn start_writer(&mut self, headers: &[String]) -> Result<(), String> {
        let file_index = self.filenames.len();
        let filename = if file_index == 0 {
            format!("{}.csv", self.prefix)
        } else {
            format!("{}-part-{}.csv", self.prefix, file_index + 1)
        };
        let full_headers = self.merge_headers(headers);
        let file = File::create(self.dir.join(&filename)).map_err(map_io_error)?;
        let mut writer = Writer::from_writer(BufWriter::new(file));
        writer.write_record(full_headers).map_err(map_csv_error)?;
        self.writer = Some(writer);
        self.current_rows = 0;
        self.filenames.push(filename);
        Ok(())
    }

    fn merge_headers(&self, base: &[String]) -> Vec<String> {
        let mut headers = base.to_vec();
        headers.extend(self.extra_headers.clone());
        headers
    }

    fn close_current(&mut self) -> Result<(), String> {
        if let Some(mut writer) = self.writer.take() {
            writer.flush().map_err(map_csv_error)?;
        }
        self.current_rows = 0;
        Ok(())
    }

    fn write_row(
        &mut self,
        base_headers: &[String],
        row: &Value,
        extras: &[String],
    ) -> Result<(), String> {
        if self.writer.is_none() {
            self.start_writer(base_headers)?;
        }

        if self.threshold > 0 && self.current_rows >= self.threshold {
            self.close_current()?;
            self.start_writer(base_headers)?;
        }

        let mut record = build_csv_record(row, base_headers);
        record.extend(extras.iter().cloned());

        if let Some(writer) = self.writer.as_mut() {
            writer.write_record(record).map_err(map_csv_error)?;
        }
        self.current_rows += 1;
        self.total_rows += 1;
        Ok(())
    }

    fn finish(mut self) -> Result<(Vec<String>, u64), String> {
        if self.writer.is_some() {
            self.close_current()?;
        }
        Ok((self.filenames, self.total_rows))
    }
}

#[allow(dead_code)]
fn chunk_records(rows: Vec<Value>, chunk_size: usize) -> Vec<Vec<Value>> {
    assert!(chunk_size > 0, "chunk_size must be > 0");
    let mut result = Vec::new();
    let mut current = Vec::new();
    for row in rows.into_iter() {
        current.push(row);
        if current.len() == chunk_size {
            result.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        result.push(current);
    }
    result
}

fn value_to_csv_field(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(v) => v.to_string(),
        Value::Number(num) => num.to_string(),
        Value::String(text) => text.clone(),
        _ => value.to_string(),
    }
}

#[allow(dead_code)]
fn collect_csv_headers(rows: &[Value]) -> Vec<String> {
    use std::collections::BTreeSet;
    let mut set = BTreeSet::new();
    for row in rows {
        if let Value::Object(map) = row {
            for key in map.keys() {
                set.insert(key.clone());
            }
        }
    }
    set.into_iter().collect()
}

fn extract_headers_from_row(row: &Value) -> Vec<String> {
    if let Value::Object(map) = row {
        let mut keys: Vec<String> = map.keys().cloned().collect();
        keys.sort();
        keys
    } else {
        Vec::new()
    }
}

fn build_csv_record(row: &Value, headers: &[String]) -> Vec<String> {
    headers
        .iter()
        .map(|key| {
            if let Value::Object(map) = row {
                map.get(key).map(value_to_csv_field).unwrap_or_default()
            } else {
                String::new()
            }
        })
        .collect()
}

fn truncate_excerpt(text: &str, limit: usize) -> String {
    if text.len() <= limit {
        return text.to_string();
    }
    let mut truncated = text
        .chars()
        .take(limit.saturating_sub(3))
        .collect::<String>();
    truncated.push_str("...");
    truncated
}

fn saturating_i64(value: u64) -> i64 {
    if value > i64::MAX as u64 {
        i64::MAX
    } else {
        value as i64
    }
}

fn create_manifest(
    run_id: &str,
    snapshot: &Value,
    stats: &RunSummary,
    files: &ManifestFiles,
    started_at: i64,
    finished_at: i64,
) -> Value {
    json!({
        "runId": run_id,
        "scriptSnapshot": snapshot,
        "summary": {
            "totalBatches": stats.total_batches,
            "processedBatches": stats.processed_batches,
            "requestCount": stats.request_count,
            "successRows": stats.success_rows,
            "errorRows": stats.error_rows,
            "totalRows": stats.total_rows,
        },
        "files": {
            "successParts": files.success_parts,
            "errorParts": files.error_parts,
            "logs": files.logs,
            "manifest": files.manifest,
        },
        "startedAt": started_at,
        "finishedAt": finished_at,
        "generatedAt": now_ms(),
    })
}

fn read_manifest_files(path: &Path) -> Result<ManifestFiles, String> {
    let text = fs::read_to_string(path).map_err(map_io_error)?;
    let doc: ManifestDocument = serde_json::from_str(&text).map_err(map_json_error)?;
    let files = doc.files;
    let manifest_name = files
        .manifest
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| MANIFEST_FILE_NAME.to_string());
    Ok(ManifestFiles {
        success_parts: files.successParts,
        error_parts: files.errorParts,
        logs: files.logs,
        manifest: manifest_name,
    })
}

fn now_ms() -> i64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    (now.as_secs() as i64) * 1000 + (now.subsec_millis() as i64)
}

fn map_sql_error(err: impl std::fmt::Display) -> String {
    err.to_string()
}

fn map_io_error(err: impl std::fmt::Display) -> String {
    err.to_string()
}

fn map_json_error(err: impl std::fmt::Display) -> String {
    err.to_string()
}

fn map_csv_error(err: impl std::fmt::Display) -> String {
    err.to_string()
}

fn map_http_error(err: impl std::fmt::Display) -> String {
    err.to_string()
}

fn resolve_sqlite_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_config_dir().map_err(map_sql_error)?;
    Ok(base.join("rdv_local.db"))
}

async fn open_sqlite_pool(app: &AppHandle) -> Result<SqlitePool, String> {
    let db_path = resolve_sqlite_path(app)?;
    let conn_str = format!("sqlite://{}", db_path.to_string_lossy());
    let options = SqliteConnectOptions::from_str(&conn_str)
        .map_err(map_sql_error)?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true);
    SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .map_err(map_sql_error)
}

fn validate_connection_dsn(dsn: &str) -> Result<(), String> {
    let trimmed = dsn.trim();
    if trimmed.is_empty() {
        return Err("connection_dsn_empty".to_string());
    }
    let lowered = trimmed.to_ascii_lowercase();
    if lowered.starts_with("postgres://") || lowered.starts_with("postgresql://") {
        return Ok(());
    }
    Err("仅支持 PostgreSQL 连接串 (postgres:// 或 postgresql://)".to_string())
}

async fn fetch_script_record(
    pool: &SqlitePool,
    script_id: &str,
) -> Result<ApiScriptRecord, String> {
    let row = sqlx::query(
        "SELECT id, query_id, name, method, endpoint, headers, body_template, fetch_size, send_batch_size, sleep_ms, request_timeout_ms, error_policy, updated_at FROM query_api_scripts WHERE id = ? LIMIT 1",
    )
    .bind(script_id)
    .fetch_optional(pool)
    .await
    .map_err(map_sql_error)?
    .ok_or_else(|| "script_not_found".to_string())?;

    let headers_raw: Option<String> = row.try_get("headers").map_err(map_sql_error)?;
    Ok(ApiScriptRecord {
        id: row.try_get::<String, _>("id").map_err(map_sql_error)?,
        query_id: row
            .try_get::<String, _>("query_id")
            .map_err(map_sql_error)?,
        name: row.try_get::<String, _>("name").map_err(map_sql_error)?,
        method: row.try_get::<String, _>("method").map_err(map_sql_error)?,
        endpoint: row
            .try_get::<String, _>("endpoint")
            .map_err(map_sql_error)?,
        headers: parse_headers(headers_raw),
        body_template: row
            .try_get::<Option<String>, _>("body_template")
            .map_err(map_sql_error)?,
        fetch_size: row.try_get::<i64, _>("fetch_size").map_err(map_sql_error)?,
        send_batch_size: row
            .try_get::<i64, _>("send_batch_size")
            .map_err(map_sql_error)?,
        sleep_ms: row.try_get::<i64, _>("sleep_ms").map_err(map_sql_error)?,
        request_timeout_ms: row
            .try_get::<i64, _>("request_timeout_ms")
            .map_err(map_sql_error)?,
        error_policy: row
            .try_get::<String, _>("error_policy")
            .map_err(map_sql_error)?,
        updated_at: row.try_get::<i64, _>("updated_at").map_err(map_sql_error)?,
    })
}

struct RunStoragePaths {
    output_dir: Option<String>,
    manifest_path: Option<String>,
    zip_path: Option<String>,
}

async fn fetch_run_storage(
    pool: &SqlitePool,
    run_id: &str,
) -> Result<Option<RunStoragePaths>, String> {
    let row = sqlx::query(
        "SELECT output_dir, manifest_path, zip_path, finished_at, updated_at FROM query_api_script_runs WHERE id = ? LIMIT 1",
    )
    .bind(run_id)
    .fetch_optional(pool)
    .await
    .map_err(map_sql_error)?;

    if let Some(row) = row {
        Ok(Some(RunStoragePaths {
            output_dir: row
                .try_get::<Option<String>, _>("output_dir")
                .map_err(map_sql_error)?,
            manifest_path: row
                .try_get::<Option<String>, _>("manifest_path")
                .map_err(map_sql_error)?,
            zip_path: row
                .try_get::<Option<String>, _>("zip_path")
                .map_err(map_sql_error)?,
        }))
    } else {
        Ok(None)
    }
}

async fn open_pg_pool(dsn: &str) -> Result<PgPool, String> {
    PgPoolOptions::new()
        .max_connections(1)
        .min_connections(0)
        .acquire_timeout(Duration::from_secs(10))
        .idle_timeout(Duration::from_secs(30))
        .connect(dsn)
        .await
        .map_err(map_sql_error)
}

fn parse_headers(raw: Option<String>) -> Vec<ApiScriptHeader> {
    let mut headers: Vec<ApiScriptHeader> = Vec::new();
    if let Some(text) = raw {
        if let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&text) {
            for item in items {
                if let Some(obj) = item.as_object() {
                    if let Some(key) = obj.get("key").and_then(Value::as_str) {
                        let value = obj
                            .get("value")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        let sensitive = obj
                            .get("sensitive")
                            .and_then(Value::as_bool)
                            .unwrap_or(false);
                        headers.push(ApiScriptHeader {
                            key: key.to_string(),
                            value,
                            sensitive,
                        });
                    }
                }
            }
        }
    }
    headers
}

fn strip_trailing_semicolons(sql: &str) -> String {
    let mut trimmed = sql.trim();
    while trimmed.ends_with(';') {
        trimmed = trimmed.trim_end_matches(';').trim_end();
    }
    trimmed.to_string()
}

fn build_count_sql(base_sql: &str) -> Result<String, String> {
    let cleaned = strip_trailing_semicolons(base_sql);
    if cleaned.is_empty() {
        return Err("base_sql_empty".to_string());
    }
    Ok(format!(
        "SELECT COUNT(*)::bigint FROM ({}) __rdv_source__",
        cleaned
    ))
}

fn build_fetch_sql(base_sql: &str) -> Result<String, String> {
    let cleaned = strip_trailing_semicolons(base_sql);
    if cleaned.is_empty() {
        return Err("base_sql_empty".to_string());
    }
    Ok(format!(
        "SELECT row_to_json(__rdv_source__) AS row_json FROM ({}) __rdv_source__",
        cleaned
    ))
}

fn build_pg_arguments(params: &[Value]) -> Result<PgArguments, String> {
    let mut arguments = PgArguments::default();
    for param in params {
        match param {
            Value::Null => arguments
                .add(Option::<serde_json::Value>::None)
                .map_err(|err| err.to_string())?,
            Value::Bool(value) => arguments.add(*value).map_err(|err| err.to_string())?,
            Value::Number(num) => {
                if let Some(v) = num.as_i64() {
                    arguments.add(v).map_err(|err| err.to_string())?;
                } else if let Some(v) = num.as_u64() {
                    if v <= i64::MAX as u64 {
                        arguments.add(v as i64).map_err(|err| err.to_string())?;
                    } else {
                        arguments.add(v as f64).map_err(|err| err.to_string())?;
                    }
                } else if let Some(v) = num.as_f64() {
                    arguments.add(v).map_err(|err| err.to_string())?;
                } else {
                    return Err("unsupported_numeric_param".to_string());
                }
            }
            Value::String(text) => arguments.add(text.clone()).map_err(|err| err.to_string())?,
            Value::Array(_) | Value::Object(_) => arguments
                .add(param.clone())
                .map_err(|err| err.to_string())?,
        }
    }
    Ok(arguments)
}

fn render_body_template(template: &str, batch_json: &str) -> Result<String, String> {
    if template.trim().is_empty() {
        return Ok(batch_json.to_string());
    }
    let replaced = if template.contains(BODY_TEMPLATE_PLACEHOLDER) {
        template.replace(BODY_TEMPLATE_PLACEHOLDER, batch_json)
    } else {
        template.to_string()
    };
    let parsed: Value = serde_json::from_str(&replaced)
        .map_err(|err| format!("body_template_invalid_json: {}", err))?;
    serde_json::to_string(&parsed).map_err(map_json_error)
}

fn create_zip_archive(run_dir: &Path, files: &ManifestFiles) -> Result<PathBuf, String> {
    let zip_path = run_dir.join(ZIP_FILE_NAME);
    let file = File::create(&zip_path).map_err(map_io_error)?;
    let mut writer = zip::ZipWriter::new(file);
    let options = FileOptions::default().compression_method(CompressionMethod::Deflated);

    let mut add_file = |name: &str| -> Result<(), String> {
        let path = run_dir.join(name);
        if !path.exists() {
            return Ok(());
        }
        let mut source = File::open(&path).map_err(map_io_error)?;
        writer.start_file(name, options).map_err(map_io_error)?;
        std::io::copy(&mut source, &mut writer).map_err(map_io_error)?;
        Ok(())
    };

    for name in files
        .success_parts
        .iter()
        .chain(files.error_parts.iter())
        .chain(files.logs.iter())
    {
        add_file(name)?;
    }
    let manifest_name = if files.manifest.is_empty() {
        MANIFEST_FILE_NAME
    } else {
        files.manifest.as_str()
    };
    add_file(manifest_name)?;

    writer.finish().map_err(map_io_error)?;
    Ok(zip_path)
}

async fn process_batch(
    client: &Client,
    method: &Method,
    endpoint: &str,
    headers: &HeaderMap,
    has_content_type: bool,
    include_body: bool,
    body_template: Option<&str>,
    batch_rows: &[Value],
    base_headers: &[String],
    send_batch_size: usize,
    error_policy_continue: bool,
    sleep_interval: u64,
    cancel_flag: &Arc<AtomicBool>,
    fetch_index: u32,
    processed_rows_before: u64,
    request_counter: &mut u32,
    success_writer: &mut CsvPartWriter,
    error_writer: &mut CsvPartWriter,
    logger: &mut RunLogger,
) -> Result<BatchOutcome, String> {
    let mut success_rows = 0u64;
    let mut error_rows = 0u64;
    let mut abort_message: Option<String> = None;
    let mut cancelled = false;

    if cancel_flag.load(Ordering::SeqCst) {
        return Ok(BatchOutcome {
            success_rows,
            error_rows,
            should_abort: false,
            error_message: None,
            cancelled: true,
        });
    }

    for (chunk_idx, chunk) in batch_rows.chunks(send_batch_size).enumerate() {
        if cancel_flag.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }
        let chunk_vec: Vec<Value> = chunk.iter().cloned().collect();
        let body_json = Value::Array(chunk_vec.clone());
        let body_json_text = serde_json::to_string(&body_json).map_err(map_json_error)?;
        let final_body = if include_body {
            if let Some(template) = body_template {
                render_body_template(template, &body_json_text)?
            } else {
                body_json_text
            }
        } else {
            String::new()
        };

        let mut request = client.request(method.clone(), endpoint);
        for (key, value) in headers.iter() {
            request = request.header(key, value);
        }
        if include_body {
            if !has_content_type {
                request =
                    request.header(CONTENT_TYPE, HeaderValue::from_static("application/json"));
            }
            request = request.body(final_body.clone());
        }

        let request_index = *request_counter;
        *request_counter += 1;

        let start_time = Instant::now();
        let response_result = request.send().await;
        let duration = start_time.elapsed();

        let mut status_code: Option<u16> = None;
        let mut error_message: Option<String> = None;
        let mut response_excerpt: Option<String> = None;
        let mut is_success = false;

        match response_result {
            Ok(response) => {
                let status = response.status();
                status_code = Some(status.as_u16());
                if status.is_success() {
                    is_success = true;
                } else {
                    let text = response.text().await.unwrap_or_else(|_| String::new());
                    response_excerpt = if text.is_empty() {
                        None
                    } else {
                        Some(truncate_excerpt(&text, RESPONSE_EXCERPT_LIMIT))
                    };
                    error_message = Some(format!("HTTP {}", status.as_u16()));
                }
            }
            Err(err) => {
                error_message = Some(err.to_string());
            }
        }

        let chunk_offset = send_batch_size * chunk_idx;
        let start_row = processed_rows_before + chunk_offset as u64 + 1;
        let end_row = start_row + chunk.len() as u64 - 1;

        let log_entry = RequestLogEntry {
            timestamp: now_ms(),
            fetch_index,
            request_index,
            request_size: chunk.len(),
            start_row,
            end_row,
            status: status_code,
            duration_ms: duration.as_millis(),
            error: error_message.clone(),
            response_excerpt: response_excerpt.clone(),
        };
        logger.log(&log_entry)?;

        if is_success {
            for row in chunk {
                success_writer.write_row(base_headers, row, &[])?;
            }
            success_rows += chunk.len() as u64;
        } else {
            let status_text = status_code
                .map(|code| code.to_string())
                .unwrap_or_else(|| "".to_string());
            let base_error = error_message
                .clone()
                .unwrap_or_else(|| "request_failed".to_string());
            let csv_error = if let Some(excerpt) = response_excerpt {
                format!("{} | {}", base_error, excerpt)
            } else {
                base_error
            };
            for row in chunk {
                error_writer.write_row(
                    base_headers,
                    row,
                    &[csv_error.clone(), status_text.clone()],
                )?;
            }
            error_rows += chunk.len() as u64;
            if !error_policy_continue {
                abort_message = error_message;
                break;
            }
        }

        if sleep_interval > 0 {
            sleep(Duration::from_millis(sleep_interval)).await;
        }
        if cancel_flag.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }
    }

    Ok(BatchOutcome {
        success_rows,
        error_rows,
        should_abort: abort_message.is_some(),
        error_message: abort_message,
        cancelled,
    })
}

fn build_script_snapshot(script: &ApiScriptRecord, args: &ExecuteApiScriptArgs) -> Value {
    let headers_snapshot: Vec<Value> = script
        .headers
        .iter()
        .map(|header| {
            let masked = if header.sensitive {
                "***".to_string()
            } else {
                header.value.clone()
            };
            json!({
                "key": header.key,
                "value": masked,
                "sensitive": header.sensitive,
            })
        })
        .collect();
    json!({
        "script": {
            "id": script.id,
            "queryId": script.query_id,
            "name": script.name,
            "method": script.method,
            "endpoint": script.endpoint,
            "headers": headers_snapshot,
            "bodyTemplate": script.body_template,
            "fetchSize": script.fetch_size,
            "sendBatchSize": script.send_batch_size,
            "sleepMs": script.sleep_ms,
            "requestTimeoutMs": script.request_timeout_ms,
            "errorPolicy": script.error_policy,
            "updatedAt": script.updated_at,
        },
        "execution": {
            "runSignature": args.run_signature,
            "baseSql": args.base_sql,
            "baseParams": args.base_params,
            "executedSql": args.executed_sql,
            "executedParams": args.params,
            "executedAt": args.executed_at,
        }
    })
}

fn resolve_run_directory(app: &AppHandle, run_id: &str) -> Result<PathBuf, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(map_io_error)?
        .join(CACHE_SUBDIR)
        .join(run_id);
    fs::create_dir_all(&cache_dir).map_err(map_io_error)?;
    Ok(cache_dir)
}

fn cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(map_io_error)?
        .join(CACHE_SUBDIR))
}

fn ensure_path_within(base: &Path, candidate: &Path) -> Result<(), String> {
    if candidate.starts_with(base) {
        Ok(())
    } else {
        Err("缓存路径无效".to_string())
    }
}

async fn perform_api_script_run(
    app: &AppHandle,
    sqlite_pool: &SqlitePool,
    args: &ExecuteApiScriptArgs,
    script: &ApiScriptRecord,
    run_id: &str,
    cancel_flag: Arc<AtomicBool>,
) -> Result<RunCompletion, String> {
    let started_at = now_ms();
    let run_dir = resolve_run_directory(app, run_id)?;
    let log_path = run_dir.join(LOG_FILE_NAME);
    let mut logger = RunLogger::new(&log_path)?;

    let mut success_writer =
        CsvPartWriter::new(&run_dir, "success", CSV_SPLIT_THRESHOLD, Vec::new());
    let mut error_writer = CsvPartWriter::new(
        &run_dir,
        "errors",
        CSV_SPLIT_THRESHOLD,
        vec!["__error_message".to_string(), "__status_code".to_string()],
    );

    let method = Method::from_bytes(script.method.as_bytes())
        .map_err(|_| "unsupported_http_method".to_string())?;
    let headers_map = build_header_map(&script.headers)?;
    let has_content_type = headers_map.contains_key(CONTENT_TYPE);
    let include_body = method != Method::GET;
    let client_timeout = script.request_timeout_ms.max(1) as u64;
    let client = Client::builder()
        .timeout(Duration::from_millis(client_timeout))
        .build()
        .map_err(map_http_error)?;

    let mut summary = RunSummary::default();

    let fetch_size = script.fetch_size.max(1) as usize;
    let send_batch_size = script.send_batch_size.max(1) as usize;
    let sleep_interval = script.sleep_ms.max(0) as u64;
    let error_policy_continue = script.error_policy == "continue";

    let pg_pool = open_pg_pool(&args.connection_dsn).await?;
    let mut conn = pg_pool.acquire().await.map_err(map_sql_error)?;
    sqlx::query("BEGIN READ ONLY")
        .execute(&mut *conn)
        .await
        .map_err(map_sql_error)?;
    sqlx::query(&format!(
        "SET LOCAL statement_timeout = {}",
        DEFAULT_DB_TIMEOUT_MS
    ))
    .execute(&mut *conn)
    .await
    .map_err(map_sql_error)?;
    sqlx::query(&format!(
        "SET LOCAL idle_in_transaction_session_timeout = {}",
        DEFAULT_DB_TIMEOUT_MS
    ))
    .execute(&mut *conn)
    .await
    .map_err(map_sql_error)?;
    sqlx::query("SET LOCAL search_path = pg_catalog, \"$user\"")
        .execute(&mut *conn)
        .await
        .map_err(map_sql_error)?;

    let count_sql = build_count_sql(&args.base_sql)?;
    let total_rows_value: i64 =
        sqlx::query_scalar_with(&count_sql, build_pg_arguments(&args.base_params)?)
            .fetch_one(&mut *conn)
            .await
            .map_err(map_sql_error)?;
    let total_rows = if total_rows_value < 0 {
        0
    } else {
        total_rows_value as u64
    };
    summary.total_rows = total_rows;
    summary.total_batches = if total_rows == 0 {
        0
    } else {
        ((total_rows - 1) / fetch_size as u64 + 1) as u32
    };

    let mut progress = RunProgress::default();
    progress.total_batches = Some(summary.total_batches);
    update_run_progress_state(app, sqlite_pool, run_id, &progress).await?;

    let fetch_sql = build_fetch_sql(&args.base_sql)?;
    let mut stream =
        sqlx::query_with(&fetch_sql, build_pg_arguments(&args.base_params)?).fetch(&mut *conn);

    let mut base_headers: Vec<String> = Vec::new();
    let mut buffer: Vec<Value> = Vec::with_capacity(fetch_size);
    let mut processed_rows: u64 = 0;
    let mut fetch_index: u32 = 0;
    let mut request_counter: u32 = 0;
    let mut cancelled = false;

    while let Some(row) = stream.try_next().await.map_err(map_sql_error)? {
        if cancel_flag.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }
        let value: Value = row.try_get("row_json").map_err(map_sql_error)?;
        if base_headers.is_empty() {
            base_headers = extract_headers_from_row(&value);
        }
        buffer.push(value);
        if buffer.len() == fetch_size {
            let outcome = process_batch(
                &client,
                &method,
                &script.endpoint,
                &headers_map,
                has_content_type,
                include_body,
                script.body_template.as_deref(),
                &buffer,
                &base_headers,
                send_batch_size,
                error_policy_continue,
                sleep_interval,
                &cancel_flag,
                fetch_index,
                processed_rows,
                &mut request_counter,
                &mut success_writer,
                &mut error_writer,
                &mut logger,
            )
            .await?;
            processed_rows += buffer.len() as u64;
            summary.processed_batches += 1;
            summary.request_count = request_counter;
            summary.success_rows += outcome.success_rows;
            summary.error_rows += outcome.error_rows;
            buffer.clear();

            progress.processed_batches = Some(summary.processed_batches);
            progress.request_count = summary.request_count;
            progress.success_rows = summary.success_rows;
            progress.error_rows = summary.error_rows;
            progress.processed_rows = processed_rows;
            progress.current_batch = Some(fetch_index + 1);
            update_run_progress_state(app, sqlite_pool, run_id, &progress).await?;

            if outcome.should_abort {
                drop(stream);
                sqlx::query("ROLLBACK")
                    .execute(&mut *conn)
                    .await
                    .map_err(map_sql_error)?;
                logger.finish()?;
                let _ = success_writer.finish()?;
                let _ = error_writer.finish()?;
                let completion = RunCompletion {
                    status: "failed".to_string(),
                    message: outcome.error_message,
                    summary,
                    output_dir: Some(run_dir.to_string_lossy().into_owned()),
                    manifest_path: None,
                    zip_path: None,
                    started_at,
                    finished_at: now_ms(),
                };
                return Ok(completion);
            }

            if outcome.cancelled {
                cancelled = true;
                break;
            }

            fetch_index += 1;
        }
    }

    if !cancelled && !buffer.is_empty() {
        let outcome = process_batch(
            &client,
            &method,
            &script.endpoint,
            &headers_map,
            has_content_type,
            include_body,
            script.body_template.as_deref(),
            &buffer,
            &base_headers,
            send_batch_size,
            error_policy_continue,
            sleep_interval,
            &cancel_flag,
            fetch_index,
            processed_rows,
            &mut request_counter,
            &mut success_writer,
            &mut error_writer,
            &mut logger,
        )
        .await?;
        processed_rows += buffer.len() as u64;
        summary.processed_batches += 1;
        summary.request_count = request_counter;
        summary.success_rows += outcome.success_rows;
        summary.error_rows += outcome.error_rows;
        buffer.clear();

        progress.processed_batches = Some(summary.processed_batches);
        progress.request_count = summary.request_count;
        progress.success_rows = summary.success_rows;
        progress.error_rows = summary.error_rows;
        progress.processed_rows = processed_rows;
        progress.current_batch = Some(fetch_index + 1);
        update_run_progress_state(app, sqlite_pool, run_id, &progress).await?;

        if outcome.should_abort {
            drop(stream);
            sqlx::query("ROLLBACK")
                .execute(&mut *conn)
                .await
                .map_err(map_sql_error)?;
            logger.finish()?;
            let _ = success_writer.finish()?;
            let _ = error_writer.finish()?;
            let completion = RunCompletion {
                status: "failed".to_string(),
                message: outcome.error_message,
                summary,
                output_dir: Some(run_dir.to_string_lossy().into_owned()),
                manifest_path: None,
                zip_path: None,
                started_at,
                finished_at: now_ms(),
            };
            return Ok(completion);
        }

        if outcome.cancelled {
            cancelled = true;
        }
    }

    if cancelled || cancel_flag.load(Ordering::SeqCst) {
        drop(stream);
        sqlx::query("ROLLBACK")
            .execute(&mut *conn)
            .await
            .map_err(map_sql_error)?;
        logger.finish()?;
        let (success_files, _) = success_writer.finish()?;
        let (error_files, _) = error_writer.finish()?;
        let files = ManifestFiles {
            success_parts: success_files,
            error_parts: error_files,
            logs: vec![LOG_FILE_NAME.to_string()],
            manifest: MANIFEST_FILE_NAME.to_string(),
        };

        let snapshot = build_script_snapshot(script, args);
        let finished_at = now_ms();
        let manifest_value =
            create_manifest(run_id, &snapshot, &summary, &files, started_at, finished_at);
        let manifest_path = run_dir.join(MANIFEST_FILE_NAME);
        fs::write(
            &manifest_path,
            serde_json::to_string_pretty(&manifest_value).map_err(map_json_error)?,
        )
        .map_err(map_io_error)?;

        let zip_path = create_zip_archive(&run_dir, &files)?;
        let completion = RunCompletion {
            status: "cancelled".to_string(),
            message: Some("任务已取消".to_string()),
            summary,
            output_dir: Some(run_dir.to_string_lossy().into_owned()),
            manifest_path: Some(manifest_path.to_string_lossy().into_owned()),
            zip_path: Some(zip_path.to_string_lossy().into_owned()),
            started_at,
            finished_at,
        };
        return Ok(completion);
    }

    drop(stream);

    sqlx::query("COMMIT")
        .execute(&mut *conn)
        .await
        .map_err(map_sql_error)?;

    let finished_at = now_ms();
    logger.finish()?;
    let (success_files, _) = success_writer.finish()?;
    let (error_files, _) = error_writer.finish()?;
    let files = ManifestFiles {
        success_parts: success_files,
        error_parts: error_files,
        logs: vec![LOG_FILE_NAME.to_string()],
        manifest: MANIFEST_FILE_NAME.to_string(),
    };

    let snapshot = build_script_snapshot(script, args);
    let manifest_value =
        create_manifest(run_id, &snapshot, &summary, &files, started_at, finished_at);
    let manifest_path = run_dir.join(MANIFEST_FILE_NAME);
    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest_value).map_err(map_json_error)?,
    )
    .map_err(map_io_error)?;

    let zip_path = create_zip_archive(&run_dir, &files)?;
    let completion_message = if summary.error_rows > 0 {
        Some(format!("{} rows failed", summary.error_rows))
    } else {
        None
    };

    let completion = RunCompletion {
        status: if summary.error_rows > 0 {
            "completed_with_errors".to_string()
        } else {
            "succeeded".to_string()
        },
        message: completion_message,
        summary,
        output_dir: Some(run_dir.to_string_lossy().into_owned()),
        manifest_path: Some(manifest_path.to_string_lossy().into_owned()),
        zip_path: Some(zip_path.to_string_lossy().into_owned()),
        started_at,
        finished_at,
    };

    Ok(completion)
}

fn build_header_map(headers: &[ApiScriptHeader]) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    for header in headers {
        let key = header.key.trim();
        if key.is_empty() {
            continue;
        }
        let name = HeaderName::from_bytes(key.as_bytes())
            .map_err(|err| format!("invalid_header_name: {}", err))?;
        let value = HeaderValue::from_str(header.value.trim())
            .map_err(|err| format!("invalid_header_value: {}", err))?;
        map.insert(name, value);
    }
    Ok(map)
}

async fn insert_run_record(
    pool: &SqlitePool,
    run_id: &str,
    args: &ExecuteApiScriptArgs,
    script: &ApiScriptRecord,
) -> Result<(), String> {
    let snapshot = build_script_snapshot(script, args);
    let now = now_ms();
    let snapshot_text = snapshot.to_string();
    let progress_text = json!({}).to_string();
    sqlx::query(
        "INSERT INTO query_api_script_runs (id, script_id, query_id, status, script_snapshot, progress_snapshot, error_message, output_dir, manifest_path, zip_path, total_batches, processed_batches, success_rows, error_rows, started_at, finished_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)",
    )
    .bind(run_id)
    .bind(&args.script_id)
    .bind(&args.query_id)
    .bind("pending")
    .bind(snapshot_text)
    .bind(progress_text)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await
    .map_err(map_sql_error)?;
    Ok(())
}

async fn mark_run_started(pool: &SqlitePool, run_id: &str) -> Result<(), String> {
    let now = now_ms();
    sqlx::query(
        "UPDATE query_api_script_runs SET status = ?, started_at = ?, updated_at = ? WHERE id = ?",
    )
    .bind("running")
    .bind(now)
    .bind(now)
    .bind(run_id)
    .execute(pool)
    .await
    .map_err(map_sql_error)?;
    Ok(())
}

async fn mark_run_finished(
    pool: &SqlitePool,
    run_id: &str,
    completion: &RunCompletion,
) -> Result<(), String> {
    let now = now_ms();
    let progress_snapshot = build_final_progress(&completion.summary);
    sqlx::query(
        "UPDATE query_api_script_runs SET status = ?, error_message = ?, finished_at = ?, output_dir = ?, manifest_path = ?, zip_path = ?, total_batches = ?, processed_batches = ?, success_rows = ?, error_rows = ?, progress_snapshot = ?, started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?",
    )
    .bind(&completion.status)
    .bind(completion.message.as_deref())
    .bind(completion.finished_at)
    .bind(completion.output_dir.as_deref())
    .bind(completion.manifest_path.as_deref())
    .bind(completion.zip_path.as_deref())
    .bind(completion.summary.total_batches as i64)
    .bind(completion.summary.processed_batches as i64)
    .bind(saturating_i64(completion.summary.success_rows))
    .bind(saturating_i64(completion.summary.error_rows))
    .bind(progress_snapshot.to_string())
    .bind(completion.started_at)
    .bind(now)
    .bind(run_id)
    .execute(pool)
    .await
    .map_err(map_sql_error)?;
    Ok(())
}

async fn emit_event(app: &AppHandle, payload: ScriptRunEvent) {
    let _ = app.emit("rdv://api-script/run-updated", payload);
}

fn compose_progress_value(progress: &RunProgress) -> Value {
    json!({
        "totalBatches": progress.total_batches,
        "processedBatches": progress.processed_batches,
        "requestCount": progress.request_count,
        "successRows": progress.success_rows,
        "errorRows": progress.error_rows,
        "processedRows": progress.processed_rows,
        "currentBatch": progress.current_batch,
    })
}

async fn update_run_progress_state(
    app: &AppHandle,
    pool: &SqlitePool,
    run_id: &str,
    progress: &RunProgress,
) -> Result<(), String> {
    let snapshot = compose_progress_value(progress);
    let now = now_ms();
    sqlx::query(
        "UPDATE query_api_script_runs SET progress_snapshot = ?, total_batches = ?, processed_batches = ?, success_rows = ?, error_rows = ?, updated_at = ? WHERE id = ?",
    )
    .bind(snapshot.to_string())
    .bind(progress.total_batches.map(|v| v as i64))
    .bind(progress.processed_batches.map(|v| v as i64))
    .bind(saturating_i64(progress.success_rows))
    .bind(saturating_i64(progress.error_rows))
    .bind(now)
    .bind(run_id)
    .execute(pool)
    .await
    .map_err(map_sql_error)?;

    let event = ScriptRunEvent {
        run_id: run_id.to_string(),
        status: "running".to_string(),
        message: None,
        progress: Some(snapshot),
    };
    emit_event(app, event).await;
    Ok(())
}

fn build_final_progress(summary: &RunSummary) -> Value {
    json!({
        "totalBatches": summary.total_batches,
        "processedBatches": summary.processed_batches,
        "requestCount": summary.request_count,
        "successRows": summary.success_rows,
        "errorRows": summary.error_rows,
        "processedRows": summary.success_rows + summary.error_rows,
        "totalRows": summary.total_rows,
    })
}

async fn spawn_run_task(
    app: AppHandle,
    manager: ApiScriptManager,
    pool: SqlitePool,
    args: ExecuteApiScriptArgs,
    script: ApiScriptRecord,
    run_id: String,
    cancel_flag: Arc<AtomicBool>,
) {
    let initial_event = ScriptRunEvent {
        run_id: run_id.clone(),
        status: "pending".to_string(),
        message: None,
        progress: None,
    };
    emit_event(&app, initial_event).await;

    let result = async {
        mark_run_started(&pool, &run_id).await?;
        let start_event = ScriptRunEvent {
            run_id: run_id.clone(),
            status: "running".to_string(),
            message: None,
            progress: None,
        };
        emit_event(&app, start_event).await;

        let completion =
            perform_api_script_run(&app, &pool, &args, &script, &run_id, cancel_flag.clone())
                .await?;
        Ok::<RunCompletion, String>(completion)
    }
    .await;

    let completion = match result {
        Ok(completion) => {
            let _ = mark_run_finished(&pool, &run_id, &completion).await;
            completion
        }
        Err(err) => {
            let failure = RunCompletion {
                status: "failed".to_string(),
                message: Some(err.clone()),
                summary: RunSummary::default(),
                output_dir: None,
                manifest_path: None,
                zip_path: None,
                started_at: now_ms(),
                finished_at: now_ms(),
            };
            let _ = mark_run_finished(&pool, &run_id, &failure).await;
            failure
        }
    };

    let event = ScriptRunEvent {
        run_id: run_id.clone(),
        status: completion.status.clone(),
        message: completion.message.clone(),
        progress: Some(build_final_progress(&completion.summary)),
    };
    emit_event(&app, event).await;
    manager.finish(&run_id);
}

#[tauri::command]
pub async fn ensure_api_script_run_zip(app: AppHandle, run_id: String) -> Result<String, String> {
    if run_id.trim().is_empty() {
        return Err("run_id_required".to_string());
    }

    let sqlite_pool = open_sqlite_pool(&app).await?;
    let storage = fetch_run_storage(&sqlite_pool, &run_id)
        .await?
        .ok_or_else(|| "run_not_found".to_string())?;

    let cache_root = cache_root(&app)?;

    if let Some(zip_text) = storage.zip_path.as_ref() {
        let zip_path = PathBuf::from(zip_text);
        if ensure_path_within(&cache_root, &zip_path).is_ok() && zip_path.exists() {
            return Ok(zip_text.clone());
        }
    }

    let output_dir_text = storage
        .output_dir
        .ok_or_else(|| "output_dir_not_available".to_string())?;
    let manifest_path_text = storage
        .manifest_path
        .ok_or_else(|| "manifest_not_available".to_string())?;

    let output_dir = PathBuf::from(&output_dir_text);
    ensure_path_within(&cache_root, &output_dir)?;
    if !output_dir.exists() {
        return Err("output_dir_missing".to_string());
    }

    let manifest_path = PathBuf::from(&manifest_path_text);
    ensure_path_within(&cache_root, &manifest_path)?;
    if !manifest_path.exists() {
        return Err("manifest_file_missing".to_string());
    }

    let mut files = read_manifest_files(&manifest_path)?;
    if files.manifest.is_empty() {
        files.manifest = manifest_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| MANIFEST_FILE_NAME.to_string());
    }

    let zip_path = create_zip_archive(&output_dir, &files)?;
    let zip_text = zip_path.to_string_lossy().into_owned();

    sqlx::query("UPDATE query_api_script_runs SET zip_path = ?, updated_at = ? WHERE id = ?")
        .bind(&zip_text)
        .bind(now_ms())
        .bind(&run_id)
        .execute(&sqlite_pool)
        .await
        .map_err(map_sql_error)?;

    Ok(zip_text)
}

#[tauri::command]
pub async fn export_api_script_run_zip(
    app: AppHandle,
    run_id: String,
    destination: String,
) -> Result<(), String> {
    if destination.trim().is_empty() {
        return Err("目标路径不能为空".to_string());
    }

    let sqlite_pool = open_sqlite_pool(&app).await?;
    let storage = fetch_run_storage(&sqlite_pool, &run_id)
        .await?
        .ok_or_else(|| "run_not_found".to_string())?;

    let zip_path_text = storage
        .zip_path
        .ok_or_else(|| "zip_not_available".to_string())?;
    let zip_path = PathBuf::from(&zip_path_text);
    if !zip_path.exists() {
        return Err("zip_file_missing".to_string());
    }

    let cache_root = cache_root(&app)?;
    ensure_path_within(&cache_root, &zip_path)?;

    let destination_path = PathBuf::from(&destination);
    if let Some(parent) = destination_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(map_io_error)?;
        }
    }

    fs::copy(&zip_path, &destination_path).map_err(map_io_error)?;
    Ok(())
}

#[tauri::command]
pub async fn cancel_api_script_run(
    app: AppHandle,
    manager: State<'_, ApiScriptManager>,
    run_id: String,
) -> Result<(), String> {
    manager.request_cancel(&run_id)?;
    let event = ScriptRunEvent {
        run_id: run_id.clone(),
        status: "running".to_string(),
        message: Some("已提交取消请求".to_string()),
        progress: None,
    };
    emit_event(&app, event).await;
    Ok(())
}

#[tauri::command]
pub async fn read_api_script_run_log(
    app: AppHandle,
    run_id: String,
    limit: Option<usize>,
) -> Result<Vec<RequestLogEntry>, String> {
    let sqlite_pool = open_sqlite_pool(&app).await?;
    let storage = fetch_run_storage(&sqlite_pool, &run_id)
        .await?
        .ok_or_else(|| "run_not_found".to_string())?;

    let output_dir = storage
        .output_dir
        .ok_or_else(|| "log_not_available".to_string())?;
    let log_path = PathBuf::from(output_dir).join(LOG_FILE_NAME);
    if !log_path.exists() {
        return Err("log_file_missing".to_string());
    }

    let cache_root = cache_root(&app)?;
    ensure_path_within(&cache_root, &log_path)?;

    let log_text = tokio_fs::read_to_string(&log_path)
        .await
        .map_err(map_io_error)?;
    let mut records: Vec<RequestLogEntry> = Vec::new();
    for line in log_text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<RequestLogEntry>(trimmed) {
            Ok(entry) => records.push(entry),
            Err(_) => continue,
        }
    }

    let keep = limit.unwrap_or(500);
    if records.len() > keep {
        records = records.into_iter().rev().take(keep).collect::<Vec<_>>();
        records.reverse();
    }

    Ok(records)
}

#[tauri::command]
pub async fn cleanup_api_script_cache(
    app: AppHandle,
    older_than_ms: Option<i64>,
) -> Result<u32, String> {
    let threshold = older_than_ms.unwrap_or(86_400_000).max(0);
    let cutoff = now_ms() - threshold;
    let sqlite_pool = open_sqlite_pool(&app).await?;
    let rows = sqlx::query(
        "SELECT id, output_dir, manifest_path, zip_path, finished_at, updated_at FROM query_api_script_runs WHERE output_dir IS NOT NULL OR zip_path IS NOT NULL",
    )
    .fetch_all(&sqlite_pool)
    .await
    .map_err(map_sql_error)?;

    let cache_root = cache_root(&app)?;
    let mut cleaned: u32 = 0;

    for row in rows {
        let run_id: String = row.try_get("id").map_err(map_sql_error)?;
        let output_dir: Option<String> = row.try_get("output_dir").map_err(map_sql_error)?;
        let _manifest_path: Option<String> = row.try_get("manifest_path").map_err(map_sql_error)?;
        let zip_path: Option<String> = row.try_get("zip_path").map_err(map_sql_error)?;
        let finished_at: Option<i64> = row.try_get("finished_at").map_err(map_sql_error)?;
        let updated_at: i64 = row.try_get("updated_at").map_err(map_sql_error)?;

        let last_ts = finished_at.unwrap_or(updated_at);
        if last_ts == 0 || last_ts > cutoff {
            continue;
        }

        if let Some(dir_text) = output_dir.as_ref() {
            let dir_path = PathBuf::from(dir_text);
            if ensure_path_within(&cache_root, &dir_path).is_ok() {
                if dir_path.exists() {
                    if let Err(err) = fs::remove_dir_all(&dir_path) {
                        if err.kind() != std::io::ErrorKind::NotFound {
                            return Err(map_io_error(err));
                        }
                    }
                }
            }
        }

        if let Some(zip_text) = zip_path.as_ref() {
            let zip_path = PathBuf::from(zip_text);
            if ensure_path_within(&cache_root, &zip_path).is_ok() && zip_path.exists() {
                if let Err(err) = fs::remove_file(&zip_path) {
                    if err.kind() != std::io::ErrorKind::NotFound {
                        return Err(map_io_error(err));
                    }
                }
            }
        }

        let now = now_ms();
        sqlx::query(
            "UPDATE query_api_script_runs SET output_dir = NULL, manifest_path = NULL, zip_path = NULL, updated_at = ? WHERE id = ?",
        )
        .bind(now)
        .bind(&run_id)
        .execute(&sqlite_pool)
        .await
        .map_err(map_sql_error)?;

        cleaned += 1;
    }

    Ok(cleaned)
}

#[tauri::command]
pub async fn execute_api_script(
    app: AppHandle,
    manager: State<'_, ApiScriptManager>,
    args: ExecuteApiScriptArgs,
) -> Result<(), String> {
    validate_connection_dsn(&args.connection_dsn)?;

    let sqlite_pool = open_sqlite_pool(&app).await?;
    let script = fetch_script_record(&sqlite_pool, &args.script_id).await?;
    let run_id = Uuid::new_v4().to_string();
    let cancel_flag = manager.try_begin(run_id.clone(), script.id.clone())?;
    if let Err(err) = insert_run_record(&sqlite_pool, &run_id, &args, &script).await {
        manager.finish(&run_id);
        return Err(err);
    }

    let app_handle = app.clone();
    let manager_clone = manager.inner().clone();
    let pool_clone = sqlite_pool.clone();
    let args_clone = args.clone();
    let script_clone = script.clone();

    let cancel_flag_clone = cancel_flag.clone();
    async_runtime::spawn(async move {
        spawn_run_task(
            app_handle,
            manager_clone,
            pool_clone,
            args_clone,
            script_clone,
            run_id,
            cancel_flag_clone,
        )
        .await;
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        build_csv_record, chunk_records, collect_csv_headers, create_manifest,
        validate_connection_dsn, value_to_csv_field, ManifestFiles, RunSummary,
    };
    use serde_json::json;

    #[test]
    fn validates_postgres_dsn() {
        assert!(validate_connection_dsn("postgres://user:pass@localhost/db").is_ok());
        assert!(validate_connection_dsn("postgresql://localhost").is_ok());
    }

    #[test]
    fn rejects_non_postgres_dsn() {
        assert!(validate_connection_dsn("http://example.com").is_err());
        assert!(validate_connection_dsn("").is_err());
    }

    #[test]
    fn chunk_records_splits_evenly() {
        let rows = vec![
            json!({"id": 1}),
            json!({"id": 2}),
            json!({"id": 3}),
            json!({"id": 4}),
        ];
        let batches = chunk_records(rows, 3);
        assert_eq!(batches.len(), 2);
        assert_eq!(batches[0].len(), 3);
        assert_eq!(batches[1].len(), 1);
        assert_eq!(batches[0][0]["id"], json!(1));
        assert_eq!(batches[1][0]["id"], json!(4));
    }

    #[test]
    fn collect_csv_headers_merges_and_sorts_keys() {
        let rows = vec![json!({"b": 1, "a": 2}), json!({"c": 3, "a": 4})];
        let headers = collect_csv_headers(&rows);
        assert_eq!(headers, vec!["a", "b", "c"]);
    }

    #[test]
    fn value_to_csv_field_handles_types() {
        assert_eq!(value_to_csv_field(&json!(null)), "");
        assert_eq!(value_to_csv_field(&json!(true)), "true");
        assert_eq!(value_to_csv_field(&json!(42)), "42");
        assert_eq!(value_to_csv_field(&json!("text")), "text");
        assert_eq!(
            value_to_csv_field(&json!({"nested": [1, 2]})),
            "{\"nested\":[1,2]}"
        );
    }

    #[test]
    fn build_csv_record_uses_headers_order() {
        let row = json!({"a": 1, "c": "x"});
        let headers = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let record = build_csv_record(&row, &headers);
        assert_eq!(
            record,
            vec!["1".to_string(), "".to_string(), "x".to_string()]
        );
    }

    #[test]
    fn create_manifest_generates_expected_shape() {
        let snapshot = json!({
            "script": {
                "id": "script-1",
                "fetchSize": 500,
            },
            "execution": {
                "baseSql": "select 1",
            }
        });
        let stats = RunSummary {
            total_batches: 10,
            processed_batches: 9,
            request_count: 30,
            success_rows: 450,
            error_rows: 5,
            total_rows: 455,
        };
        let files = ManifestFiles {
            success_parts: vec!["success-part-1.csv".to_string()],
            error_parts: vec!["errors.csv".to_string()],
            logs: vec!["run.log".to_string()],
            manifest: "manifest.json".to_string(),
        };
        let manifest = create_manifest("run-123", &snapshot, &stats, &files, 1000, 2000);
        assert_eq!(manifest["runId"], json!("run-123"));
        assert_eq!(manifest["scriptSnapshot"], snapshot);
        assert_eq!(manifest["summary"]["totalBatches"], json!(10));
        assert_eq!(manifest["summary"]["successRows"], json!(450));
        assert_eq!(manifest["summary"]["errorRows"], json!(5));
        assert_eq!(manifest["summary"]["totalRows"], json!(455));
        assert_eq!(manifest["summary"]["processedBatches"], json!(9));
        assert_eq!(
            manifest["files"]["successParts"],
            json!(["success-part-1.csv"])
        );
        assert_eq!(manifest["files"]["errorParts"], json!(["errors.csv"]));
        assert_eq!(manifest["files"]["logs"], json!(["run.log"]));
        assert_eq!(manifest["files"]["manifest"], json!("manifest.json"));
        assert_eq!(manifest["startedAt"], json!(1000));
        assert_eq!(manifest["finishedAt"], json!(2000));
        let generated = manifest["generatedAt"].as_i64().unwrap();
        assert!(generated >= 1000);
    }
}
