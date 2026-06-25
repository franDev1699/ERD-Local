// src/core/StateManager.js

export class StateManager {
  constructor(initialState, onStateChange) {
    this.state = JSON.parse(JSON.stringify(initialState));
    this.state.groups = this.state.groups || [];
    this.onStateChange = onStateChange;
  }

  getState() {
    return this.state;
  }

  setState(newState, isRemote = false) {
    this.state = JSON.parse(JSON.stringify(newState));
    if (this.onStateChange) {
      this.onStateChange(this.state, isRemote);
    }
  }

  updateTable(tableId, updates) {
    const tableIndex = this.state.tables.findIndex(t => t.id === tableId);
    if (tableIndex !== -1) {
      // Avoid overwriting fields if fields is not in updates
      this.state.tables[tableIndex] = { ...this.state.tables[tableIndex], ...updates };
      this.notify();
    }
  }

  addTable(table) {
    this.state.tables.push(table);
    this.notify();
  }

  removeTable(tableId) {
    this.state.tables = this.state.tables.filter(t => t.id !== tableId);
    this.state.relationships = this.state.relationships.filter(
      rel => rel.fromTable !== tableId && rel.toTable !== tableId
    );
    this.notify();
  }

  addField(tableId, field) {
    const table = this.state.tables.find(t => t.id === tableId);
    if (table) {
      table.fields.push(field);
      this.notify();
    }
  }

  updateField(tableId, fieldId, updates) {
    const table = this.state.tables.find(t => t.id === tableId);
    if (table) {
      const fieldIndex = table.fields.findIndex(f => f.id === fieldId);
      if (fieldIndex !== -1) {
        table.fields[fieldIndex] = { ...table.fields[fieldIndex], ...updates };
        this.notify();
      }
    }
  }

  deleteField(tableId, fieldId) {
    const table = this.state.tables.find(t => t.id === tableId);
    if (table) {
      table.fields = table.fields.filter(f => f.id !== fieldId);
      // Clean up relationships containing this field
      this.state.relationships = this.state.relationships.filter(
        rel => !(rel.fromTable === tableId && rel.fromField === fieldId) &&
               !(rel.toTable === tableId && rel.toField === fieldId)
      );
      this.notify();
    }
  }

  addRelationship(relationship) {
    this.state.relationships.push(relationship);
    this.notify();
  }

  removeRelationship(relationshipId) {
    this.state.relationships = this.state.relationships.filter(r => r.id !== relationshipId);
    this.notify();
  }

  isFieldForeignKey(tableId, fieldId) {
    return this.state.relationships.some(rel => rel.fromTable === tableId && rel.fromField === fieldId);
  }

  addGroup(group) {
    if (!this.state.groups) this.state.groups = [];
    this.state.groups.push(group);
    this.notify();
  }

  updateGroup(groupId, updates) {
    if (!this.state.groups) this.state.groups = [];
    const index = this.state.groups.findIndex(g => g.id === groupId);
    if (index !== -1) {
      this.state.groups[index] = { ...this.state.groups[index], ...updates };
      this.notify();
    }
  }

  removeGroup(groupId) {
    if (this.state.groups) {
      this.state.groups = this.state.groups.filter(g => g.id !== groupId);
      this.notify();
    }
  }

  notify() {
    if (this.onStateChange) {
      this.onStateChange(this.state, false);
    }
  }
}
