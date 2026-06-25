// src/ui/Renderer.js

export class Renderer {
  constructor(domElements, config = {}) {
    this.elements = domElements;
    this.onRelationshipDelete = config.onRelationshipDelete;
    this.zoom = 1.0;
  }

  render(appState, selectedTableIds, selectedGroupId, zoom = 1.0) {
    this.zoom = zoom;
    this.renderGroups(appState, selectedGroupId);
    this.renderTables(appState, selectedTableIds);
    this.renderConnections(appState.relationships);
  }

  renderTables(appState, selectedTableIds) {
    const { tablesContainer } = this.elements;
    tablesContainer.innerHTML = "";

    const selectedSet = selectedTableIds instanceof Set 
      ? selectedTableIds 
      : new Set(selectedTableIds ? [selectedTableIds] : []);

    appState.tables.forEach(table => {
      const isSelected = selectedSet.has(table.id);
      const isFK = (fieldId) => appState.relationships.some(
        rel => rel.fromTable === table.id && rel.fromField === fieldId
      );
      const tableEl = this._createTableElement(table, isSelected, isFK);
      tablesContainer.appendChild(tableEl);
    });

    // Re-initialize Lucide icons after render
    if (window.lucide) {
      window.lucide.createIcons();
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

    // Header
    const headerEl = document.createElement("div");
    headerEl.className = "erd-table-header";
    headerEl.innerHTML = `
      <h4>${table.name}</h4>
      <i data-lucide="grip-horizontal"></i>
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
      icon = '<i data-lucide="key-round" style="width: 11px; height: 11px; margin-right: 4px;"></i>';
      classes += " is-pk";
    } else if (isFK) {
      icon = '<i data-lucide="link" style="width: 11px; height: 11px; margin-right: 4px;"></i>';
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

      // Decide which ports to connect based on relative position
      const useRightSource = fromLeft < toLeft;

      const fromPort = fromRow.querySelector(useRightSource ? ".port-right" : ".port-left");
      const toPort = toRow.querySelector(useRightSource ? ".port-left" : ".port-right");

      if (!fromPort || !toPort) return;

      const start = this.getPortCenter(fromPort);
      const end = this.getPortCenter(toPort);

      this.drawRelationshipLine(start.x, start.y, end.x, end.y, useRightSource, rel.id);
    });
  }

  drawRelationshipLine(x1, y1, x2, y2, sourceIsLeftToRight, relationshipId) {
    const { connectionsSvg } = this.elements;
    const glowPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const mainPath = document.createElementNS("http://www.w3.org/2000/svg", "path");

    // Calculate control points for smooth Bezier curve
    const dx = Math.abs(x2 - x1);
    const controlOffset = Math.max(50, dx / 1.7);
    const cx1 = sourceIsLeftToRight ? x1 + controlOffset : x1 - controlOffset;
    const cx2 = sourceIsLeftToRight ? x2 - controlOffset : x2 + controlOffset;

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
    groupsContainer.innerHTML = "";

    const groups = appState.groups || [];
    groups.forEach(group => {
      const isSelected = group.id === selectedGroupId;
      const groupEl = this._createGroupElement(group, isSelected);
      groupsContainer.appendChild(groupEl);
    });

    if (window.lucide) {
      window.lucide.createIcons();
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
      groupEl.style.backgroundColor = `${group.color}07`; // 4% opacity background
      groupEl.style.borderColor = `${group.color}44`; // 26% opacity border
    }

    // Header
    const headerEl = document.createElement("div");
    headerEl.className = "erd-group-header";
    if (group.color) {
      headerEl.style.backgroundColor = `${group.color}15`; // 8% opacity background
      headerEl.style.borderBottomColor = `${group.color}33`;
    }
    headerEl.innerHTML = `
      <span class="erd-group-title">${group.name}</span>
      <i data-lucide="grip-vertical" style="width: 14px; height: 14px; opacity: 0.5;"></i>
    `;
    groupEl.appendChild(headerEl);

    // Resize handle
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "erd-group-resize-handle";
    groupEl.appendChild(resizeHandle);

    return groupEl;
  }
}
