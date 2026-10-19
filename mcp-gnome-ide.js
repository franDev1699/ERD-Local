#!/usr/bin/env node
/**
 * mcp-gnome-ide.js
 * ============================================================================
 * Servidor MCP (Model Context Protocol) autónomo en UN SOLO ARCHIVO para
 * usar en Antigravity IDE (o Claude Desktop / Cursor) y compartir con el equipo.
 *
 * CARACTERÍSTICAS:
 * - Cero dependencias externas (usa módulos nativos de Node.js).
 * - Seguro por defecto (Modo SÓLO LECTURA estricto: limpia comentarios SQL y
 *   bloquea INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, etc.).
 * - Incluye la lógica de Gnome ERD:
 *   1. Introspección completa de esquema (`get_schema`: tablas, columnas, PKs y FKs).
 *   2. Listado y descripción de tablas (`list_tables`, `describe_table`, `list_foreign_keys`).
 *   3. Ejecución segura de consultas SQL (`execute_query`) con límite de filas.
 *   4. Lectura/sincronización opcional de diagramas del servidor Gnome ERD (`get_gnome_diagram`).
 *
 * ============================================================================
 * CONFIGURACIÓN EN ANTIGRAVITY IDE (mcp_config.json):
 *
 * Opción A — Conectar a MySQL (usando el conector MCP bajo nuestro escudo seguro):
 * {
 *   "mcpServers": {
 *     "gnome-db": {
 *       "command": "node",
 *       "args": ["C:/ruta/a/mcp-gnome-ide.js"],
 *       "env": {
 *         "READ_ONLY": "true",
 *         "MCP_COMMAND": "npx",
 *         "MCP_ARGS": "-y @benborla29/mcp-server-mysql",
 *         "MYSQL_HOST": "tu-servidor-interno",
 *         "MYSQL_PORT": "3306",
 *         "MYSQL_USER": "tu_usuario",
 *         "MYSQL_PASS": "tu_password",
 *         "MYSQL_DB": "tu_base_de_datos"
 *       }
 *     }
 *   }
 * }
 *
 * Opción B — Conectar a través del Servidor Interno de Gnome ERD (sin credenciales locales):
 * {
 *   "mcpServers": {
 *     "gnome-db": {
 *       "command": "node",
 *       "args": ["C:/ruta/a/mcp-gnome-ide.js"],
 *       "env": {
 *         "GNOME_URL": "http://192.168.1.X:3000",
 *         "GNOME_SESSION_TOKEN": "tu_cookie_erd_session",
 *         "GNOME_CONNECTION_ID": "mcp-xxxx",
 *         "GNOME_PROJECT_ID": "default"
 *       }
 *     }
 *   }
 * }
 *
 * Opción C — Conectar a un archivo SQLite local (Zero-dep nativo):
 * {
 *   "mcpServers": {
 *     "gnome-db": {
 *       "command": "node",
 *       "args": ["C:/ruta/a/mcp-gnome-ide.js"],
 *       "env": {
 *         "SQLITE_PATH": "C:/ruta/a/archivo.db",
 *         "READ_ONLY": "true"
 *       }
 *     }
 *   }
 * }
 * ============================================================================
 */

const { spawn } = require('node:child_process');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const fs = require('node:fs');

let DatabaseSync = null;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (_) {
  DatabaseSync = null;
}

const IS_READ_ONLY = String(process.env.READ_ONLY ?? 'true').toLowerCase() !== 'false' && process.env.READ_ONLY !== '0';
const MAX_ROWS = parseInt(process.env.MAX_ROWS || '500', 10);

// ============================================================================
// 1. VALIDADOR DE SEGURIDAD SQL (Escudo Read-Only)
// ============================================================================
function assertSafeSql(sql, isReadOnly = IS_READ_ONLY) {
  if (!sql || typeof sql !== 'string') {
    throw new Error('La consulta SQL es requerida y debe ser texto.');
  }

  // Eliminar comentarios SQL (/* ... */ y -- ...) para evitar bypasses
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .trim();

  if (!stripped) {
    throw new Error('La consulta SQL está vacía.');
  }

  if (!isReadOnly) return stripped;

  // Bloquear múltiples sentencias separadas por punto y coma (excepto ';' al final)
  const withoutTrailingSemicolon = stripped.replace(/;+\s*$/, '');
  if (withoutTrailingSemicolon.includes(';')) {
    throw new Error('Operación bloqueada por seguridad: No se permiten múltiples sentencias SQL encadenadas (;).');
  }

  // Bloquear cualquier palabra clave destructiva o de escritura en cualquier parte fuera de comillas
  const withoutStrings = withoutTrailingSemicolon
    .replace(/'([^'\\]|\\.)*'/g, "''")
    .replace(/"([^"\\]|\\.)*"/g, '""');

  const writeKeywords = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE|ATTACH|DETACH|VACUUM|REINDEX|RENAME|CALL|EXEC|EXECUTE|LOAD|INTO\s+OUTFILE|INTO\s+DUMPFILE)\b/i;
  if (writeKeywords.test(withoutStrings)) {
    throw new Error('Operación bloqueada: El MCP está en modo SÓLO LECTURA. No se permiten sentencias de modificación o escritura.');
  }

  const allowedStart = /^(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN|PRAGMA|WITH)\b/i;
  if (!allowedStart.test(withoutStrings)) {
    throw new Error('Operación bloqueada: Solo se permiten consultas de lectura (SELECT, SHOW, DESCRIBE, EXPLAIN, WITH).');
  }

  return stripped;
}

// ============================================================================
// 2. ADAPTADORES DE CONEXIÓN (SQLite Nativo / Proxy Stdio / Servidor Gnome HTTP)
// ============================================================================

class SqliteBackend {
  constructor(dbPath, isReadOnly) {
    this.dbPath = path.resolve(dbPath);
    this.isReadOnly = isReadOnly;
    this.db = null;
  }

  _getDb() {
    if (!this.db) {
      if (!DatabaseSync) throw new Error('node:sqlite no está disponible en esta versión de Node.js (requiere Node 22.5+).');
      if (!fs.existsSync(this.dbPath)) throw new Error(`No existe el archivo SQLite: ${this.dbPath}`);
      this.db = new DatabaseSync(this.dbPath, { readOnly: this.isReadOnly });
    }
    return this.db;
  }

  async listTables() {
    const db = this._getDb();
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_migrations' ORDER BY name").all();
    return rows.map(r => r.name);
  }

  async describeTable(table) {
    const db = this._getDb();
    return db.prepare(`PRAGMA table_info("${String(table).replace(/"/g, '""')}")`).all();
  }

  async listForeignKeys(table) {
    const db = this._getDb();
    return db.prepare(`PRAGMA foreign_key_list("${String(table).replace(/"/g, '""')}")`).all();
  }

  async introspectSchema() {
    const tableNames = await this.listTables();
    const tables = [];
    const relationships = [];

    for (const tableName of tableNames) {
      const cols = await this.describeTable(tableName);
      const fks = await this.listForeignKeys(tableName);

      tables.push({
        name: tableName,
        fields: cols.map(c => ({
          name: c.name,
          type: (c.type || 'TEXT').toUpperCase(),
          isPK: c.pk === 1,
          isNullable: c.notnull === 0,
          defaultValue: c.dflt_value ?? null
        }))
      });

      for (const fk of fks) {
        relationships.push({
          fromTable: tableName,
          fromField: fk.from,
          toTable: fk.table,
          toField: fk.to,
          onDelete: fk.on_delete || 'NO ACTION',
          onUpdate: fk.on_update || 'NO ACTION'
        });
      }
    }

    return { tables, relationships };
  }

  async executeQuery(sql, { skipLimit = false } = {}) {
    const cleanSql = assertSafeSql(sql, this.isReadOnly);
    const startTime = Date.now();
    const db = this._getDb();
    const rows = db.prepare(cleanSql).all();
    return {
      rows: skipLimit ? rows : rows.slice(0, MAX_ROWS),
      totalCount: rows.length,
      truncated: !skipLimit && rows.length > MAX_ROWS,
      executionTimeMs: Date.now() - startTime
    };
  }
}

class StdioSubprocessBackend {
  constructor(command, args, env, isReadOnly) {
    this.command = command;
    this.args = Array.isArray(args) ? args : String(args || '').split(' ').filter(Boolean);
    this.env = env || {};
    this.isReadOnly = isReadOnly;
    this.child = null;
    this.msgId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.initialized = false;
  }

  _start() {
    if (this.child) return;
    this.child = spawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      shell: process.platform === 'win32'
    });

    this.child.stdout.on('data', chunk => {
      this.buffer += chunk.toString('utf8');
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            else resolve(msg.result);
          }
        } catch (_) {}
      }
    });

    this.child.on('close', code => {
      for (const { reject } of this.pending.values()) {
        reject(new Error(`Subproceso MCP terminado (código ${code})`));
      }
      this.pending.clear();
      this.child = null;
      this.initialized = false;
    });
  }

  _rpc(method, params = {}, isNotification = false) {
    this._start();
    return new Promise((resolve, reject) => {
      const id = isNotification ? undefined : this.msgId++;
      const payload = { jsonrpc: '2.0', ...(id !== undefined ? { id } : {}), method, params };

      if (!isNotification) {
        const timeoutMs = method === 'initialize' ? 90000 : 30000;
        const timer = setTimeout(() => {
          if (this.pending.has(id)) {
            this.pending.delete(id);
            reject(new Error(`Timeout (${timeoutMs / 1000}s) en ${method}`));
          }
        }, timeoutMs);

        this.pending.set(id, {
          resolve: res => { clearTimeout(timer); resolve(res); },
          reject: err => { clearTimeout(timer); reject(err); }
        });
      }

      this.child.stdin.write(JSON.stringify(payload) + '\n');
      if (isNotification) resolve();
    });
  }

  async _ensureInit() {
    if (this.initialized) return;
    await this._rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'gnome-erd-ide-mcp', version: '1.0.0' }
    });
    await this._rpc('notifications/initialized', {}, true);
    this.initialized = true;
  }

  async _listUnderlyingTools() {
    await this._ensureInit();
    const res = await this._rpc('tools/list', {});
    return res?.tools || [];
  }

  async _findQueryTool() {
    const tools = await this._listUnderlyingTools();
    const names = ['execute_sql', 'mysql_query', 'execute_query', 'query', 'read_query', 'sql_query', 'run_query'];
    return tools.find(t => names.includes(t.name.toLowerCase()));
  }

  _extractData(mcpRes) {
    if (!mcpRes) return {};
    if (Array.isArray(mcpRes.content)) {
      const txt = mcpRes.content.find(c => c.type === 'text')?.text;
      if (txt) {
        try { return JSON.parse(txt); } catch (_) {
          const match = txt.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
          if (match) {
            try { return JSON.parse(match[0]); } catch (__) {}
          }
          return { text: txt };
        }
      }
    }
    return mcpRes;
  }

  async executeQuery(sql, { skipLimit = false } = {}) {
    const cleanSql = assertSafeSql(sql, this.isReadOnly);
    const qTool = await this._findQueryTool();
    if (!qTool) throw new Error('El conector subyacente no expone una herramienta de consulta SQL.');

    const startTime = Date.now();
    const res = await this._rpc('tools/call', {
      name: qTool.name,
      arguments: { query: cleanSql, sql: cleanSql }
    });
    if (res?.isError) {
      throw new Error(res.content?.find(c => c.type === 'text')?.text || 'Error al ejecutar SQL en el conector.');
    }
    const data = this._extractData(res);
    const rows = Array.isArray(data) ? data : (data.rows || [data]);
    return {
      rows: skipLimit ? rows : rows.slice(0, MAX_ROWS),
      totalCount: rows.length,
      truncated: !skipLimit && rows.length > MAX_ROWS,
      executionTimeMs: Date.now() - startTime
    };
  }

  async listTables() {
    const { rows } = await this.executeQuery(`
      SELECT TABLE_NAME AS name
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME
    `, { skipLimit: true });
    return rows.map(r => r.name || r.TABLE_NAME || Object.values(r)[0]);
  }

  async describeTable(table) {
    const safeName = String(table).replace(/[^a-zA-Z0-9_$]/g, '');
    const { rows } = await this.executeQuery(`
      SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${safeName}'
      ORDER BY ORDINAL_POSITION
    `, { skipLimit: true });
    return rows;
  }

  async listForeignKeys(table) {
    const safeName = String(table).replace(/[^a-zA-Z0-9_$]/g, '');
    const { rows } = await this.executeQuery(`
      SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = '${safeName}'
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `, { skipLimit: true });
    return rows;
  }

  async introspectSchema() {
    const pick = (row, k) => row[k] ?? row[k.toUpperCase()] ?? row[k.toLowerCase()];
    const { rows: colRows } = await this.executeQuery(`
      SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `, { skipLimit: true });

    const { rows: fkRows } = await this.executeQuery(`
      SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
    `, { skipLimit: true });

    const tableMap = new Map();
    const tables = [];

    for (const row of colRows) {
      const tName = pick(row, 'TABLE_NAME');
      if (!tName) continue;
      let tbl = tableMap.get(tName);
      if (!tbl) {
        tbl = { name: tName, fields: [] };
        tableMap.set(tName, tbl);
        tables.push(tbl);
      }
      tbl.fields.push({
        name: pick(row, 'COLUMN_NAME'),
        type: String(pick(row, 'COLUMN_TYPE') || 'VARCHAR').toUpperCase(),
        isPK: pick(row, 'COLUMN_KEY') === 'PRI',
        isNullable: pick(row, 'IS_NULLABLE') === 'YES',
        defaultValue: pick(row, 'COLUMN_DEFAULT') ?? null
      });
    }

    const relationships = fkRows.map(r => ({
      fromTable: pick(r, 'TABLE_NAME'),
      fromField: pick(r, 'COLUMN_NAME'),
      toTable: pick(r, 'REFERENCED_TABLE_NAME'),
      toField: pick(r, 'REFERENCED_COLUMN_NAME'),
      cardinality: '1:N'
    }));

    return { tables, relationships };
  }
}

class GnomeServerHttpBackend {
  constructor(baseUrl, sessionToken, connectionId, projectId, isReadOnly) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.sessionToken = sessionToken;
    this.connectionId = connectionId;
    this.projectId = projectId || 'default';
    this.isReadOnly = isReadOnly;
  }

  _request(method, endpoint, body = null) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(this.baseUrl + endpoint);
      const transport = urlObj.protocol === 'https:' ? https : http;
      const payload = body ? JSON.stringify(body) : null;

      const headers = { 'Content-Type': 'application/json' };
      if (this.sessionToken) {
        headers['Cookie'] = this.sessionToken.includes('erd_session=')
          ? this.sessionToken
          : `erd_session=${this.sessionToken}`;
      }
      if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

      const req = transport.request(urlObj, { method, headers, timeout: 30000 }, res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400 || parsed.error) {
              reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
            } else {
              resolve(parsed);
            }
          } catch (_) {
            reject(new Error(`Respuesta inválida de Gnome Server (${res.statusCode})`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout conectando a Gnome Server')); });
      if (payload) req.write(payload);
      req.end();
    });
  }

  async introspectSchema() {
    const res = await this._request('POST', '/api/mcp-connections/introspect', { id: this.connectionId });
    return res.schema;
  }

  async executeQuery(sql) {
    const cleanSql = assertSafeSql(sql, this.isReadOnly);
    return this._request('POST', '/api/mcp-connections/query', { id: this.connectionId, sql: cleanSql });
  }

  async listTables() {
    const schema = await this.introspectSchema();
    return (schema?.tables || []).map(t => t.name);
  }

  async describeTable(table) {
    const schema = await this.introspectSchema();
    const found = (schema?.tables || []).find(t => t.name.toLowerCase() === String(table).toLowerCase());
    if (!found) throw new Error(`Tabla no encontrada: ${table}`);
    return found.fields;
  }

  async listForeignKeys(table) {
    const schema = await this.introspectSchema();
    return (schema?.relationships || []).filter(
      r => r.fromTable === table || r.toTable === table
    );
  }
}

// ============================================================================
// 3. SELECCIÓN AUTOMÁTICA DE BACKEND SEGÚN VARIABLES DE ENTORNO
// ============================================================================
function createBackendFromEnv() {
  if (process.env.GNOME_URL && process.env.GNOME_CONNECTION_ID) {
    return new GnomeServerHttpBackend(
      process.env.GNOME_URL,
      process.env.GNOME_SESSION_TOKEN,
      process.env.GNOME_CONNECTION_ID,
      process.env.GNOME_PROJECT_ID,
      IS_READ_ONLY
    );
  }

  if (process.env.MCP_COMMAND || process.env.MYSQL_HOST) {
    const cmd = process.env.MCP_COMMAND || 'npx';
    const args = process.env.MCP_ARGS || '-y @benborla29/mcp-server-mysql';
    return new StdioSubprocessBackend(cmd, args, process.env, IS_READ_ONLY);
  }

  const sqlitePath = process.env.SQLITE_PATH || path.join(__dirname, 'data', 'app.db');
  return new SqliteBackend(sqlitePath, IS_READ_ONLY);
}

const backend = createBackendFromEnv();

// ============================================================================
// 4. DEFINICIÓN DE HERRAMIENTAS MCP PARA ANTIGRAVITY IDE
// ============================================================================
const TOOLS = [
  {
    name: 'get_schema',
    description: 'Obtiene el esquema completo de la base de datos (tablas, columnas, tipos, llaves primarias y relaciones foráneas) en el formato de Gnome ERD.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'list_tables',
    description: 'Lista los nombres de todas las tablas disponibles en la base de datos.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'describe_table',
    description: 'Describe las columnas, tipos de datos, nulabilidad y llaves primarias de una tabla específica.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Nombre de la tabla a describir' }
      },
      required: ['table']
    }
  },
  {
    name: 'list_foreign_keys',
    description: 'Lista las llaves foráneas y relaciones de una tabla.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Nombre de la tabla' }
      },
      required: ['table']
    }
  },
  {
    name: 'execute_query',
    description: `Ejecuta una consulta SQL en la base de datos (${IS_READ_ONLY ? 'Modo SÓLO LECTURA activo: solo SELECT/SHOW/DESCRIBE/EXPLAIN' : 'Lectura/Escritura'}). Devuelve hasta ${MAX_ROWS} filas.`,
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Consulta SQL a ejecutar' }
      },
      required: ['sql']
    }
  },
  {
    name: 'get_local_gnome_diagram',
    description: 'Lee el diagrama ERD local (tablas, grupos, relaciones y consultas guardadas) de un proyecto de Gnome ERD en disco.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID del proyecto (por defecto: default)' }
      }
    }
  }
];

async function handleToolCall(name, args = {}) {
  switch (name) {
    case 'get_schema':
      return await backend.introspectSchema();
    case 'list_tables':
      return { tables: await backend.listTables() };
    case 'describe_table':
      if (!args.table) throw new Error('El parámetro "table" es obligatorio.');
      return { table: args.table, columns: await backend.describeTable(args.table) };
    case 'list_foreign_keys':
      if (!args.table) throw new Error('El parámetro "table" es obligatorio.');
      return { table: args.table, foreignKeys: await backend.listForeignKeys(args.table) };
    case 'execute_query':
      if (!args.sql) throw new Error('El parámetro "sql" es obligatorio.');
      return await backend.executeQuery(args.sql);
    case 'get_local_gnome_diagram': {
      const proj = String(args.projectId || process.env.GNOME_PROJECT_ID || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
      const candidates = [
        path.join(__dirname, 'projects', `${proj}.json`),
        path.join(__dirname, 'shared_state.json')
      ];
      for (const file of candidates) {
        if (fs.existsSync(file)) {
          return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
      }
      throw new Error(`No se encontró el archivo local del proyecto "${proj}".`);
    }
    default:
      throw new Error(`Herramienta desconocida: ${name}`);
  }
}

// ============================================================================
// 5. SERVIDOR JSON-RPC 2.0 SOBRE STDIO (Estándar MCP para Antigravity IDE)
// ============================================================================
function sendResponse(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function sendError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

let stdinBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  stdinBuffer += chunk;
  const lines = stdinBuffer.split('\n');
  stdinBuffer = lines.pop();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (_) {
      continue;
    }

    const { id, method, params } = msg;

    if (method === 'initialize') {
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'gnome-erd-mcp',
          version: '1.0.0'
        }
      });
    } else if (method === 'notifications/initialized') {
      // Notificación sin respuesta
    } else if (method === 'ping') {
      sendResponse(id, {});
    } else if (method === 'tools/list') {
      sendResponse(id, { tools: TOOLS });
    } else if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      handleToolCall(toolName, toolArgs)
        .then(data => {
          sendResponse(id, {
            content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
          });
        })
        .catch(err => {
          sendResponse(id, {
            isError: true,
            content: [{ type: 'text', text: `Error: ${err.message}` }]
          });
        });
    } else if (id !== undefined) {
      sendError(id, -32601, `Método no soportado: ${method}`);
    }
  }
});
