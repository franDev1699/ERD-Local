// src/db/connection.js
const fs = require('fs');
const path = require('path');

// Graceful check for node:sqlite compatibility (requires Node 22.5+)
let DatabaseSync;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (e) {
  console.error('\n======================================================');
  console.error('❌ ERROR CRÍTICO DE COMPATIBILIDAD');
  console.error('======================================================');
  console.error(`Tu versión de Node.js (${process.version}) no soporta "node:sqlite" de forma nativa.`);
  console.error('Se requiere Node.js 22.5 o superior (estabilizado en Node 26).');
  console.error('Por favor actualiza Node.js o instala better-sqlite3 como alternativa.');
  console.error('======================================================\n');
  process.exit(1);
}

const DB_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DB_DIR, 'app.db');
const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

// Ensure database directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

let db;
try {
  db = new DatabaseSync(DB_FILE);
  // Enable foreign keys constraints
  db.exec('PRAGMA foreign_keys = ON;');
  console.log(`[Database] Conectado a SQLite exitosamente en: ${DB_FILE}`);
} catch (err) {
  console.error('[Database] Error crítico al conectar a SQLite:', err.message);
  process.exit(1);
}

// Ensure the migrations table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  ) STRICT;
`);

function runMigrations() {
  try {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
      console.log('[Database] Directorio de migraciones no encontrado, creándolo...');
      fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
      return;
    }

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const checkStmt = db.prepare('SELECT 1 FROM _migrations WHERE name = ?');
      const isApplied = checkStmt.get(file);

      if (!isApplied) {
        console.log(`[Database] Aplicando migración: ${file}`);
        const sqlPath = path.join(MIGRATIONS_DIR, file);
        const sql = fs.readFileSync(sqlPath, 'utf8');

        // Split queries by semicolon to execute individually if needed,
        // but DatabaseSync.exec executes multi-statement strings just fine.
        db.exec(sql);

        const insertStmt = db.prepare('INSERT INTO _migrations (name) VALUES (?)');
        insertStmt.run(file);
        console.log(`[Database] Migración ${file} aplicada con éxito.`);
      }
    }

    // Seed global prompts if empty
    const checkPromptsStmt = db.prepare("SELECT COUNT(*) as count FROM ai_prompt_configs WHERE scope = 'global'");
    const promptsCount = checkPromptsStmt.get().count;

    if (promptsCount === 0) {
      console.log('[Database] Inicializando prompts de IA globales...');
      const promptsJsonPath = path.join(__dirname, '..', '..', 'ai_prompts.json');
      let defaultPrompts = {};

      if (fs.existsSync(promptsJsonPath)) {
        try {
          defaultPrompts = JSON.parse(fs.readFileSync(promptsJsonPath, 'utf8'));
        } catch (jsonErr) {
          console.error('[Database] Error al parsear ai_prompts.json para seeding:', jsonErr.message);
        }
      }

      const insertPrompt = db.prepare(`
        INSERT INTO ai_prompt_configs (id, scope, user_id, prompt_key, prompt_template, model)
        VALUES (?, 'global', NULL, ?, ?, NULL)
      `);

      for (const [key, value] of Object.entries(defaultPrompts)) {
        const id = `p_global_${key}`;
        insertPrompt.run(id, key, value);
      }
      console.log(`[Database] Se insertaron ${Object.keys(defaultPrompts).length} prompts globales.`);
    }

  } catch (err) {
    console.error('[Database] Error durante la ejecución de migraciones:', err.message);
    process.exit(1);
  }
}

runMigrations();

module.exports = db;
