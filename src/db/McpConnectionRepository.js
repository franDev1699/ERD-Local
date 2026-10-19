// src/db/McpConnectionRepository.js
const db = require('./connection');

class McpConnectionRepository {
  static getConnectionsByProject(projectId) {
    try {
      const stmt = db.prepare(`
        SELECT id, project_id, name, type, command, args, env, url, db_path, is_read_only, created_at, updated_at
        FROM mcp_connections
        WHERE project_id = ?
        ORDER BY created_at DESC
      `);
      return stmt.all(projectId);
    } catch (err) {
      console.error('[McpConnectionRepository] Error en getConnectionsByProject:', err.message);
      return [];
    }
  }

  static getConnectionById(id) {
    try {
      const stmt = db.prepare(`
        SELECT * FROM mcp_connections WHERE id = ?
      `);
      return stmt.get(id);
    } catch (err) {
      console.error('[McpConnectionRepository] Error en getConnectionById:', err.message);
      return null;
    }
  }

  static createConnection({ id, project_id, name, type, command = null, args = null, env = null, url = null, db_path = null, is_read_only = 1 }) {
    try {
      const stmt = db.prepare(`
        INSERT INTO mcp_connections (id, project_id, name, type, command, args, env, url, db_path, is_read_only, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);
      stmt.run(id, project_id, name, type, command, args, env, url, db_path, is_read_only ? 1 : 0);
      return this.getConnectionById(id);
    } catch (err) {
      console.error('[McpConnectionRepository] Error en createConnection:', err.message);
      throw err;
    }
  }

  static updateConnection(id, { name, type, command = null, args = null, env = null, url = null, db_path = null, is_read_only = 1 }) {
    try {
      const stmt = db.prepare(`
        UPDATE mcp_connections
        SET name = ?, type = ?, command = ?, args = ?, env = ?, url = ?, db_path = ?, is_read_only = ?, updated_at = datetime('now')
        WHERE id = ?
      `);
      stmt.run(name, type, command, args, env, url, db_path, is_read_only ? 1 : 0, id);
      return this.getConnectionById(id);
    } catch (err) {
      console.error('[McpConnectionRepository] Error en updateConnection:', err.message);
      throw err;
    }
  }

  static deleteConnection(id) {
    try {
      const stmt = db.prepare('DELETE FROM mcp_connections WHERE id = ?');
      stmt.run(id);
      return true;
    } catch (err) {
      console.error('[McpConnectionRepository] Error en deleteConnection:', err.message);
      throw err;
    }
  }
}

module.exports = McpConnectionRepository;
