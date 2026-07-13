#!/usr/bin/env node
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'app.db');
const db = new DatabaseSync(dbPath);

const countBefore = db.prepare("SELECT COUNT(*) as c FROM ai_cache").get();
db.exec("DELETE FROM ai_cache");
console.log(`✅ Cache de IA limpiado. Se eliminaron ${countBefore.c} entradas.`);
db.close();
