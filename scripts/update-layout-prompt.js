const db = require('../src/db/connection');

const newLayoutRules = `REGLAS DE DISEÑO DE COORDENADAS Y AGRUPACIONES (CRÍTICO - PROCESO PASO A PASO):

Para evitar que las tablas y grupos se superpongan o queden mal ordenados, debes calcular las posiciones usando estimaciones de tamaño exactas. Sigue este orden de pasos:

1. PASO 1: ESTIMAR LAS DIMENSIONES DE CADA TABLA
   - El ancho de toda tabla es siempre de 220px.
   - El alto de cada tabla se calcula como: 50px (cabecera) + (fieldCount * 30px).

2. PASO 2: POSICIONAR LAS TABLAS DENTRO DE SUS GRUPOS (Distribución en Rejilla/Grid)
   - Agrupa las tablas que comparten el mismo 'groupId'.
   - Si un grupo tiene 1 o 2 tablas:
     - Organízalas en una sola columna vertical.
     - Alineación X: Todas a x = 30px (coordenada local dentro del grupo).
     - Alineación Y: La primera a y = 60px (deja espacio para el título). La segunda a y = 60px + alto_tabla_1 + 40px.
     - Ancho del grupo: 280px.
     - Alto del grupo: 60px + altura de todas las tablas + espacios (40px) + 30px de margen inferior.
   - Si un grupo tiene 3 o más tablas:
     - Organízalas en una rejilla de 2 columnas (lado a lado).
     - Columna 1 (izquierda): x = 30px.
     - Columna 2 (derecha): x = 290px.
     - Alineación Y: Comienza en y = 60px. Coloca las tablas en la Columna 1 y Columna 2 de forma alterna, incrementando el eje Y de cada fila sumando el alto de la tabla más alta de la fila anterior + 40px de espacio.
     - Ancho del grupo: 540px.
     - Alto del grupo: Basado en la fila más alta, añadiendo el margen de 30px inferior.

3. PASO 3: DISTRIBUIR LOS GRUPOS Y TABLAS SUELTAS EN EL LIENZO (Coordenadas absolutas x, y)
   - Distribuye los grupos y las tablas sueltas (groupId null) ordenadamente a lo largo del lienzo.
   - Mantén un margen mínimo de 80px de separación entre los límites exteriores de diferentes grupos o tablas.
   - REGLA DE ORO: Ningún elemento (grupo o tabla) puede intersectar o superponerse al área de otro.`;

try {
  // Update global prompt config
  let stmt = db.prepare("UPDATE ai_prompt_configs SET prompt_template = ? WHERE prompt_key = 'layoutRulesText' AND scope = 'global'");
  let info = stmt.run(newLayoutRules);
  console.log(`Global prompt updated. Changes: ${info.changes}`);

  // Update user prompt configs (overrides) if they exist
  stmt = db.prepare("UPDATE ai_prompt_configs SET prompt_template = ? WHERE prompt_key = 'layoutRulesText' AND scope = 'user'");
  info = stmt.run(newLayoutRules);
  console.log(`User prompt overrides updated. Changes: ${info.changes}`);

  console.log('Prompts de reglas de layout actualizados con éxito en SQLite.');
} catch (e) {
  console.error('Error actualizando prompts:', e.message);
}
