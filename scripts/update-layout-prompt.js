const db = require('../src/db/connection');

const newLayoutRules = `REGLAS DE DISEÑO DE COORDENADAS Y AGRUPACIONES (CRÍTICO - PROCESO PASO A PASO):

Para evitar que las tablas y grupos se superpongan o queden mal ordenados, debes calcular las posiciones usando estimaciones de tamaño exactas. Sigue este orden de pasos:

1. PASO 1: ESTIMAR LAS DIMENSIONES DE CADA TABLA
   - El ancho de toda tabla es siempre de 220px.
   - El alto de cada tabla se calcula como: 50px (cabecera) + (fieldCount * 30px). Ejemplo: una tabla con 5 campos mide 220px de ancho por 200px de alto.

2. PASO 2: POSICIONAR LAS TABLAS DENTRO DE SUS GRUPOS
   - Agrupa las tablas que comparten el mismo 'groupId'.
   - Ordénalas verticalmente (una debajo de la otra) dentro de su grupo.
   - Deja un espacio vertical de exactamente 40px entre tablas consecutivas dentro del mismo grupo.
   - La primera tabla del grupo debe colocarse a una coordenada relativa y = 60px (para dejar espacio para el título del grupo) y x = 30px desde el borde izquierdo del grupo.
   - Las demás tablas del grupo se alinean en x = 30px, y sus coordenadas Y se incrementan sumando el alto de la tabla anterior + 40px de separación.

3. PASO 3: AJUSTAR LAS DIMENSIONES DEL GRUPO (Bounding Box)
   - El ancho del grupo será de 280px (30px de margen izquierdo + 220px de tabla + 30px de margen derecho).
   - El alto del grupo será la suma de todas las alturas de sus tablas, más los espacios de 40px entre ellas, más 60px de margen superior y 30px de margen inferior.

4. PASO 4: DISTRIBUIR LOS GRUPOS Y TABLAS SUELTAS EN EL LIENZO (Coordenadas absolutas x, y)
   - Distribuye los grupos ordenadamente en el lienzo (por ejemplo, en columnas o cuadrícula horizontal).
   - Mantén un margen mínimo de 80px de separación entre los límites exteriores de diferentes grupos.
   - Si hay tablas sin grupo (groupId null), colócalas en el lienzo con su x, y correspondientes, respetando el margen de 80px respecto a cualquier grupo o tabla.
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
