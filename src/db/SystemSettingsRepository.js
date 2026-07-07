// src/db/SystemSettingsRepository.js
const db = require('./connection');

class SystemSettingsRepository {
  /**
   * Get a system setting value by key
   * @param {string} key - Setting key
   * @param {string} defaultValue - Default value if not found
   * @returns {string}
   */
  static getSetting(key, defaultValue = '') {
    try {
      const stmt = db.prepare('SELECT value FROM system_settings WHERE key = ?');
      const row = stmt.get(key);
      return row ? row.value : defaultValue;
    } catch (err) {
      console.error(`[SystemSettingsRepository] Error en getSetting para ${key}:`, err.message);
      return defaultValue;
    }
  }

  /**
   * Set/update a system setting
   * @param {string} key - Setting key
   * @param {string} value - Setting value
   * @returns {boolean}
   */
  static setSetting(key, value) {
    try {
      const stmt = db.prepare(`
        INSERT INTO system_settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `);
      stmt.run(key, String(value));
      return true;
    } catch (err) {
      console.error(`[SystemSettingsRepository] Error en setSetting para ${key}:`, err.message);
      return false;
    }
  }

  /**
   * Helper to check if public registration is allowed
   * Supports environment variable override if set
   * @returns {boolean}
   */
  static isPublicRegistrationAllowed() {
    // Environment variable takes precedence if explicitly provided
    if (process.env.ALLOW_PUBLIC_REGISTRATION !== undefined) {
      return process.env.ALLOW_PUBLIC_REGISTRATION === 'true' || process.env.ALLOW_PUBLIC_REGISTRATION === '1';
    }
    const val = this.getSetting('allow_public_registration', 'true');
    return val === 'true' || val === '1';
  }
}

module.exports = SystemSettingsRepository;
