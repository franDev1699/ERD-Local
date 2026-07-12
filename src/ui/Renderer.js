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
    this.onRelationshipCardinalityChange = config.onRelationshipCardinalityChange;
    this.zoom = 1.0;

    // Cache: maps tableId -> DOM element for O(1) lookups
    this._tableElements = new Map();
    // Cache: maps tableId -> serialized snapshot for dirty-checking
    this._tableSnapshots = new Map();
    // Cache: maps groupId -> DOM element
    this._groupElements = new Map();
    this._groupSnapshots = new Map();
  }

  /** O(1) cached DOM element lookup by table ID */
  getTableElement(tableId) {
    return this._tableElements.get(tableId) || null;
  }

  /** O(1) cached DOM element lookup by group ID */
  getGroupElement(groupId) {
    return this._groupElements.get(groupId) || null;
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

    // Remove old connection groups (each <g> contains paths + labels)
    const oldGroups = connectionsSvg.querySelectorAll("g[data-id]");
    oldGroups.forEach(g => g.remove());

    const TABLE_WIDTH = 240;

    // Phase 1: Gather table geometry and resolve port assignments globally
    const tableBounds = new Map(); // tableId -> { left, right, centerX }
    const portLoad = new Map();    // "tableId:side" -> count of connections assigned

    // Pre-compute table bounds
    relationships.forEach(rel => {
      for (const tid of [rel.fromTable, rel.toTable]) {
        if (!tableBounds.has(tid)) {
          const el = this._tableElements.get(tid);
          if (el) {
            const left = parseFloat(el.style.left) || 0;
            tableBounds.set(tid, { left, right: left + TABLE_WIDTH, centerX: left + TABLE_WIDTH / 2 });
          }
        }
      }
    });

    // Phase 2: Assign ports with smart side selection
    const resolvedRels = [];

    relationships.forEach(rel => {
      const fromRow = document.querySelector(`.erd-table[data-id="${rel.fromTable}"] .erd-field-row[data-field-id="${rel.fromField}"]`);
      const toRow = document.querySelector(`.erd-table[data-id="${rel.toTable}"] .erd-field-row[data-field-id="${rel.toField}"]`);
      if (!fromRow || !toRow) return;

      const fb = tableBounds.get(rel.fromTable);
      const tb = tableBounds.get(rel.toTable);
      if (!fb || !tb) return;

      let fromSide, toSide;

      // Determine optimal sides based on relative positions
      const horizontalGap = Math.min(
        Math.abs(fb.left - tb.right),
        Math.abs(tb.left - fb.right)
      );
      const noOverlapX = fb.right + 10 < tb.left || tb.right + 10 < fb.left;

      if (noOverlapX) {
        // Tables clearly separated horizontally
        if (fb.centerX < tb.centerX) {
          fromSide = "right";
          toSide = "left";
        } else {
          fromSide = "left";
          toSide = "right";
        }
      } else if (horizontalGap > 80) {
        // Close but not overlapping — prefer same-side routing through the gap
        if (fb.centerX < tb.centerX) {
          fromSide = "right";
          toSide = "left";
        } else {
          fromSide = "left";
          toSide = "right";
        }
      } else {
        // Tables overlap in X — pick side with fewer connections for balance
        const fromLeftKey = `${rel.fromTable}:left`;
        const fromRightKey = `${rel.fromTable}:right`;
        const toLeftKey = `${rel.toTable}:left`;
        const toRightKey = `${rel.toTable}:right`;

        const fromLeftLoad = portLoad.get(fromLeftKey) || 0;
        const fromRightLoad = portLoad.get(fromRightKey) || 0;
        const toLeftLoad = portLoad.get(toLeftKey) || 0;
        const toRightLoad = portLoad.get(toRightKey) || 0;

        const leftTotal = fromLeftLoad + toLeftLoad;
        const rightTotal = fromRightLoad + toRightLoad;

        if (leftTotal <= rightTotal) {
          fromSide = "left";
          toSide = "left";
        } else {
          fromSide = "right";
          toSide = "right";
        }
      }

      // Track port load for balancing subsequent connections
      const fKey = `${rel.fromTable}:${fromSide}`;
      const tKey = `${rel.toTable}:${toSide}`;
      const fromIndex = portLoad.get(fKey) || 0;
      const toIndex = portLoad.get(tKey) || 0;
      portLoad.set(fKey, fromIndex + 1);
      portLoad.set(tKey, toIndex + 1);

      const fromPort = fromRow.querySelector(`.port-${fromSide}`);
      const toPort = toRow.querySelector(`.port-${toSide}`);
      if (!fromPort || !toPort) return;

      const start = this.getPortCenter(fromPort);
      const end = this.getPortCenter(toPort);

      resolvedRels.push({
        id: rel.id,
        start, end,
        fromSide, toSide,
        fromIndex, toIndex,
        fromTable: rel.fromTable,
        toTable: rel.toTable,
        customChannelX: rel.customChannelX,
        cardinality: rel.cardinality || '1:N'
      });
    });

    // Phase 3: Calculate channel positions and draw clean H-V-H paths
    const CORNER_RADIUS = 8;
    const CHANNEL_STAGGER = 14;
    const CHANNEL_SNAP_THRESHOLD = 10;

    // Track channels per table-pair for staggering vertical segments
    const pairChannelCount = new Map();
    const allChannelXs = [];

    resolvedRels.forEach(r => {
      const { start, end, fromSide, toSide, fromIndex, toIndex } = r;
      const isSameSide = (fromSide === toSide);

      let channelX;

      if (r.customChannelX !== undefined && r.customChannelX !== null) {
        channelX = r.customChannelX;
      } else if (!isSameSide) {
        // DIFFERENT SIDES: channel in the gap between tables
        const fb = tableBounds.get(r.fromTable);
        const tb = tableBounds.get(r.toTable);
        const gapMid = (fb.centerX < tb.centerX)
          ? (fb.right + tb.left) / 2
          : (tb.right + fb.left) / 2;

        // Stagger multiple connections crossing the same gap
        const pairKey = [r.fromTable, r.toTable].sort().join(':');
        const pairIdx = pairChannelCount.get(pairKey) || 0;
        pairChannelCount.set(pairKey, pairIdx + 1);
        channelX = gapMid + pairIdx * CHANNEL_STAGGER;
      } else {
        // SAME SIDE: channel extends outward from both ports
        const dir = fromSide === "right" ? 1 : -1;
        const STUB_BASE = 30;
        const maxIdx = Math.max(fromIndex, toIndex);
        if (dir > 0) {
          channelX = Math.max(start.x, end.x) + STUB_BASE + maxIdx * CHANNEL_STAGGER;
        } else {
          channelX = Math.min(start.x, end.x) - STUB_BASE - maxIdx * CHANNEL_STAGGER;
        }
      }

      for (const existing of allChannelXs) {
        if (Math.abs(channelX - existing) < CHANNEL_SNAP_THRESHOLD) {
          channelX = existing;
          break;
        }
      }
      allChannelXs.push(channelX);

      const d = this._buildOrthogonalPath(start.x, start.y, end.x, end.y, channelX, CORNER_RADIUS);
      this._drawConnectionPath(d, r.id, r.cardinality, start, end, fromSide, toSide);
    });
  }

  /**
   * Builds a clean 3-segment orthogonal SVG path: H → V → H
   * with rounded corners using quadratic Bézier arcs.
   */
  _buildOrthogonalPath(x1, y1, x2, y2, channelX, r) {
    const dy = y2 - y1;

    // Same Y → straight line
    if (Math.abs(dy) < 2) {
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    }

    const dirY = dy > 0 ? 1 : -1;
    const dx1 = channelX - x1;
    const dx2 = x2 - channelX;

    // Edge case: channel at start X → just V-H (2 segments)
    if (Math.abs(dx1) < 2) {
      const cr = Math.min(r, Math.abs(dx2), Math.abs(dy));
      const dirX = dx2 > 0 ? 1 : -1;
      return [
        `M ${x1} ${y1}`,
        `L ${x1} ${y2 - dirY * cr}`,
        `Q ${x1} ${y2} ${x1 + dirX * cr} ${y2}`,
        `L ${x2} ${y2}`
      ].join(' ');
    }

    // Edge case: channel at end X → just H-V (2 segments)
    if (Math.abs(dx2) < 2) {
      const cr = Math.min(r, Math.abs(dx1), Math.abs(dy));
      const dirX = dx1 > 0 ? 1 : -1;
      return [
        `M ${x1} ${y1}`,
        `L ${channelX - dirX * cr} ${y1}`,
        `Q ${channelX} ${y1} ${channelX} ${y1 + dirY * cr}`,
        `L ${x2} ${y2}`
      ].join(' ');
    }

    // Normal case: H → V → H (3 segments, 2 rounded corners)
    const dirX1 = dx1 > 0 ? 1 : -1;
    const dirX2 = dx2 > 0 ? 1 : -1;
    const r1 = Math.min(r, Math.abs(dx1), Math.abs(dy) / 2);
    const r2 = Math.min(r, Math.abs(dx2), Math.abs(dy) / 2);

    return [
      `M ${x1} ${y1}`,
      `L ${channelX - dirX1 * r1} ${y1}`,
      `Q ${channelX} ${y1} ${channelX} ${y1 + dirY * r1}`,
      `L ${channelX} ${y2 - dirY * r2}`,
      `Q ${channelX} ${y2} ${channelX + dirX2 * r2} ${y2}`,
      `L ${x2} ${y2}`
    ].join(' ');
  }

  _drawConnectionPath(d, relationshipId, cardinality, start, end, fromSide, toSide) {
    const { connectionsSvg } = this.elements;
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.dataset.id = relationshipId;

    const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const glowPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const mainPath = document.createElementNS("http://www.w3.org/2000/svg", "path");

    hitPath.setAttribute("d", d);
    hitPath.className.baseVal = "connection-path-hit";
    hitPath.dataset.id = relationshipId;

    glowPath.setAttribute("d", d);
    glowPath.className.baseVal = "connection-path-glow";
    glowPath.dataset.id = relationshipId;

    mainPath.setAttribute("d", d);
    mainPath.className.baseVal = "connection-path";
    mainPath.dataset.id = relationshipId;
    mainPath.setAttribute("marker-end", "url(#arrow)");

    hitPath.addEventListener("click", (e) => {
      if (hitPath.dataset.dragged === "true") {
        hitPath.removeAttribute("data-dragged");
        return;
      }
      e.stopPropagation();
      if (this.onRelationshipDelete) {
        this.onRelationshipDelete(relationshipId);
      }
    });

    hitPath.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._showCardinalityPopover(relationshipId, e.clientX, e.clientY);
    });

    group.appendChild(hitPath);
    group.appendChild(glowPath);
    group.appendChild(mainPath);

    if (cardinality) {
      const parts = cardinality.split(':');
      const fromLabel = parts[0] || '1';
      const toLabel = parts[1] || 'N';

      const labelGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
      labelGroup.className.baseVal = "connection-label-group";
      labelGroup.dataset.id = relationshipId;

      const OFFSET = 14;
      const fromOffsetX = fromSide === 'right' ? -OFFSET : OFFSET;
      const toOffsetX = toSide === 'right' ? -OFFSET : OFFSET;

      const fromText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      fromText.setAttribute("x", start.x + fromOffsetX);
      fromText.setAttribute("y", start.y - 6);
      fromText.setAttribute("text-anchor", fromSide === 'right' ? 'end' : 'start');
      fromText.className.baseVal = "connection-label connection-label-from";
      fromText.textContent = fromLabel;

      const toText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      toText.setAttribute("x", end.x + toOffsetX);
      toText.setAttribute("y", end.y - 6);
      toText.setAttribute("text-anchor", toSide === 'right' ? 'end' : 'start');
      toText.className.baseVal = "connection-label connection-label-to";
      toText.textContent = toLabel;

      labelGroup.appendChild(fromText);
      labelGroup.appendChild(toText);
      group.appendChild(labelGroup);
    }

    connectionsSvg.appendChild(group);
  }

  _showCardinalityPopover(relationshipId, clientX, clientY) {
    const existing = document.querySelector(".cardinality-popover");
    if (existing) existing.remove();

    const popover = document.createElement("div");
    popover.className = "cardinality-popover";

    const options = [
      { value: '1:1', label: '1 a 1' },
      { value: '1:N', label: '1 a N' },
      { value: 'N:1', label: 'N a 1' },
      { value: 'N:M', label: 'N a M' }
    ];

    popover.innerHTML = `
      <div class="cardinality-popover-header">
        <span>Cardinalidad</span>
        <button class="cardinality-popover-close">&times;</button>
      </div>
      <div class="cardinality-popover-body">
        ${options.map(opt => `
          <button class="cardinality-option" data-value="${opt.value}">${opt.label}</button>
        `).join('')}
      </div>
    `;

    popover.style.left = `${clientX + 10}px`;
    popover.style.top = `${clientY - 10}px`;

    document.body.appendChild(popover);

    const close = () => popover.remove();

    popover.querySelector('.cardinality-popover-close').addEventListener('click', close);

    popover.querySelectorAll('.cardinality-option').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.onRelationshipCardinalityChange) {
          this.onRelationshipCardinalityChange(relationshipId, btn.dataset.value);
        }
        close();
      });
    });

    setTimeout(() => {
      const handler = (e) => {
        if (!popover.contains(e.target)) {
          close();
          document.removeEventListener('mousedown', handler);
        }
      };
      document.addEventListener('mousedown', handler);
    }, 0);
  }

  getPortCenter(portEl) {
    const rowEl = portEl.closest('.erd-field-row');
    const tableEl = portEl.closest('.erd-table');
    if (!rowEl || !tableEl) {
      const { erdCanvas } = this.elements;
      const canvasRect = erdCanvas.getBoundingClientRect();
      const portRect = portEl.getBoundingClientRect();
      return {
        x: (portRect.left - canvasRect.left + portRect.width / 2) / this.zoom,
        y: (portRect.top - canvasRect.top + portRect.height / 2) / this.zoom
      };
    }

    const tableX = parseFloat(tableEl.style.left) || 0;
    const tableY = parseFloat(tableEl.style.top) || 0;
    
    const isLeft = portEl.classList.contains('port-left');
    const relativeX = isLeft ? 0 : 240;
    
    let relativeY = rowEl.offsetTop;
    let parent = rowEl.offsetParent;
    while (parent && parent !== tableEl) {
      relativeY += parent.offsetTop;
      parent = parent.offsetParent;
    }
    relativeY += (rowEl.offsetHeight / 2 || 16);

    return {
      x: tableX + relativeX,
      y: tableY + relativeY
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
