const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// SQLite connection & Repositories
const db = require('./src/db/connection');
const UserRepository = require('./src/db/UserRepository');
const SessionRepository = require('./src/db/SessionRepository');
const ProjectRepository = require('./src/db/ProjectRepository');
const AiPromptRepository = require('./src/db/AiPromptRepository');
const SystemSettingsRepository = require('./src/db/SystemSettingsRepository');
const UserAiConfigRepository = require('./src/db/UserAiConfigRepository');
const { hashPassword, verifyPassword } = require('./src/db/auth');
const rateLimiter = require('./src/security/rateLimiter');
const { validatePassword } = require('./src/security/passwordValidator');

const PORT = process.env.PORT || 3000;
const STATE_FILE = path.join(__dirname, 'shared_state.json');
const PROJECTS_DIR = path.join(__dirname, 'projects');

// Create projects directory if it doesn't exist
if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

// Ensure assets directory exists and copy the logo if present
const ASSETS_DIR = path.join(__dirname, 'assets', 'imgs');
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}
const logoSrc = path.join(__dirname, 'projects', 'imgs', 'gnomo-logo.png');
const logoDest = path.join(ASSETS_DIR, 'gnomo-logo.png');
if (fs.existsSync(logoSrc) && !fs.existsSync(logoDest)) {
  try {
    fs.copyFileSync(logoSrc, logoDest);
    console.log('Logo copiado automáticamente a assets/imgs/gnomo-logo.png');
  } catch (e) {
    console.error('Error copiando el logo a assets/imgs:', e.message);
  }
}



// Helper to get safe path for a project file
function getProjectPath(projectId) {
  const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(PROJECTS_DIR, `${safeId}.json`);
}

// Migrate old shared_state.json to projects/default.json if it exists
const defaultPath = getProjectPath('default');
if (!fs.existsSync(defaultPath) && fs.existsSync(STATE_FILE)) {
  try {
    fs.copyFileSync(STATE_FILE, defaultPath);
    console.log('Migrado shared_state.json a projects/default.json');
  } catch (e) {
    console.error('Error migrando el estado por defecto:', e.message);
  }
}

const VALID_PROMPT_KEYS = [
  'expectedSchemaText', 'layoutRulesText', 'mode_create', 'mode_append', 
  'mode_edit', 'mode_layout', 'mode_query_generate', 'mode_query_suggest', 
  'mode_query_explain', 'prompt_document'
];


// MIME types mapping
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIP();

// Load project state from disk
function loadProjectState(projectId) {
  const filePath = getProjectPath(projectId);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.error(`Error al cargar el proyecto ${projectId}:`, e.message);
    }
  }
  return null;
}

// Map to track the last backup date per project
const lastBackupDates = {};

function saveProjectState(projectId, state) {
  const filePath = getProjectPath(projectId);
  const dateStr = new Date().toISOString().split('T')[0];
  const lastBackupDate = lastBackupDates[projectId] || '';

  if (lastBackupDate !== dateStr) {
    const backupFile = path.join(PROJECTS_DIR, `${projectId}.backup_${dateStr}.json`);
    if (fs.existsSync(filePath) && !fs.existsSync(backupFile)) {
      try {
        fs.copyFileSync(filePath, backupFile);
        console.log(`Backup creado para ${projectId}: ${backupFile}`);
      } catch (e) {
        console.error(`Error creando backup para ${projectId}:`, e.message);
      }
    }
    lastBackupDates[projectId] = dateStr;
  }

  const tempFile = filePath + '.tmp';
  try {
    const data = JSON.stringify(state, null, 2);
    fs.writeFileSync(tempFile, data);
    try {
      fs.renameSync(tempFile, filePath);
    } catch (renameErr) {
      fs.writeFileSync(filePath, data);
    }
  } catch (e) {
    console.error(`Error guardando estado para ${projectId}:`, e.message);
  }
}

class ContextBuilder {
  /**
   * Parsea el prompt y el estado actual para filtrar/compactar la base de datos
   * que se envía como contexto al modelo de lenguaje.
   */
  static build({ currentState, prompt, mode, contextDepth, currentQuerySql, selectedTableIds }) {
    if (!currentState || !currentState.tables) {
      return { tables: [], relationships: [], groups: [] };
    }

    const tables = currentState.tables;
    const relationships = currentState.relationships || [];
    const groups = currentState.groups || [];

    // Estrategia para tablas seleccionadas específicamente
    if (contextDepth === 'selected') {
      const selectedIds = new Set(selectedTableIds || []);
      const detailedTables = tables.filter(t => selectedIds.has(t.id));
      const detailedTableIds = new Set(detailedTables.map(t => t.id));
      
      const filteredRelationships = relationships.filter(rel =>
        detailedTableIds.has(rel.fromTable) && detailedTableIds.has(rel.toTable)
      );

      const detailedGroupIds = new Set(detailedTables.map(t => t.groupId).filter(Boolean));
      const filteredGroups = groups.filter(g => detailedGroupIds.has(g.id));

      const catalog = tables
        .filter(t => !detailedTableIds.has(t.id))
        .map(t => {
          const pkFields = (t.fields || []).filter(f => f.isPK).map(f => f.name);
          const fieldsStr = pkFields.length > 0 ? pkFields.join(',') : 'id';
          return `${t.name}(${fieldsStr})`;
        });

      return {
        tables: detailedTables,
        relationships: filteredRelationships,
        groups: filteredGroups,
        catalog: catalog
      };
    }

    // Estrategia para diseño/layout (solo coordenadas y dimensiones)
    if (contextDepth === 'layout' || mode === 'layout') {
      const compactTables = tables.map(t => ({
        id: t.id,
        name: t.name,
        x: t.x,
        y: t.y,
        groupId: t.groupId,
        fieldCount: t.fields ? t.fields.length : 0
      }));
      return {
        tables: compactTables,
        relationships: relationships,
        groups: groups
      };
    }

    // Estrategia para consultas SQL (explicación, sugerencias, generación)
    if (contextDepth === 'query' || ['query_generate', 'query_suggest', 'query_explain'].includes(mode)) {
      let relevantTables = tables;
      const combinedText = `${prompt || ''} ${currentQuerySql || ''}`;
      const mentionedIds = this.findMentionedTables(combinedText, tables);

      if (mentionedIds.length > 0) {
        const relevantIdsSet = this.getRelatedTables(mentionedIds, relationships, 1);
        relevantTables = tables.filter(t => relevantIdsSet.has(t.id));
      }

      const queryTables = relevantTables.map(t => {
        const fieldsStr = (t.fields || []).map(f => {
          let desc = f.name;
          if (f.type) desc += ` ${f.type}`;
          if (f.isPK) desc += ' PK';
          if (f.isNotNull) desc += ' NOT NULL';
          if (f.isUnique) desc += ' UNIQUE';
          return desc;
        });
        return {
          name: t.name,
          fields: fieldsStr
        };
      });

      const activeTableNames = new Set(relevantTables.map(t => t.name));
      const activeTableIds = new Set(relevantTables.map(t => t.id));
      
      const compactRelationships = relationships.filter(rel => 
        activeTableIds.has(rel.fromTable) && activeTableIds.has(rel.toTable)
      ).map(rel => {
        const fromT = tables.find(t => t.id === rel.fromTable);
        const toT = tables.find(t => t.id === rel.toTable);
        const fromF = fromT ? fromT.fields.find(f => f.id === rel.fromField) : null;
        const toF = toT ? toT.fields.find(f => f.id === rel.toField) : null;
        return {
          fromTable: fromT ? fromT.name : rel.fromTable,
          fromField: fromF ? fromF.name : rel.fromField,
          toTable: toT ? toT.name : rel.toTable,
          toField: toF ? toF.name : rel.toField
        };
      });

      return {
        tables: queryTables,
        relationships: compactRelationships
      };
    }

    // Estrategia para edición o adición en diagramas grandes (contextDepth 1 o 2)
    const depth = parseInt(contextDepth, 10);
    if (!isNaN(depth) && depth >= 1 && depth <= 2) {
      const mentionedIds = this.findMentionedTables(prompt, tables);

      if (mentionedIds.length === 0) {
        return currentState;
      }

      const relevantIdsSet = this.getRelatedTables(mentionedIds, relationships, depth);
      const detailedTables = tables.filter(t => relevantIdsSet.has(t.id));
      const detailedTableIds = new Set(detailedTables.map(t => t.id));

      const catalog = tables
        .filter(t => !detailedTableIds.has(t.id))
        .map(t => {
          const pkFields = (t.fields || []).filter(f => f.isPK).map(f => f.name);
          const fieldsStr = pkFields.length > 0 ? pkFields.join(',') : 'id';
          return `${t.name}(${fieldsStr})`;
        });

      const filteredRelationships = relationships.filter(rel =>
        detailedTableIds.has(rel.fromTable) && detailedTableIds.has(rel.toTable)
      );

      const detailedGroupIds = new Set(detailedTables.map(t => t.groupId).filter(Boolean));
      const filteredGroups = groups.filter(g => detailedGroupIds.has(g.id));

      return {
        tables: detailedTables,
        relationships: filteredRelationships,
        groups: filteredGroups,
        catalog: catalog
      };
    }

    return currentState;
  }

  static findMentionedTables(text, tables) {
    if (!text) return [];
    const textLower = text.toLowerCase();
    const foundIds = [];

    for (const table of tables) {
      const tableNameEscaped = table.name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\b${tableNameEscaped}\\b`, 'i');
      if (regex.test(textLower)) {
        foundIds.push(table.id);
      }
    }
    return foundIds;
  }

  static getRelatedTables(startIds, relationships, depth) {
    const visited = new Set(startIds);
    let currentLevel = [...startIds];

    for (let d = 0; d < depth; d++) {
      const nextLevel = [];
      for (const tableId of currentLevel) {
        for (const rel of relationships) {
          if (rel.fromTable === tableId && !visited.has(rel.toTable)) {
            visited.add(rel.toTable);
            nextLevel.push(rel.toTable);
          }
          if (rel.toTable === tableId && !visited.has(rel.fromTable)) {
            visited.add(rel.fromTable);
            nextLevel.push(rel.fromTable);
          }
        }
      }
      currentLevel = nextLevel;
      if (currentLevel.length === 0) break;
    }

    return visited;
  }
}

// Helper para realizar solicitudes de IA a los distintos proveedores de manera nativa
function makeAiRequest({ provider, apiKey, apiUrl, model, prompt, currentState, mode, engine, currentQuerySql, contextDepth, selectedTableIds, userId, enableThinking }) {
  return new Promise((resolve, reject) => {
    let promptTemplate = '';
    const prompts = AiPromptRepository.getPromptsForUser(userId);
    if (mode === 'append') {
      promptTemplate = prompts.mode_append;
    } else if (mode === 'edit') {
      promptTemplate = prompts.mode_edit;
    } else if (mode === 'layout') {
      promptTemplate = prompts.mode_layout;
    } else if (mode === 'query_generate') {
      promptTemplate = prompts.mode_query_generate;
    } else if (mode === 'query_suggest') {
      promptTemplate = prompts.mode_query_suggest;
    } else if (mode === 'query_explain') {
      promptTemplate = prompts.mode_query_explain;
    } else {
      promptTemplate = prompts.mode_create;
    }

    const optimizedContext = ContextBuilder.build({
      currentState,
      prompt,
      mode,
      contextDepth,
      currentQuerySql,
      selectedTableIds
    });

    let catalogInstruction = "";
    if (optimizedContext.catalog && optimizedContext.catalog.length > 0) {
      catalogInstruction = `\n\nOTRAS TABLAS EXISTENTES EN EL DIAGRAMA (Catálogo de referencia rápida. NO las modifiques ni agregues campos en ellas a menos que se te pida explícitamente):\n- ${optimizedContext.catalog.join('\n- ')}\n`;
      delete optimizedContext.catalog;
    }

    const stateStr = JSON.stringify(optimizedContext);
    const currentQuerySqlStr = currentQuerySql ? `\nConsulta SQL actual a modificar:\n${currentQuerySql}` : '';

    let systemInstruction = (promptTemplate || '')
      .replace(/{expectedSchemaText}/g, prompts.expectedSchemaText || '')
      .replace(/{layoutRulesText}/g, prompts.layoutRulesText || '')
      .replace(/{currentState}/g, stateStr)
      .replace(/{engine}/g, engine || 'PostgreSQL')
      .replace(/{currentQuerySql}/g, currentQuerySqlStr);

    if (catalogInstruction) {
      systemInstruction += catalogInstruction;
    }

    let options = {};
    let clientModule = https;

    if (provider === 'gemini') {
      const geminiModel = model || 'gemini-1.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;
      
      requestBody = JSON.stringify({
        contents: [{
          parts: [{
            text: `Requerimiento del usuario: ${prompt}\n\nInstrucción del sistema: ${systemInstruction}`
          }]
        }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      });

      options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              return reject(new Error(parsed.error.message || 'Error en la API de Gemini'));
            }
            const textResponse = parsed.candidates[0].content.parts[0].text;
            resolve(JSON.parse(cleanJsonResponseText(textResponse)));
          } catch (e) {
            reject(new Error('La respuesta de Gemini no se pudo procesar como JSON: ' + e.message + '\nData recibida: ' + data));
          }
        });
      });

      req.on('error', (e) => reject(e));
      req.write(requestBody);
      req.end();

    } else if (['openai', 'vllm', 'litellm', 'custom-openai'].includes(provider)) {
      const modelName = model || (provider === 'openai' ? 'gpt-4o-mini' : '');
      let requestUrl = '';
      
      if (provider === 'openai') {
        requestUrl = 'https://api.openai.com/v1/chat/completions';
      } else {
        let base = apiUrl || '';
        base = base.trim();
        if (base.endsWith('/')) {
          base = base.slice(0, -1);
        }
        if (base.endsWith('/chat/completions')) {
          requestUrl = base;
        } else if (base.endsWith('/v1')) {
          requestUrl = `${base}/chat/completions`;
        } else if (base.includes('/v1')) {
          requestUrl = `${base}/chat/completions`;
        } else {
          requestUrl = `${base}/v1/chat/completions`;
        }
      }

      clientModule = requestUrl.startsWith('https') ? https : http;

      const requestPayload = {
        model: modelName,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt }
        ]
      };

      requestPayload.chat_template_kwargs = { enable_thinking: !!enableThinking };
      if (enableThinking) {
        requestPayload.max_tokens = 8192;
      }

      if (provider === 'openai') {
        requestPayload.response_format = { type: "json_object" };
      }

      requestBody = JSON.stringify(requestPayload);

      options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      if (apiKey) {
        options.headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const req = clientModule.request(requestUrl, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              const errMsg = parsed.error.message || (typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error));
              return reject(new Error(errMsg || 'Error en el proveedor compatible con OpenAI'));
            }
            if (!parsed.choices || parsed.choices.length === 0 || !parsed.choices[0].message) {
              return reject(new Error('Respuesta inválida del proveedor compatible con OpenAI. Data: ' + data));
            }
            const textResponse = parsed.choices[0].message.content;
            resolve(JSON.parse(cleanJsonResponseText(textResponse)));
          } catch (e) {
            reject(new Error('La respuesta del proveedor de IA no se pudo procesar como JSON: ' + e.message + '\nData: ' + data));
          }
        });
      });

      req.on('error', (e) => reject(new Error(`No se pudo conectar con el servidor de IA (${requestUrl}): ${e.message}`)));
      req.write(requestBody);
      req.end();

    } else if (provider === 'ollama') {
      const ollamaUrl = apiUrl || 'http://localhost:11434';
      const url = `${ollamaUrl}/api/chat`;
      clientModule = ollamaUrl.startsWith('https') ? https : http;

      requestBody = JSON.stringify({
        model: model || 'llama3',
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt }
        ],
        stream: false,
        format: 'json'
      });

      options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      if (apiKey) {
        options.headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const req = clientModule.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              return reject(new Error(parsed.error || 'Error en la API de Ollama'));
            }
            const textResponse = parsed.message.content;
            resolve(JSON.parse(cleanJsonResponseText(textResponse)));
          } catch (e) {
            reject(new Error('La respuesta de Ollama no se pudo procesar como JSON: ' + e.message + '\nData: ' + data));
          }
        });
      });

      req.on('error', (e) => reject(new Error(`Ollama no está corriendo o la URL es inaccesible: ${e.message}`)));
      req.write(requestBody);
      req.end();
    } else {
      reject(new Error('Proveedor de IA no soportado.'));
    }
  });
}

// Helper para solicitar la documentación detallada en Markdown a la IA
function makeAiDocRequest({ provider, apiKey, apiUrl, model, currentState, userId }) {
  return new Promise((resolve, reject) => {
    const prompts = AiPromptRepository.getPromptsForUser(userId);
    const stateStr = JSON.stringify(currentState || { tables: [], relationships: [] }, null, 2);
    const prompt = (prompts.prompt_document || '').replace(/{currentState}/g, stateStr);

    let requestBody = '';
    let options = {};
    let clientModule = https;

    if (provider === 'gemini') {
      const geminiModel = model || 'gemini-1.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;
      
      requestBody = JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      });

      options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              return reject(new Error(parsed.error.message || 'Error en la API de Gemini'));
            }
            const textResponse = parsed.candidates[0].content.parts[0].text;
            resolve(textResponse);
          } catch (e) {
            reject(new Error('La respuesta de Gemini no se pudo procesar: ' + e.message));
          }
        });
      });

      req.on('error', (e) => reject(e));
      req.write(requestBody);
      req.end();

    } else if (['openai', 'vllm', 'litellm', 'custom-openai'].includes(provider)) {
      const modelName = model || (provider === 'openai' ? 'gpt-4o-mini' : '');
      let requestUrl = '';
      
      if (provider === 'openai') {
        requestUrl = 'https://api.openai.com/v1/chat/completions';
      } else {
        let base = apiUrl || '';
        base = base.trim();
        if (base.endsWith('/')) {
          base = base.slice(0, -1);
        }
        if (base.endsWith('/chat/completions')) {
          requestUrl = base;
        } else if (base.endsWith('/v1')) {
          requestUrl = `${base}/chat/completions`;
        } else if (base.includes('/v1')) {
          requestUrl = `${base}/chat/completions`;
        } else {
          requestUrl = `${base}/v1/chat/completions`;
        }
      }

      clientModule = requestUrl.startsWith('https') ? https : http;

      requestBody = JSON.stringify({
        model: modelName,
        messages: [
          { role: 'user', content: prompt }
        ]
      });

      options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      if (apiKey) {
        options.headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const req = clientModule.request(requestUrl, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              const errMsg = parsed.error.message || (typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error));
              return reject(new Error(errMsg || 'Error en el proveedor compatible con OpenAI'));
            }
            if (!parsed.choices || parsed.choices.length === 0 || !parsed.choices[0].message) {
              return reject(new Error('Respuesta inválida del proveedor compatible con OpenAI. Data: ' + data));
            }
            const textResponse = parsed.choices[0].message.content;
            resolve(textResponse);
          } catch (e) {
            reject(new Error('La respuesta del proveedor de IA no se pudo procesar: ' + e.message + '\nData: ' + data));
          }
        });
      });

      req.on('error', (e) => reject(new Error(`No se pudo conectar con el servidor de IA (${requestUrl}): ${e.message}`)));
      req.write(requestBody);
      req.end();

    } else if (provider === 'ollama') {
      const ollamaUrl = apiUrl || 'http://localhost:11434';
      const url = `${ollamaUrl}/api/chat`;
      clientModule = ollamaUrl.startsWith('https') ? https : http;

      requestBody = JSON.stringify({
        model: model || 'llama3',
        messages: [
          { role: 'user', content: prompt }
        ],
        stream: false
      });

      options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      if (apiKey) {
        options.headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const req = clientModule.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              return reject(new Error(parsed.error || 'Error en la API de Ollama'));
            }
            const textResponse = parsed.message.content;
            resolve(textResponse);
          } catch (e) {
            reject(new Error('La respuesta de Ollama no se pudo procesar: ' + e.message));
          }
        });
      });

      req.on('error', (e) => reject(new Error(`Ollama no está corriendo o la URL es inaccesible: ${e.message}`)));
      req.write(requestBody);
      req.end();
    } else {
      reject(new Error('Proveedor de IA no soportado.'));
    }
  });
}

// Obtener la lista de modelos disponibles para un proveedor de IA de forma nativa
function fetchModelsFromProvider({ provider, apiKey, apiUrl }) {
  return new Promise((resolve, reject) => {
    let clientModule = https;
    let url = '';
    let options = {
      method: 'GET',
      headers: {}
    };

    if (provider === 'gemini') {
      const key = apiKey || '';
      url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
      options.headers['Content-Type'] = 'application/json';
      
      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              return reject(new Error(parsed.error.message || 'Error en la API de Gemini'));
            }
            if (!parsed.models || !Array.isArray(parsed.models)) {
              return reject(new Error('Formato de respuesta inválido de Gemini'));
            }
            const models = parsed.models
              .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
              .map(m => ({
                id: m.name.replace(/^models\//, ''),
                name: m.displayName || m.name.replace(/^models\//, '')
              }));
            resolve(models);
          } catch (e) {
            reject(new Error('La respuesta de Gemini no se pudo procesar: ' + e.message));
          }
        });
      });
      req.on('error', (e) => reject(new Error(`No se pudo conectar con la API de Gemini: ${e.message}`)));
      req.end();

    } else if (provider === 'openai') {
      url = 'https://api.openai.com/v1/models';
      options.headers['Authorization'] = `Bearer ${apiKey}`;
      options.headers['Content-Type'] = 'application/json';

      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              return reject(new Error(parsed.error.message || 'Error en la API de OpenAI'));
            }
            if (!parsed.data || !Array.isArray(parsed.data)) {
              return reject(new Error('Formato de respuesta inválido de OpenAI'));
            }
            const models = parsed.data
              .filter(m => m.id.includes('gpt') || m.id.includes('o1') || m.id.includes('o3') || m.id.includes('davinci') || m.id.includes('babbage'))
              .map(m => ({
                id: m.id,
                name: m.id
              }))
              .sort((a, b) => a.id.localeCompare(b.id));
            resolve(models);
          } catch (e) {
            reject(new Error('La respuesta de OpenAI no se pudo procesar: ' + e.message));
          }
        });
      });
      req.on('error', (e) => reject(new Error(`No se pudo conectar con la API de OpenAI: ${e.message}`)));
      req.end();

    } else if (provider === 'ollama') {
      const ollamaUrl = apiUrl || 'http://localhost:11434';
      url = `${ollamaUrl}/api/tags`;
      clientModule = ollamaUrl.startsWith('https') ? https : http;

      const req = clientModule.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              return reject(new Error(parsed.error || 'Error en la API de Ollama'));
            }
            if (!parsed.models || !Array.isArray(parsed.models)) {
              return reject(new Error('Formato de respuesta de Ollama inválido'));
            }
            const models = parsed.models.map(m => ({
              id: m.name,
              name: m.name
            }));
            resolve(models);
          } catch (e) {
            reject(new Error('La respuesta de Ollama no se pudo procesar: ' + e.message));
          }
        });
      });
      req.on('error', (e) => reject(new Error(`Ollama no está disponible en la URL proporcionada (${ollamaUrl}): ${e.message}`)));
      req.end();

    } else if (['vllm', 'litellm', 'custom-openai'].includes(provider)) {
      let requestUrl = apiUrl || '';
      requestUrl = requestUrl.trim();
      if (requestUrl.endsWith('/')) {
        requestUrl = requestUrl.slice(0, -1);
      }
      if (requestUrl.endsWith('/chat/completions')) {
        requestUrl = requestUrl.replace(/\/chat\/completions$/, '/models');
      } else if (requestUrl.endsWith('/v1')) {
        requestUrl = `${requestUrl}/models`;
      } else if (requestUrl.includes('/v1')) {
        if (!requestUrl.endsWith('/models')) {
          requestUrl = `${requestUrl}/models`;
        }
      } else {
        requestUrl = `${requestUrl}/v1/models`;
      }

      clientModule = requestUrl.startsWith('https') ? https : http;
      options.headers['Content-Type'] = 'application/json';
      if (apiKey) {
        options.headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const req = clientModule.request(requestUrl, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              const errMsg = parsed.error.message || (typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error));
              return reject(new Error(errMsg || 'Error en el servidor compatible con OpenAI'));
            }
            if (!parsed.data || !Array.isArray(parsed.data)) {
              return reject(new Error('Formato de respuesta compatible con OpenAI inválido'));
            }
            const models = parsed.data.map(m => ({
              id: m.id,
              name: m.id
            }));
            resolve(models);
          } catch (e) {
            reject(new Error('La respuesta del servidor no se pudo procesar: ' + e.message));
          }
        });
      });
      req.on('error', (e) => reject(new Error(`Servidor inaccesible en ${requestUrl}: ${e.message}`)));
      req.end();

    } else {
      reject(new Error('Proveedor no soportado para listar modelos.'));
    }
  });
}

// Limpia posibles tags markdown del JSON devuelto por la IA
function cleanJsonResponseText(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  return cleaned.trim();
}

// Helper to get client IP
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

// Resolver los parámetros de configuración de IA utilizando la base de datos para enmascarar la API Key
function resolveAiParams(userId, clientParams) {
  const savedConfig = UserAiConfigRepository.getUserConfig(userId);
  const resolved = {
    provider: clientParams.provider || (savedConfig ? savedConfig.provider : ''),
    model: clientParams.model || (savedConfig ? savedConfig.model : ''),
    apiUrl: clientParams.apiUrl || (savedConfig ? savedConfig.api_url : ''),
    apiKey: clientParams.apiKey || '',
    enableThinking: clientParams.enableThinking !== undefined ? clientParams.enableThinking : (savedConfig ? !!savedConfig.enable_thinking : false)
  };

  if (resolved.apiKey === '••••••••' || resolved.apiKey === '') {
    resolved.apiKey = savedConfig ? savedConfig.api_key : '';
  }

  return { ...clientParams, ...resolved };
}

// Helper to parse cookies
function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const name = parts.shift().trim();
    const value = parts.join('=').trim();
    list[name] = decodeURIComponent(value);
  });
  return list;
}

// Helper to resolve session
function parseSessionToken(req) {
  const cookies = parseCookies(req);
  let token = cookies['session_token'];

  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }

  if (!token) {
    try {
      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      token = urlObj.searchParams.get('token') || urlObj.searchParams.get('session_token');
    } catch (e) {}
  }

  if (!token) return null;
  return SessionRepository.getSession(token);
}

// Helper to enforce auth
function requireAuth(req, res) {
  const session = parseSessionToken(req);
  if (!session) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No autorizado. Inicie sesión.' }));
    return null;
  }
  return session;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

// HTTP Server to serve static files and API endpoints
const server = http.createServer(async (req, res) => {
  const cleanUrl = req.url.split('?')[0];

  // 1. PUBLIC AUTH ENDPOINTS
  if (req.method === 'POST' && cleanUrl === '/api/login') {
    const ip = getClientIp(req);
    const limit = rateLimiter.checkLogin(ip);
    if (!limit.allowed) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Demasiados intentos de inicio de sesión. Por favor intente en ${limit.timeLeft} segundos.` }));
      return;
    }

    try {
      const { username, password } = await readJsonBody(req);
      if (!username || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Usuario y contraseña son requeridos.' }));
        return;
      }

      const user = UserRepository.getUserByUsername(username.trim());
      if (!user) {
        rateLimiter.recordLoginAttempt(ip);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Usuario o contraseña incorrectos.' }));
        return;
      }

      const isValid = await verifyPassword(password, user.password_hash, user.password_salt);
      if (!isValid) {
        rateLimiter.recordLoginAttempt(ip);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Usuario o contraseña incorrectos.' }));
        return;
      }

      // Success
      rateLimiter.resetLoginBlocks(ip);

      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

      SessionRepository.createSession({
        token,
        user_id: user.id,
        expires_at: expiresAt.toISOString()
      });

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `session_token=${token}; HttpOnly; Path=/; Max-Age=${7 * 24 * 60 * 60}; SameSite=Lax`
      });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === 'POST' && cleanUrl === '/api/register') {
    // 1. Check if public registration is allowed
    if (!SystemSettingsRepository.isPublicRegistrationAllowed()) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'El registro público está deshabilitado por el administrador.' }));
      return;
    }

    const ip = getClientIp(req);
    // 2. Check rate limit
    const limit = rateLimiter.checkRegister(ip);
    if (!limit.allowed) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Has realizado demasiados intentos de registro. Intenta de nuevo en ${limit.timeLeft} segundos.` }));
      return;
    }

    try {
      const { username, displayName, password, color } = await readJsonBody(req);
      if (!username || !displayName || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Todos los campos son obligatorios.' }));
        return;
      }

      // 3. Validate password strength
      const passwordCheck = validatePassword(password);
      if (!passwordCheck.valid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: passwordCheck.errors.join(' ') }));
        return;
      }

      const existing = UserRepository.getUserByUsername(username.trim());
      if (existing) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'El nombre de usuario ya está en uso.' }));
        return;
      }

      rateLimiter.recordRegisterAttempt(ip);

      const { hash, salt } = await hashPassword(password);
      const userId = 'u_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

      const user = UserRepository.createUser({
        id: userId,
        username: username.trim(),
        password_hash: hash,
        password_salt: salt,
        display_name: displayName.trim(),
        color,
        is_admin: 0 // Public signups are regular users
      });

      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

      SessionRepository.createSession({
        token,
        user_id: user.id,
        expires_at: expiresAt.toISOString()
      });

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `session_token=${token}; HttpOnly; Path=/; Max-Age=${7 * 24 * 60 * 60}; SameSite=Lax`
      });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === 'POST' && cleanUrl === '/api/logout') {
    const cookies = parseCookies(req);
    const token = cookies['session_token'];
    if (token) {
      SessionRepository.deleteSession(token);
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `session_token=; HttpOnly; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
    });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // GET /api/registration-status (Publicly accessible)
  if (req.method === 'GET' && cleanUrl === '/api/registration-status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ open: SystemSettingsRepository.isPublicRegistrationAllowed() }));
    return;
  }

  // 2. SECURE API ENDPOINTS (Require active session)
  const session = parseSessionToken(req);

  if (cleanUrl.startsWith('/api/')) {
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado. Por favor inicie sesión.' }));
      return;
    }

    // GET /api/me
    if (req.method === 'GET' && cleanUrl === '/api/me') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        userId: session.user_id,
        username: session.username,
        display_name: session.display_name,
        color: session.color,
        is_admin: session.is_admin
      }));
      return;
    }

    // GET /api/projects - List all projects accessible by user
    if (req.method === 'GET' && cleanUrl === '/api/projects') {
      try {
        const dbProjects = ProjectRepository.listProjectsForUser(session.user_id, session.is_admin === 1);
        const enrichedDbProjects = dbProjects.map(p => {
          const fileName = `${p.id}.json`;
          const filePath = path.join(PROJECTS_DIR, fileName);
          let tableCount = 0;
          let relationshipCount = 0;
          let lastModified = p.created_at || new Date();
          let name = p.name || p.id;

          if (fs.existsSync(filePath)) {
            try {
              const stats = fs.statSync(filePath);
              const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
              if (state.name) name = state.name;
              tableCount = state.tables ? state.tables.length : 0;
              relationshipCount = state.relationships ? state.relationships.length : 0;
              lastModified = stats.mtime;

              // Keep SQLite display_name in sync with diagram file name on disk
              if (state.name && state.name !== p.name) {
                ProjectRepository.updateProjectName(p.id, state.name);
              }
            } catch (e) {
              // Ignore file read/parse errors
            }
          }

          return {
            ...p,
            name,
            tableCount,
            relationshipCount,
            lastModified
          };
        });

        const dbProjectIds = new Set(dbProjects.map(p => p.id));
        const files = fs.readdirSync(PROJECTS_DIR);
        const projectsList = [...enrichedDbProjects];

        files.forEach(file => {
          if (file.endsWith('.json') && !file.includes('.backup_') && !file.endsWith('.tmp')) {
            const projectId = file.slice(0, -5);
            if (!dbProjectIds.has(projectId)) {
              try {
                const filePath = path.join(PROJECTS_DIR, file);
                const stats = fs.statSync(filePath);
                const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                projectsList.push({
                  id: projectId,
                  name: state.name || projectId,
                  tableCount: state.tables ? state.tables.length : 0,
                  relationshipCount: state.relationships ? state.relationships.length : 0,
                  lastModified: stats.mtime,
                  role: 'public',
                  owner_name: 'Sistema'
                });
              } catch (e) {
                // Ignore malformed files
              }
            }
          }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(projectsList));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST /api/delete-project - Delete a project (Owner or Admin only)
    if (cleanUrl === '/api/delete-project') {
      try {
        const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const projectToDelete = urlObj.searchParams.get('project');
        if (projectToDelete) {
          const project = ProjectRepository.getProject(projectToDelete);
          if (project) {
            const isOwner = project.owner_id === session.user_id;
            const isAdmin = session.is_admin === 1;
            if (!isOwner && !isAdmin) {
              res.writeHead(403, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Permiso denegado. Solo el creador o un administrador pueden eliminar este proyecto.' }));
              return;
            }
            ProjectRepository.deleteProject(projectToDelete);
          }

          const filePath = getProjectPath(projectToDelete);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            
            // Clean backups
            try {
              const files = fs.readdirSync(PROJECTS_DIR);
              files.forEach(file => {
                if (file.startsWith(`${projectToDelete}.backup_`)) {
                  fs.unlinkSync(path.join(PROJECTS_DIR, file));
                }
              });
            } catch (backupErr) {
              console.error('Error al limpiar backups:', backupErr.message);
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proyecto no especificado' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // GET /api/users/list - Return list of public user profiles for autocompletion
    if (req.method === 'GET' && cleanUrl === '/api/users/list') {
      try {
        const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const projectId = urlObj.searchParams.get('project');
        
        let existingUserIds = new Set();
        if (projectId) {
          try {
            const members = ProjectRepository.getProjectMembers(projectId);
            members.forEach(m => existingUserIds.add(m.user_id));
          } catch (e) {
            console.error('[server.js] Error getProjectMembers:', e.message);
          }
        }

        const currentUserId = session.user_id;
        const usersList = UserRepository.listAllUsers()
          .filter(u => u.id !== currentUserId && !existingUserIds.has(u.id))
          .map(u => ({
            username: u.username,
            display_name: u.display_name,
            color: u.color
          }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(usersList));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // GET /api/projects/my-role - Get current user's role for a specific project
    if (req.method === 'GET' && cleanUrl === '/api/projects/my-role') {
      try {
        const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const projectId = urlObj.searchParams.get('project');
        if (!projectId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Proyecto no especificado' }));
          return;
        }

        const role = ProjectRepository.getProjectRole(projectId, session.user_id);
        const isAdmin = session.is_admin === 1;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ role: role || (isAdmin ? 'admin' : null), is_admin: isAdmin }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // GET /api/projects/members - List project members
    if (req.method === 'GET' && cleanUrl === '/api/projects/members') {
      try {
        const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const projectId = urlObj.searchParams.get('project');
        if (!projectId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Proyecto no especificado' }));
          return;
        }

        const role = ProjectRepository.getProjectRole(projectId, session.user_id);
        const isAdmin = session.is_admin === 1;

        if (!role && !isAdmin) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No tienes acceso a los miembros de este proyecto.' }));
          return;
        }

        const members = ProjectRepository.getProjectMembers(projectId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(members));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST /api/projects/members - Add/Edit project member
    if (req.method === 'POST' && cleanUrl === '/api/projects/members') {
      try {
        const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const projectId = urlObj.searchParams.get('project');
        if (!projectId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Proyecto no especificado' }));
          return;
        }

        const role = ProjectRepository.getProjectRole(projectId, session.user_id);
        const isAdmin = session.is_admin === 1;

        if (role !== 'owner' && !isAdmin) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Permiso denegado. Solo el creador del proyecto o un administrador pueden gestionar colaboradores.' }));
          return;
        }

        const { username, role: memberRole } = await readJsonBody(req);
        if (!username || !memberRole) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Username y role son requeridos.' }));
          return;
        }

        const targetUser = UserRepository.getUserByUsername(username.trim());
        if (!targetUser) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `El usuario "${username}" no existe.` }));
          return;
        }

        ProjectRepository.addProjectMember({
          projectId,
          userId: targetUser.id,
          role: memberRole
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST /api/projects/remove-member - Remove project member
    if (req.method === 'POST' && cleanUrl === '/api/projects/remove-member') {
      try {
        const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const projectId = urlObj.searchParams.get('project');
        if (!projectId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Proyecto no especificado' }));
          return;
        }

        const role = ProjectRepository.getProjectRole(projectId, session.user_id);
        const isAdmin = session.is_admin === 1;

        if (role !== 'owner' && !isAdmin) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Permiso denegado. Solo el creador del proyecto o un administrador pueden gestionar colaboradores.' }));
          return;
        }

        const { userId } = await readJsonBody(req);
        if (!userId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'userId es requerido.' }));
          return;
        }

        if (userId === session.user_id && role === 'owner') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No puedes removerte a ti mismo siendo creador del proyecto.' }));
          return;
        }

        ProjectRepository.removeProjectMember({
          projectId,
          userId
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // GET /api/ai/prompts or /api/ai-prompts
    if (req.method === 'GET' && (cleanUrl === '/api/ai/prompts' || cleanUrl === '/api/ai-prompts')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(AiPromptRepository.getPromptsForUser(session.user_id)));
      return;
    }

    // POST /api/ai/prompts or /api/ai-prompts
    if (req.method === 'POST' && (cleanUrl === '/api/ai/prompts' || cleanUrl === '/api/ai-prompts')) {
      try {
        const payload = await readJsonBody(req);
        if (payload.reset) {
          AiPromptRepository.resetUserPrompts(session.user_id);
        } else {
          // Copiar valores recibidos válidos
          const keys = VALID_PROMPT_KEYS;
          for (const key of keys) {
            if (payload[key] !== undefined) {
              AiPromptRepository.setPrompt(session.user_id, key, {
                promptTemplate: payload[key],
                scope: 'user'
              });
            }
          }
        }

        const prompts = AiPromptRepository.getPromptsForUser(session.user_id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, prompts }));
      } catch (err) {
        console.error('Error al guardar prompts:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // GET /api/ai/config - Obtener configuración de IA del usuario (enmascarada)
    if (req.method === 'GET' && cleanUrl === '/api/ai/config') {
      const savedConfig = UserAiConfigRepository.getUserConfig(session.user_id);
      if (savedConfig) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          provider: savedConfig.provider,
          model: savedConfig.model,
          apiKey: savedConfig.api_key ? '••••••••' : '',
          apiUrl: savedConfig.api_url,
          enableThinking: !!savedConfig.enable_thinking
        }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          provider: 'gemini',
          model: 'gemini-1.5-flash',
          apiKey: '',
          apiUrl: '',
          enableThinking: false
        }));
      }
      return;
    }

    // POST /api/ai/config - Guardar configuración de IA del usuario
    if (req.method === 'POST' && cleanUrl === '/api/ai/config') {
      try {
        const payload = await readJsonBody(req);
        if (!payload.provider) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'El proveedor es obligatorio.' }));
          return;
        }

        UserAiConfigRepository.saveUserConfig(session.user_id, payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        console.error('Error al guardar config de IA:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST /api/ai/generate - AI Proxy
    if (req.method === 'POST' && cleanUrl === '/api/ai/generate') {
      try {
        const clientParams = await readJsonBody(req);
        const params = resolveAiParams(session.user_id, clientParams);
        if (!params.prompt && params.mode !== 'query_suggest') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'El campo "prompt" es obligatorio.' }));
          return;
        }
        const requiresApiKey = ['gemini', 'openai'].includes(params.provider);
        if (requiresApiKey && !params.apiKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'La API Key es obligatoria para proveedores Cloud.' }));
          return;
        }

        params.userId = session.user_id; // Inyectar id del usuario
        const aiResult = await makeAiRequest(params);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(aiResult));
      } catch (err) {
        console.error('Error en Proxy de IA:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST /api/ai/document - AI Document Generator
    if (req.method === 'POST' && cleanUrl === '/api/ai/document') {
      try {
        const clientParams = await readJsonBody(req);
        const params = resolveAiParams(session.user_id, clientParams);
        const requiresApiKey = ['gemini', 'openai'].includes(params.provider);
        if (requiresApiKey && !params.apiKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'La API Key es obligatoria para proveedores Cloud.' }));
          return;
        }

        params.userId = session.user_id; // Inyectar id del usuario
        const mdDoc = await makeAiDocRequest(params);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ markdown: mdDoc }));
      } catch (err) {
        console.error('Error al documentar BD con IA:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST /api/ai/models - Obtener lista de modelos para un proveedor
    if (req.method === 'POST' && cleanUrl === '/api/ai/models') {
      try {
        const clientParams = await readJsonBody(req);
        const params = resolveAiParams(session.user_id, clientParams);
        if (!params.provider) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'El proveedor es obligatorio.' }));
          return;
        }
        const requiresApiKey = ['gemini', 'openai'].includes(params.provider);
        if (requiresApiKey && !params.apiKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'La API Key es obligatoria para proveedores Cloud.' }));
          return;
        }

        const models = await fetchModelsFromProvider(params);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, models }));
      } catch (err) {
        console.error('Error al obtener modelos de IA:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST /api/ai/test-connection - Probar conexión con el proveedor de IA
    if (req.method === 'POST' && cleanUrl === '/api/ai/test-connection') {
      try {
        const clientParams = await readJsonBody(req);
        const params = resolveAiParams(session.user_id, clientParams);
        if (!params.provider) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'El proveedor es obligatorio.' }));
          return;
        }
        const requiresApiKey = ['gemini', 'openai'].includes(params.provider);
        if (requiresApiKey && !params.apiKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'La API Key es obligatoria para proveedores Cloud.' }));
          return;
        }

        // Test connection by fetching models list
        await fetchModelsFromProvider(params);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Conexión exitosa' }));
      } catch (err) {
        console.error('Error al probar conexión con IA:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 3. ADMIN-ONLY ENDPOINTS
    // GET /api/admin/users
    if (req.method === 'GET' && cleanUrl === '/api/admin/users') {
      if (session.is_admin !== 1) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Acceso denegado. Se requieren permisos de administrador.' }));
        return;
      }
      const usersList = UserRepository.listAllUsers();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(usersList));
      return;
    }

    // POST /api/admin/create-user
    if (req.method === 'POST' && cleanUrl === '/api/admin/create-user') {
      if (session.is_admin !== 1) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Acceso denegado. Se requieren permisos de administrador.' }));
        return;
      }
      try {
        const { username, displayName, password, color, is_admin } = await readJsonBody(req);
        if (!username || !displayName || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Faltan campos obligatorios.' }));
          return;
        }

        const passwordCheck = validatePassword(password);
        if (!passwordCheck.valid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: passwordCheck.errors.join(' ') }));
          return;
        }

        const existing = UserRepository.getUserByUsername(username.trim());
        if (existing) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'El nombre de usuario ya está en uso.' }));
          return;
        }

        const { hash, salt } = await hashPassword(password);
        const userId = 'u_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

        UserRepository.createUser({
          id: userId,
          username: username.trim(),
          password_hash: hash,
          password_salt: salt,
          display_name: displayName.trim(),
          color,
          is_admin: is_admin ? 1 : 0
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST /api/admin/update-user
    if (req.method === 'POST' && cleanUrl === '/api/admin/update-user') {
      if (session.is_admin !== 1) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Acceso denegado. Se requieren permisos de administrador.' }));
        return;
      }
      try {
        const { userId, displayName, color, is_admin, password } = await readJsonBody(req);
        if (!userId || !displayName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'userId y displayName son requeridos.' }));
          return;
        }

        // Prevent admin from removing their own admin privilege to avoid locking out the system
        const finalIsAdmin = (userId === session.user_id) ? true : is_admin;

        const updateData = {
          display_name: displayName.trim(),
          color,
          is_admin: finalIsAdmin ? 1 : 0
        };

        if (password && password.trim().length > 0) {
          const passwordCheck = validatePassword(password);
          if (!passwordCheck.valid) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: passwordCheck.errors.join(' ') }));
            return;
          }
          const { hash, salt } = await hashPassword(password);
          updateData.password_hash = hash;
          updateData.password_salt = salt;
        }

        UserRepository.updateUser(userId, updateData);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST /api/admin/delete-user
    if (req.method === 'POST' && cleanUrl === '/api/admin/delete-user') {
      if (session.is_admin !== 1) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Acceso denegado. Se requieren permisos de administrador.' }));
        return;
      }
      try {
        const { userId } = await readJsonBody(req);
        if (!userId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'userId es requerido.' }));
          return;
        }

        if (userId === session.user_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No puedes eliminarte a ti mismo.' }));
          return;
        }

        UserRepository.deleteUser(userId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // GET /api/admin/settings
    if (req.method === 'GET' && cleanUrl === '/api/admin/settings') {
      if (session.is_admin !== 1) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Acceso denegado. Se requieren permisos de administrador.' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        allow_public_registration: SystemSettingsRepository.isPublicRegistrationAllowed()
      }));
      return;
    }

    // POST /api/admin/settings
    if (req.method === 'POST' && cleanUrl === '/api/admin/settings') {
      if (session.is_admin !== 1) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Acceso denegado. Se requieren permisos de administrador.' }));
        return;
      }
      try {
        const { allow_public_registration } = await readJsonBody(req);
        if (allow_public_registration !== undefined) {
          SystemSettingsRepository.setSetting('allow_public_registration', allow_public_registration ? 'true' : 'false');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
  }

  // 4. STATIC PAGES & FILE SERVING
  const isPage = cleanUrl === '/' || cleanUrl === '/index.html';
  const publicPaths = ['/assets/imgs/gnomo-logo.png', '/login.html'];
  const isPublicAsset = publicPaths.includes(cleanUrl);

  if (!session && !isPublicAsset) {
    if (isPage) {
      const loginPath = path.join(__dirname, 'login.html');
      fs.readFile(loginPath, (err, content) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error interno del servidor al cargar el portal de login.');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(content, 'utf-8');
        }
      });
    } else {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('No autorizado. Por favor inicie sesión.');
    }
    return;
  }

  // Normalize path and prevent directory traversal
  let filePath = cleanUrl === '/' ? '/index.html' : cleanUrl;
  filePath = path.join(__dirname, filePath);

  if (!filePath.startsWith(__dirname)) {
    res.statusCode = 403;
    res.end('Acceso denegado');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.statusCode = 404;
        res.end('Archivo no encontrado');
      } else {
        res.statusCode = 500;
        res.end('Error interno del servidor');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

// Rooms dictionary to manage clients by project: projectId -> Set of client objects
// A client object: { socket, state: 1, projectId, user: { userId, username, color } }
const rooms = new Map();

function broadcastUserList(projectId) {
  const room = rooms.get(projectId);
  if (!room) return;

  // Clean up any destroyed or unwritable sockets first
  room.forEach(c => {
    if (c.socket.destroyed || !c.socket.writable) {
      c.state = 0; // CLOSED
      room.delete(c);
    }
  });

  if (room.size === 0) {
    rooms.delete(projectId);
    return;
  }

  // De-duplicate active users by userId
  const uniqueUsersMap = new Map();
  Array.from(room)
    .filter(c => c.state === 1 && c.user && c.user.userId)
    .forEach(c => {
      uniqueUsersMap.set(c.user.userId, c.user);
    });

  const activeUsers = Array.from(uniqueUsersMap.values());

  room.forEach(c => {
    if (c.state === 1) {
      sendFrame(c.socket, {
        type: 'user_list',
        payload: activeUsers
      });
    }
  });
}

// Handle WebSocket Upgrade
server.on('upgrade', (req, socket) => {
  if (req.headers['upgrade'] !== 'websocket') {
    socket.destroy();
    return;
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const projectId = urlObj.searchParams.get('project') || 'default';

  // Session validation on Upgrade
  const session = parseSessionToken(req);
  if (!session) {
    console.log('[WebSocket] Conexión rechazada: No autorizado.');
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  const userId = session.user_id;
  let role = ProjectRepository.getProjectRole(projectId, userId);

  if (!role) {
    const exists = ProjectRepository.isProjectRegistered(projectId);
    if (!exists) {
      console.log(`[WebSocket] Migrando/Creando proyecto ${projectId} en BD. Owner: ${session.username}`);
      const pendingName = urlObj.searchParams.get('name');
      let displayName = pendingName || projectId;
      const diskState = loadProjectState(projectId);
      if (diskState && diskState.name) {
        displayName = diskState.name;
      }
      ProjectRepository.createProject({
        id: projectId,
        display_name: displayName,
        owner_id: userId
      });
      role = 'owner';
    } else {
      console.log(`[WebSocket] Acceso denegado a ${session.username} para el proyecto ${projectId} (No es miembro).`);
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
  }

  // Sec-WebSocket-Key handshake
  const key = req.headers['sec-websocket-key'];
  const hash = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${hash}`
  ];

  socket.write(responseHeaders.join('\r\n') + '\r\n\r\n');

  if (!rooms.has(projectId)) {
    rooms.set(projectId, new Set());
  }
  const room = rooms.get(projectId);

  const client = { 
    socket, 
    state: 1, // 1 = OPEN
    projectId,
    user: { 
      userId: session.user_id, 
      username: session.display_name, // Usar display_name como nombre visible
      color: session.color || '#6366f1',
      role: role
    },
    isAlive: true
  };
  room.add(client);

  console.log(`Nuevo compañero conectado al proyecto: "${projectId}" (Rol: ${role})`);

  let projectState = loadProjectState(projectId);
  if (!projectState) {
    projectState = {
      tables: [],
      relationships: [],
      groups: [],
      queries: []
    };
    saveProjectState(projectId, projectState);
  }

  // Send initial state and share link
  sendFrame(socket, {
    type: 'init_state',
    payload: {
      state: projectState,
      shareUrl: `http://${LOCAL_IP}:${PORT}/?project=${encodeURIComponent(projectId)}`
    }
  });

  let buffer = Buffer.alloc(0);
  let messageBuffer = '';

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const parsed = parseFrame(buffer);
      if (!parsed) break;

      buffer = buffer.slice(parsed.frameLength);

      if (parsed.opcode === 8) { // CLOSE frame
        socket.end();
        break;
      }

      if (parsed.opcode === 9) { // PING frame
        sendFrame(socket, parsed.payload, 10); // respond with PONG frame
        continue;
      }

      if (parsed.opcode === 10) { // PONG frame
        client.isAlive = true;
        continue;
      }

      if (parsed.opcode === 1 || parsed.opcode === 0) { // TEXT or CONTINUATION frame
        messageBuffer += parsed.payload;

        if (parsed.fin) {
          const completeMessage = messageBuffer;
          messageBuffer = ''; // Reset for next message

          try {
            const data = JSON.parse(completeMessage);
            
            if (data.type === 'ping') {
              sendFrame(socket, { type: 'pong' });
            } else if (data.type === 'join') {
              // Usar el user validado
              broadcastUserList(projectId);
            } else if (data.type === 'cursor_move') {
              room.forEach((c) => {
                if (c.socket !== socket && c.state === 1 && client.user.userId) {
                  sendFrame(c.socket, {
                    type: 'cursor_update',
                    payload: {
                      userId: client.user.userId,
                      username: client.user.username,
                      color: client.user.color,
                      x: data.payload.x,
                      y: data.payload.y
                    }
                  });
                }
              });
            } else if (data.type === 'update_state') {
              // Validar permisos de edición (editor u owner)
              if (client.user.role === 'viewer') {
                console.log(`[WebSocket] Bloqueada modificación de Viewer: ${client.user.username}`);
                sendFrame(socket, {
                  type: 'save_ack',
                  error: 'No tienes permisos de edición para este proyecto (Rol: Lector)'
                });
                
                // Revertir cliente localmente
                const currentDiskState = loadProjectState(projectId);
                if (currentDiskState) {
                  sendFrame(socket, {
                    type: 'sync_state',
                    payload: currentDiskState
                  });
                }
                return;
              }

              saveProjectState(projectId, data.payload);

              // Broadcast state update to all other open clients in this project
              room.forEach((c) => {
                if (c.socket !== socket && c.state === 1) {
                  sendFrame(c.socket, {
                    type: 'sync_state',
                    payload: data.payload
                  });
                }
              });
            }
          } catch (e) {
            console.error('Error procesando mensaje WebSocket:', e);
          }
        }
      }
    }
  });

  socket.on('close', () => {
    client.state = 0; // CLOSED
    if (rooms.has(projectId)) {
      const r = rooms.get(projectId);
      r.delete(client);
      if (r.size === 0) {
        rooms.delete(projectId);
      } else {
        broadcastUserList(projectId);
      }
    }
    console.log(`Compañero desconectado del proyecto: "${projectId}"`);
  });

  socket.on('error', (err) => {
    console.error('Error en socket de cliente:', err.message);
    socket.destroy();
  });
});

// Helper to parse incoming WebSocket frame according to RFC 6455
function parseFrame(buffer) {
  if (buffer.length < 2) return null;

  const firstByte = buffer[0];
  const secondByte = buffer[1];

  const fin = (firstByte & 0x80) !== 0;
  const opcode = firstByte & 0x0F;
  const masked = (secondByte & 0x80) !== 0;

  let payloadLength = secondByte & 0x7F;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < 4) return null;
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) return null;
    // Read 64-bit payload length
    const bigLen = buffer.readBigUInt64BE(2);
    if (bigLen > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Payload size exceeds maximum safe integer limits.");
    }
    payloadLength = Number(bigLen);
    offset = 10;
  }

  if (buffer.length < offset + (masked ? 4 : 0) + payloadLength) return null;

  let maskingKey;
  if (masked) {
    maskingKey = buffer.slice(offset, offset + 4);
    offset += 4;
  }

  const payload = buffer.slice(offset, offset + payloadLength);

  if (masked) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskingKey[i % 4];
    }
  }

  return {
    fin,
    opcode,
    payload: payload.toString('utf8'),
    frameLength: offset + payloadLength
  };
}

// Helper to send outgoing unmasked WebSocket frame
function sendFrame(socket, payload, opcode = 1) {
  let payloadBuffer;
  if (Buffer.isBuffer(payload)) {
    payloadBuffer = payload;
  } else if (typeof payload === 'object') {
    payloadBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
  } else {
    payloadBuffer = Buffer.from(String(payload), 'utf8');
  }

  const payloadLength = payloadBuffer.length;
  let header;

  if (payloadLength <= 125) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode; // FIN = 1, Opcode
    header[1] = payloadLength;
  } else if (payloadLength <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payloadLength, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payloadLength), 2);
  }

  try {
    if (socket.writable) {
      socket.write(Buffer.concat([header, payloadBuffer]));
    }
  } catch (e) {
    console.error('Error escribiendo en socket:', e.message);
  }
}

// Server Keep-Alive Heartbeat Interval
const serverHeartbeatInterval = setInterval(() => {
  rooms.forEach((room, projectId) => {
    room.forEach((client) => {
      if (client.state === 1) {
        if (client.isAlive === false) {
          console.log(`Cliente inactivo desconectado por heartbeat del proyecto: "${projectId}"`);
          client.socket.destroy();
          client.state = 0;
          room.delete(client);
          broadcastUserList(projectId);
        } else {
          client.isAlive = false;
          sendFrame(client.socket, '', 9); // Opcode 9 = PING frame
        }
      }
    });
    if (room.size === 0) {
      rooms.delete(projectId);
    }
  });
}, 35000);

// Clean up expired sessions periodically (every 30 minutes)
const sessionCleanupInterval = setInterval(() => {
  const deletedCount = SessionRepository.deleteExpiredSessions();
  if (deletedCount > 0) {
    console.log(`[Database] Limpieza automática: Se eliminaron ${deletedCount} sesiones expiradas.`);
  }
}, 30 * 60 * 1000);
// Ensure it doesn't block server shutdown
sessionCleanupInterval.unref();

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Servidor ERD Colaborativo Iniciado (Sin dependencias)`);
  console.log(`======================================================`);
  console.log(`Acceso Local:      http://localhost:${PORT}`);
  console.log(`Acceso Red Local:  http://${LOCAL_IP}:${PORT}`);
  console.log(`======================================================\n`);
});
