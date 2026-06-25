// src/models/Relationship.js

export class Relationship {
  constructor({ id, fromTable, fromField, toTable, toField, cardinality = '1:N' }) {
    this.id = id || `rel-${Date.now()}`;
    this.fromTable = fromTable;
    this.fromField = fromField;
    this.toTable = toTable;
    this.toField = toField;
    this.cardinality = cardinality;
  }
}
