import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const dataDir = path.resolve(
  /* turbopackIgnore: true */ process.env.NEURAL_CHAT_DATA_DIR || path.join(process.cwd(), "data"),
);

const databasePath = path.resolve(
  /* turbopackIgnore: true */ process.env.NEURAL_CHAT_DB_PATH || path.join(dataDir, "neural-chat.sqlite3"),
);

declare global {
  // Keep one connection across route bundles and development reloads.
  var neuralChatDatabase: Database.Database | undefined;
}

function openDatabase() {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const connection = new Database(databasePath);
  connection.pragma("foreign_keys = ON");
  connection.pragma("journal_mode = WAL");
  connection.pragma("synchronous = NORMAL");
  connection.pragma("busy_timeout = 5000");
  connection.pragma("wal_autocheckpoint = 1000");

  connection.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const version = connection.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number };
  if (version.version < 1) {
    connection.transaction(() => {
      connection.exec(`
        CREATE TABLE app_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          value TEXT NOT NULL CHECK (json_valid(value)),
          updated_at TEXT NOT NULL
        );

        CREATE TABLE conversations (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          model_id TEXT NOT NULL,
          reasoning_preset_id TEXT,
          active_branch_id TEXT NOT NULL
            REFERENCES branches(id) DEFERRABLE INITIALLY DEFERRED,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE branches (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          parent_branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
          forked_from_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
          position INTEGER NOT NULL CHECK (position >= 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (conversation_id, position)
        );

        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          revision_group_id TEXT,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          reasoning TEXT,
          reasoning_duration_seconds REAL CHECK (reasoning_duration_seconds IS NULL OR reasoning_duration_seconds >= 0),
          created_at TEXT NOT NULL
        );

        CREATE TABLE branch_messages (
          branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
          message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          position INTEGER NOT NULL CHECK (position >= 0),
          PRIMARY KEY (branch_id, position),
          UNIQUE (branch_id, message_id)
        );

        CREATE TABLE uploads (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          mime_type TEXT NOT NULL CHECK (mime_type LIKE 'image/%'),
          size INTEGER NOT NULL CHECK (size >= 0),
          width INTEGER CHECK (width IS NULL OR width > 0),
          height INTEGER CHECK (height IS NULL OR height > 0),
          created_at TEXT NOT NULL
        );

        CREATE TABLE message_attachments (
          message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE RESTRICT,
          position INTEGER NOT NULL CHECK (position >= 0),
          PRIMARY KEY (message_id, position),
          UNIQUE (message_id, upload_id)
        );

        CREATE TABLE storage_migrations (
          name TEXT PRIMARY KEY,
          completed_at TEXT NOT NULL
        );

        CREATE INDEX conversations_updated_at_idx ON conversations(updated_at DESC);
        CREATE INDEX branches_conversation_id_idx ON branches(conversation_id);
        CREATE INDEX messages_conversation_id_idx ON messages(conversation_id);
        CREATE INDEX branch_messages_message_id_idx ON branch_messages(message_id);
        CREATE INDEX message_attachments_upload_id_idx ON message_attachments(upload_id);
      `);
      connection.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(1, new Date().toISOString());
    })();
  }

  const currentVersion = connection.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number };
  if (currentVersion.version < 2) {
    connection.transaction(() => {
      connection.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL COLLATE NOCASE UNIQUE,
          display_name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'user')),
          preferences TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        ALTER TABLE conversations ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
        ALTER TABLE uploads ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;

        CREATE INDEX conversations_user_updated_idx ON conversations(user_id, updated_at DESC);
        CREATE INDEX uploads_user_idx ON uploads(user_id);
        CREATE INDEX sessions_token_idx ON sessions(token_hash);
        CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
      `);
      connection.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(2, new Date().toISOString());
    })();
  }

  const tokenUsageVersion = connection.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number };
  if (tokenUsageVersion.version < 3) {
    connection.transaction(() => {
      connection.exec(`
        ALTER TABLE messages ADD COLUMN input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0);
        ALTER TABLE messages ADD COLUMN output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0);
        ALTER TABLE messages ADD COLUMN reasoning_tokens INTEGER CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0);
        ALTER TABLE messages ADD COLUMN total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0);
        ALTER TABLE messages ADD COLUMN completion_duration_seconds REAL CHECK (completion_duration_seconds IS NULL OR completion_duration_seconds >= 0);
      `);
      connection.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(3, new Date().toISOString());
    })();
  }

  const streamTimingVersion = connection.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number };
  if (streamTimingVersion.version < 4) {
    connection.transaction(() => {
      connection.exec(`
        ALTER TABLE messages ADD COLUMN time_to_first_token_seconds REAL
          CHECK (time_to_first_token_seconds IS NULL OR time_to_first_token_seconds >= 0);
      `);
      connection.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(4, new Date().toISOString());
    })();
  }

  const toolEventsVersion = connection.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number };
  if (toolEventsVersion.version < 5) {
    connection.transaction(() => {
      connection.exec(`
        ALTER TABLE messages ADD COLUMN tool_events TEXT
          CHECK (tool_events IS NULL OR json_valid(tool_events));
      `);
      connection.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(5, new Date().toISOString());
    })();
  }

  const documentUploadsVersion = connection.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number };
  if (documentUploadsVersion.version < 6) {
    connection.pragma("foreign_keys = OFF");
    try {
      connection.transaction(() => {
        connection.exec(`
          CREATE TABLE uploads_v6 (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            mime_type TEXT NOT NULL CHECK (mime_type LIKE 'image/%' OR mime_type = 'application/pdf'),
            size INTEGER NOT NULL CHECK (size >= 0),
            width INTEGER CHECK (width IS NULL OR width > 0),
            height INTEGER CHECK (height IS NULL OR height > 0),
            created_at TEXT NOT NULL,
            user_id TEXT REFERENCES users(id) ON DELETE CASCADE
          );
          INSERT INTO uploads_v6(id, name, mime_type, size, width, height, created_at, user_id)
            SELECT id, name, mime_type, size, width, height, created_at, user_id FROM uploads;
          DROP TABLE uploads;
          ALTER TABLE uploads_v6 RENAME TO uploads;
          CREATE INDEX uploads_user_idx ON uploads(user_id);
        `);
        connection.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(6, new Date().toISOString());
      })();
    } finally {
      connection.pragma("foreign_keys = ON");
    }
    const violations = connection.pragma("foreign_key_check") as unknown[];
    if (violations.length) throw new Error("Database migration 6 left invalid attachment references.");
  }

  return connection;
}

export const db = globalThis.neuralChatDatabase ?? openDatabase();
globalThis.neuralChatDatabase = db;

export function storageMigrationCompleted(name: string) {
  return Boolean(db.prepare("SELECT 1 FROM storage_migrations WHERE name = ?").get(name));
}

export function completeStorageMigration(name: string) {
  db.prepare("INSERT OR IGNORE INTO storage_migrations(name, completed_at) VALUES (?, ?)").run(name, new Date().toISOString());
}
