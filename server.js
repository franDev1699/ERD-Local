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

const PROMPTS_FILE = path.join(__dirname, 'ai_prompts.json');

const DEFAULT_PROMPTS = {
  expectedSchemaText: `Esquema JSON esperado:
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
      "color": "string (código hexadecimal de color, ej: #6366f1, #10b981, #ef4444, #f59e0b, #ec4899, #06b6d4)",
      "groupId": "string o null (id del grupo al que pertenece la tabla, o null si ninguno)"
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
  "groups": [
    {
      "id": "string único (ej: group-1)",
      "name": "string (nombre del grupo)",
      "color": "string (código hexadecimal de color, ej: #374151)",
      "x": 100, // número
      "y": 100, // número
      "width": 300, // número
      "height": 200 // número
    }
  ]
}

IMPORTANTE - IDIOMA DE NOMENCLATURA:
Todos los nombres de tablas, campos y grupos DEBEN estar en INGLÉS (snake_case). Ejemplos: users, orders, created_at, product_name, order_items. Nunca uses nombres en español como 'usuarios', 'pedidos', 'nombre_producto'.`,

  layoutRulesText: `REGLAS DE DISEÑO DE COORDENADAS Y AGRUPACIONES (CRÍTICO):
1. NO permitas la superposición de ningún elemento. Las tablas y los grupos deben estar claramente separados y no superponerse.
2. ESPACIADO GENERAL:
   - Mantén al menos 100px de separación entre cualquier tabla suelta (sin grupo) y otros elementos (otras tablas o grupos).
   - Mantén al menos 150px de separación entre grupos distintos.
3. TABLAS DENTRO DE GRUPOS (groupId definido):
   - Una tabla perteneciente a un grupo DEBE ubicarse físicamente dentro de los límites de ese grupo.
   - PADDING SUPERIOR (Grupo): El título del grupo se renderiza en la parte superior. Las tablas dentro del grupo DEBEN tener su coordenada 'y' al menos a 60px del borde superior del grupo (ej: y_tabla >= group.y + 60). Nunca coloques una tabla cubriendo el título del grupo.
   - PADDING LATERAL E INFERIOR (Grupo): Las tablas deben estar separadas de los bordes izquierdo y derecho por al menos 30px, y del borde inferior del grupo por al menos 50px (ej: y_tabla + alto_tabla <= group.y + group.height - 50). Esto evita estrictamente que peguen al borde inferior del grupo.
   - ESPACIADO INTERNO: Las tablas dentro del mismo grupo deben distribuirse ordenadamente (p. ej. en columnas o cuadrícula). Deja al menos 80px de distancia horizontal y 60px de distancia vertical entre las tablas del mismo grupo.
   - TAMAÑO DEL GRUPO: Ajusta 'width' y 'height' del grupo de manera proporcional para que todas sus tablas quepan holgadamente dentro, respetando los paddings y márgenes descritos (ej. para dos tablas medianas de alto 200px en vertical, el grupo necesita al menos width: 310px y height: 510px).`,

  mode_create: `Eres un diseñador de bases de datos experto. Genera un esquema de base de datos ERD desde cero que responda a la solicitud del usuario en el siguiente formato JSON estricto. No devuelvas ningún otro texto, explicaciones, markdown, ni HTML, solo el objeto JSON crudo.

{expectedSchemaText}

Reglas importantes:
1. El JSON debe ser 100% válido y parseable directamente. No agregues \`\`\`json ni bloques de código.
2. Cada tabla debe tener una clave primaria (isPK: true).
3. Todas las relaciones referenciadas en 'relationships' deben usar IDs de tablas y campos existentes en el JSON.
4. Asigna coordenadas x e y, así como dimensiones de grupos y tablas de forma distribuida de acuerdo con estas directrices:
{layoutRulesText}`,

  mode_append: `Eres un diseñador de bases de datos experto. El usuario desea AGREGAR nuevos elementos (tablas, relaciones, grupos) al diagrama actual. 
NO debes modificar, renombrar, alterar ni eliminar ninguna de las tablas, campos, relaciones ni grupos existentes en el 'Estado actual del diagrama' suministrado.
Genera únicamente los NUEVOS elementos que se deben agregar para cumplir la solicitud.

Tu respuesta en formato JSON estricto debe incluir:
1. En "tables": Únicamente las NUEVAS tablas que se van a agregar. NO incluyas ninguna de las tablas existentes del 'Estado actual del diagrama'.
2. En "relationships": Únicamente las NUEVAS relaciones creadas. Puedes relacionar las tablas nuevas entre sí, o relacionar las tablas nuevas con las existentes usando los IDs de las tablas existentes. NO incluyas relaciones que ya existen.
3. En "groups": Únicamente los NUEVOS grupos creados (si aplica).
No devuelvas ningún otro texto, explicaciones, markdown, ni HTML, solo el objeto JSON crudo.

{expectedSchemaText}

Reglas importantes:
1. El JSON debe ser 100% válido y parseable directamente. No agregues \`\`\`json ni bloques de código.
2. Cada tabla nueva debe tener una clave primaria (isPK: true).
3. Las nuevas relaciones en 'relationships' deben usar IDs de tablas y campos existentes en el estado actual o en las nuevas tablas.
4. Asigna coordenadas x e y a las nuevas tablas y grupos de acuerdo con las siguientes directrices:
{layoutRulesText}
5. Queda estrictamente PROHIBIDO incluir tablas o relaciones existentes en el JSON de respuesta. Solo devuelve lo NUEVO.

Estado actual del diagrama (para referencia de contexto, nombres e IDs existentes):
{currentState}`,

  mode_edit: `Eres un diseñador de bases de datos experto. El usuario desea MODIFICAR o EDITAR el diagrama actual.
Analiza el 'Estado actual del diagrama' suministrado y aplica únicamente los cambios solicitados por el usuario (por ejemplo: agregar o modificar campos, renombrar una tabla, agregar una relación, eliminar una tabla, etc.).
NO alteres, reescribas ni elimines tablas, campos, tipos o relaciones a menos que el usuario lo pida explícitamente. Mantén la estructura existente intacta tanto como sea posible.

Debes devolver el estado COMPLETO del diagrama en tu respuesta JSON, incluyendo todas las tablas y relaciones (tanto las modificadas como las no modificadas). Conserva estrictamente los IDs existentes (de tablas, campos, relaciones y grupos) que no hayan sido eliminados para no romper el lienzo.
No devuelvas ningún otro texto, explicaciones, markdown, ni HTML, solo el objeto JSON crudo.

{expectedSchemaText}

Reglas importantes:
1. El JSON debe ser 100% válido y parseable directamente. No agregues \`\`\`json ni bloques de código.
2. Cada tabla debe tener una clave primaria (isPK: true).
3. Conserva los IDs originales de las tablas, campos y relaciones que no cambien.
4. Si agregas o reposicionas tablas o grupos, sigue estrictamente estas directrices:
{layoutRulesText}
4. Si el usuario pide eliminar algún elemento, puedes omitirlo del JSON de salida.

Estado actual del diagrama (si deseas extenderlo o relacionarlo, úsalo como base):
{currentState}`,

  mode_layout: `Eres un diseñador de bases de datos experto. El usuario desea REORGANIZAR las posiciones y dimensiones de las tablas y grupos del diagrama para mejorar su legibilidad y estética.
NO agregues, modifiques ni elimines ninguna tabla, campo, tipo ni relación. Solo debes ajustar las coordenadas (x, y) de las tablas y de los grupos, y las dimensiones (width, height) de los grupos.
Agrupa físicamente cerca las tablas relacionadas, manteniendo un excelente espacio libre entre ellas.

Debes devolver el estado COMPLETO del diagrama en tu respuesta JSON, incluyendo exactamente las mismas tablas, relaciones y grupos (con sus nombres e IDs idénticos), pero con coordenadas optimizadas.
No devuelvas ningún otro texto, explicaciones, markdown, ni HTML, solo el objeto JSON crudo.

{expectedSchemaText}

Reglas importantes:
1. El JSON debe ser 100% válido y parseable directamente. No agregues \`\`\`json ni bloques de código.
2. No cambies nombres de tablas, campos ni relaciones. Tampoco añadas ni elimines campos.
3. Organiza todas las coordenadas y dimensiones del diagrama siguiendo al pie de la letra estas directrices:
{layoutRulesText}

Estado actual del diagrama:
{currentState}`,

  mode_query_generate: `Eres un administrador de bases de datos y desarrollador SQL experto.
Tu tarea es generar o modificar una consulta SQL basada en la descripción del usuario y el esquema de base de datos suministrado.
El motor de base de datos destino es: {engine}.
Asegúrate de que la consulta SQL use la sintaxis correcta del motor destino, califique los nombres de los campos de manera clara y use JOINs adecuados si hay relaciones entre las tablas.

Debes devolver la respuesta estrictamente en el siguiente formato JSON:
{
  "name": "Nombre corto descriptivo de la consulta",
  "sql": "Código SQL formateado y listo para ejecutar",
  "explanation": "Breve explicación de una línea sobre cómo funciona la consulta"
}

No agregues bloques de código \`\`\`json ni texto explicativo fuera del JSON.

Esquema actual de base de datos:
{currentState}
{currentQuerySql}`,

  mode_query_suggest: `Eres un administrador de bases de datos y desarrollador SQL experto.
Analiza el esquema de base de datos suministrado y sugiere 3 consultas SQL de negocio o analíticas útiles (ej. reportes, acumulados, cruces de información).
Para cada sugerencia, proporciona un nombre y un prompt descriptivo en español que el usuario pueda usar para generar la consulta.

Debes devolver la respuesta estrictamente en el siguiente formato JSON de arreglo:
[
  {
    "name": "ej: Usuarios con más compras",
    "prompt": "ej: Muestra los top 5 usuarios con mayor volumen de compras y sus datos de perfil"
  },
  ...
]

No agregues bloques de código \`\`\`json ni texto explicativo fuera del JSON.

Esquema de base de datos:
{currentState}`,

  mode_query_explain: `Eres un administrador de bases de datos y profesor SQL experto.
Tu tarea es explicar de manera clara y detallada cómo funciona la consulta SQL proporcionada por el usuario.
El motor de base de datos es: {engine}.

Debes explicar:
1. Qué hace la consulta paso a paso (SELECT, FROM, JOINs, WHERE, GROUP BY, ORDER BY, etc.)
2. Qué tablas y campos involucra y por qué
3. Si usa JOINs, explica el tipo de JOIN y cómo conecta las tablas
4. Si tiene funciones de agregación, subconsultas o CTEs, explícalas
5. Posibles optimizaciones o mejoras si las detectas

Devuelve la respuesta estrictamente en el siguiente formato JSON:
{
  "explanation": "Explicación detallada y bien formateada de la consulta"
}

No agregues bloques de código \`\`\`json ni texto explicativo fuera del JSON. Responde en español.

Esquema actual de base de datos:
{currentState}`,

  prompt_document: `Genera una documentación en Markdown (.md) elegante, detallada y profesional para el siguiente esquema de base de datos JSON.

Esquema JSON de la Base de Datos:
{currentState}

La documentación debe incluir:
1. Un título principal llamativo.
2. Una introducción que describa conceptualmente el propósito general del sistema basándote en las tablas encontradas.
3. Un índice de contenidos.
4. Por cada tabla:
   - Su nombre y una breve descripción de su función.
   - Una tabla Markdown con sus campos, detallando: Nombre de columna, Tipo de dato, Llaves (PK/FK), si permite Nulos (NULL/NOT NULL), Valor por defecto (si lo tiene) y una descripción detallada que supongas para qué sirve ese campo.
5. Una sección de Relaciones y Reglas de Negocio, describiendo qué tabla se relaciona con cuál y la cardinalidad.
6. Un bloque de diagrama Mermaid que ilustre visualmente las relaciones entre tablas (usando la sintaxis erDiagram de Mermaid).

Asegúrate de que la salida sea estrictamente Markdown limpio para poder ser guardado como un archivo .md. No agregues explicaciones fuera del bloque Markdown.`
};

let aiPrompts = { ...DEFAULT_PROMPTS };

function loadAiPrompts() {
  if (fs.existsSync(PROMPTS_FILE)) {
    try {
      const data = fs.readFileSync(PROMPTS_FILE, 'utf8');
      aiPrompts = { ...DEFAULT_PROMPTS, ...JSON.parse(data) };
    } catch (e) {
      console.error('Error al cargar ai_prompts.json:', e.message);
      aiPrompts = { ...DEFAULT_PROMPTS };
    }
  } else {
    try {
      fs.writeFileSync(PROMPTS_FILE, JSON.stringify(DEFAULT_PROMPTS, null, 2), 'utf8');
      console.log('Creado archivo de prompts por defecto: ai_prompts.json');
    } catch (e) {
      console.error('Error al crear ai_prompts.json:', e.message);
    }
  }
}

loadAiPrompts();


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
  static build({ currentState, prompt, mode, contextDepth, currentQuerySql }) {
    if (!currentState || !currentState.tables) {
      return { tables: [], relationships: [], groups: [] };
    }

    const tables = currentState.tables;
    const relationships = currentState.relationships || [];
    const groups = currentState.groups || [];

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
function makeAiRequest({ provider, apiKey, apiUrl, model, prompt, currentState, mode, engine, currentQuerySql, contextDepth }) {
  return new Promise((resolve, reject) => {
    let promptTemplate = '';
    if (mode === 'append') {
      promptTemplate = aiPrompts.mode_append;
    } else if (mode === 'edit') {
      promptTemplate = aiPrompts.mode_edit;
    } else if (mode === 'layout') {
      promptTemplate = aiPrompts.mode_layout;
    } else if (mode === 'query_generate') {
      promptTemplate = aiPrompts.mode_query_generate;
    } else if (mode === 'query_suggest') {
      promptTemplate = aiPrompts.mode_query_suggest;
    } else if (mode === 'query_explain') {
      promptTemplate = aiPrompts.mode_query_explain;
    } else {
      promptTemplate = aiPrompts.mode_create;
    }

    const optimizedContext = ContextBuilder.build({
      currentState,
      prompt,
      mode,
      contextDepth,
      currentQuerySql
    });

    let catalogInstruction = "";
    if (optimizedContext.catalog && optimizedContext.catalog.length > 0) {
      catalogInstruction = `\n\nOTRAS TABLAS EXISTENTES EN EL DIAGRAMA (Catálogo de referencia rápida. NO las modifiques ni agregues campos en ellas a menos que se te pida explícitamente):\n- ${optimizedContext.catalog.join('\n- ')}\n`;
      delete optimizedContext.catalog;
    }

    const stateStr = JSON.stringify(optimizedContext);
    const currentQuerySqlStr = currentQuerySql ? `\nConsulta SQL actual a modificar:\n${currentQuerySql}` : '';

    let systemInstruction = promptTemplate
      .replace(/{expectedSchemaText}/g, aiPrompts.expectedSchemaText)
      .replace(/{layoutRulesText}/g, aiPrompts.layoutRulesText)
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
function makeAiDocRequest({ provider, apiKey, apiUrl, model, currentState }) {
  return new Promise((resolve, reject) => {
    const stateStr = JSON.stringify(currentState || { tables: [], relationships: [] }, null, 2);
    const prompt = aiPrompts.prompt_document.replace(/{currentState}/g, stateStr);

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
  // GET /api/ai/prompts - Obtener los prompts configurados
  if (req.method === 'GET' && req.url === '/api/ai/prompts') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(aiPrompts));
    return;
  }

  // POST /api/ai/prompts - Guardar o restablecer prompts
  if (req.method === 'POST' && req.url === '/api/ai/prompts') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (payload.reset) {
          aiPrompts = { ...DEFAULT_PROMPTS };
        } else {
          // Copiar valores recibidos válidos
          const keys = Object.keys(DEFAULT_PROMPTS);
          for (const key of keys) {
            if (payload[key] !== undefined) {
              aiPrompts[key] = payload[key];
            }
          }
        }
        
        fs.writeFileSync(PROMPTS_FILE, JSON.stringify(aiPrompts, null, 2), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, prompts: aiPrompts }));
      } catch (err) {
        console.error('Error al guardar prompts:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /api/ai/generate - Proxy de Inteligencia Artificial
  if (req.method === 'POST' && req.url === '/api/ai/generate') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const params = JSON.parse(body);
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
        const requiresApiKey = ['gemini', 'openai'].includes(params.provider);
        if (requiresApiKey && !params.apiKey) {
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
          const projectId = file.slice(0, -5);
          try {
            const filePath = path.join(PROJECTS_DIR, file);
            const stats = fs.statSync(filePath);
            const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            projectsList.push({
              id: projectId,
              name: state.name || projectId,
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
