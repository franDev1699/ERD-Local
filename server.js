const http = require('http');
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

// HTTP Server to serve static files and API endpoints
const server = http.createServer((req, res) => {
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
