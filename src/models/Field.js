// src/models/Field.js

export class Field {
  constructor({ id, name, type, isPK = false }) {
    this.id = id || `f-${Date.now()}`;
    this.name = name || 'columna';
    this.type = type || 'VARCHAR(255)';
    this.isPK = isPK;
  }
}
