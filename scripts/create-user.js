// scripts/create-user.js
const readline = require('readline');
const { hashPassword } = require('../src/db/auth');
const UserRepository = require('../src/db/UserRepository');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('\n======================================================');
  console.log('Uso: node scripts/create-user.js <username> <display_name> [color] [admin|true]');
  console.log('Ejemplo: node scripts/create-user.js admin "Super Admin" "#ef4444" admin');
  console.log('======================================================\n');
  process.exit(1);
}

const username = args[0].trim();
const displayName = args[1].trim();
const color = args[2] || '#6366f1';
const isAdminArg = args[3];
const is_admin = (isAdminArg === 'admin' || isAdminArg === 'true' || isAdminArg === '1') ? 1 : 0;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Prompt for password
rl.question(`Introduce la contraseña para el usuario "${username}": `, async (password) => {
  rl.close();

  if (!password || password.trim().length === 0) {
    console.error('❌ Error: La contraseña no puede estar vacía.');
    process.exit(1);
  }

  try {
    // Check if user already exists
    const existing = UserRepository.getUserByUsername(username);
    if (existing) {
      console.error(`❌ Error: El usuario "${username}" ya existe en la base de datos.`);
      process.exit(1);
    }

    const { hash, salt } = await hashPassword(password.trim());
    const id = 'u_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    const user = UserRepository.createUser({
      id,
      username,
      password_hash: hash,
      password_salt: salt,
      display_name: displayName,
      color,
      is_admin
    });

    console.log('\n======================================================');
    console.log('✅ ¡Usuario creado exitosamente!');
    console.log('======================================================');
    console.log(`ID:           ${user.id}`);
    console.log(`Username:     ${user.username}`);
    console.log(`Display Name: ${user.display_name}`);
    console.log(`Color:        ${user.color}`);
    console.log(`Admin?:       ${user.is_admin === 1 ? 'SÍ' : 'NO'}`);
    console.log('======================================================\n');

  } catch (err) {
    console.error('❌ Error al crear el usuario:', err.message);
    process.exit(1);
  }
});
