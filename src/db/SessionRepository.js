// src/db/SessionRepository.js
const db = require('./connection');

class SessionRepository {
  static createSession({ token, user_id, expires_at }) {
    try {
      const stmt = db.prepare(`
        INSERT INTO sessions (token, user_id, expires_at)
        VALUES (?, ?, ?)
      `);
      stmt.run(token, user_id, expires_at);
      return this.getSession(token);
    } catch (err) {
      console.error('[SessionRepository] Error en createSession:', err.message);
      throw err;
    }
  }

  static getSession(token) {
    try {
      const stmt = db.prepare(`
        SELECT s.token, s.user_id, s.expires_at, u.username, u.display_name, u.color, u.is_admin
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
      `);
      return stmt.get(token);
    } catch (err) {
      console.error('[SessionRepository] Error en getSession:', err.message);
      return null;
    }
  }

  static deleteSession(token) {
    try {
      const stmt = db.prepare('DELETE FROM sessions WHERE token = ?');
      stmt.run(token);
      return true;
    } catch (err) {
      console.error('[SessionRepository] Error en deleteSession:', err.message);
      return false;
    }
  }

  static deleteExpiredSessions() {
    try {
      const stmt = db.prepare("DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')");
      const info = stmt.run();
      return info.changes;
    } catch (err) {
      console.error('[SessionRepository] Error en deleteExpiredSessions:', err.message);
      return 0;
    }
  }
}

module.exports = SessionRepository;
