// src/db/UserAiConfigRepository.js
const db = require('./connection');

class UserAiConfigRepository {
  static getUserConfig(userId) {
    try {
      const stmt = db.prepare('SELECT * FROM user_ai_configs WHERE user_id = ?');
      const row = stmt.get(userId);
      return row || null;
    } catch (err) {
      console.error('[UserAiConfigRepository] Error en getUserConfig:', err.message);
      return null;
    }
  }

  static saveUserConfig(userId, { provider, model, apiKey, apiUrl, enableThinking }) {
    try {
      const existing = this.getUserConfig(userId);
      let finalApiKey = apiKey || '';

      // If apiKey is masked, keep the existing one from the database
      if (finalApiKey === '••••••••' || finalApiKey.trim() === '') {
        if (existing) {
          finalApiKey = existing.api_key || '';
        }
      }

      const stmt = db.prepare(`
        INSERT INTO user_ai_configs (user_id, provider, model, api_key, api_url, enable_thinking)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          provider = excluded.provider,
          model = excluded.model,
          api_key = excluded.api_key,
          api_url = excluded.api_url,
          enable_thinking = excluded.enable_thinking,
          updated_at = datetime('now')
      `);
      stmt.run(userId, provider, model || null, finalApiKey, apiUrl || null, enableThinking ? 1 : 0);
      return true;
    } catch (err) {
      console.error('[UserAiConfigRepository] Error en saveUserConfig:', err.message);
      throw err;
    }
  }
}

module.exports = UserAiConfigRepository;
