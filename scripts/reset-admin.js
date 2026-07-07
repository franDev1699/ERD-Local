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
    
    // Check if the admin user exists
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
    
    if (existing) {
      const stmt = db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, is_admin = 1 WHERE username = ?');
      stmt.run(hash, salt, 'admin');
      console.log(`¡Contraseña de "admin" restablecida con éxito y privilegios de admin asegurados!`);
    } else {
      const id = 'u_admin_' + Date.now();
      const stmt = db.prepare('INSERT INTO users (id, username, password_hash, password_salt, display_name, color, is_admin) VALUES (?, ?, ?, ?, ?, ?, 1)');
      stmt.run(id, 'admin', hash, salt, 'Administrador', '#ef4444');
      console.log(`¡Usuario "admin" creado con éxito con privilegios de administrador!`);
    }
  } catch (e) {
    console.error('Error al configurar el usuario administrador:', e.message);
  }
  process.exit(0);
}
run();
