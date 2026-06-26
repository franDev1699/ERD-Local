// src/services/ExportService.js

export class ExportService {
  static exportToJson(state) {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    this._downloadFile(dataStr, "diagrama_erd.json");
  }

  static exportToSql(state, dialect = 'mysql') {
    let ddl = `-- Generado localmente en ERD Designer\n`;
    ddl += `-- Dialecto: ${dialect.toUpperCase()} | Fecha: ${new Date().toLocaleDateString()}\n\n`;

    if (state.tables.length === 0) {
      return ddl + `-- No hay tablas en el diagrama.`;
    }

    const q = dialect === 'sqlserver' ? (name) => `[${name}]` : (name) => name;

    // Type mapping for SQL Server
    const mapType = (fieldType, dial) => {
      if (dial !== 'sqlserver') return fieldType;
      const upper = fieldType.toUpperCase();
      if (upper === 'TEXT') return 'NVARCHAR(MAX)';
      if (upper.startsWith('VARCHAR')) return upper.replace('VARCHAR', 'NVARCHAR');
      if (upper === 'BOOLEAN') return 'BIT';
      if (upper === 'TIMESTAMP') return 'DATETIME2';
      if (upper.startsWith('DECIMAL')) return upper;
      return upper;
    };

    // 1. Create Tables DDL
    state.tables.forEach(table => {
      ddl += `CREATE TABLE ${q(table.name)} (\n`;

      const columnDefinitions = [];

      table.fields.forEach(field => {
        let fieldType = field.type.toUpperCase();

        // Postgres SERIAL shorthand for Auto Increment INT
        if (field.isAutoIncrement && dialect === 'postgresql' && fieldType.includes('INT')) {
          fieldType = 'SERIAL';
        }

        // SQL Server type mapping
        fieldType = mapType(fieldType, dialect);

        let colDef = `  ${q(field.name)} ${fieldType}`;

        if (field.isPK && dialect === "sqlite") {
          colDef += ` PRIMARY KEY`;
        }

        if (field.isAutoIncrement) {
          if (dialect === 'mysql') colDef += ` AUTO_INCREMENT`;
          if (dialect === 'sqlite') colDef += ` AUTOINCREMENT`;
          if (dialect === 'sqlserver') colDef += ` IDENTITY(1,1)`;
        }

        if (field.isUnique) {
          colDef += ` UNIQUE`;
        }

        // Avoid adding NOT NULL multiple times if PK already implies it in our logic
        const needsNotNull = field.isNotNull || (field.isPK && dialect !== "sqlite");
        if (needsNotNull) {
          colDef += ` NOT NULL`;
        }

        if (field.defaultValue) {
          colDef += ` DEFAULT ${field.defaultValue}`;
        }

        columnDefinitions.push(colDef);
      });

      // Add primary key constraints for non-sqlite dialects
      if (dialect !== "sqlite") {
        const pks = table.fields.filter(f => f.isPK).map(f => q(f.name));
        if (pks.length > 0) {
          if (dialect === 'sqlserver') {
            columnDefinitions.push(`  CONSTRAINT [PK_${table.name}] PRIMARY KEY (${pks.join(', ')})`);
          } else {
            columnDefinitions.push(`  PRIMARY KEY (${pks.join(', ')})`);
          }
        }
      }

      // Inline foreign key constraints for SQLite (since ALTER TABLE is limited)
      if (dialect === "sqlite") {
        state.relationships.forEach(rel => {
          if (rel.fromTable === table.id) {
            const fromField = table.fields.find(f => f.id === rel.fromField);
            const targetTable = state.tables.find(t => t.id === rel.toTable);
            if (targetTable) {
              const targetField = targetTable.fields.find(f => f.id === rel.toField);
              if (fromField && targetField) {
                columnDefinitions.push(`  FOREIGN KEY (${fromField.name}) REFERENCES ${targetTable.name}(${targetField.name})`);
              }
            }
          }
        });
      }

      ddl += columnDefinitions.join(",\n");
      ddl += `\n);\n`;
      if (dialect === 'sqlserver') ddl += `GO\n`;
      ddl += `\n`;
    });

    // 2. ALTER TABLE commands for Foreign Keys (PostgreSQL, MySQL, SQL Server)
    if (dialect !== "sqlite") {
      let fkDdl = "";
      state.relationships.forEach(rel => {
        const sourceTable = state.tables.find(t => t.id === rel.fromTable);
        const targetTable = state.tables.find(t => t.id === rel.toTable);

        if (sourceTable && targetTable) {
          const sourceField = sourceTable.fields.find(f => f.id === rel.fromField);
          const targetField = targetTable.fields.find(f => f.id === rel.toField);

          if (sourceField && targetField) {
            const constraintName = `fk_${sourceTable.name}_${sourceField.name}`;
            fkDdl += `ALTER TABLE ${q(sourceTable.name)}\n`;
            fkDdl += `  ADD CONSTRAINT ${q(constraintName)}\n`;
            fkDdl += `  FOREIGN KEY (${q(sourceField.name)}) REFERENCES ${q(targetTable.name)}(${q(targetField.name)});\n`;
            if (dialect === 'sqlserver') fkDdl += `GO\n`;
            fkDdl += `\n`;
          }
        }
      });

      if (fkDdl) {
        ddl += `-- Relaciones de Llave Foránea (FK)\n` + fkDdl;
      }
    }

    return ddl;
  }

  static async exportToImage(canvasElement, format = 'png', appState, currentZoom, setZoomFn) {
    if (typeof html2canvas === "undefined") {
      throw new Error("La librería html2canvas no está cargada.");
    }

    if (appState.tables.length === 0) {
      throw new Error("No hay tablas para exportar.");
    }

    // Save previous zoom and force 1.0 for cropping accuracy
    const previousZoom = currentZoom;
    setZoomFn(1.0);

    // Brief timeout to allow scale transform redraw
    await new Promise(resolve => setTimeout(resolve, 150));

    try {
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;

      appState.tables.forEach(table => {
        if (table.x < minX) minX = table.x;
        if (table.x + 240 > maxX) maxX = table.x + 240;
        if (table.y < minY) minY = table.y;

        const tableHeight = 50 + table.fields.length * 28;
        if (table.y + tableHeight > maxY) maxY = table.y + tableHeight;
      });

      const padding = 40;
      const cropX = Math.max(0, minX - padding);
      const cropY = Math.max(0, minY - padding);
      const cropW = Math.min(canvasElement.clientWidth - cropX, (maxX - minX) + padding * 2);
      const cropH = Math.min(canvasElement.clientHeight - cropY, (maxY - minY) + padding * 2);

      const canvas = await html2canvas(canvasElement, {
        backgroundColor: "#090d16",
        x: cropX,
        y: cropY,
        width: cropW,
        height: cropH,
        scrollX: 0,
        scrollY: 0,
        useCORS: true,
        logging: false
      });

      setZoomFn(previousZoom);

      let mimeType = "image/png";
      let extension = "png";
      if (format === "jpg" || format === "jpeg") {
        mimeType = "image/jpeg";
        extension = "jpg";
      }

      const image = canvas.toDataURL(mimeType);
      this._downloadFile(image, `screenshot_erd.${extension}`);
    } catch (err) {
      setZoomFn(previousZoom);
      throw err;
    }
  }

  static _downloadFile(dataUrl, fileName) {
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataUrl);
    downloadAnchor.setAttribute("download", fileName);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }
}
