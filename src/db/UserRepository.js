// src/db/UserRepository.js
const db = require('./connection');

class UserRepository {
  static getUserById(id) {
    try {
      const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
      return stmt.get(id);
    } catch (err) {
      console.error('[UserRepository] Error en getUserById:', err.message);
      return null;
    }
  }

  static getUserByUsername(username) {
    try {
      const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
      return stmt.get(username);
    } catch (err) {
      console.error('[UserRepository] Error en getUserByUsername:', err.message);
      return null;
    }
  }

  static createUser({ id, username, password_hash, password_salt, display_name, color, is_admin }) {
    try {
      const stmt = db.prepare(`
        INSERT INTO users (id, username, password_hash, password_salt, display_name, color, is_admin)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, username, password_hash, password_salt, display_name, color || '#6366f1', is_admin ? 1 : 0);
      return this.getUserById(id);
    } catch (err) {
      console.error('[UserRepository] Error en createUser:', err.message);
      throw err;
    }
  }

  static updateUser(id, { display_name, color, is_admin, password_hash, password_salt }) {
    try {
      if (password_hash && password_salt) {
        const stmt = db.prepare(`
          UPDATE users
          SET display_name = ?, color = ?, is_admin = ?, password_hash = ?, password_salt = ?
          WHERE id = ?
        `);
        stmt.run(display_name, color, is_admin ? 1 : 0, password_hash, password_salt, id);
      } else {
        const stmt = db.prepare(`
          UPDATE users
          SET display_name = ?, color = ?, is_admin = ?
          WHERE id = ?
        `);
        stmt.run(display_name, color, is_admin ? 1 : 0, id);
      }
      return this.getUserById(id);
    } catch (err) {
      console.error('[UserRepository] Error en updateUser:', err.message);
      throw err;
    }
  }

  static deleteUser(id) {
    try {
      const stmt = db.prepare('DELETE FROM users WHERE id = ?');
      stmt.run(id);
      return true;
    } catch (err) {
      console.error('[UserRepository] Error en deleteUser:', err.message);
      throw err;
    }
  }

  static listAllUsers() {
    try {
      const stmt = db.prepare('SELECT id, username, display_name, color, is_admin, created_at FROM users ORDER BY username ASC');
      return stmt.all();
    } catch (err) {
      console.error('[UserRepository] Error en listAllUsers:', err.message);
      return [];
    }
  }
}

module.exports = UserRepository;
