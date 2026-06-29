// src/models/Table.js

export class Table {
  constructor({ id, name, x, y, fields = [] }) {
    this.id = id || `tbl-${Date.now()}`;
    this.name = name || 'nueva_tabla';
    this.x = x || 1500;
    this.y = y || 1500;
    this.fields = fields;
  }

  addField(field) {
    this.fields.push(field);
  }

  removeField(fieldId) {
    this.fields = this.fields.filter(f => f.id !== fieldId);
  }
}
