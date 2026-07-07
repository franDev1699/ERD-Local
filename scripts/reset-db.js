// scripts/reset-db.js
const readline = require('readline');
const path = require('path');
const fs = require('fs');

// Import database connection and auth helper
const db = require('../src/db/connection');
const { hashPassword } = require('../src/db/auth');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const isForce = process.argv.includes('--force') || process.argv.includes('-y');

async function performReset() {
  try {
    console.log('\n🧹 Limpiando la base de datos...');

    // Disable foreign keys temporarily to truncate tables safely
    db.exec('PRAGMA foreign_keys = OFF;');
    
    db.exec('DELETE FROM sessions;');
    db.exec('DELETE FROM project_members;');
    db.exec('DELETE FROM projects;');
    db.exec('DELETE FROM ai_prompt_configs;');
    db.exec('DELETE FROM users;');
    
    db.exec('PRAGMA foreign_keys = ON;');
    
    console.log('✅ Tablas de datos vaciadas correctamente.');

    // Seed global prompts again
    console.log('🌱 Re-inicializando prompts de IA globales...');
    const promptsJsonPath = path.join(__dirname, '..', 'ai_prompts.json');
    let defaultPrompts = {};

    if (fs.existsSync(promptsJsonPath)) {
      try {
        defaultPrompts = JSON.parse(fs.readFileSync(promptsJsonPath, 'utf8'));
      } catch (jsonErr) {
        console.error('❌ Error al parsear ai_prompts.json:', jsonErr.message);
      }
    }

    const insertPrompt = db.prepare(`
      INSERT INTO ai_prompt_configs (id, scope, user_id, prompt_key, prompt_template, model)
      VALUES (?, 'global', NULL, ?, ?, NULL)
    `);

    for (const [key, value] of Object.entries(defaultPrompts)) {
      const id = `p_global_${key}`;
      insertPrompt.run(id, key, value);
    }
    console.log(`✅ Se insertaron ${Object.keys(defaultPrompts).length} prompts de IA globales.`);

    // Create the admin user
    let adminPassword = 'admin';
    if (!isForce) {
      adminPassword = await new Promise((resolve) => {
        rl.question('\nIntroduce la contraseña para el nuevo usuario administrador "admin": ', (pwd) => {
          resolve(pwd.trim() || 'admin');
        });
      });
    } else {
      console.log('\n⚠️ Se usó --force. Creando usuario "admin" con contraseña por defecto: "admin"');
    }

    const { hash, salt } = await hashPassword(adminPassword);
    const adminId = 'u_admin_' + Date.now();
    const insertAdmin = db.prepare('INSERT INTO users (id, username, password_hash, password_salt, display_name, color, is_admin) VALUES (?, ?, ?, ?, ?, ?, 1)');
    insertAdmin.run(adminId, 'admin', hash, salt, 'Administrador', '#ef4444');

    console.log('✅ Usuario "admin" creado con privilegios de administrador.');
    console.log('\n======================================================');
    console.log('🎉 ¡Base de datos restablecida con éxito!');
    console.log('======================================================\n');

  } catch (err) {
    console.error('❌ Error durante el restablecimiento de la base de datos:', err.message);
  } finally {
    rl.close();
    process.exit(0);
  }
}

if (isForce) {
  performReset();
} else {
  console.log('\n⚠️  ADVERTENCIA: Esta acción eliminará PERMANENTEMENTE todos los usuarios, sesiones, proyectos y configuraciones personalizadas de la base de datos.');
  rl.question('¿Estás seguro de que deseas continuar? (sí/no): ', (answer) => {
    const normalized = answer.trim().toLowerCase();
    if (normalized === 'si' || normalized === 'sí' || normalized === 'y' || normalized === 'yes') {
      performReset();
    } else {
      console.log('❌ Operación cancelada.\n');
      rl.close();
      process.exit(0);
    }
  });
}
