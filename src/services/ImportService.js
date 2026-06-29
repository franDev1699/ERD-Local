// src/services/ImportService.js

export class ImportService {
  static parseSql(sql) {
    const result = {
      tables: [],
      relationships: []
    };

    if (!sql || sql.trim() === '') return result;

    // Remove single line comments
    let cleanSql = sql.replace(/--.*$/gm, '');
    // Remove multi-line comments
    cleanSql = cleanSql.replace(/\/\*[\s\S]*?\*\//g, '');
    
    // Split by statement separator (;)
    // To be perfectly accurate we'd need a real lexer, but this works for 90% of DDL dumps
    const statements = cleanSql.split(';').map(s => s.trim()).filter(s => s.length > 0);

    const tableMap = new Map(); // name -> table id
    const fieldMap = new Map(); // table_name.field_name -> field id

    statements.forEach(stmt => {
      const createTableMatch = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"'\w]+)/i);
      if (createTableMatch) {
        let tableName = createTableMatch[1].replace(/[`"']/g, '');
        const tableId = `tbl-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        tableMap.set(tableName, tableId);

        const newTable = {
          id: tableId,
          name: tableName,
          x: 100, // Will be overridden by autoLayout
          y: 100,
          fields: []
        };

        // Extract content between first ( and last )
        const contentMatch = stmt.match(/\(([\s\S]*)\)/);
        if (contentMatch) {
          const content = contentMatch[1];
          // Split by comma, but not commas inside parens e.g. DECIMAL(10,2)
          // We can use a trick: split by comma, then merge if parens are unbalanced
          const parts = content.split(',');
          const definitions = [];
          let currentPart = "";
          let openParens = 0;

          parts.forEach(part => {
            currentPart += (currentPart.length > 0 ? "," : "") + part;
            openParens += (part.match(/\(/g) || []).length;
            openParens -= (part.match(/\)/g) || []).length;
            
            if (openParens <= 0) {
              definitions.push(currentPart.trim());
              currentPart = "";
              openParens = 0;
            }
          });

          definitions.forEach(def => {
            if (!def) return;

            const uDef = def.toUpperCase();
            
            // Check if it's a table-level constraint
            if (uDef.startsWith("PRIMARY KEY")) {
              const pkMatch = def.match(/\(([^)]+)\)/);
              if (pkMatch) {
                const pks = pkMatch[1].split(',').map(s => s.replace(/[`"']/g, '').trim());
                pks.forEach(pk => {
                  const field = newTable.fields.find(f => f.name === pk);
                  if (field) field.isPK = true;
                });
              }
              return;
            }

            if (uDef.startsWith("FOREIGN KEY") || uDef.startsWith("CONSTRAINT")) {
              // Parse inline foreign key
              // CONSTRAINT fk_name FOREIGN KEY (col) REFERENCES other_table(other_col)
              const fkMatch = def.match(/FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+([`"'\w]+)\s*\(([^)]+)\)/i);
              if (fkMatch) {
                const fromFieldName = fkMatch[1].replace(/[`"']/g, '').trim();
                const toTableName = fkMatch[2].replace(/[`"']/g, '').trim();
                const toFieldName = fkMatch[3].replace(/[`"']/g, '').trim();

                // We queue these to process later after all tables are parsed
                result.relationships.push({
                  fromTableName: tableName,
                  fromFieldName: fromFieldName,
                  toTableName: toTableName,
                  toFieldName: toFieldName
                });
              }
              return;
            }

            if (uDef.startsWith("UNIQUE") || uDef.startsWith("KEY") || uDef.startsWith("INDEX")) {
               // Ignore index definitions for ERD
               return;
            }

            // Otherwise, it's a column definition
            // format: `name` TYPE [constraints]
            // We use regex to match the first word as name, second as type including parentheses
            const colMatch = def.match(/^([`"'\w]+)\s+([a-zA-Z0-9_]+(?:\s*\([^)]+\))?)(.*)$/s);
            if (colMatch) {
              const colName = colMatch[1].replace(/[`"']/g, '');
              let colType = colMatch[2].trim();
              const rest = colMatch[3] ? colMatch[3].toUpperCase() : "";
              const originalRest = colMatch[3] || "";

              const fieldId = `f-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
              fieldMap.set(`${tableName}.${colName}`, fieldId);

              // Standardize or clean types, but preserve their length
              let standardizedType = colType.toUpperCase();
              if (standardizedType === "INTEGER") standardizedType = "INT";
              if (standardizedType === "BOOL") standardizedType = "BOOLEAN";

              let isAutoIncrement = rest.includes("AUTO_INCREMENT") || rest.includes("AUTOINCREMENT") || standardizedType === "SERIAL" || standardizedType === "BIGSERIAL";
              let isPK = rest.includes("PRIMARY KEY");
              let isNotNull = rest.includes("NOT NULL") || isPK;
              let isUnique = rest.includes("UNIQUE");
              let defaultValue = "";

              const defaultMatch = originalRest.match(/DEFAULT\s+([^ ]+)/i);
              if (defaultMatch) {
                defaultValue = defaultMatch[1].replace(/,$/, '').trim(); // Remove trailing comma if accidental
              }

              newTable.fields.push({
                id: fieldId,
                name: colName,
                type: standardizedType,
                isPK,
                isAutoIncrement,
                isNotNull,
                isUnique,
                defaultValue
              });
            }
          });
        }
        result.tables.push(newTable);
      } else {
        // Look for ALTER TABLE ... ADD CONSTRAINT FOREIGN KEY
        const alterMatch = stmt.match(/ALTER\s+TABLE\s+([`"'\w]+)\s+ADD\s+(?:CONSTRAINT\s+[`"'\w]+\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+([`"'\w]+)\s*\(([^)]+)\)/i);
        if (alterMatch) {
          const fromTableName = alterMatch[1].replace(/[`"']/g, '');
          const fromFieldName = alterMatch[2].replace(/[`"']/g, '').trim();
          const toTableName = alterMatch[3].replace(/[`"']/g, '');
          const toFieldName = alterMatch[4].replace(/[`"']/g, '').trim();

          result.relationships.push({
            fromTableName,
            fromFieldName,
            toTableName,
            toFieldName
          });
        }
      }
    });

    // Post-process relationships to map names to generated IDs
    const finalRelationships = [];
    result.relationships.forEach(rel => {
      const fromTableId = tableMap.get(rel.fromTableName);
      const toTableId = tableMap.get(rel.toTableName);
      const fromFieldId = fieldMap.get(`${rel.fromTableName}.${rel.fromFieldName}`);
      const toFieldId = fieldMap.get(`${rel.toTableName}.${rel.toFieldName}`);

      if (fromTableId && toTableId && fromFieldId && toFieldId) {
        finalRelationships.push({
          id: `rel-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          fromTable: fromTableId,
          fromField: fromFieldId,
          toTable: toTableId,
          toField: toFieldId
        });
      }
    });

    result.relationships = finalRelationships;
    return result;
  }
}
