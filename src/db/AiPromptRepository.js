// src/db/AiPromptRepository.js
const db = require('./connection');

class AiPromptRepository {
  /**
   * Retrieves the prompt template. Fallback to global if user-specific does not exist.
   */
  static getPrompt(userId, promptKey) {
    try {
      const stmt = db.prepare(`
        SELECT * FROM ai_prompt_configs
        WHERE (scope = 'user' AND user_id = ? AND prompt_key = ?)
           OR (scope = 'global' AND prompt_key = ?)
        ORDER BY (CASE WHEN scope = 'user' THEN 1 ELSE 2 END) ASC
        LIMIT 1
      `);
      return stmt.get(userId, promptKey, promptKey);
    } catch (err) {
      console.error('[AiPromptRepository] Error en getPrompt:', err.message);
      return null;
    }
  }

  /**
   * Saves or updates a prompt template.
   */
  static setPrompt(userId, promptKey, { promptTemplate, model, scope }) {
    try {
      if (scope === 'global') {
        const id = `p_global_${promptKey}`;
        const stmt = db.prepare(`
          INSERT INTO ai_prompt_configs (id, scope, user_id, prompt_key, prompt_template, model)
          VALUES (?, 'global', NULL, ?, ?, ?)
          ON CONFLICT(scope, user_id, prompt_key) DO UPDATE SET
            prompt_template = excluded.prompt_template,
            model = excluded.model,
            updated_at = datetime('now')
        `);
        stmt.run(id, promptKey, promptTemplate, model || null);
      } else {
        const id = `p_user_${userId}_${promptKey}`;
        const stmt = db.prepare(`
          INSERT INTO ai_prompt_configs (id, scope, user_id, prompt_key, prompt_template, model)
          VALUES (?, 'user', ?, ?, ?, ?)
          ON CONFLICT(scope, user_id, prompt_key) DO UPDATE SET
            prompt_template = excluded.prompt_template,
            model = excluded.model,
            updated_at = datetime('now')
        `);
        stmt.run(id, userId, promptKey, promptTemplate, model || null);
      }
      return true;
    } catch (err) {
      console.error('[AiPromptRepository] Error en setPrompt:', err.message);
      throw err;
    }
  }

  /**
   * Returns all active prompts for a user (merged user + global defaults).
   */
  static getPromptsForUser(userId) {
    try {
      const stmt = db.prepare(`
        SELECT prompt_key, prompt_template
        FROM (
          SELECT prompt_key, prompt_template, scope,
                 ROW_NUMBER() OVER (PARTITION BY prompt_key ORDER BY (CASE WHEN scope = 'user' THEN 1 ELSE 2 END) ASC) as rn
          FROM ai_prompt_configs
          WHERE (scope = 'user' AND user_id = ?) OR scope = 'global'
        )
        WHERE rn = 1
      `);
      const rows = stmt.all(userId || '');
      const result = {};
      for (const row of rows) {
        result[row.prompt_key] = row.prompt_template;
      }
      return result;
    } catch (err) {
      console.error('[AiPromptRepository] Error en getPromptsForUser:', err.message);
      return {};
    }
  }

  /**
   * Resets all user prompts overrides back to global defaults.
   */
  static resetUserPrompts(userId) {
    try {
      const stmt = db.prepare("DELETE FROM ai_prompt_configs WHERE scope = 'user' AND user_id = ?");
      stmt.run(userId);
      return true;
    } catch (err) {
      console.error('[AiPromptRepository] Error en resetUserPrompts:', err.message);
      throw err;
    }
  }
}

module.exports = AiPromptRepository;
