const { hashPassword } = require('../src/db/auth');
const db = require('../src/db/connection');

async function run() {
  const newPassword = process.argv[2];
  if (!newPassword) {
    console.log('Uso: node scripts/reset-admin.js <nueva_contraseña>');
    process.exit(1);
  }

  try {
    const { hash, salt } = await hashPassword(newPassword);
    const stmt = db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, is_admin = 1 WHERE username = ?');
    stmt.run(hash, salt, 'admin');
    console.log(`¡Contraseña de "admin" restablecida con éxito y privilegios de admin asegurados!`);
  } catch (e) {
    console.error('Error al restablecer la contraseña:', e.message);
  }
  process.exit(0);
}
run();
