// src/db/FeedbackRepository.js
const db = require('./connection');

class FeedbackRepository {
  static createFeedback({ userId, type, subject, description }) {
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const sanitizedSubject = this._sanitize(subject);
      const sanitizedDesc = this._sanitize(description);
      const stmt = db.prepare(`
        INSERT INTO feedback (id, user_id, type, subject, description, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'new', ?, ?)
      `);
      stmt.run(id, userId, type, sanitizedSubject, sanitizedDesc, now, now);
      return this._toFullObject(this.getFeedbackById(id));
    } catch (err) {
      console.error('[FeedbackRepository] Error en createFeedback:', err.message);
      throw err;
    }
  }

  static getFeedbackByUserId(userId, onlyOwn) {
    try {
      let rows;
      if (onlyOwn) {
        const stmt = db.prepare('SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC');
        rows = stmt.all(userId);
      } else {
        rows = this.getAllFeedbackRaw();
      }
      return rows.map(r => this._toFullObject(r));
    } catch (err) {
      console.error('[FeedbackRepository] Error en getFeedbackByUserId:', err.message);
      return [];
    }
  }

  static getAllFeedback() {
    try {
      const rows = this.getAllFeedbackRaw();
      return rows.map(r => this._toFullObject(r));
    } catch (err) {
      console.error('[FeedbackRepository] Error en getAllFeedback:', err.message);
      return [];
    }
  }

  static getAllFeedbackRaw() {
    const stmt = db.prepare(`
      SELECT f.*, u.display_name AS user_name, u.username, u.color AS user_color
      FROM feedback f
      JOIN users u ON f.user_id = u.id
      ORDER BY f.created_at DESC
    `);
    return stmt.all();
  }

  static getFeedbackById(id) {
    try {
      const stmt = db.prepare(`
        SELECT f.*, u.display_name AS user_name, u.username, u.color AS user_color
        FROM feedback f
        JOIN users u ON f.user_id = u.id
        WHERE f.id = ?
      `);
      return this._toFullObject(stmt.get(id));
    } catch (err) {
      console.error('[FeedbackRepository] Error en getFeedbackById:', err.message);
      return null;
    }
  }

  static updateStatus(id, status) {
    try {
      const now = new Date().toISOString();
      const stmt = db.prepare('UPDATE feedback SET status = ?, updated_at = ? WHERE id = ?');
      stmt.run(status, now, id);
      return this.getFeedbackById(id);
    } catch (err) {
      console.error('[FeedbackRepository] Error en updateStatus:', err.message);
      throw err;
    }
  }

  static deleteFeedback(id) {
    try {
      const stmt = db.prepare('DELETE FROM feedback WHERE id = ?');
      stmt.run(id);
      return true;
    } catch (err) {
      console.error('[FeedbackRepository] Error en deleteFeedback:', err.message);
      throw err;
    }
  }

  static _toFullObject(row) {
    if (!row) return null;
    return {
      id: row.id,
      user_id: row.user_id,
      user_name: row.user_name,
      username: row.username,
      user_color: row.user_color,
      type: row.type,
      subject: row.subject,
      description: row.description,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  static _sanitize(text) {
    if (!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
    return String(text).replace(/[&<>"']/g, (s) => map[s]);
  }
}

module.exports = FeedbackRepository;