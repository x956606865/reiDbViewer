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
    }
    ]
}
