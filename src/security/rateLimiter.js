// src/security/rateLimiter.js

class RateLimiter {
  constructor() {
    // Structure: { [ip]: { loginAttempts: [timestamp, ...], registerAttempts: [timestamp, ...], consecutiveBlocks: 0, blockedUntil: timestamp } }
    this.store = new Map();
    
    // Auto-cleanup every 10 minutes
    setInterval(() => this.cleanup(), 10 * 60 * 1000).unref();
  }

  /**
   * Check if an IP exceeds the rate limits for login
   * @param {string} ip - Client IP
   * @returns {{ allowed: boolean, timeLeft: number }}
   */
  checkLogin(ip) {
    const now = Date.now();
    let record = this.store.get(ip);
    
    if (!record) {
      record = { loginAttempts: [], registerAttempts: [], consecutiveBlocks: 0, blockedUntil: 0 };
      this.store.set(ip, record);
    }

    // Check temporary blocks
    if (record.blockedUntil > now) {
      return { allowed: false, timeLeft: Math.ceil((record.blockedUntil - now) / 1000) };
    }

    // Filter login attempts in the last 60 seconds
    const oneMinuteAgo = now - 60 * 1000;
    record.loginAttempts = record.loginAttempts.filter(ts => ts > oneMinuteAgo);

    // Limit to 5 login attempts per minute
    if (record.loginAttempts.length >= 5) {
      // Apply progressive block
      record.consecutiveBlocks++;
      let blockDuration = 60 * 1000; // Default 1 minute
      if (record.consecutiveBlocks === 2) {
        blockDuration = 5 * 60 * 1000; // 5 minutes
      } else if (record.consecutiveBlocks >= 3) {
        blockDuration = 15 * 60 * 1000; // 15 minutes
      }
      
      record.blockedUntil = now + blockDuration;
      return { allowed: false, timeLeft: blockDuration / 1000 };
    }

    return { allowed: true, timeLeft: 0 };
  }

  /**
   * Record a login attempt (usually called on failure)
   * @param {string} ip - Client IP
   */
  recordLoginAttempt(ip) {
    const record = this.store.get(ip);
    if (record) {
      record.loginAttempts.push(Date.now());
    }
  }

  /**
   * Reset block counter on successful login
   * @param {string} ip - Client IP
   */
  resetLoginBlocks(ip) {
    const record = this.store.get(ip);
    if (record) {
      record.loginAttempts = [];
      record.consecutiveBlocks = 0;
      record.blockedUntil = 0;
    }
  }

  /**
   * Check if an IP exceeds the rate limits for registration
   * @param {string} ip - Client IP
   * @returns {{ allowed: boolean, timeLeft: number }}
   */
  checkRegister(ip) {
    const now = Date.now();
    let record = this.store.get(ip);

    if (!record) {
      record = { loginAttempts: [], registerAttempts: [], consecutiveBlocks: 0, blockedUntil: 0 };
      this.store.set(ip, record);
    }

    // Filter register attempts in the last hour
    const oneHourAgo = now - 60 * 60 * 1000;
    record.registerAttempts = record.registerAttempts.filter(ts => ts > oneHourAgo);

    // Limit to 3 register attempts per hour
    if (record.registerAttempts.length >= 3) {
      const oldestAttempt = record.registerAttempts[0];
      const timeLeft = Math.ceil((oldestAttempt + 60 * 60 * 1000 - now) / 1000);
      return { allowed: false, timeLeft };
    }

    return { allowed: true, timeLeft: 0 };
  }

  /**
   * Record a register attempt
   * @param {string} ip - Client IP
   */
  recordRegisterAttempt(ip) {
    const record = this.store.get(ip);
    if (record) {
      record.registerAttempts.push(Date.now());
    }
  }

  /**
   * Cleanup IPs that have no active blocks or recent attempts to prevent memory leaks
   */
  cleanup() {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const oneMinuteAgo = now - 60 * 1000;

    for (const [ip, record] of this.store.entries()) {
      if (record.blockedUntil <= now) {
        // Filter recent activities
        const activeLogin = record.loginAttempts.some(ts => ts > oneMinuteAgo);
        const activeRegister = record.registerAttempts.some(ts => ts > oneHourAgo);

        if (!activeLogin && !activeRegister) {
          this.store.delete(ip);
        }
      }
    }
  }
}

module.exports = new RateLimiter();
