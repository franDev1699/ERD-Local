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
const FeedbackRepository = require('./src/db/FeedbackRepository');
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

// Helper para hacer peticiones HTTP asíncronas con soporte para HTTP y HTTPS
function sendHttpRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const clientModule = url.startsWith('https') ? https : http;
    const req = clientModule.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, data });
      });
    });
    req.on('error', (e) => reject(e));
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// Helper para mezclar las coordenadas recalculadas por la IA en el estado original del diagrama
function mergeLayoutResult(originalState, layoutResult) {
  if (!originalState) return layoutResult;
  
  const merged = JSON.parse(JSON.stringify(originalState));
  
  if (layoutResult && layoutResult.tables && Array.isArray(layoutResult.tables)) {
    const layoutTablesMap = new Map();
    for (const tbl of layoutResult.tables) {
      if (tbl.id) {
        layoutTablesMap.set(tbl.id, tbl);
      }
    }
    
    for (const tbl of merged.tables) {
      const layoutTbl = layoutTablesMap.get(tbl.id);
      if (layoutTbl) {
        if (typeof layoutTbl.x === 'number') tbl.x = layoutTbl.x;
        if (typeof layoutTbl.y === 'number') tbl.y = layoutTbl.y;
        if (layoutTbl.groupId !== undefined) tbl.groupId = layoutTbl.groupId;
        if (layoutTbl.color !== undefined) tbl.color = layoutTbl.color;
      }
    }
  }
  
  if (layoutResult && layoutResult.groups && Array.isArray(layoutResult.groups)) {
    merged.groups = layoutResult.groups;
  }
  
  return merged;
}

// Enviar un mensaje de estado/progreso al WebSocket activo del usuario
function sendUserStatusLog(userId, message) {
  let matchCount = 0;
  let totalClients = 0;
  rooms.forEach((room, projectId) => {
    room.forEach((client) => {
      totalClients++;
      const clientUserId = client.user ? (client.user.userId || client.user.id) : null;
      if (clientUserId === userId && client.state === 1) {
        matchCount++;
        const writable = client.socket && client.socket.writable;
        console.log(`[WS-STATUS] Enviando a cliente en proyecto "${projectId}", socket writable: ${writable}, msg preview: ${message.substring(0, 50)}`);
        try {
          sendFrame(client.socket, {
            type: 'ai_status_progress',
            message: message
          });
        } catch (e) {
          console.error('Error enviando log de progreso por WS:', e.message);
        }
      }
    });
  });
  if (matchCount === 0) {
    console.warn(`[WS-STATUS] ⚠️ No se encontró ningún cliente WS para userId="${userId}". Total clientes en rooms: ${totalClients}`);
    // Log all connected user IDs for debugging
    rooms.forEach((room, projectId) => {
      room.forEach((client) => {
        const clientUserId = client.user ? (client.user.userId || client.user.id) : 'N/A';
        console.warn(`[WS-STATUS]   - Proyecto "${projectId}": user=${clientUserId}, state=${client.state}`);
      });
    });
  }
}

function getAiRequestHash(params) {
  const data = {
    provider: params.provider || '',
    model: params.model || '',
    mode: params.mode || '',
    prompt: params.prompt || '',
    enableThinking: !!params.enableThinking,
    currentQuerySql: params.currentQuerySql || '',
    contextDepth: params.contextDepth || '',
    selectedTableIds: params.selectedTableIds || [],
  };
  
  if (params.currentState) {
    if (params.mode === 'layout_group') {
      data.currentState = {
        tables: (params.currentState.tables || []).map(t => ({ id: t.id, name: t.name, groupId: t.groupId || null })),
        relationships: (params.currentState.relationships || []).map(r => ({ from: r.fromTable, to: r.toTable }))
      };
    } else {
      data.currentState = params.currentState;
    }
  }
  
  const serialized = JSON.stringify(data);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

function getAiCache(hash) {
  try {
    const stmt = db.prepare("SELECT response FROM ai_cache WHERE hash = ?");
    const row = stmt.get(hash);
    if (row) {
      console.log(`[Cache] Usando respuesta de IA guardada en caché (${hash.slice(0, 8)}...)`);
      return JSON.parse(row.response);
    }
    return null;
  } catch (err) {
    console.error("[Cache] Error al leer caché:", err.message);
    return null;
  }
}

function saveAiCache(hash, response) {
  try {
    const stmt = db.prepare("INSERT OR REPLACE INTO ai_cache (hash, response) VALUES (?, ?)");
    stmt.run(hash, JSON.stringify(response));
    console.log(`[Cache] Respuesta de IA guardada en caché bajo hash: ${hash.slice(0, 8)}...`);
  } catch (err) {
    console.error("[Cache] Error al escribir en caché:", err.message);
  }
}

async function makeAiRequest(params) {
  const { provider, apiKey, apiUrl, model, prompt, currentState, mode, engine, currentQuerySql, contextDepth, selectedTableIds, userId, enableThinking } = params;
  
  const cacheHash = getAiRequestHash(params);
  const cachedResponse = getAiCache(cacheHash);
  if (cachedResponse) {
    console.log(`[Cache] Hit para modo "${mode}" — saltando request al modelo.`);
    sendUserStatusLog(userId, `Respuesta obtenida del caché.`);
    return cachedResponse;
  }

  let systemInstruction = '';
  
  if (mode === 'layout_group') {
    systemInstruction = prompt;
  } else {
    let promptTemplate = '';
    const prompts = AiPromptRepository.getPromptsForUser(userId);
    if (mode === 'append') {
      promptTemplate = prompts.mode_append;
    } else if (mode === 'edit') {
      promptTemplate = prompts.mode_edit;
    } else if (mode === 'layout') {
      promptTemplate = `Eres un diseñador de bases de datos experto. El usuario desea REORGANIZAR las posiciones y dimensiones de las tablas y grupos del diagrama para mejorar su legibilidad y estética.
NO agregues, modifiques ni elimines ninguna tabla, campo, tipo ni relación. Solo debes ajustar las coordenadas (x, y) de las tablas y de los grupos, y las dimensiones (width, height) de los grupos.
Agrupa físicamente cerca las tablas relacionadas, manteniendo un excelente espacio libre entre ellas.

Para ahorrar tokens y velocidad, tu respuesta JSON DEBE ser compacta y contener únicamente las coordenadas (x, y) de las tablas y grupos, y dimensiones (width, height) de los grupos. NO devuelvas los campos ('fields') de las tablas ni las relaciones ('relationships').
Esquema JSON de respuesta esperado:
{
  "tables": [
    { "id": "string", "x": número, "y": número, "groupId": "string o null" }
  ],
  "groups": [
    { "id": "string", "name": "string", "color": "string", "x": número, "y": número, "width": número, "height": número }
  ]
}

Reglas importantes:
1. El JSON debe ser 100% válido y parseable directamente. No agregues \`\`\`json ni bloques de código.
2. No cambies nombres de tablas ni de grupos.
3. Organiza todas las coordenadas y dimensiones del diagrama siguiendo al pie de la letra estas directrices:
{layoutRulesText}
importante: no use el pensamiento, ni pensamiento extendido.
Estado actual del diagrama:
{currentState}`;
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

    systemInstruction = (promptTemplate || '')
      .replace(/{expectedSchemaText}/g, prompts.expectedSchemaText || '')
      .replace(/{layoutRulesText}/g, prompts.layoutRulesText || '')
      .replace(/{currentState}/g, stateStr)
      .replace(/{engine}/g, engine || 'PostgreSQL')
      .replace(/{currentQuerySql}/g, currentQuerySqlStr);

    if (catalogInstruction) {
      systemInstruction += catalogInstruction;
    }
  }

  if (provider === 'gemini') {
    const geminiModel = model || 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;
    
    const textPart = (mode === 'layout_group') ? systemInstruction : `Requerimiento del usuario: ${prompt}\n\nInstrucción del sistema: ${systemInstruction}`;
    
    const requestBody = JSON.stringify({
      contents: [{
        parts: [{
          text: textPart
        }]
      }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    });

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    try {
      const res = await sendHttpRequest(url, options, requestBody);
      const parsed = JSON.parse(res.data);
      if (parsed.error) {
        throw new Error(parsed.error.message || 'Error en la API de Gemini');
      }
      
      let reasoningText = '';
      let textResponse = '';
      
      if (parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content && parsed.candidates[0].content.parts) {
        for (const part of parsed.candidates[0].content.parts) {
          if (part.thought) {
            reasoningText += part.text || '';
          } else {
            textResponse += part.text || '';
          }
        }
      }
      
      if (!textResponse && parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content && parsed.candidates[0].content.parts && parsed.candidates[0].content.parts[0]) {
        textResponse = parsed.candidates[0].content.parts[0].text || '';
      }
      
      const thinkMatch = textResponse.match(/<think>([\s\S]*?)<\/think>/);
      if (thinkMatch) {
        reasoningText = (reasoningText ? reasoningText + '\n' : '') + thinkMatch[1];
        textResponse = textResponse.replace(/<think>[\s\S]*?<\/think>/, '');
      }
      
      if (reasoningText.trim()) {
        sendUserStatusLog(userId, `[THINKING] ${reasoningText.trim()}`);
      }

      const parsedResult = JSON.parse(cleanJsonResponseText(textResponse));
      saveAiCache(cacheHash, parsedResult);
      return parsedResult;
    } catch (e) {
      throw new Error('La respuesta de Gemini no se pudo procesar como JSON: ' + e.message);
    }

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

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (apiKey) {
      options.headers['Authorization'] = `Bearer ${apiKey}`;
    }

    let textResponse = '';
    let reasoningText = '';
    let finishReason = 'length';
    let attempts = 0;
    const maxAttempts = 3;

    const messages = (mode === 'layout_group') ? [
      { role: 'user', content: systemInstruction }
    ] : [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: prompt }
    ];

    let partContent = '';
    
    sendUserStatusLog(userId, 'Conectando con el servidor de IA...');

    while (finishReason === 'length' && attempts < maxAttempts) {
      attempts++;
      
      if (attempts > 1) {
        const msg = `La respuesta se truncó (intento ${attempts - 1}). Solicitando continuación...`;
        console.log(`[makeAiRequest] ${msg}`);
        sendUserStatusLog(userId, msg);
        messages.push({ role: 'assistant', content: partContent });
        messages.push({
          role: 'user',
          content: 'Tu respuesta anterior se interrumpió por el límite de tokens. Continúa escribiendo la respuesta EXACTAMENTE desde el último carácter, sin repetir nada de lo que ya escribiste, sin envolverlo en bloques de código markdown (como ```json) y sin dar explicaciones. Solo escribe el fragmento restante del JSON.'
        });
      }

      const requestPayload = {
        model: modelName,
        messages: messages,
        max_tokens: 8192
      };

      // Send enable_thinking on all attempts so the model keeps its thinking mode
      requestPayload.chat_template_kwargs = { enable_thinking: !!enableThinking };
      if (attempts === 1 && provider === 'openai') {
        requestPayload.response_format = { type: "json_object" };
      }

      let res;
      try {
        res = await sendHttpRequest(requestUrl, options, JSON.stringify(requestPayload));
      } catch (err) {
        throw new Error(`No se pudo conectar con el servidor de IA (${requestUrl}): ${err.message}`);
      }

      let parsed;
      try {
        parsed = JSON.parse(res.data);
      } catch (err) {
        throw new Error(`La respuesta del servidor de IA no es un JSON válido. Status: ${res.statusCode}. Error: ${err.message}`);
      }

      if (parsed.error) {
        const errMsg = parsed.error.message || (typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error));
        throw new Error(errMsg || 'Error en el proveedor compatible con OpenAI');
      }

      if (!parsed.choices || parsed.choices.length === 0 || !parsed.choices[0].message) {
        throw new Error('Respuesta inválida del proveedor compatible con OpenAI.');
      }

      partContent = parsed.choices[0].message.content || '';
      textResponse += partContent;
      
      // Check multiple possible fields for thinking/reasoning content
      const msg = parsed.choices[0].message;
      // DEBUG: Log all message fields to identify where thinking content lives
      const msgKeys = Object.keys(msg);
      console.log(`[AI-DEBUG] Message keys: ${msgKeys.join(', ')}`);
      console.log(`[AI-DEBUG] reasoning_content: ${(msg.reasoning_content || '').substring(0, 100)}`);
      console.log(`[AI-DEBUG] reasoning: ${(msg.reasoning || '').substring(0, 100)}`);
      console.log(`[AI-DEBUG] content has <think>: ${partContent.includes('<think>')}`);
      console.log(`[AI-DEBUG] enableThinking: ${enableThinking}`);
      const reasoningPart = msg.reasoning_content || msg.reasoning || '';
      if (reasoningPart) {
        reasoningText += reasoningPart;
      }
      
      finishReason = parsed.choices[0].finish_reason;
      
      sendUserStatusLog(userId, `Procesados ${textResponse.length} caracteres de respuesta...`);
    }

    const thinkMatch = textResponse.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      reasoningText = (reasoningText ? reasoningText + '\n' : '') + thinkMatch[1];
      textResponse = textResponse.replace(/<think>[\s\S]*?<\/think>/, '');
    }
    
    if (reasoningText.trim()) {
      // Truncate thinking to avoid oversized WebSocket frames (models can produce 10-18KB+ of thinking)
      const MAX_THINKING_LENGTH = 2000;
      let thinkingToSend = reasoningText.trim();
      if (thinkingToSend.length > MAX_THINKING_LENGTH) {
        thinkingToSend = thinkingToSend.substring(0, MAX_THINKING_LENGTH) + '\n\n... (truncado, ' + reasoningText.trim().length + ' chars totales)';
      }
      console.log(`[AI-DEBUG] Enviando [THINKING] al usuario ${userId}, longitud: ${reasoningText.trim().length} chars (enviando ${thinkingToSend.length})`);
      sendUserStatusLog(userId, `[THINKING] ${thinkingToSend}`);
    } else {
      console.log(`[AI-DEBUG] No se encontró thinking content. reasoningText empty: ${!reasoningText}`);
    }

    try {
      const parsedResult = tryParseJSONResponse(textResponse);
      saveAiCache(cacheHash, parsedResult);
      return parsedResult;
    } catch (parseErr) {
      if (finishReason === 'length') {
        // Try to repair the truncated JSON before giving up
        sendUserStatusLog(userId, 'Respuesta truncada. Intentando reparar JSON...');
        try {
          const repaired = repairTruncatedJson(cleanJsonResponseText(textResponse));
          const repairedResult = JSON.parse(repaired);
          sendUserStatusLog(userId, 'JSON reparado exitosamente tras truncamiento.');
          saveAiCache(cacheHash, repairedResult);
          return repairedResult;
        } catch (repairErr) {
          throw new Error('La respuesta de la IA se truncó (finish_reason: length) y no se pudo reparar el JSON. Intenta reducir la cantidad de tablas o usar un modelo con mayor contexto.');
        }
      }
      throw new Error('La respuesta del proveedor de IA no se pudo procesar como JSON: ' + parseErr.message + '\nRespuesta acumulada: ' + textResponse);
    }

  } else if (provider === 'ollama') {
    const ollamaUrl = apiUrl || 'http://localhost:11434';
    const url = `${ollamaUrl}/api/chat`;

    const requestBody = JSON.stringify({
      model: model || 'llama3',
      messages: (mode === 'layout_group') ? [
        { role: 'user', content: systemInstruction }
      ] : [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt }
      ],
      stream: false,
      format: 'json'
    });

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (apiKey) {
      options.headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
      const res = await sendHttpRequest(url, options, requestBody);
      const parsed = JSON.parse(res.data);
      if (parsed.error) {
        throw new Error(parsed.error || 'Error en la API de Ollama');
      }
      const textResponse = parsed.message.content;
      const parsedResult = JSON.parse(cleanJsonResponseText(textResponse));
      saveAiCache(cacheHash, parsedResult);
      return parsedResult;
    } catch (e) {
      throw new Error('La respuesta de Ollama no se pudo procesar como JSON: ' + e.message);
    }
  } else {
    throw new Error('Proveedor de IA no soportado.');
  }
}

// Helper para solicitar la documentación detallada en Markdown a la IA con soporte para auto-continuar respuestas truncadas
async function makeAiDocRequest({ provider, apiKey, apiUrl, model, currentState, userId, enableThinking }) {
  const prompts = AiPromptRepository.getPromptsForUser(userId);
  const stateStr = JSON.stringify(currentState || { tables: [], relationships: [] }, null, 2);
  const prompt = (prompts.prompt_document || '').replace(/{currentState}/g, stateStr);

  if (provider === 'gemini') {
    const geminiModel = model || 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;
    
    const requestBody = JSON.stringify({
      contents: [{
        parts: [{
          text: prompt
        }]
      }]
    });

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    try {
      const res = await sendHttpRequest(url, options, requestBody);
      const parsed = JSON.parse(res.data);
      if (parsed.error) {
        throw new Error(parsed.error.message || 'Error en la API de Gemini');
      }
      return parsed.candidates[0].content.parts[0].text;
    } catch (e) {
      throw new Error('La respuesta de Gemini no se pudo procesar: ' + e.message);
    }

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

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (apiKey) {
      options.headers['Authorization'] = `Bearer ${apiKey}`;
    }

    let textResponse = '';
    let finishReason = 'length';
    let attempts = 0;
    const maxAttempts = 3;

    const messages = [
      { role: 'user', content: prompt }
    ];

    let partContent = '';

    while (finishReason === 'length' && attempts < maxAttempts) {
      attempts++;

      if (attempts > 1) {
        console.log(`[makeAiDocRequest] La documentación se truncó (intento ${attempts - 1}). Solicitando continuación...`);
        messages.push({ role: 'assistant', content: partContent });
        messages.push({
          role: 'user',
          content: 'Tu respuesta anterior se interrumpió por el límite de espacio. Continúa imprimiendo el texto EXACTAMENTE desde donde te quedaste (sin repetir nada anterior y sin introducciones). Solo escribe la continuación.'
        });
      }

      const requestPayload = {
        model: modelName,
        messages: messages,
        max_tokens: 8192
      };
      requestPayload.chat_template_kwargs = { enable_thinking: !!enableThinking };

      let res;
      try {
        res = await sendHttpRequest(requestUrl, options, JSON.stringify(requestPayload));
      } catch (err) {
        throw new Error(`No se pudo conectar con el servidor de IA (${requestUrl}): ${err.message}`);
      }

      let parsed;
      try {
        parsed = JSON.parse(res.data);
      } catch (err) {
        throw new Error(`La respuesta del servidor de IA no es un JSON válido. Status: ${res.statusCode}. Error: ${err.message}`);
      }

      if (parsed.error) {
        const errMsg = parsed.error.message || (typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error));
        throw new Error(errMsg || 'Error en el proveedor compatible con OpenAI');
      }

      if (!parsed.choices || parsed.choices.length === 0 || !parsed.choices[0].message) {
        throw new Error('Respuesta inválida del proveedor compatible con OpenAI.');
      }

      partContent = parsed.choices[0].message.content || '';
      textResponse += partContent;
      finishReason = parsed.choices[0].finish_reason;
    }

    return textResponse;

  } else if (provider === 'ollama') {
    const ollamaUrl = apiUrl || 'http://localhost:11434';
    const url = `${ollamaUrl}/api/chat`;

    const requestBody = JSON.stringify({
      model: model || 'llama3',
      messages: [
        { role: 'user', content: prompt }
      ],
      stream: false
    });

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (apiKey) {
      options.headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
      const res = await sendHttpRequest(url, options, requestBody);
      const parsed = JSON.parse(res.data);
      if (parsed.error) {
        throw new Error(parsed.error || 'Error en la API de Ollama');
      }
      return parsed.message.content;
    } catch (e) {
      throw new Error('La respuesta de Ollama no se pudo procesar: ' + e.message);
    }
  } else {
    throw new Error('Proveedor de IA no soportado.');
  }
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

// Valida si un color es un formato hexadecimal CSS válido (#ffffff)
function isValidHexColor(color) {
  return typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color);
}

// Genera un color HSL distribuido y lo convierte a Hexadecimal
function getFallbackColor(index) {
  const hue = (index * 137.5) % 360; // Distribución basada en el ángulo dorado
  return hslToHex(hue, 65, 50);
}

function hslToHex(h, s, l) {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
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

// Repara un JSON truncado cerrando llaves y corchetes abiertos de forma robusta
function repairTruncatedJson(jsonStr) {
  let str = jsonStr.trim();
  let stack = [];
  let inString = false;
  let escaped = false;
  
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{' || char === '[') {
        stack.push(char);
      } else if (char === '}') {
        if (stack[stack.length - 1] === '{') {
          stack.pop();
        }
      } else if (char === ']') {
        if (stack[stack.length - 1] === '[') {
          stack.pop();
        }
      }
    }
  }
  
  if (stack.length === 0) {
    return str;
  }
  
  if (inString) {
    str += '"';
  }
  
  let cleanStr = str;
  while (cleanStr.length > 0) {
    const lastChar = cleanStr[cleanStr.length - 1];
    if (lastChar === ':' || lastChar === ',' || /\s/.test(lastChar)) {
      cleanStr = cleanStr.slice(0, -1);
    } else if (lastChar === '"' && cleanStr[cleanStr.length - 2] === ',') {
      cleanStr = cleanStr.slice(0, -1);
    } else {
      break;
    }
  }
  
  if (cleanStr.length === 0) {
    return str;
  }
  
  const lastComma = cleanStr.lastIndexOf(',');
  const lastOpenBrace = Math.max(cleanStr.lastIndexOf('{'), cleanStr.lastIndexOf('['));
  const cutIndex = Math.max(lastComma, lastOpenBrace);
  
  if (cutIndex !== -1) {
    const tail = cleanStr.slice(cutIndex);
    const quoteCount = (tail.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0 || tail.trim().endsWith(':') || 
        (tail.includes('":') && !tail.includes('":"') && !tail.includes('":null') && 
         !tail.includes('":true') && !tail.includes('":false') && !/\d/.test(tail))) {
      cleanStr = cleanStr.slice(0, cutIndex);
      while (cleanStr.length > 0 && (cleanStr[cleanStr.length - 1] === ',' || /\s/.test(cleanStr[cleanStr.length - 1]))) {
        cleanStr = cleanStr.slice(0, -1);
      }
    }
  }

  stack = [];
  inString = false;
  escaped = false;
  for (let i = 0; i < cleanStr.length; i++) {
    const char = cleanStr[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (!inString) {
      if (char === '{' || char === '[') stack.push(char);
      else if (char === '}') { if (stack[stack.length - 1] === '{') stack.pop(); }
      else if (char === ']') { if (stack[stack.length - 1] === '[') stack.pop(); }
    }
  }

  let closingTags = '';
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i] === '{') {
      closingTags += '}';
    } else if (stack[i] === '[') {
      closingTags += ']';
    }
  }
  
  return cleanStr + closingTags;
}

// Intenta parsear el JSON de forma robusta, buscando bloques válidos si la respuesta concatenada falló
function tryParseJSONResponse(text) {
  const cleaned = cleanJsonResponseText(text);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // Intentar reparar el JSON si se truncó
    try {
      const repaired = repairTruncatedJson(cleaned);
      return JSON.parse(repaired);
    } catch (repairErr) {
      // Si falla la reparación, probar las heurísticas anteriores
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const candidate = text.slice(firstBrace, lastBrace + 1);
        try {
          return JSON.parse(cleanJsonResponseText(candidate));
        } catch (e) {
          // Intentar buscar el último bloque '{' si hubo un reinicio completo en la concatenación
          const lastStartBrace = text.lastIndexOf('{');
          if (lastStartBrace !== -1 && lastStartBrace > firstBrace && lastBrace > lastStartBrace) {
            const lastCandidate = text.slice(lastStartBrace, lastBrace + 1);
            try {
              return JSON.parse(cleanJsonResponseText(lastCandidate));
            } catch (e2) {}
          }
        }
      }
      throw err;
    }
  }
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

async function executeLayoutGroupBatch(params, batchTables, batchRels, existingGroups, existingAssignments, userId) {
  let existingGroupsSection = '';
  if (existingGroups && existingGroups.length > 0) {
    existingGroupsSection = `GRUPOS YA EXISTENTES (NO los modifiques, solo úsalos como referencia):\n${JSON.stringify(existingGroups)}\n\n`;
  }

  let existingAssignmentsSection = '';
  if (existingAssignments && existingAssignments.length > 0) {
    existingAssignmentsSection = `ASIGNACIONES EXISTENTES (RESPÉTALAS - NO cambies el groupId de estas tablas):\n${JSON.stringify(existingAssignments)}\n\n`;
  }

  const prompt = `${existingGroupsSection}${existingAssignmentsSection}TABLAS:
${JSON.stringify(batchTables, null, 2)}

RELACIONES:
${JSON.stringify(batchRels, null, 2)}

REGLAS CRÍTICAS:
1. **RESPETA LAS ASIGNACIONES EXISTENTES**: Si una tabla ya tiene un groupId en "ASIGNACIONES EXISTENTES", DEBES mantener ese mismo groupId. NO la muevas a otro grupo.
2. Solo asigna groupId a tablas que actualmente tienen groupId: null (sin grupo).
3. Para tablas sin grupo, agrúpalas por dominio funcional usando las relaciones como señal principal.
4. Una tabla puede quedar sin grupo (groupId: null) si no encaja claramente en ningún dominio. No fuerces agrupaciones artificiales.
5. Cada grupo debe tener entre 2 y 12 tablas.
6. Asigna a cada grupo un color hex que tenga relación semántica con el dominio funcional. Usa colores de saturación media, evita repetir colores idénticos.
7. Nombra cada grupo con 2-4 palabras que describan el dominio, nunca genérico como "Grupo 1".
8. Responde ÚNICAMENTE con este JSON, sin texto antes ni después, sin markdown, sin backticks:

{
  "groups": [
    { "id": "g1", "name": "string", "color": "#hex" }
  ],
  "assignments": [
    { "tableId": "string", "groupId": "g1_o_null" }
  ]
}

9. El array "assignments" debe incluir exactamente una entrada por cada tabla recibida. Para tablas con asignación existente, usa el mismo groupId. Para tablas sin grupo, asigna un groupId nuevo o null.
10. NO cambies el groupId de ninguna tabla que ya tenga uno asignado en "ASIGNACIONES EXISTENTES".`;

  const requestParams = {
    ...params,
    prompt: prompt,
    mode: 'layout_group',
    userId: userId,
    enableThinking: false // Desactivar pensamiento profundo para agrupamiento (ahorra ~90% de tiempo y tokens)
  };

  return await makeAiRequest(requestParams);
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
        const originalState = params.currentState;
        const aiResult = await makeAiRequest(params);

        let finalResult = aiResult;
        if (params.mode === 'layout' && originalState) {
          finalResult = mergeLayoutResult(originalState, aiResult);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: finalResult }));
      } catch (err) {
        console.error('Error en Proxy de IA:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST /api/ai/layout-group - Auto-Layout functional grouping stage
    if (req.method === 'POST' && cleanUrl === '/api/ai/layout-group') {
      try {
        const clientParams = await readJsonBody(req);
        const params = resolveAiParams(session.user_id, clientParams);
        const requiresApiKey = ['gemini', 'openai'].includes(params.provider);
        if (requiresApiKey && !params.apiKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'La API Key es obligatoria para proveedores Cloud.' }));
          return;
        }

        let state = clientParams.currentState;
        if (!state && clientParams.projectId) {
          state = loadProjectState(clientParams.projectId);
        }

        if (!state || !Array.isArray(state.tables)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Estado del proyecto no válido o vacío.' }));
          return;
        }

        const simplifiedTables = state.tables.map(t => ({ id: t.id, name: t.name, groupId: t.groupId || null }));
        const simplifiedRelationships = (state.relationships || []).map(r => ({ from: r.fromTable, to: r.toTable }));
        const existingGroups = state.groups || [];
        // Extract existing table-to-group assignments (only tables that already have a groupId)
        const existingAssignments = simplifiedTables
          .filter(t => t.groupId)
          .map(t => ({ tableId: t.id, groupId: t.groupId }));

        const BATCH_SIZE = 60;
        const batches = [];
        for (let i = 0; i < simplifiedTables.length; i += BATCH_SIZE) {
          batches.push(simplifiedTables.slice(i, i + BATCH_SIZE));
        }

        const existingGroupIds = new Set(existingGroups.map(g => g.id));
        const preservedAssignments = new Map(existingAssignments.map(a => [a.tableId, a.groupId]));

        // Ejecutar lotes en paralelo
        sendUserStatusLog(session.user_id, `Iniciando análisis en paralelo para ${batches.length} lote(s)...`);
        
        const batchPromises = batches.map(async (batchTables, b) => {
          const batchTableIds = new Set(batchTables.map(t => t.id));
          const batchRels = simplifiedRelationships.filter(r => batchTableIds.has(r.from) || batchTableIds.has(r.to));

          let batchResult;
          try {
            sendUserStatusLog(session.user_id, `Analizando lote ${b + 1} de ${batches.length}...`);
            batchResult = await executeLayoutGroupBatch(params, batchTables, batchRels, existingGroups, existingAssignments, session.user_id);
          } catch (batchErr) {
            console.error(`Error en lote ${b + 1}:`, batchErr.message);
            sendUserStatusLog(session.user_id, `⚠️ Error en lote ${b + 1}: ${batchErr.message.substring(0, 120)}`);
            const fallbackAssignments = batchTables.map(t => ({
              tableId: t.id,
              groupId: preservedAssignments.get(t.id) || null
            }));
            return { groups: [], assignments: fallbackAssignments, batchIndex: b };
          }

          const assignmentsMap = new Map();
          if (batchResult && Array.isArray(batchResult.assignments)) {
            batchResult.assignments.forEach(asgn => {
              if (asgn && asgn.tableId && batchTableIds.has(asgn.tableId)) {
                assignmentsMap.set(asgn.tableId, asgn.groupId || null);
              }
            });
          }

          const missingTables = batchTables.filter(t => !assignmentsMap.has(t.id));
          if (missingTables.length > 0) {
            console.log(`Lote ${b + 1}: Faltan asignaciones para ${missingTables.length} tablas. Reintentando...`);
            try {
              const retryRels = simplifiedRelationships.filter(r => missingTables.some(mt => mt.id === r.from || mt.id === r.to));
              const retryResult = await executeLayoutGroupBatch(params, missingTables, retryRels, existingGroups, existingAssignments, session.user_id);
              if (retryResult && Array.isArray(retryResult.assignments)) {
                retryResult.assignments.forEach(asgn => {
                  if (asgn && asgn.tableId && missingTables.some(mt => mt.id === asgn.tableId)) {
                    assignmentsMap.set(asgn.tableId, asgn.groupId || null);
                  }
                });
              }
            } catch (retryErr) {
              console.error(`Error en reintento de lote ${b + 1}:`, retryErr.message);
            }
          }

          batchTables.forEach(t => {
            if (!assignmentsMap.has(t.id)) {
              assignmentsMap.set(t.id, preservedAssignments.get(t.id) || null);
            }
          });

          const finalBatchAssignments = Array.from(assignmentsMap.entries()).map(([tableId, groupId]) => ({
            tableId,
            groupId
          }));

          return {
            groups: batchResult && Array.isArray(batchResult.groups) ? batchResult.groups : [],
            assignments: finalBatchAssignments,
            batchIndex: b
          };
        });

        const batchResults = await Promise.all(batchPromises);

        const rawGroups = [];
        const rawAssignments = [];
        const finalGroups = [...existingGroups];
        const existingGroupNames = new Map(existingGroups.map(g => [g.name.trim().toLowerCase(), g.id]));

        batchResults.forEach((res, b) => {
          const batchGroupMap = new Map();
          
          res.groups.forEach(g => {
            if (g && g.id && g.name) {
              const nameLower = g.name.trim().toLowerCase();
              if (existingGroupNames.has(nameLower)) {
                batchGroupMap.set(g.id, existingGroupNames.get(nameLower));
              } else {
                const newGroupId = `b_${b}_${g.id}`;
                batchGroupMap.set(g.id, newGroupId);
                rawGroups.push({ id: newGroupId, name: g.name.trim(), color: g.color });
              }
            }
          });

          res.assignments.forEach(asgn => {
            let finalGroupId = asgn.groupId;
            if (preservedAssignments.has(asgn.tableId)) {
              finalGroupId = preservedAssignments.get(asgn.tableId);
            } else if (asgn.groupId) {
              if (existingGroupIds.has(asgn.groupId)) {
                finalGroupId = asgn.groupId;
              } else if (batchGroupMap.has(asgn.groupId)) {
                finalGroupId = batchGroupMap.get(asgn.groupId);
              } else {
                finalGroupId = null;
              }
            }
            rawAssignments.push({ tableId: asgn.tableId, groupId: finalGroupId });
          });
        });

        const nameToGroupMap = new Map();
        rawGroups.forEach(rg => {
          const nameLower = rg.name.toLowerCase();
          if (!nameToGroupMap.has(nameLower)) {
            const canonicalId = `g_${crypto.randomBytes(4).toString('hex')}`;
            let color = rg.color;
            if (!isValidHexColor(color)) {
              color = getFallbackColor(finalGroups.length + nameToGroupMap.size);
            }
            nameToGroupMap.set(nameLower, {
              id: canonicalId,
              name: rg.name,
              color: color,
              sourceIds: new Set([rg.id])
            });
          } else {
            nameToGroupMap.get(nameLower).sourceIds.add(rg.id);
          }
        });

        nameToGroupMap.forEach(cg => {
          finalGroups.push({ id: cg.id, name: cg.name, color: cg.color });
        });

        const finalAssignments = rawAssignments.map(asgn => {
          let finalGroupId = asgn.groupId;
          if (finalGroupId && finalGroupId.startsWith('b_')) {
            let foundCanonicalId = null;
            for (const cg of nameToGroupMap.values()) {
              if (cg.sourceIds.has(finalGroupId)) {
                foundCanonicalId = cg.id;
                break;
              }
            }
            finalGroupId = foundCanonicalId || null;
          }
          return { tableId: asgn.tableId, groupId: finalGroupId };
        });

        // Filtrar grupos vacíos (grupos que no tienen ninguna tabla asignada)
        const assignedGroupIds = new Set(finalAssignments.map(a => a.groupId).filter(Boolean));
        const filteredGroups = finalGroups.filter(g => assignedGroupIds.has(g.id));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, groups: filteredGroups, assignments: finalAssignments }));
      } catch (err) {
        console.error('Error en /api/ai/layout-group:', err.message);
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

    // ============================================
    // FEEDBACK / SUGGESTIONS API
    // ============================================

    // GET /api/feedback - List feedback (own or all for admins)
    if (req.method === 'GET' && cleanUrl === '/api/feedback') {
      try {
        let results;
        if (session.is_admin === 1) {
          results = FeedbackRepository.getAllFeedback();
        } else {
          results = FeedbackRepository.getFeedbackByUserId(session.user_id, false);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(results));
      } catch (err) {
        console.error('[server.js] Error al obtener feedback:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST /api/feedback - Create new feedback
    if (req.method === 'POST' && cleanUrl === '/api/feedback') {
      try {
        const payload = await readJsonBody(req);
        if (!payload.type || !['bug', 'suggestion', 'feature', 'other'].includes(payload.type)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Tipo de feedback inválido.' }));
          return;
        }
        if (!payload.subject || payload.subject.trim().length < 3) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'El asunto debe tener al menos 3 caracteres.' }));
          return;
        }
        if (!payload.description || payload.description.trim().length < 10) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'La descripción debe tener al menos 10 caracteres.' }));
          return;
        }

        const feedback = FeedbackRepository.createFeedback({
          userId: session.user_id,
          type: payload.type,
          subject: payload.subject,
          description: payload.description,
        });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: feedback }));
      } catch (err) {
        console.error('[server.js] Error al crear feedback:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // PUT /api/feedback/:id - Update feedback status (admins only)
    if (req.method === 'PUT' && cleanUrl.startsWith('/api/feedback/')) {
      try {
        const itemId = cleanUrl.split('/').pop();
        if (itemId === 'feedback') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No encontrado' }));
          return;
        }
        if (session.is_admin !== 1) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Solo administradores pueden actualizar feedback.' }));
          return;
        }
        const payload = await readJsonBody(req);
        if (!payload.status || !['new', 'in_progress', 'resolved', 'closed'].includes(payload.status)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Estado inválido.' }));
          return;
        }
        const updated = FeedbackRepository.updateStatus(itemId, payload.status);
        if (!updated) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Feedback no encontrado.' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: updated }));
      } catch (err) {
        console.error('[server.js] Error al actualizar feedback:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // DELETE /api/feedback/:id - Delete feedback (admins only)
    if (req.method === 'DELETE' && cleanUrl.startsWith('/api/feedback/')) {
      try {
        const itemId = cleanUrl.split('/').pop();
        if (itemId === 'feedback') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No encontrado' }));
          return;
        }
        if (session.is_admin !== 1) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Solo administradores pueden eliminar feedback.' }));
          return;
        }
        FeedbackRepository.deleteFeedback(itemId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        console.error('[server.js] Error al eliminar feedback:', err.message);
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
      res.writeHead(200, { 
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
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
    // Admins can access any project
    if (session.is_admin) {
      console.log(`[WebSocket] Admin "${session.username}" accediendo al proyecto ${projectId} sin membresía explícita → rol owner.`);
      role = 'owner';
    } else {
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
