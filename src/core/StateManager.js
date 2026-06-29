// src/core/StateManager.js

export class StateManager {
  constructor(initialState, onStateChange) {
    this.state = JSON.parse(JSON.stringify(initialState));
    this.state.groups = this.state.groups || [];
    this.state.queries = this.state.queries || [];
    this.onStateChange = onStateChange;

    // Debounce timer for heavy persistence operations
    this._saveTimer = null;
    this._SAVE_DELAY = 300; // ms — debounce window for rapid changes (e.g. dragging)
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

  moveField(sourceTableId, fieldId, targetTableId, targetIndex) {
    const sourceTable = this.state.tables.find(t => t.id === sourceTableId);
    const targetTable = this.state.tables.find(t => t.id === targetTableId);
    if (!sourceTable || !targetTable) return;

    const fieldIndex = sourceTable.fields.findIndex(f => f.id === fieldId);
    if (fieldIndex === -1) return;

    const [field] = sourceTable.fields.splice(fieldIndex, 1);

    // Clamp target index
    const clampedIndex = Math.max(0, Math.min(targetTable.fields.length, targetIndex));
    targetTable.fields.splice(clampedIndex, 0, field);

    // Update relationships if field moved to a different table
    if (sourceTableId !== targetTableId) {
      this.state.relationships.forEach(rel => {
        if (rel.fromTable === sourceTableId && rel.fromField === fieldId) {
          rel.fromTable = targetTableId;
        }
        if (rel.toTable === sourceTableId && rel.toField === fieldId) {
          rel.toTable = targetTableId;
        }
      });
    }

    this.notify();
  }

  copyField(sourceTableId, fieldId, targetTableId, targetIndex) {
    const sourceTable = this.state.tables.find(t => t.id === sourceTableId);
    const targetTable = this.state.tables.find(t => t.id === targetTableId);
    if (!sourceTable || !targetTable) return;

    const sourceField = sourceTable.fields.find(f => f.id === fieldId);
    if (!sourceField) return;

    const copiedField = {
      ...JSON.parse(JSON.stringify(sourceField)),
      id: `f-${Date.now()}-${Math.floor(Math.random() * 1000)}`
    };

    const clampedIndex = Math.max(0, Math.min(targetTable.fields.length, targetIndex));
    targetTable.fields.splice(clampedIndex, 0, copiedField);

    this.notify();
  }

  removeGroup(groupId) {
    if (this.state.groups) {
      this.state.groups = this.state.groups.filter(g => g.id !== groupId);
      this.notify();
    }
  }

  addQuery(query) {
    if (!this.state.queries) this.state.queries = [];
    this.state.queries.push(query);
    this.notify();
  }

  updateQuery(queryId, updates) {
    if (!this.state.queries) this.state.queries = [];
    const index = this.state.queries.findIndex(q => q.id === queryId);
    if (index !== -1) {
      this.state.queries[index] = { ...this.state.queries[index], ...updates };
      this.notify();
    }
  }

  deleteQuery(queryId) {
    if (!this.state.queries) this.state.queries = [];
    this.state.queries = this.state.queries.filter(q => q.id !== queryId);
    this.notify();
  }

  /**
   * Standard notify — triggers immediate UI refresh + debounced persistence/broadcast.
   * UI update fires instantly; save/broadcast is delayed to coalesce rapid changes.
   */
  notify() {
    if (this.onStateChange) {
      this.onStateChange(this.state, false);
    }
  }

  /**
   * Debounced notify — for high-frequency operations like dragging.
   * Only fires the callback after the action settles.
   */
  notifyDebounced() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      if (this.onStateChange) {
        this.onStateChange(this.state, false);
      }
    }, this._SAVE_DELAY);
  }
}
