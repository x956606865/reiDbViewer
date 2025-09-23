use tauri_plugin_sql::{Migration, MigrationKind};

pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "init_local_store",
            sql: r#"
        CREATE TABLE IF NOT EXISTS user_connections (
          id TEXT PRIMARY KEY,
          alias TEXT NOT NULL,
          driver TEXT NOT NULL CHECK(driver IN ('postgres')),
          host TEXT,
          port INTEGER,
          database TEXT,
          username TEXT,
          dsn_key_ref TEXT NULL,
          dsn_cipher TEXT NULL,
          created_at INTEGER,
          updated_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS saved_sql (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NULL,
          sql TEXT NOT NULL,
          variables TEXT NOT NULL,       -- JSON string (SavedQueryVariableDef[])
          dynamic_columns TEXT NULL,     -- JSON string (DynamicColumnDef[])
          calc_items TEXT NULL,          -- JSON string (CalcItemDef[])
          is_archived INTEGER DEFAULT 0,
          created_at INTEGER,
          updated_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS schema_cache (
          id TEXT PRIMARY KEY,
          conn_id TEXT NOT NULL,
          content TEXT NOT NULL,         -- JSON string of cached schema
          updated_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS app_prefs (
          k TEXT PRIMARY KEY,
          v TEXT NOT NULL                 -- JSON string for arbitrary prefs
        );

        CREATE INDEX IF NOT EXISTS idx_saved_sql_updated_at ON saved_sql(updated_at);
        CREATE INDEX IF NOT EXISTS idx_schema_cache_conn ON schema_cache(conn_id);
        "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "ops_audit_table",
            sql: r#"
        CREATE TABLE IF NOT EXISTS ops_audit (
          id TEXT PRIMARY KEY,
          conn_id TEXT NOT NULL,
          action TEXT NOT NULL,
          target_pid INTEGER NULL,
          status TEXT NOT NULL,
          message TEXT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ops_audit_created_at ON ops_audit(created_at);
        "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "saved_sql_column_widths",
            sql: r#"
        CREATE TABLE IF NOT EXISTS saved_sql_column_widths (
          saved_id TEXT NOT NULL,
          column_name TEXT NOT NULL,
          width INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (saved_id, column_name)
        );

        CREATE INDEX IF NOT EXISTS idx_saved_sql_widths_saved ON saved_sql_column_widths(saved_id);
        "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "query_api_scripts",
            sql: r#"
        CREATE TABLE IF NOT EXISTS query_api_scripts (
          id TEXT PRIMARY KEY,
          query_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NULL,
          method TEXT NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
          endpoint TEXT NOT NULL,
          headers TEXT NOT NULL DEFAULT '[]',
          body_template TEXT NULL,
          fetch_size INTEGER NOT NULL CHECK (fetch_size BETWEEN 1 AND 1000),
          send_batch_size INTEGER NOT NULL CHECK (send_batch_size BETWEEN 1 AND 1000),
          sleep_ms INTEGER NOT NULL CHECK (sleep_ms BETWEEN 0 AND 600000),
          request_timeout_ms INTEGER NOT NULL CHECK (request_timeout_ms BETWEEN 1000 AND 600000),
          error_policy TEXT NOT NULL CHECK (error_policy IN ('continue', 'abort')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE (query_id, name)
        );

        CREATE INDEX IF NOT EXISTS idx_query_api_scripts_query ON query_api_scripts(query_id);

        CREATE TABLE IF NOT EXISTS query_api_script_runs (
          id TEXT PRIMARY KEY,
          script_id TEXT NOT NULL,
          query_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN (
            'pending',
            'running',
            'succeeded',
            'completed_with_errors',
            'failed',
            'cancelled'
          )),
          script_snapshot TEXT NOT NULL,
          progress_snapshot TEXT NOT NULL DEFAULT '{}',
          error_message TEXT NULL,
          output_dir TEXT NULL,
          manifest_path TEXT NULL,
          zip_path TEXT NULL,
          total_batches INTEGER NULL,
          processed_batches INTEGER NULL,
          success_rows INTEGER NULL,
          error_rows INTEGER NULL,
          started_at INTEGER NULL,
          finished_at INTEGER NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_query_api_script_runs_script ON query_api_script_runs(script_id);
        CREATE INDEX IF NOT EXISTS idx_query_api_script_runs_created ON query_api_script_runs(created_at DESC);
        "#,
            kind: MigrationKind::Up,
        },
    ]
}
