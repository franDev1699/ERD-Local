// src/security/passwordValidator.js

/**
 * Validate password strength
 * @param {string} password - Plain text password
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePassword(password) {
  const errors = [];
  
  if (!password || password.length < 8) {
    errors.push("La contraseña debe tener al menos 8 caracteres.");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("La contraseña debe contener al menos una letra minúscula.");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("La contraseña debe contener al menos una letra mayúscula.");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("La contraseña debe contener al menos un número.");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  validatePassword
};
