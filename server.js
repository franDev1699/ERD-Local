const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const STATE_FILE = path.join(__dirname, 'shared_state.json');
const PROJECTS_DIR = path.join(__dirname, 'projects');

// Create projects directory if it doesn't exist
if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
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

// Helper para realizar solicitudes de IA a los distintos proveedores de manera nativa
function makeAiRequest({ provider, apiKey, apiUrl, model, prompt, currentState }) {
  return new Promise((resolve, reject) => {
    const systemInstruction = `Eres un diseñador de bases de datos experto. Genera un esquema de base de datos ERD que responda a la solicitud del usuario en el siguiente formato JSON estricto. No devuelvas ningún otro texto, explicaciones, markdown, ni HTML, solo el objeto JSON crudo.

Esquema JSON esperado:
{
  "tables": [
    {
      "id": "string único (ej: tbl-users, tbl-orders)",
      "name": "string (nombre de tabla sin espacios, snake_case, ej: usuarios, ordenes_compra)",
      "x": 100, // número
      "y": 100, // número
      "fields": [
        {
          "id": "string único (ej: f-users-1, f-users-2)",
          "name": "string (nombre de campo, snake_case, ej: id, email, created_at)",
          "type": "string (ej: INT, VARCHAR(255), TEXT, DECIMAL(10,2), DATETIME, BOOLEAN)",
          "isPK": boolean (si es clave primaria),
          "isAutoIncrement": boolean (opcional, true si es PK autoincrementable),
          "isNotNull": boolean (si es NOT NULL),
          "isUnique": boolean (opcional, si es único),
          "defaultValue": "string (opcional, valor por defecto)"
        }
      ],
      "color": "string (código hexadecimal de color, ej: #6366f1, #10b981, #ef4444, #f59e0b, #ec4899, #06b6d4)"
    }
  ],
  "relationships": [
    {
      "id": "string único (ej: rel-1)",
      "fromTable": "string (id de la tabla de origen/padre)",
      "fromField": "string (id del campo de origen en la tabla de origen)",
      "toTable": "string (id de la tabla de destino/hijo)",
      "toField": "string (id del campo de destino en la tabla de destino)"
    }
  ],
  "groups": []
}

Reglas importantes:
1. El JSON debe ser 100% válido y parseable directamente. No agregues \`\`\`json ni bloques de código.
2. Cada tabla debe tener una clave primaria (isPK: true).
3. Todas las relaciones referenciadas en 'relationships' deben usar IDs de tablas y campos existentes en el JSON.
4. Asigna coordenadas x e y distribuidas (ej. espaciadas cada 300px o en formato grid) para que las tablas no se superpongan inicialmente en el lienzo.
5. Intenta elegir colores armoniosos para agrupar visualmente las tablas relacionadas.

Estado actual del diagrama (si deseas extenderlo o relacionarlo, úsalo como base):
${JSON.stringify(currentState || { tables: [], relationships: [], groups: [] })}
`;

    let requestBody = '';
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

    } else if (provider === 'openai') {
      const openaiModel = model || 'gpt-4o-mini';
      const url = 'https://api.openai.com/v1/chat/completions';
      
      requestBody = JSON.stringify({
        model: openaiModel,
        response_format: { type: "json_object" },
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt }
        ]
      });

      options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        }
      };

      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              return reject(new Error(parsed.error.message || 'Error en la API de OpenAI'));
            }
            const textResponse = parsed.choices[0].message.content;
            resolve(JSON.parse(cleanJsonResponseText(textResponse)));
          } catch (e) {
            reject(new Error('La respuesta de OpenAI no se pudo procesar como JSON: ' + e.message));
          }
        });
      });

      req.on('error', (e) => reject(e));
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
function makeAiDocRequest({ provider, apiKey, apiUrl, model, currentState }) {
  return new Promise((resolve, reject) => {
    const prompt = `Genera una documentación en Markdown (.md) elegante, detallada y profesional para el siguiente esquema de base de datos JSON.

Esquema JSON de la Base de Datos:
${JSON.stringify(currentState || { tables: [], relationships: [] }, null, 2)}

La documentación debe incluir:
1. Un título principal llamativo.
2. Una introducción que describa conceptualmente el propósito general del sistema basándote en las tablas encontradas.
3. Un índice de contenidos.
4. Por cada tabla:
   - Su nombre y una breve descripción de su función.
   - Una tabla Markdown con sus campos, detallando: Nombre de columna, Tipo de dato, Llaves (PK/FK), si permite Nulos (NULL/NOT NULL), Valor por defecto (si lo tiene) y una descripción detallada que supongas para qué sirve ese campo.
5. Una sección de Relaciones y Reglas de Negocio, describiendo qué tabla se relaciona con cuál y la cardinalidad.
6. Un bloque de diagrama Mermaid que ilustre visualmente las relaciones entre tablas (usando la sintaxis erDiagram de Mermaid).

Asegúrate de que la salida sea estrictamente Markdown limpio para poder ser guardado como un archivo .md. No agregues explicaciones fuera del bloque Markdown.`;

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

    } else if (provider === 'openai') {
      const openaiModel = model || 'gpt-4o-mini';
      const url = 'https://api.openai.com/v1/chat/completions';
      
      requestBody = JSON.stringify({
        model: openaiModel,
        messages: [
          { role: 'user', content: prompt }
        ]
      });

      options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        }
      };

      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              return reject(new Error(parsed.error.message || 'Error en la API de OpenAI'));
            }
            const textResponse = parsed.choices[0].message.content;
            resolve(textResponse);
          } catch (e) {
            reject(new Error('La respuesta de OpenAI no se pudo procesar: ' + e.message));
          }
        });
      });

      req.on('error', (e) => reject(e));
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

// HTTP Server to serve static files and API endpoints
const server = http.createServer((req, res) => {
  // POST /api/ai/generate - Proxy de Inteligencia Artificial
  if (req.method === 'POST' && req.url === '/api/ai/generate') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const params = JSON.parse(body);
        if (!params.prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'El campo "prompt" es obligatorio.' }));
          return;
        }
        if (params.provider !== 'ollama' && !params.apiKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'La API Key es obligatoria para proveedores Cloud.' }));
          return;
        }

        const aiResult = await makeAiRequest(params);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(aiResult));
      } catch (err) {
        console.error('Error en Proxy de IA:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /api/ai/document - Generar Documentación Markdown con IA
  if (req.method === 'POST' && req.url === '/api/ai/document') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const params = JSON.parse(body);
        if (params.provider !== 'ollama' && !params.apiKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'La API Key es obligatoria para proveedores Cloud.' }));
          return;
        }

        const mdDoc = await makeAiDocRequest(params);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ markdown: mdDoc }));
      } catch (err) {
        console.error('Error al documentar BD con IA:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // GET /api/projects - List all projects
  if (req.url === '/api/projects') {
    try {
      const files = fs.readdirSync(PROJECTS_DIR);
      const projectsList = [];
      files.forEach(file => {
        if (file.endsWith('.json') && !file.includes('.backup_') && !file.endsWith('.tmp')) {
          const projectName = file.slice(0, -5);
          try {
            const filePath = path.join(PROJECTS_DIR, file);
            const stats = fs.statSync(filePath);
            const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            projectsList.push({
              name: projectName,
              tableCount: state.tables ? state.tables.length : 0,
              relationshipCount: state.relationships ? state.relationships.length : 0,
              lastModified: stats.mtime
            });
          } catch (e) {
            // Ignore malformed JSON files
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

  // POST /api/delete-project - Delete a project
  if (req.url.startsWith('/api/delete-project')) {
    try {
      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const projectToDelete = urlObj.searchParams.get('project');
      if (projectToDelete) {
        const filePath = getProjectPath(projectToDelete);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          
          // Also clean up any backups for this project
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

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proyecto no encontrado' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Normalize path and prevent directory traversal
  const cleanUrl = req.url.split('?')[0];
  let filePath = cleanUrl === '/' ? '/index.html' : cleanUrl;
  filePath = path.join(__dirname, filePath);

  // Ensure filePath is within __dirname
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

  const activeUsers = Array.from(room)
    .filter(c => c.state === 1 && c.user && c.user.userId)
    .map(c => c.user);

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
    user: { userId: '', username: '', color: '' }
  };
  room.add(client);

  console.log(`Nuevo compañero conectado al proyecto: "${projectId}"`);

  // Load project state
  let projectState = loadProjectState(projectId);
  if (!projectState) {
    projectState = {
      tables: [
        {
          id: "tbl-users",
          name: "usuarios",
          x: 100,
          y: 100,
          groupId: null,
          fields: [
            { id: "f-u-1", name: "id", type: "INT", isPK: true },
            { id: "f-u-2", name: "nombre", type: "VARCHAR(255)", isPK: false }
          ]
        }
      ],
      relationships: [],
      groups: []
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

      if (parsed.opcode === 1) { // TEXT frame
        try {
          const data = JSON.parse(parsed.payload);
          
          if (data.type === 'join') {
            client.user = {
              userId: data.payload.userId,
              username: data.payload.username,
              color: data.payload.color
            };
            broadcastUserList(projectId);
          } else if (data.type === 'cursor_move') {
            // Broadcast cursor coordinates to everyone else in the project
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
    // Read lower 32-bits for simplicity (diagrams are small enough)
    payloadLength = buffer.readUInt32BE(6);
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
    opcode,
    payload: payload.toString('utf8'),
    frameLength: offset + payloadLength
  };
}

// Helper to send outgoing unmasked WebSocket text frame
function sendFrame(socket, obj) {
  const payload = JSON.stringify(obj);
  const payloadBuffer = Buffer.from(payload, 'utf8');
  const payloadLength = payloadBuffer.length;

  let header;
  if (payloadLength <= 125) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN = 1, Opcode = 1 (text)
    header[1] = payloadLength;
  } else if (payloadLength <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payloadLength, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeUInt32BE(0, 2); // high bits
    header.writeUInt32BE(payloadLength, 6); // low bits
  }

  try {
    socket.write(Buffer.concat([header, payloadBuffer]));
  } catch (e) {
    console.error('Error escribiendo en socket:', e.message);
  }
}

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Servidor ERD Colaborativo Iniciado (Sin dependencias)`);
  console.log(`======================================================`);
  console.log(`Acceso Local:      http://localhost:${PORT}`);
  console.log(`Acceso Red Local:  http://${LOCAL_IP}:${PORT}`);
  console.log(`======================================================\n`);
});
