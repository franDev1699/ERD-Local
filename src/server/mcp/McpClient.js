// src/server/mcp/McpClient.js
const { spawn } = require('node:child_process');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const fs = require('node:fs');

// Attempt native SQLite
let DatabaseSync;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (e) {
  DatabaseSync = null;
}

/**
 * Base MCP Client interface
 */
class BaseMcpClient {
  async test() {
    throw new Error('test() not implemented');
  }
  async listTools() {
    throw new Error('listTools() not implemented');
  }
  async callTool(name, args = {}) {
    throw new Error('callTool() not implemented');
  }
  async introspectSchema() {
    throw new Error('introspectSchema() not implemented');
  }
  async executeQuery(sql) {
    throw new Error('executeQuery() not implemented');
  }
  close() {}
}

function assertSafeReadOnlySql(sql) {
  const stripped = String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .trim();

  if (!stripped) {
    throw new Error('Consulta SQL vacía');
  }

  const withoutTrailingSemicolon = stripped.replace(/;+\s*$/, '');
  if (withoutTrailingSemicolon.includes(';')) {
    throw new Error('Operación bloqueada: No se permiten múltiples sentencias SQL encadenadas (;).');
  }

  const withoutStrings = withoutTrailingSemicolon
    .replace(/'([^'\\]|\\.)*'/g, "''")
    .replace(/"([^"\\]|\\.)*"/g, '""');

  const writeKeywords = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE|ATTACH|DETACH|VACUUM|REINDEX|RENAME|CALL|EXEC|EXECUTE|LOAD|INTO\s+OUTFILE|INTO\s+DUMPFILE)\b/i;
  if (writeKeywords.test(withoutStrings)) {
    throw new Error('Operación bloqueada: La conexión está configurada en modo SÓLO LECTURA.');
  }

  const allowedStart = /^(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN|PRAGMA|WITH)\b/i;
  if (!allowedStart.test(withoutStrings)) {
    throw new Error('Operación bloqueada: Solo se permiten consultas de lectura (SELECT, SHOW, DESCRIBE, EXPLAIN, WITH).');
  }
}

/**
 * Built-in SQLite MCP Adapter (Zero dependencies)
 * Emulates a full-featured MCP Database Server using Node.js native sqlite
 */
class BuiltinSqliteMcpClient extends BaseMcpClient {
  constructor(config) {
    super();
    this.config = config;
    this.dbPath = config.db_path 
      ? path.resolve(config.db_path) 
      : path.join(__dirname, '..', '..', '..', 'data', 'app.db');
    this.isReadOnly = config.is_read_only !== 0;
    this.db = null;
  }

  _getDb() {
    if (!this.db) {
      if (!DatabaseSync) {
        throw new Error('node:sqlite no está disponible en este entorno Node.js');
      }
      if (!fs.existsSync(this.dbPath)) {
        throw new Error(`El archivo de base de datos no existe: ${this.dbPath}`);
      }
      this.db = new DatabaseSync(this.dbPath, { readOnly: this.isReadOnly });
    }
    return this.db;
  }

  async test() {
    const db = this._getDb();
    const tables = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get();
    const tools = await this.listTools();
    return {
      connected: true,
      serverInfo: {
        name: 'erd-builtin-sqlite-mcp',
        version: '1.0.0',
        dbPath: this.dbPath,
        tableCount: tables.count
      },
      tools
    };
  }

  async listTools() {
    return [
      {
        name: 'list_tables',
        description: 'Lista todas las tablas de usuario en la base de datos',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'describe_table',
        description: 'Describe las columnas, tipos y claves primarias de una tabla',
        inputSchema: {
          type: 'object',
          properties: { table: { type: 'string', description: 'Nombre de la tabla' } },
          required: ['table']
        }
      },
      {
        name: 'list_foreign_keys',
        description: 'Lista las llaves foráneas y relaciones de una tabla',
        inputSchema: {
          type: 'object',
          properties: { table: { type: 'string', description: 'Nombre de la tabla' } },
          required: ['table']
        }
      },
      {
        name: 'execute_query',
        description: 'Ejecuta una consulta SQL en la base de datos (restringido a lectura si está configurado)',
        inputSchema: {
          type: 'object',
          properties: { sql: { type: 'string', description: 'Consulta SQL a ejecutar' } },
          required: ['sql']
        }
      },
      {
        name: 'get_schema',
        description: 'Introspecciona el esquema completo (tablas, campos y relaciones) para el diseñador ERD',
        inputSchema: { type: 'object', properties: {} }
      }
    ];
  }

  async callTool(name, args = {}) {
    const db = this._getDb();
    switch (name) {
      case 'list_tables': {
        const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_migrations' ORDER BY name").all();
        return { tables: rows.map(r => r.name) };
      }
      case 'describe_table': {
        const table = args.table;
        if (!table) throw new Error('Parámetro "table" requerido');
        const rows = db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all();
        return { columns: rows };
      }
      case 'list_foreign_keys': {
        const table = args.table;
        if (!table) throw new Error('Parámetro "table" requerido');
        const rows = db.prepare(`PRAGMA foreign_key_list("${table.replace(/"/g, '""')}")`).all();
        return { foreignKeys: rows };
      }
      case 'execute_query': {
        return this.executeQuery(args.sql);
      }
      case 'get_schema': {
        return this.introspectSchema();
      }
      default:
        throw new Error(`Herramienta no encontrada: ${name}`);
    }
  }

  async introspectSchema() {
    const db = this._getDb();
    const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_migrations' ORDER BY name").all();

    const tables = [];
    const relationships = [];
    const tableMap = new Map();

    const START_X = 80;
    const START_Y = 80;
    const SPACING_X = 280;
    const SPACING_Y = 240;
    const COLS = 4;

    tableRows.forEach((tr, index) => {
      const tableName = tr.name;
      const tableId = `tbl-${Date.now()}-${index}`;
      tableMap.set(tableName, tableId);

      const colRows = db.prepare(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`).all();
      const fields = colRows.map((col, fIndex) => ({
        id: `fld-${tableId}-${fIndex}`,
        name: col.name,
        type: (col.type || 'TEXT').toUpperCase(),
        isPK: col.pk === 1,
        isNullable: col.notnull === 0,
        defaultValue: col.dflt_value || null
      }));

      const colPos = index % COLS;
      const rowPos = Math.floor(index / COLS);

      tables.push({
        id: tableId,
        name: tableName,
        x: START_X + colPos * SPACING_X,
        y: START_Y + rowPos * SPACING_Y,
        fields,
        comment: ''
      });
    });

    // Foreign Keys
    let relIndex = 0;
    tableRows.forEach(tr => {
      const fromTableName = tr.name;
      const fromTableId = tableMap.get(fromTableName);
      const fkRows = db.prepare(`PRAGMA foreign_key_list("${fromTableName.replace(/"/g, '""')}")`).all();

      fkRows.forEach(fk => {
        const toTableName = fk.table;
        const toTableId = tableMap.get(toTableName);
        if (!toTableId) return;

        const fromTableObj = tables.find(t => t.id === fromTableId);
        const toTableObj = tables.find(t => t.id === toTableId);

        const fromField = fromTableObj?.fields.find(f => f.name.toLowerCase() === fk.from.toLowerCase());
        const toField = toTableObj?.fields.find(f => f.name.toLowerCase() === fk.to.toLowerCase());

        if (fromField && toField) {
          relIndex++;
          relationships.push({
            id: `rel-mcp-${Date.now()}-${relIndex}`,
            fromTable: fromTableId,
            fromField: fromField.id,
            toTable: toTableId,
            toField: toField.id,
            cardinality: '1:N',
            onDelete: fk.on_delete || 'NO ACTION',
            onUpdate: fk.on_update || 'NO ACTION'
          });
        }
      });
    });

    return {
      tables,
      relationships
    };
  }

  async executeQuery(sql) {
    if (!sql || typeof sql !== 'string') {
      throw new Error('Consulta SQL requerida');
    }

    const trimmed = sql.trim();
    if (!trimmed) {
      throw new Error('Consulta SQL vacía');
    }

    if (this.isReadOnly) {
      assertSafeReadOnlySql(trimmed);
    }

    const startTime = Date.now();
    const db = this._getDb();

    try {
      const stmt = db.prepare(trimmed);
      const rows = stmt.all();
      const executionTimeMs = Date.now() - startTime;

      let columns = [];
      if (rows.length > 0) {
        columns = Object.keys(rows[0]).map(colName => ({
          name: colName,
          type: typeof rows[0][colName]
        }));
      }

      return {
        columns,
        rows: rows.slice(0, 500), // Max 500 rows preview
        totalCount: rows.length,
        executionTimeMs
      };
    } catch (err) {
      throw new Error(`Error en ejecución SQL: ${err.message}`);
    }
  }

  close() {
    if (this.db) {
      try {
        this.db.close();
      } catch (e) {}
      this.db = null;
    }
  }
}

/**
 * Standard Stdio MCP Client (Zero external dependencies)
 * Manages child process lifecycle, JSON-RPC 2.0 message framing over stdin/stdout
 */
class StdioMcpClient extends BaseMcpClient {
  constructor(config) {
    super();
    this.config = config;
    this.command = config.command || 'npx';
    this.args = this._parseArgs(config.args);
    this.env = this._parseEnv(config.env);
    this.isReadOnly = config.is_read_only !== 0;
    this.child = null;
    this.messageId = 1;
    this.pendingRequests = new Map();
    this.buffer = '';
    this.initialized = false;
  }

  _parseArgs(args) {
    if (Array.isArray(args)) return args;
    if (typeof args === 'string') {
      try {
        const parsed = JSON.parse(args);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        return args.split(' ').filter(Boolean);
      }
    }
    return [];
  }

  _parseEnv(env) {
    if (typeof env === 'object' && env !== null) return env;
    if (typeof env === 'string') {
      try {
        return JSON.parse(env);
      } catch (e) {
        return {};
      }
    }
    return {};
  }

  _startProcess() {
    if (this.child) return;

    const childEnv = { ...process.env, ...this.env };
    this.child = spawn(this.command, this.args, {
      env: childEnv,
      shell: process.platform === 'win32'
    });

    this.child.stdout.on('data', chunk => {
      this.buffer += chunk.toString('utf8');
      this._processBuffer();
    });

    this.stderrTail = '';
    this.child.stderr.on('data', chunk => {
      const text = chunk.toString('utf8');
      this.stderrTail = (this.stderrTail + text).slice(-600);
      console.warn(`[StdioMcpClient ${this.config.name}] stderr:`, text.trim());
    });

    this.child.on('error', err => {
      console.error(`[StdioMcpClient ${this.config.name}] Error del proceso:`, err.message);
      this._rejectAll(new Error(`Fallo al iniciar proceso MCP: ${err.message}`));
    });

    this.child.on('close', code => {
      const detail = this.stderrTail.trim() ? ` — ${this.stderrTail.trim()}` : '';
      this._rejectAll(new Error(`El servidor MCP se cerró con código: ${code}${detail}`));
      this.child = null;
    });
  }

  _processBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop(); // keep partial trailing line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const message = JSON.parse(trimmed);
        if (message.id !== undefined && this.pendingRequests.has(message.id)) {
          const { resolve, reject } = this.pendingRequests.get(message.id);
          this.pendingRequests.delete(message.id);
          if (message.error) {
            reject(new Error(message.error.message || JSON.stringify(message.error)));
          } else {
            resolve(message.result);
          }
        }
      } catch (e) {
        // Not a JSON-RPC message, might be stdout log
      }
    }
  }

  _rejectAll(error) {
    for (const { reject } of this.pendingRequests.values()) {
      reject(error);
    }
    this.pendingRequests.clear();
  }

  _send(method, params = {}, isNotification = false) {
    this._startProcess();

    return new Promise((resolve, reject) => {
      const id = isNotification ? undefined : this.messageId++;
      const payload = {
        jsonrpc: '2.0',
        ...(id !== undefined ? { id } : {}),
        method,
        params
      };

      if (!isNotification) {
        // First run of `npx -y` downloads the package; give initialize more time
        const timeoutMs = method === 'initialize' ? 90000 : 30000;
        const timeout = setTimeout(() => {
          if (this.pendingRequests.has(id)) {
            this.pendingRequests.delete(id);
            reject(new Error(`Tiempo de espera agotado (${timeoutMs / 1000}s) para ${method}`));
          }
        }, timeoutMs);

        this.pendingRequests.set(id, {
          resolve: res => {
            clearTimeout(timeout);
            resolve(res);
          },
          reject: err => {
            clearTimeout(timeout);
            reject(err);
          }
        });
      }

      this.child.stdin.write(JSON.stringify(payload) + '\n');
      if (isNotification) {
        resolve();
      }
    });
  }

  async _ensureInitialized() {
    if (this.initialized) return;
    const initRes = await this._send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'erd-designer',
        version: '1.0.0'
      }
    });
    await this._send('notifications/initialized', {}, true);
    this.initialized = true;
    return initRes;
  }

  async test() {
    const initRes = await this._ensureInitialized();
    const tools = await this.listTools();
    return {
      connected: true,
      serverInfo: initRes?.serverInfo || { name: this.config.name },
      tools
    };
  }

  async listTools() {
    await this._ensureInitialized();
    const res = await this._send('tools/list', {});
    return res?.tools || [];
  }

  async callTool(name, args = {}) {
    await this._ensureInitialized();
    const res = await this._send('tools/call', { name, arguments: args });
    return res;
  }

  async introspectSchema() {
    const tools = await this.listTools();
    const toolNames = tools.map(t => t.name.toLowerCase());

    // Try schema or query tools
    if (toolNames.includes('get_schema')) {
      const res = await this.callTool('get_schema', {});
      return this._extractResultData(res);
    }

    if (toolNames.includes('list_tables') || toolNames.includes('list-tables')) {
      const listTool = tools.find(t => t.name.toLowerCase().includes('list_table') || t.name.toLowerCase().includes('list-table'));
      const listRes = await this.callTool(listTool.name, {});
      const tableData = this._extractResultData(listRes);
      const tableNames = Array.isArray(tableData) ? tableData : (tableData.tables || []);

      const tables = [];
      const START_X = 80;
      const START_Y = 80;
      const SPACING_X = 280;
      const SPACING_Y = 240;
      const COLS = 4;

      for (let i = 0; i < tableNames.length; i++) {
        const rawName = typeof tableNames[i] === 'string' ? tableNames[i] : (tableNames[i].name || tableNames[i].table_name);
        const tableId = `tbl-${Date.now()}-${i}`;
        const fields = [];

        // Describe table if tool exists
        const describeTool = tools.find(t => t.name.toLowerCase().includes('describe') || t.name.toLowerCase().includes('schema'));
        if (describeTool) {
          try {
            const descRes = await this.callTool(describeTool.name, { table: rawName, tableName: rawName });
            const descData = this._extractResultData(descRes);
            const cols = descData.columns || (Array.isArray(descData) ? descData : []);
            cols.forEach((col, fIdx) => {
              fields.push({
                id: `fld-${tableId}-${fIdx}`,
                name: col.name || col.column_name || `field_${fIdx + 1}`,
                type: (col.type || col.data_type || 'VARCHAR').toUpperCase(),
                isPK: Boolean(col.pk || col.is_primary || col.primary_key),
                isNullable: col.nullable !== false && col.notnull !== 1
              });
            });
          } catch (e) {}
        }

        if (fields.length === 0) {
          fields.push({ id: `fld-${tableId}-0`, name: 'id', type: 'INT', isPK: true, isNullable: false });
        }

        const colPos = i % COLS;
        const rowPos = Math.floor(i / COLS);

        tables.push({
          id: tableId,
          name: rawName,
          x: START_X + colPos * SPACING_X,
          y: START_Y + rowPos * SPACING_Y,
          fields,
          comment: ''
        });
      }

      return { tables, relationships: [] };
    }

    // Fallback: servers exposing only a SQL tool (e.g. mysql_query) → information_schema
    if (this._findQueryTool(tools)) {
      return this._introspectViaInformationSchema();
    }

    throw new Error('El servidor MCP no expone herramientas de introspección (get_schema, list_tables) ni de consulta SQL.');
  }

  _findQueryTool(tools) {
    const names = ['execute_sql', 'mysql_query', 'execute_query', 'query', 'read_query', 'sql_query', 'run_query'];
    return tools.find(t => names.includes(t.name.toLowerCase()));
  }

  async _runRows(sql) {
    const result = await this.executeQuery(sql, { skipLimit: true });
    return result.rows || [];
  }

  async _introspectViaInformationSchema() {
    const pick = (row, key) => row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()];

    const colRows = await this._runRows(`
      SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, ORDINAL_POSITION
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, ORDINAL_POSITION`);

    const fkRows = await this._runRows(`
      SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`);

    const START_X = 80, START_Y = 80, SPACING_X = 280, SPACING_Y = 240, COLS = 4;
    const stamp = Date.now();
    const tableMap = new Map();
    const tables = [];

    colRows.forEach(row => {
      const tName = pick(row, 'TABLE_NAME');
      let table = tableMap.get(tName);
      if (!table) {
        const index = tables.length;
        table = {
          id: `tbl-${stamp}-${index}`,
          name: tName,
          x: START_X + (index % COLS) * SPACING_X,
          y: START_Y + Math.floor(index / COLS) * SPACING_Y,
          fields: [],
          comment: ''
        };
        tableMap.set(tName, table);
        tables.push(table);
      }
      table.fields.push({
        id: `fld-${table.id}-${table.fields.length}`,
        name: pick(row, 'COLUMN_NAME'),
        type: String(pick(row, 'COLUMN_TYPE') || 'VARCHAR').toUpperCase(),
        isPK: pick(row, 'COLUMN_KEY') === 'PRI',
        isNullable: pick(row, 'IS_NULLABLE') === 'YES',
        defaultValue: pick(row, 'COLUMN_DEFAULT') ?? null
      });
    });

    const relationships = [];
    fkRows.forEach((row, i) => {
      const from = tableMap.get(pick(row, 'TABLE_NAME'));
      const to = tableMap.get(pick(row, 'REFERENCED_TABLE_NAME'));
      if (!from || !to) return;
      const fromField = from.fields.find(f => f.name === pick(row, 'COLUMN_NAME'));
      const toField = to.fields.find(f => f.name === pick(row, 'REFERENCED_COLUMN_NAME'));
      if (!fromField || !toField) return;
      relationships.push({
        id: `rel-mcp-${stamp}-${i}`,
        fromTable: from.id,
        fromField: fromField.id,
        toTable: to.id,
        toField: toField.id,
        cardinality: '1:N'
      });
    });

    return { tables, relationships };
  }

  async executeQuery(sql, { skipLimit = false } = {}) {
    if (this.isReadOnly) {
      assertSafeReadOnlySql(sql);
    }

    const tools = await this.listTools();
    const queryTool = this._findQueryTool(tools);

    if (!queryTool) {
      throw new Error('El servidor MCP no expone una herramienta para ejecutar consultas SQL (ej: execute_sql, mysql_query o execute_query).');
    }

    const startTime = Date.now();
    const res = await this.callTool(queryTool.name, { query: sql, sql });
    const executionTimeMs = Date.now() - startTime;
    if (res?.isError) {
      const msg = res.content?.find(c => c.type === 'text')?.text || 'Error del servidor MCP';
      throw new Error(msg);
    }
    const data = this._extractResultData(res);

    let rows = Array.isArray(data) ? data : (data.rows || []);
    let columns = [];
    if (rows.length > 0 && typeof rows[0] === 'object') {
      columns = Object.keys(rows[0]).map(k => ({ name: k, type: typeof rows[0][k] }));
    }

    return {
      columns,
      rows: skipLimit ? rows : rows.slice(0, 500),
      totalCount: rows.length,
      executionTimeMs
    };
  }

  _extractResultData(mcpRes) {
    if (!mcpRes) return {};
    if (mcpRes.content && Array.isArray(mcpRes.content)) {
      const textItem = mcpRes.content.find(c => c.type === 'text');
      if (textItem && textItem.text) {
        try {
          return JSON.parse(textItem.text);
        } catch (e) {
          const jsonMatch = textItem.text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
          if (jsonMatch) {
            try {
              return JSON.parse(jsonMatch[0]);
            } catch (err) {}
          }
          return { text: textItem.text };
        }
      }
    }
    return mcpRes;
  }

  close() {
    if (this.child) {
      try {
        this.child.kill();
      } catch (e) {}
      this.child = null;
    }
    this._rejectAll(new Error('Conexión cerrada'));
  }
}

/**
 * Standard HTTP / SSE MCP Client (Zero external dependencies)
 */
class HttpMcpClient extends BaseMcpClient {
  constructor(config) {
    super();
    this.config = config;
    this.url = config.url;
    this.isReadOnly = config.is_read_only !== 0;
    this.messageId = 1;
  }

  _post(body) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(this.url);
      const isHttps = parsedUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const payload = JSON.stringify(body);
      const req = transport.request(parsedUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 15000
      }, res => {
        let resData = '';
        res.on('data', chunk => { resData += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(resData);
            if (json.error) {
              reject(new Error(json.error.message || JSON.stringify(json.error)));
            } else {
              resolve(json.result !== undefined ? json.result : json);
            }
          } catch (e) {
            resolve({ raw: resData });
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout de conexión HTTP MCP (15s)'));
      });
      req.write(payload);
      req.end();
    });
  }

  async test() {
    const tools = await this.listTools();
    return {
      connected: true,
      serverInfo: { url: this.url },
      tools
    };
  }

  async listTools() {
    const res = await this._post({
      jsonrpc: '2.0',
      id: this.messageId++,
      method: 'tools/list',
      params: {}
    });
    return res?.tools || [];
  }

  async callTool(name, args = {}) {
    return await this._post({
      jsonrpc: '2.0',
      id: this.messageId++,
      method: 'tools/call',
      params: { name, arguments: args }
    });
  }

  async introspectSchema() {
    const tools = await this.listTools();
    const schemaTool = tools.find(t => ['get_schema', 'introspect', 'schema'].includes(t.name.toLowerCase()));
    if (schemaTool) {
      return await this.callTool(schemaTool.name, {});
    }
    throw new Error('El endpoint HTTP MCP no implementa get_schema');
  }

  async executeQuery(sql) {
    if (this.isReadOnly) {
      assertSafeReadOnlySql(sql);
    }
    const tools = await this.listTools();
    const queryTool = tools.find(t => ['execute_query', 'query', 'read_query'].includes(t.name.toLowerCase()));
    if (!queryTool) throw new Error('Herramienta execute_query no disponible en el servidor HTTP');
    return await this.callTool(queryTool.name, { sql, query: sql });
  }
}

/**
 * Factory helper
 */
class McpClientFactory {
  static createClient(config) {
    if (!config || !config.type) {
      throw new Error('Configuración de conexión MCP inválida');
    }

    switch (config.type) {
      case 'builtin_sqlite':
        return new BuiltinSqliteMcpClient(config);
      case 'stdio':
        return new StdioMcpClient(config);
      case 'http':
        return new HttpMcpClient(config);
      default:
        throw new Error(`Tipo de conexión MCP desconocido: ${config.type}`);
    }
  }
}

module.exports = {
  BaseMcpClient,
  BuiltinSqliteMcpClient,
  StdioMcpClient,
  HttpMcpClient,
  McpClientFactory
};
