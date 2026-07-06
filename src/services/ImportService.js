// src/services/ImportService.js

export class ImportService {
  static parseSql(sql) {
    const result = {
      tables: [],
      relationships: []
    };

    if (!sql || sql.trim() === '') return result;

    // 1. Tokenize the SQL input
    const tokens = this._tokenize(sql);
    if (tokens.length === 0) return result;

    const stream = new TokenStream(tokens);
    const tableMap = new Map(); // tableName -> tableId
    const fieldMap = new Map(); // tableName.fieldName -> fieldId
    const pendingRelationships = [];

    // 2. Parse statements
    while (!stream.eof()) {
      if (stream.consume('CREATE')) {
        if (stream.consume('TABLE')) {
          this._parseCreateTable(stream, result.tables, tableMap, fieldMap, pendingRelationships);
        }
      } else if (stream.consume('ALTER')) {
        if (stream.consume('TABLE')) {
          this._parseAlterTable(stream, tableMap, fieldMap, pendingRelationships);
        }
      } else {
        // Skip token if not a recognized statement start
        stream.next();
      }
    }

    // 3. Post-process relationships to map names to generated IDs
    pendingRelationships.forEach(rel => {
      const fromTableId = tableMap.get(rel.fromTableName);
      const toTableId = tableMap.get(rel.toTableName);
      const fromFieldId = fieldMap.get(`${rel.fromTableName}.${rel.fromFieldName}`);
      const toFieldId = fieldMap.get(`${rel.toTableName}.${rel.toFieldName}`);

      if (fromTableId && toTableId && fromFieldId && toFieldId) {
        result.relationships.push({
          id: `rel-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          fromTable: fromTableId,
          fromField: fromFieldId,
          toTable: toTableId,
          toField: toFieldId
        });
      }
    });

    return result;
  }

  static _tokenize(sql) {
    const tokens = [];
    let i = 0;
    const len = sql.length;

    while (i < len) {
      const char = sql[i];

      // Whitespace
      if (/\s/.test(char)) {
        i++;
        continue;
      }

      // Single-line comment
      if (char === '-' && sql[i + 1] === '-') {
        i += 2;
        while (i < len && sql[i] !== '\n' && sql[i] !== '\r') {
          i++;
        }
        continue;
      }

      // Multi-line comment
      if (char === '/' && sql[i + 1] === '*') {
        i += 2;
        while (i < len && !(sql[i] === '*' && sql[i + 1] === '/')) {
          i++;
        }
        i += 2;
        continue;
      }

      // Symbols
      if (['(', ')', ',', ';', '.'].includes(char)) {
        tokens.push({ type: 'SYMBOL', value: char });
        i++;
        continue;
      }

      // Quoted string (single quote)
      if (char === "'") {
        let val = "";
        i++; // skip open quote
        while (i < len) {
          if (sql[i] === "'" && sql[i + 1] === "'") {
            val += "'";
            i += 2;
          } else if (sql[i] === "'") {
            i++; // skip close quote
            break;
          } else {
            val += sql[i];
            i++;
          }
        }
        tokens.push({ type: 'STRING', value: val });
        continue;
      }

      // Quoted identifier (double quote)
      if (char === '"') {
        let val = "";
        i++;
        while (i < len) {
          if (sql[i] === '"' && sql[i + 1] === '"') {
            val += '"';
            i += 2;
          } else if (sql[i] === '"') {
            i++;
            break;
          } else {
            val += sql[i];
            i++;
          }
        }
        tokens.push({ type: 'IDENTIFIER', value: val });
        continue;
      }

      // Backticked identifier
      if (char === '`') {
        let val = "";
        i++;
        while (i < len && sql[i] !== '`') {
          val += sql[i];
          i++;
        }
        if (i < len) i++;
        tokens.push({ type: 'IDENTIFIER', value: val });
        continue;
      }

      // Bracketed identifier (SQL Server [dbo])
      if (char === '[') {
        let val = "";
        i++;
        while (i < len && sql[i] !== ']') {
          val += sql[i];
          i++;
        }
        if (i < len) i++;
        tokens.push({ type: 'IDENTIFIER', value: val });
        continue;
      }

      // Numbers
      if (/\d/.test(char) || (char === '.' && /\d/.test(sql[i + 1]))) {
        let val = "";
        while (i < len && (/\d/.test(sql[i]) || sql[i] === '.')) {
          val += sql[i];
          i++;
        }
        tokens.push({ type: 'NUMBER', value: val });
        continue;
      }

      // Identifiers and Keywords
      if (/[a-zA-Z_]/.test(char)) {
        let val = "";
        while (i < len && /[a-zA-Z0-9_]/.test(sql[i])) {
          val += sql[i];
          i++;
        }
        tokens.push({ type: 'IDENTIFIER', value: val });
        continue;
      }

      // Fallback
      i++;
    }

    return tokens;
  }

  static _parseCreateTable(stream, tables, tableMap, fieldMap, pendingRelationships) {
    // Skip IF NOT EXISTS
    if (stream.consume('IF')) {
      if (stream.consume('NOT')) {
        stream.consume('EXISTS');
      }
    }

    // Parse table name (handles schema prefix like dbo.users)
    let nextTok = stream.consumeType('IDENTIFIER');
    if (!nextTok) return;

    let tableName = nextTok.value;
    if (stream.consume('.')) {
      const actualTableName = stream.consumeType('IDENTIFIER');
      if (actualTableName) {
        tableName = actualTableName.value;
      }
    }

    const tableId = `tbl-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    tableMap.set(tableName, tableId);

    const newTable = {
      id: tableId,
      name: tableName,
      x: 1500, // Will be centered or laid out by CanvasManager / AutoLayout
      y: 1500,
      fields: []
    };

    if (!stream.consume('(')) return;

    // Split inner CREATE TABLE definitions by comma, tracking parenthesis depth
    const elements = [];
    let currentElement = [];
    let parenDepth = 0;

    while (!stream.eof()) {
      const tok = stream.peek();
      if (tok.type === 'SYMBOL' && tok.value === '(') {
        parenDepth++;
      } else if (tok.type === 'SYMBOL' && tok.value === ')') {
        parenDepth--;
        if (parenDepth < 0) {
          // Closing parenthesis of the table definition
          break;
        }
      }

      if (tok.type === 'SYMBOL' && tok.value === ',' && parenDepth === 0) {
        if (currentElement.length > 0) {
          elements.push(currentElement);
          currentElement = [];
        }
        stream.next(); // consume the comma
      } else {
        currentElement.push(stream.next());
      }
    }

    if (currentElement.length > 0) {
      elements.push(currentElement);
    }

    // Consume the closing parenthesis of CREATE TABLE
    stream.consume(')');

    // Parse each column or constraint
    elements.forEach(tokens => {
      if (tokens.length === 0) return;
      const elStream = new TokenStream(tokens);

      let isConstraint = false;
      let constraintType = null;

      // Check for table level constraints
      if (elStream.consume('CONSTRAINT')) {
        elStream.consumeType('IDENTIFIER'); // skip constraint name
      }

      if (elStream.consume('PRIMARY')) {
        if (elStream.consume('KEY')) {
          isConstraint = true;
          constraintType = 'PRIMARY KEY';
        }
      } else if (elStream.consume('FOREIGN')) {
        if (elStream.consume('KEY')) {
          isConstraint = true;
          constraintType = 'FOREIGN KEY';
        }
      } else if (elStream.consume(['UNIQUE', 'KEY', 'INDEX'])) {
        // Table level index definitions, ignore
        return;
      }

      if (isConstraint) {
        if (constraintType === 'PRIMARY KEY') {
          if (elStream.consume('(')) {
            while (!elStream.eof()) {
              const pkCol = elStream.consumeType('IDENTIFIER');
              if (pkCol) {
                const field = newTable.fields.find(f => f.name === pkCol.value);
                if (field) field.isPK = true;
              }
              if (!elStream.consume(',')) break;
            }
          }
        } else if (constraintType === 'FOREIGN KEY') {
          if (elStream.consume('(')) {
            const fromCol = elStream.consumeType('IDENTIFIER');
            elStream.consume(')');
            if (fromCol && elStream.consume('REFERENCES')) {
              let toTable = elStream.consumeType('IDENTIFIER');
              let toTableName = toTable ? toTable.value : '';
              if (elStream.consume('.')) {
                const actualToTable = elStream.consumeType('IDENTIFIER');
                if (actualToTable) toTableName = actualToTable.value;
              }
              if (elStream.consume('(')) {
                const toCol = elStream.consumeType('IDENTIFIER');
                if (toCol) {
                  pendingRelationships.push({
                    fromTableName: tableName,
                    fromFieldName: fromCol.value,
                    toTableName: toTableName,
                    toFieldName: toCol.value
                  });
                }
              }
            }
          }
        }
        return;
      }

      // Column Definition
      const colNameTok = elStream.consumeType('IDENTIFIER');
      if (!colNameTok) return; // invalid column definition

      let colType = "";
      const typeTok = elStream.consumeType('IDENTIFIER');
      if (typeTok) {
        colType = typeTok.value;
        // Parse type arguments e.g. VARCHAR(255) or DECIMAL(10,2)
        if (elStream.peek() && elStream.peek().type === 'SYMBOL' && elStream.peek().value === '(') {
          colType += "(";
          elStream.next(); // consume '('
          let depth = 1;
          while (!elStream.eof() && depth > 0) {
            const t = elStream.next();
            if (t.type === 'SYMBOL' && t.value === '(') depth++;
            if (t.type === 'SYMBOL' && t.value === ')') depth--;
            if (t.type === 'STRING') {
              colType += `'${t.value}'`;
            } else {
              colType += t.value;
            }
          }
        }

        // Handle type modifiers like UNSIGNED, TIME ZONE, VARYING
        while (elStream.peek() && elStream.peek().type === 'IDENTIFIER' &&
               ['UNSIGNED', 'PRECISION', 'VARYING', 'TIME', 'ZONE'].includes(elStream.peek().value.toUpperCase())) {
          colType += " " + elStream.next().value;
        }
      }

      // Column constraints
      let isPK = false;
      let isAutoIncrement = false;
      let isNotNull = false;
      let isUnique = false;
      let defaultValue = "";

      const upperType = colType.toUpperCase();
      if (upperType === 'SERIAL' || upperType === 'BIGSERIAL') {
        isPK = true;
        isAutoIncrement = true;
        isNotNull = true;
      }

      while (!elStream.eof()) {
        if (elStream.consume('PRIMARY')) {
          if (elStream.consume('KEY')) {
            isPK = true;
          }
        } else if (elStream.consume('NOT')) {
          if (elStream.consume('NULL')) {
            isNotNull = true;
          }
        } else if (elStream.consume('NULL')) {
          isNotNull = false;
        } else if (elStream.consume('UNIQUE')) {
          isUnique = true;
        } else if (elStream.consume(['AUTO_INCREMENT', 'AUTOINCREMENT'])) {
          isAutoIncrement = true;
        } else if (elStream.consume('IDENTITY')) {
          isAutoIncrement = true;
          // Skip identity parameters e.g. IDENTITY(1,1)
          if (elStream.peek() && elStream.peek().type === 'SYMBOL' && elStream.peek().value === '(') {
            elStream.next(); // '('
            elStream.consumeType('NUMBER');
            elStream.consume(',');
            elStream.consumeType('NUMBER');
            elStream.consume(')');
          }
        } else if (elStream.consume('DEFAULT')) {
          const defValTok = elStream.next();
          if (defValTok) {
            if (defValTok.type === 'SYMBOL' && defValTok.value === '(') {
              // Expression default e.g. DEFAULT (now())
              defaultValue = "(";
              let depth = 1;
              while (!elStream.eof() && depth > 0) {
                const t = elStream.next();
                if (t.type === 'SYMBOL' && t.value === '(') depth++;
                if (t.type === 'SYMBOL' && t.value === ')') depth--;
                if (t.type === 'STRING') {
                  defaultValue += `'${t.value}'`;
                } else {
                  defaultValue += t.value;
                }
              }
            } else {
              if (defValTok.type === 'STRING') {
                defaultValue = `'${defValTok.value}'`;
              } else {
                defaultValue = defValTok.value;
              }
            }
          }
        } else if (elStream.consume('REFERENCES')) {
          // Inline foreign key reference
          let toTable = elStream.consumeType('IDENTIFIER');
          let toTableName = toTable ? toTable.value : '';
          if (elStream.consume('.')) {
            const actualToTable = elStream.consumeType('IDENTIFIER');
            if (actualToTable) toTableName = actualToTable.value;
          }
          if (elStream.consume('(')) {
            const toCol = elStream.consumeType('IDENTIFIER');
            if (toCol) {
              pendingRelationships.push({
                fromTableName: tableName,
                fromFieldName: colNameTok.value,
                toTableName: toTableName,
                toFieldName: toCol.value
              });
            }
            elStream.consume(')');
          }
        } else {
          elStream.next(); // Skip unknown token
        }
      }

      const fieldId = `f-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      fieldMap.set(`${tableName}.${colNameTok.value}`, fieldId);

      // Clean/standardize types
      let standardizedType = colType.toUpperCase();
      if (standardizedType === "INTEGER") standardizedType = "INT";
      if (standardizedType === "BOOL") standardizedType = "BOOLEAN";

      newTable.fields.push({
        id: fieldId,
        name: colNameTok.value,
        type: standardizedType,
        isPK,
        isAutoIncrement,
        isNotNull: isNotNull || isPK,
        isUnique,
        defaultValue
      });
    });

    tables.push(newTable);
  }

  static _parseAlterTable(stream, tableMap, fieldMap, pendingRelationships) {
    // Parse table name
    let nextTok = stream.consumeType('IDENTIFIER');
    if (!nextTok) return;

    let tableName = nextTok.value;
    if (stream.consume('.')) {
      const actualTableName = stream.consumeType('IDENTIFIER');
      if (actualTableName) {
        tableName = actualTableName.value;
      }
    }

    if (stream.consume('ADD')) {
      if (stream.consume('CONSTRAINT')) {
        stream.consumeType('IDENTIFIER'); // skip constraint name
      }

      if (stream.consume('FOREIGN') && stream.consume('KEY')) {
        if (stream.consume('(')) {
          const fromCol = stream.consumeType('IDENTIFIER');
          stream.consume(')');
          if (fromCol && stream.consume('REFERENCES')) {
            let toTable = stream.consumeType('IDENTIFIER');
            let toTableName = toTable ? toTable.value : '';
            if (stream.consume('.')) {
              const actualToTable = stream.consumeType('IDENTIFIER');
              if (actualToTable) toTableName = actualToTable.value;
            }
            if (stream.consume('(')) {
              const toCol = stream.consumeType('IDENTIFIER');
              if (toCol) {
                pendingRelationships.push({
                  fromTableName: tableName,
                  fromFieldName: fromCol.value,
                  toTableName: toTableName,
                  toFieldName: toCol.value
                });
              }
              stream.consume(')');
            }
          }
        }
      }
    }
  }
}

class TokenStream {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek(offset = 0) {
    if (this.pos + offset >= this.tokens.length) return null;
    return this.tokens[this.pos + offset];
  }

  next() {
    if (this.pos >= this.tokens.length) return null;
    return this.tokens[this.pos++];
  }

  consume(expectedValue) {
    const token = this.peek();
    if (!token) return false;

    const values = Array.isArray(expectedValue) ? expectedValue : [expectedValue];
    const matches = values.some(v => token.value.toUpperCase() === v.toUpperCase());

    if (matches) {
      this.next();
      return true;
    }
    return false;
  }

  consumeType(type) {
    const token = this.peek();
    if (token && token.type === type) {
      return this.next();
    }
    return null;
  }

  eof() {
    return this.pos >= this.tokens.length;
  }
}
