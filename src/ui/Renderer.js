// src/ui/Renderer.js

// Inline SVG icon strings to avoid lucide.createIcons() DOM scanning
const ICON_GRIP_HORIZONTAL = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="1"/><circle cx="19" cy="9" r="1"/><circle cx="5" cy="9" r="1"/><circle cx="12" cy="15" r="1"/><circle cx="19" cy="15" r="1"/><circle cx="5" cy="15" r="1"/></svg>';
const ICON_KEY = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>';
const ICON_LINK = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const ICON_GRIP_VERTICAL = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>';

export class Renderer {
  constructor(domElements, config = {}) {
    this.elements = domElements;
    this.onRelationshipDelete = config.onRelationshipDelete;
    this.zoom = 1.0;

    // Cache: maps tableId -> DOM element for O(1) lookups
    this._tableElements = new Map();
    // Cache: maps tableId -> serialized snapshot for dirty-checking
    this._tableSnapshots = new Map();
    // Cache: maps groupId -> DOM element
    this._groupElements = new Map();
    this._groupSnapshots = new Map();
  }

  render(appState, selectedTableIds, selectedGroupId, zoom = 1.0) {
    this.zoom = zoom;
    this.renderGroups(appState, selectedGroupId);
    this.renderTables(appState, selectedTableIds);
    this.renderConnections(appState.relationships);
  }

  renderTables(appState, selectedTableIds) {
    const { tablesContainer } = this.elements;

    const selectedSet = selectedTableIds instanceof Set
      ? selectedTableIds
      : new Set(selectedTableIds ? [selectedTableIds] : []);

    const currentTableIds = new Set();

    appState.tables.forEach(table => {
      currentTableIds.add(table.id);
      const isSelected = selectedSet.has(table.id);
      const isFK = (fieldId) => appState.relationships.some(
        rel => rel.fromTable === table.id && rel.fromField === fieldId
      );

      // Build a lightweight snapshot to detect changes
      const snapshot = this._buildTableSnapshot(table, isSelected, appState.relationships);
      const prevSnapshot = this._tableSnapshots.get(table.id);

      const existingEl = this._tableElements.get(table.id);

      if (existingEl && snapshot === prevSnapshot) {
        // Nothing changed — just ensure position is correct (cheap)
        if (existingEl.style.left !== `${table.x}px`) existingEl.style.left = `${table.x}px`;
        if (existingEl.style.top !== `${table.y}px`) existingEl.style.top = `${table.y}px`;
        return;
      }

      if (existingEl) {
        // Data changed — update in place
        this._updateTableElement(existingEl, table, isSelected, isFK);
      } else {
        // New table — create and append
        const tableEl = this._createTableElement(table, isSelected, isFK);
        tablesContainer.appendChild(tableEl);
        this._tableElements.set(table.id, tableEl);
      }

      this._tableSnapshots.set(table.id, snapshot);
    });

    // Remove tables that no longer exist in state
    for (const [id, el] of this._tableElements) {
      if (!currentTableIds.has(id)) {
        el.remove();
        this._tableElements.delete(id);
        this._tableSnapshots.delete(id);
      }
    }
  }

  _buildTableSnapshot(table, isSelected, relationships) {
    // Fast string-based snapshot for dirty-checking
    const fkFields = relationships
      .filter(r => r.fromTable === table.id)
      .map(r => r.fromField)
      .join(',');
    const fieldsKey = table.fields.map(f =>
      `${f.id}:${f.name}:${f.type}:${f.isPK ? 1 : 0}`
    ).join('|');
    return `${table.name}:${table.x}:${table.y}:${table.color || ''}:${isSelected ? 1 : 0}:${fieldsKey}:fk=${fkFields}`;
  }

  _updateTableElement(tableEl, table, isSelected, isFKCallback) {
    // Update class
    tableEl.className = `erd-table ${isSelected ? 'selected' : ''}`;
    tableEl.style.left = `${table.x}px`;
    tableEl.style.top = `${table.y}px`;

    if (table.color) {
      tableEl.style.setProperty('--table-color', table.color);
    } else {
      tableEl.style.removeProperty('--table-color');
    }

    // Update header name
    const h4 = tableEl.querySelector('h4');
    if (h4 && h4.textContent !== table.name) {
      h4.textContent = table.name;
    }

    // Rebuild fields (cheapest diffing strategy for field list)
    const fieldsEl = tableEl.querySelector('.erd-table-fields');
    if (fieldsEl) {
      fieldsEl.innerHTML = '';
      table.fields.forEach(field => {
        fieldsEl.appendChild(this._createFieldElement(field, table.id, isFKCallback(field.id)));
      });
    }
  }

  _createTableElement(table, isSelected, isFKCallback) {
    const tableEl = document.createElement("div");
    tableEl.className = `erd-table ${isSelected ? 'selected' : ''}`;
    tableEl.style.left = `${table.x}px`;
    tableEl.style.top = `${table.y}px`;
    tableEl.dataset.id = table.id;

    if (table.color) {
      tableEl.style.setProperty('--table-color', table.color);
    }

    // Header — inline SVG instead of data-lucide
    const headerEl = document.createElement("div");
    headerEl.className = "erd-table-header";
    headerEl.innerHTML = `
      <h4>${table.name}</h4>
      ${ICON_GRIP_HORIZONTAL}
    `;
    tableEl.appendChild(headerEl);

    // Fields
    const fieldsEl = document.createElement("div");
    fieldsEl.className = "erd-table-fields";
    table.fields.forEach(field => {
      fieldsEl.appendChild(this._createFieldElement(field, table.id, isFKCallback(field.id)));
    });
    tableEl.appendChild(fieldsEl);

    return tableEl;
  }

  _createFieldElement(field, tableId, isFK) {
    const fieldRow = document.createElement("div");
    fieldRow.className = "erd-field-row";
    fieldRow.dataset.fieldId = field.id;

    let icon = "";
    let classes = "field-info";
    if (field.isPK) {
      icon = ICON_KEY;
      classes += " is-pk";
    } else if (isFK) {
      icon = ICON_LINK;
      classes += " is-fk";
    }

    fieldRow.innerHTML = `
      <span class="${classes}">${icon}${field.name}</span>
      <span class="field-type">${field.type.toLowerCase()}</span>
      <div class="port port-left" data-table="${tableId}" data-field="${field.id}" data-type="left"></div>
      <div class="port port-right" data-table="${tableId}" data-field="${field.id}" data-type="right"></div>
    `;
    return fieldRow;
  }

  renderConnections(relationships) {
    const { connectionsSvg } = this.elements;

    // Remove old connection paths
    const oldPaths = connectionsSvg.querySelectorAll(".connection-path, .connection-path-glow");
    oldPaths.forEach(p => p.remove());

    relationships.forEach(rel => {
      const fromRow = document.querySelector(`.erd-table[data-id="${rel.fromTable}"] .erd-field-row[data-field-id="${rel.fromField}"]`);
      const toRow = document.querySelector(`.erd-table[data-id="${rel.toTable}"] .erd-field-row[data-field-id="${rel.toField}"]`);

      if (!fromRow || !toRow) return;

      const fromTableEl = document.querySelector(`.erd-table[data-id="${rel.fromTable}"]`);
      const toTableEl = document.querySelector(`.erd-table[data-id="${rel.toTable}"]`);

      const fromLeft = parseFloat(fromTableEl.style.left);
      const toLeft = parseFloat(toTableEl.style.left);

      // Table width is 240
      const width = 240;
      const fromRight = fromLeft + width;
      const toRight = toLeft + width;

      let fromPortType, toPortType;

      if (fromRight < toLeft) {
        fromPortType = "right";
        toPortType = "left";
      } else if (fromLeft > toRight) {
        fromPortType = "left";
        toPortType = "right";
      } else {
        if (fromLeft + width / 2 <= toLeft + width / 2) {
          fromPortType = "right";
          toPortType = "right";
        } else {
          fromPortType = "left";
          toPortType = "left";
        }
      }

      const fromPort = fromRow.querySelector(`.port-${fromPortType}`);
      const toPort = toRow.querySelector(`.port-${toPortType}`);

      if (!fromPort || !toPort) return;

      const start = this.getPortCenter(fromPort);
      const end = this.getPortCenter(toPort);

      this.drawRelationshipLine(start.x, start.y, end.x, end.y, fromPortType, toPortType, rel.id);
    });
  }

  drawRelationshipLine(x1, y1, x2, y2, fromPortType, toPortType, relationshipId) {
    const { connectionsSvg } = this.elements;
    const glowPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const mainPath = document.createElementNS("http://www.w3.org/2000/svg", "path");

    const dx = Math.abs(x2 - x1);
    const controlOffset = Math.max(50, dx / 1.7);
    const cx1 = fromPortType === "right" ? x1 + controlOffset : x1 - controlOffset;
    const cx2 = toPortType === "right" ? x2 + controlOffset : x2 - controlOffset;

    const d = `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`;

    glowPath.setAttribute("d", d);
    glowPath.className.baseVal = "connection-path-glow";

    mainPath.setAttribute("d", d);
    mainPath.className.baseVal = "connection-path";
    mainPath.setAttribute("marker-end", "url(#arrow)");

    mainPath.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.onRelationshipDelete) {
        this.onRelationshipDelete(relationshipId);
      }
    });

    connectionsSvg.appendChild(glowPath);
    connectionsSvg.appendChild(mainPath);
  }

  getPortCenter(portEl) {
    const { erdCanvas } = this.elements;
    const canvasRect = erdCanvas.getBoundingClientRect();
    const portRect = portEl.getBoundingClientRect();
    return {
      x: (portRect.left - canvasRect.left + portRect.width / 2) / this.zoom,
      y: (portRect.top - canvasRect.top + portRect.height / 2) / this.zoom
    };
  }

  renderGroups(appState, selectedGroupId) {
    const groupsContainer = document.getElementById("erd-groups-container");
    if (!groupsContainer) return;

    const groups = appState.groups || [];
    const currentGroupIds = new Set();

    groups.forEach(group => {
      currentGroupIds.add(group.id);
      const isSelected = group.id === selectedGroupId;
      const snapshot = `${group.name}:${group.x}:${group.y}:${group.width}:${group.height}:${group.color || ''}:${isSelected ? 1 : 0}`;
      const prevSnapshot = this._groupSnapshots.get(group.id);

      const existingEl = this._groupElements.get(group.id);

      if (existingEl && snapshot === prevSnapshot) {
        // Quick position check
        if (existingEl.style.left !== `${group.x}px`) existingEl.style.left = `${group.x}px`;
        if (existingEl.style.top !== `${group.y}px`) existingEl.style.top = `${group.y}px`;
        return;
      }

      if (existingEl) {
        this._updateGroupElement(existingEl, group, isSelected);
      } else {
        const groupEl = this._createGroupElement(group, isSelected);
        groupsContainer.appendChild(groupEl);
        this._groupElements.set(group.id, groupEl);
      }
      this._groupSnapshots.set(group.id, snapshot);
    });

    // Remove groups that no longer exist
    for (const [id, el] of this._groupElements) {
      if (!currentGroupIds.has(id)) {
        el.remove();
        this._groupElements.delete(id);
        this._groupSnapshots.delete(id);
      }
    }
  }

  _updateGroupElement(groupEl, group, isSelected) {
    groupEl.className = `erd-group ${isSelected ? 'selected' : ''}`;
    groupEl.style.left = `${group.x}px`;
    groupEl.style.top = `${group.y}px`;
    groupEl.style.width = `${group.width}px`;
    groupEl.style.height = `${group.height}px`;

    if (group.color) {
      groupEl.style.setProperty('--group-color', group.color);
      groupEl.style.backgroundColor = `${group.color}07`;
      groupEl.style.borderColor = `${group.color}44`;
    }

    const title = groupEl.querySelector('.erd-group-title');
    if (title && title.textContent !== group.name) {
      title.textContent = group.name;
    }

    const headerEl = groupEl.querySelector('.erd-group-header');
    if (headerEl && group.color) {
      headerEl.style.backgroundColor = `${group.color}15`;
      headerEl.style.borderBottomColor = `${group.color}33`;
    }
  }

  _createGroupElement(group, isSelected) {
    const groupEl = document.createElement("div");
    groupEl.className = `erd-group ${isSelected ? 'selected' : ''}`;
    groupEl.style.left = `${group.x}px`;
    groupEl.style.top = `${group.y}px`;
    groupEl.style.width = `${group.width}px`;
    groupEl.style.height = `${group.height}px`;
    groupEl.dataset.id = group.id;

    if (group.color) {
      groupEl.style.setProperty('--group-color', group.color);
      groupEl.style.backgroundColor = `${group.color}07`;
      groupEl.style.borderColor = `${group.color}44`;
    }

    // Header — inline SVG
    const headerEl = document.createElement("div");
    headerEl.className = "erd-group-header";
    if (group.color) {
      headerEl.style.backgroundColor = `${group.color}15`;
      headerEl.style.borderBottomColor = `${group.color}33`;
    }
    headerEl.innerHTML = `
      <span class="erd-group-title">${group.name}</span>
      ${ICON_GRIP_VERTICAL}
    `;
    groupEl.appendChild(headerEl);

    // Resize handle
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "erd-group-resize-handle";
    groupEl.appendChild(resizeHandle);

    return groupEl;
  }
}
