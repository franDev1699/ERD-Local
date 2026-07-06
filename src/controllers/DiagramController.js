// src/controllers/DiagramController.js

export class DiagramController {
  constructor({ stateManager, history, uiManager, canvasManager, dom }) {
    this.stateManager = stateManager;
    this.history = history;
    this.uiManager = uiManager;
    this.canvasManager = canvasManager;
    this.dom = dom;

    this.selectedTableIds = new Set();
    this.selectedGroupId = null;

    this.renderer = null;
    this.sidebarEditor = null;
    this.onRefreshUI = null;
  }

  setUIComponents({ renderer, sidebarEditor }) {
    this.renderer = renderer;
    this.sidebarEditor = sidebarEditor;
  }

  handleStateChange(newState, isRemote = false) {
    this.refreshUI();
  }

  refreshUI() {
    if (!this.renderer || !this.sidebarEditor) return;
    this.refreshCanvas();
    this.refreshSidebar();

    const projectTitle = document.getElementById("project-title");
    if (projectTitle && projectTitle.contentEditable !== "true") {
      const state = this.stateManager.getState();
      projectTitle.textContent = state.name || "Mi Diagrama Local";
    }

    if (this.onRefreshUI) {
      this.onRefreshUI();
    }
  }

  refreshCanvas() {
    if (!this.renderer) return;
    const state = this.stateManager.getState();
    this.adjustCanvasSizeToContent(state.tables, state.groups);
    const zoom = this.canvasManager.getZoom();
    this.renderer.render(state, this.selectedTableIds, this.selectedGroupId, zoom);
  }

  refreshSidebar() {
    if (!this.sidebarEditor) return;
    const state = this.stateManager.getState();
    if (this.selectedGroupId) {
      const group = state.groups.find(g => g.id === this.selectedGroupId);
      this.sidebarEditor.renderGroupEditor(group, state.groups);
    } else {
      this.sidebarEditor.render(state.tables, this.selectedTableIds, state.groups);
    }
  }

  adjustCanvasSizeToContent(tables, groups) {
    if (!tables || tables.length === 0) {
      const canvas = this.canvasManager.canvas;
      if (canvas) {
        canvas.style.width = '3000px';
        canvas.style.height = '3000px';
      }
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    tables.forEach(table => {
      if (table.x < minX) minX = table.x;
      if (table.x + 240 > maxX) maxX = table.x + 240;
      if (table.y < minY) minY = table.y;
      const tableHeight = 52 + (table.fields ? table.fields.length * 32 : 0) + 16;
      if (table.y + tableHeight > maxY) maxY = table.y + tableHeight;
    });

    if (groups && groups.length > 0) {
      groups.forEach(group => {
        if (group.x < minX) minX = group.x;
        if (group.x + (group.width || 300) > maxX) maxX = group.x + (group.width || 300);
        if (group.y < minY) minY = group.y;
        if (group.y + (group.height || 200) > maxY) maxY = group.y + (group.height || 200);
      });
    }

    if (!isFinite(minX)) return;

    const canvasWidth = Math.max(3000, maxX + minX);
    const canvasHeight = Math.max(3000, maxY + minY);

    const canvas = this.canvasManager.canvas;
    if (canvas) {
      canvas.style.width = `${canvasWidth}px`;
      canvas.style.height = `${canvasHeight}px`;
    }

    const connectionsSvg = this.renderer?.elements.connectionsSvg;
    if (connectionsSvg) {
      connectionsSvg.setAttribute("width", canvasWidth);
      connectionsSvg.setAttribute("height", canvasHeight);
    }
  }

  selectTable(tableId, isCumulative = false) {
    if (tableId === null) {
      this.selectedTableIds.clear();
    } else {
      if (isCumulative) {
        if (this.selectedTableIds.has(tableId)) {
          this.selectedTableIds.delete(tableId);
        } else {
          this.selectedTableIds.add(tableId);
        }
      } else {
        this.selectedTableIds.clear();
        this.selectedTableIds.add(tableId);
      }
    }
    this.selectedGroupId = null;

    const tables = this.dom.tablesContainer.querySelectorAll(".erd-table");
    tables.forEach(tableEl => {
      if (this.selectedTableIds.has(tableEl.dataset.id)) {
        tableEl.classList.add("selected");
      } else {
        tableEl.classList.remove("selected");
      }
    });

    const groups = this.dom.canvasContainer.querySelectorAll(".erd-group");
    groups.forEach(groupEl => {
      groupEl.classList.remove("selected");
    });

    this.refreshUI();

    if (tableId !== null && !isCumulative) {
      this.sidebarEditor?.scrollToTable(tableId);
    }
  }

  selectGroup(groupId) {
    if (this.selectedGroupId === groupId) return;
    this.selectedGroupId = groupId;
    this.selectedTableIds.clear();

    const groups = this.dom.canvasContainer.querySelectorAll(".erd-group");
    groups.forEach(groupEl => {
      if (groupEl.dataset.id === groupId) {
        groupEl.classList.add("selected");
      } else {
        groupEl.classList.remove("selected");
      }
    });

    const tables = this.dom.tablesContainer.querySelectorAll(".erd-table");
    tables.forEach(tableEl => {
      tableEl.classList.remove("selected");
    });

    this.refreshUI();
  }

  handleSelectionArea(ids, isCumulative) {
    if (!isCumulative) {
      this.selectedTableIds.clear();
    }
    ids.forEach(id => {
      this.selectedTableIds.add(id);
    });
    this.selectedGroupId = null;
    this.refreshUI();
  }

  addTable() {
    const rect = this.dom.canvasContainer.getBoundingClientRect();
    const zoom = this.canvasManager.getZoom();
    const x = (this.dom.canvasContainer.scrollLeft + rect.width / 2) / zoom - 120;
    const y = (this.dom.canvasContainer.scrollTop + rect.height / 2) / zoom - 50;

    this.history.push(this.stateManager.getState());

    const newId = `tbl-${Date.now()}`;
    const newTable = {
      id: newId,
      name: `nueva_tabla_${this.stateManager.getState().tables.length + 1}`,
      x: Math.max(50, Math.min(2700, x)),
      y: Math.max(50, Math.min(2700, y)),
      fields: [
        { id: `f-${Date.now()}-1`, name: "id", type: "INT", isPK: true, isAutoIncrement: true, isNotNull: true, isUnique: false, defaultValue: "" }
      ]
    };

    this.stateManager.addTable(newTable);
    this.selectTable(newId);
    this.scrollToTable(newId);
    this.uiManager.showToast("Nueva tabla agregada.", "success");
  }

  updateTable(tableId, updates) {
    this.history.push(this.stateManager.getState());
    this.stateManager.updateTable(tableId, updates);
  }

  async deleteTable(tableId) {
    const confirmed = await this.uiManager.confirm("¿Estás seguro de que deseas eliminar esta tabla y todas sus relaciones?", "Eliminar Tabla");
    if (confirmed) {
      this.history.push(this.stateManager.getState());
      this.stateManager.removeTable(tableId);
      if (this.selectedTableIds.has(tableId)) {
        this.selectedTableIds.delete(tableId);
      }
      this.refreshUI();
      this.uiManager.showToast("Tabla eliminada.", "success");
    }
  }

  duplicateTable(tableId) {
    const state = this.stateManager.getState();
    const originalTable = state.tables.find(t => t.id === tableId);
    if (!originalTable) return;

    this.history.push(state);

    const newId = `tbl-${Date.now()}`;
    const newTable = {
      id: newId,
      name: `${originalTable.name}_copy`,
      x: Math.max(50, Math.min(2700, originalTable.x + 30)),
      y: Math.max(50, Math.min(2700, originalTable.y + 30)),
      color: originalTable.color || null,
      groupId: originalTable.groupId || null,
      fields: originalTable.fields.map((f, index) => ({
        ...f,
        id: `f-${Date.now()}-${index}-${Math.floor(Math.random() * 1000)}`
      }))
    };

    this.stateManager.addTable(newTable);
    this.selectTable(newId);
    this.scrollToTable(newId);
    this.uiManager.showToast("Tabla duplicada.", "success");
  }

  async deleteTables(tableIds) {
    if (!tableIds || tableIds.length === 0) return;
    const confirmed = await this.uiManager.confirm(
      `¿Estás seguro de que deseas eliminar las ${tableIds.length} tablas seleccionadas y todas sus relaciones?`,
      "Eliminar Múltiples Tablas"
    );
    if (confirmed) {
      this.history.push(this.stateManager.getState());
      const state = this.stateManager.getState();

      const newTables = state.tables.filter(t => !tableIds.includes(t.id));
      const newRelationships = state.relationships.filter(
        rel => !tableIds.includes(rel.fromTable) && !tableIds.includes(rel.toTable)
      );

      tableIds.forEach(id => {
        if (this.selectedTableIds.has(id)) {
          this.selectedTableIds.delete(id);
        }
      });

      this.stateManager.setState({
        ...state,
        tables: newTables,
        relationships: newRelationships
      });

      this.uiManager.showToast(`${tableIds.length} tablas eliminadas.`, "success");
    }
  }

  async groupTables(tableIds, groupId) {
    if (!tableIds || tableIds.length === 0) return;

    this.history.push(this.stateManager.getState());
    const state = this.stateManager.getState();

    if (groupId === "NEW_GROUP") {
      const defaultName = `grupo_${(state.groups || []).length + 1}`;
      const groupName = await this.uiManager.prompt("Nombre del nuevo grupo:", defaultName, "Crear Grupo");
      if (!groupName || !groupName.trim()) {
        this.uiManager.showToast("Agrupación cancelada.", "info");
        return;
      }

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const selectedTables = state.tables.filter(t => tableIds.includes(t.id));

      selectedTables.forEach(table => {
        const tableHeight = 50 + table.fields.length * 28;
        if (table.x < minX) minX = table.x;
        if (table.x + 240 > maxX) maxX = table.x + 240;
        if (table.y < minY) minY = table.y;
        if (table.y + tableHeight > maxY) maxY = table.y + tableHeight;
      });

      const paddingLeft = 30;
      const paddingRight = 30;
      const paddingTop = 60;
      const paddingBottom = 30;

      const groupX = Math.max(50, minX - paddingLeft);
      const groupY = Math.max(50, minY - paddingTop);
      const groupW = Math.max(200, (maxX - minX) + paddingLeft + paddingRight);
      const groupH = Math.max(150, (maxY - minY) + paddingTop + paddingBottom);

      const newGroupId = `group-${Date.now()}`;
      const newGroup = {
        id: newGroupId,
        name: groupName.trim(),
        x: groupX,
        y: groupY,
        width: groupW,
        height: groupH,
        color: "#475569"
      };

      const newTables = state.tables.map(table => {
        if (tableIds.includes(table.id)) {
          return { ...table, groupId: newGroupId };
        }
        return table;
      });

      const updatedGroups = [...(state.groups || []), newGroup];

      this.stateManager.setState({
        ...state,
        tables: newTables,
        groups: updatedGroups
      });

      this.uiManager.showToast(`Grupo "${newGroup.name}" creado y tablas agrupadas.`, "success");
    } else {
      const targetGroup = state.groups.find(g => g.id === groupId);

      const newTables = state.tables.map(table => {
        if (tableIds.includes(table.id)) {
          return { ...table, groupId };
        }
        return table;
      });

      if (targetGroup) {
        const groupTablesList = newTables.filter(t => t.groupId === groupId);

        const paddingLeft = 30;
        const paddingTop = 60;
        const spacingX = 280;

        const colCount = Math.ceil(Math.sqrt(groupTablesList.length));

        groupTablesList.forEach((table, index) => {
          const col = index % colCount;
          const row = Math.floor(index / colCount);
          table.x = targetGroup.x + paddingLeft + col * spacingX;

          let totalHeightBefore = 0;
          for (let r = 0; r < row; r++) {
            const prevIndex = r * colCount + col;
            if (prevIndex < groupTablesList.length) {
              const prevTable = groupTablesList[prevIndex];
              const prevHeight = 50 + prevTable.fields.length * 28;
              totalHeightBefore += prevHeight + 30;
            }
          }
          table.y = targetGroup.y + paddingTop + totalHeightBefore;
        });

        const cols = colCount;
        const rows = Math.ceil(groupTablesList.length / cols);
        const minWidth = paddingLeft + cols * spacingX;

        let maxColHeight = 150;
        for (let c = 0; c < cols; c++) {
          let colHeight = paddingTop;
          for (let r = 0; r < rows; r++) {
            const idx = r * cols + c;
            if (idx < groupTablesList.length) {
              const tbl = groupTablesList[idx];
              const tblH = 50 + tbl.fields.length * 28;
              colHeight += tblH + 30;
            }
          }
          if (colHeight > maxColHeight) maxColHeight = colHeight;
        }

        if (targetGroup.width < minWidth) targetGroup.width = minWidth;
        if (targetGroup.height < maxColHeight) targetGroup.height = maxColHeight;
      }

      this.stateManager.setState({
        ...state,
        tables: newTables
      });

      this.uiManager.showToast(
        groupId ? `Tablas añadidas al grupo.` : `Tablas removidas del grupo.`,
        "success"
      );
    }
  }

  async addGroup() {
    if (this.selectedTableIds.size > 0) {
      await this.groupTables(Array.from(this.selectedTableIds), "NEW_GROUP");
      return;
    }

    const rect = this.dom.canvasContainer.getBoundingClientRect();
    const zoom = this.canvasManager.getZoom();
    const x = (this.dom.canvasContainer.scrollLeft + rect.width / 2) / zoom - 225;
    const y = (this.dom.canvasContainer.scrollTop + rect.height / 2) / zoom - 175;

    this.history.push(this.stateManager.getState());

    const newId = `group-${Date.now()}`;
    const newGroup = {
      id: newId,
      name: `nuevo_grupo_${(this.stateManager.getState().groups || []).length + 1}`,
      x: Math.max(50, Math.min(2500, x)),
      y: Math.max(50, Math.min(2500, y)),
      width: 450,
      height: 350,
      color: "#475569"
    };

    this.stateManager.addGroup(newGroup);
    this.selectGroup(newId);
    this.uiManager.showToast("Nuevo grupo agregado.", "success");
  }

  updateGroup(groupId, updates) {
    this.history.push(this.stateManager.getState());
    this.stateManager.updateGroup(groupId, updates);
  }

  async deleteGroup(groupId) {
    const confirmed = await this.uiManager.confirm("¿Estás seguro de que deseas eliminar este grupo? Las tablas agrupadas permanecerán.", "Eliminar Grupo");
    if (confirmed) {
      this.history.push(this.stateManager.getState());
      this.stateManager.removeGroup(groupId);
      if (this.selectedGroupId === groupId) {
        this.selectedGroupId = null;
      }
      this.refreshUI();
      this.uiManager.showToast("Grupo eliminado.", "success");
    }
  }

  addField(tableId) {
    this.history.push(this.stateManager.getState());
    const fieldId = `f-${Date.now()}`;
    const table = this.stateManager.getState().tables.find(t => t.id === tableId);
    const newField = {
      id: fieldId,
      name: `columna_${table ? table.fields.length + 1 : 1}`,
      type: "VARCHAR(255)",
      isPK: false,
      isAutoIncrement: false,
      isNotNull: false,
      isUnique: false,
      defaultValue: ""
    };
    this.stateManager.addField(tableId, newField);
    this.uiManager.showToast("Campo agregado.", "success");
  }

  updateField(tableId, fieldId, updates) {
    this.history.push(this.stateManager.getState());
    this.stateManager.updateField(tableId, fieldId, updates);
  }

  deleteField(tableId, fieldId) {
    this.history.push(this.stateManager.getState());
    this.stateManager.deleteField(tableId, fieldId);
    this.uiManager.showToast("Campo eliminado.", "success");
  }

  moveField(sourceTableId, fieldId, targetTableId, targetIndex) {
    this.history.push(this.stateManager.getState());
    this.stateManager.moveField(sourceTableId, fieldId, targetTableId, targetIndex);

    if (sourceTableId !== targetTableId) {
      const state = this.stateManager.getState();
      const targetTable = state.tables.find(t => t.id === targetTableId);
      const targetName = targetTable ? targetTable.name : "otra tabla";
      this.uiManager.showToast(`Campo movido a "${targetName}".`, "success");
    }
  }

  copyField(sourceTableId, fieldId, targetTableId, targetIndex) {
    this.history.push(this.stateManager.getState());
    this.stateManager.copyField(sourceTableId, fieldId, targetTableId, targetIndex);

    const state = this.stateManager.getState();
    const targetTable = state.tables.find(t => t.id === targetTableId);
    const targetName = targetTable ? targetTable.name : "tabla";
    this.uiManager.showToast(`Campo copiado a "${targetName}".`, "success");
  }

  addRelationship(fromTable, fromField, toTable, toField) {
    const state = this.stateManager.getState();
    const exists = state.relationships.some(
      r => (r.fromTable === fromTable && r.fromField === fromField && r.toTable === toTable && r.toField === toField) ||
           (r.fromTable === toTable && r.fromField === toField && r.toTable === fromTable && r.toField === fromField)
    );

    if (!exists) {
      this.history.push(state);
      this.stateManager.addRelationship({
        id: `rel-${Date.now()}`,
        fromTable,
        fromField,
        toTable,
        toField
      });
      this.uiManager.showToast("Relación creada correctamente.", "success");
    } else {
      this.uiManager.showToast("Esta relación ya existe.", "info");
    }
  }

  async deleteRelationship(relationshipId) {
    const confirmed = await this.uiManager.confirm("¿Estás seguro de que deseas eliminar esta relación?", "Eliminar Relación");
    if (confirmed) {
      this.history.push(this.stateManager.getState());
      this.stateManager.removeRelationship(relationshipId);
      this.uiManager.showToast("Relación eliminada.", "success");
    }
  }

  async clearAll() {
    const confirmed = await this.uiManager.confirm("¿Estás seguro de que deseas limpiar todo el diagrama? Esta acción no se puede deshacer.", "Limpiar Todo");
    if (confirmed) {
      this.history.push(this.stateManager.getState());
      this.stateManager.setState({
        tables: [],
        relationships: []
      });
      this.selectedTableIds.clear();
      this.selectedGroupId = null;
      this.uiManager.showToast("Todo limpiado.", "success");
    }
  }

  centerContentOnCanvas(tables, groups) {
    if (!tables || tables.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    tables.forEach(table => {
      minX = Math.min(minX, table.x);
      maxX = Math.max(maxX, table.x + 240);
      minY = Math.min(minY, table.y);
      const tableHeight = 52 + (table.fields ? table.fields.length * 32 : 0) + 16;
      maxY = Math.max(maxY, table.y + tableHeight);
    });

    if (groups && groups.length > 0) {
      groups.forEach(group => {
        minX = Math.min(minX, group.x);
        maxX = Math.max(maxX, group.x + (group.width || 300));
        minY = Math.min(minY, group.y);
        maxY = Math.max(maxY, group.y + (group.height || 200));
      });
    }

    if (!isFinite(minX)) return;

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const contentCenterX = minX + contentWidth / 2;
    const contentCenterY = minY + contentHeight / 2;

    const PADDING = 1000;
    const canvasWidth = Math.max(5000, contentWidth + PADDING * 2);
    const canvasHeight = Math.max(5000, contentHeight + PADDING * 2);

    const canvas = this.canvasManager.canvas;
    if (canvas) {
      canvas.style.width = `${canvasWidth}px`;
      canvas.style.height = `${canvasHeight}px`;
    }

    const canvasCenterX = canvasWidth / 2;
    const canvasCenterY = canvasHeight / 2;

    const dx = canvasCenterX - contentCenterX;
    const dy = canvasCenterY - contentCenterY;

    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

    tables.forEach(table => {
      table.x += dx;
      table.y += dy;
    });

    if (groups && groups.length > 0) {
      groups.forEach(group => {
        group.x += dx;
        group.y += dy;
      });
    }
  }

  autoLayout() {
    const state = this.stateManager.getState();
    if (state.tables.length === 0) return;

    this.history.push(JSON.parse(JSON.stringify(state)));

    const groups = state.groups || [];
    const groupIds = new Set(groups.map(g => g.id));

    const estimateTableHeight = (table) => {
      const fieldCount = table.fields ? table.fields.length : 0;
      return 52 + (fieldCount * 32) + 16;
    };

    groups.forEach(group => {
      const groupTables = state.tables.filter(t => t.groupId === group.id);
      if (groupTables.length === 0) {
        group.width = group.width || 300;
        group.height = group.height || 200;
        return;
      }

      const paddingLeft = 40;
      const paddingTop = 75;
      const paddingRight = 40;
      const paddingBottom = 40;
      const gapX = 80;
      const gapY = 80;
      const tableWidth = 240;

      const colCount = Math.ceil(Math.sqrt(groupTables.length));
      const rowCount = Math.ceil(groupTables.length / colCount);

      const rowHeights = [];
      for (let r = 0; r < rowCount; r++) {
        let maxH = 0;
        for (let c = 0; c < colCount; c++) {
          const idx = r * colCount + c;
          if (idx < groupTables.length) {
            maxH = Math.max(maxH, estimateTableHeight(groupTables[idx]));
          }
        }
        rowHeights.push(maxH);
      }

      groupTables.forEach((table, index) => {
        const col = index % colCount;
        const row = Math.floor(index / colCount);

        table.x = group.x + paddingLeft + col * (tableWidth + gapX);

        let yOffset = paddingTop;
        for (let r = 0; r < row; r++) {
          yOffset += rowHeights[r] + gapY;
        }
        table.y = group.y + yOffset;
      });

      const totalWidth = paddingLeft + colCount * tableWidth + (colCount - 1) * gapX + paddingRight;
      const totalHeight = paddingTop + rowHeights.reduce((sum, h) => sum + h, 0) + (rowCount - 1) * gapY + paddingBottom;

      group.width = Math.max(group.width || 0, totalWidth);
      group.height = Math.max(group.height || 0, totalHeight);
    });

    let startX = 100;
    let startY = 100;
    let maxGroupsAreaHeight = 0;
    let maxGroupsAreaWidth = 0;

    if (groups.length > 0) {
      const groupsColCount = Math.ceil(Math.sqrt(groups.length));
      const groupsRowCount = Math.ceil(groups.length / groupsColCount);
      const gapGroupsX = 150;
      const gapGroupsY = 150;

      const colWidths = [];
      const rowHeights = [];

      for (let r = 0; r < groupsRowCount; r++) {
        let maxRowH = 0;
        for (let c = 0; c < groupsColCount; c++) {
          const idx = r * groupsColCount + c;
          if (idx < groups.length) {
            maxRowH = Math.max(maxRowH, groups[idx].height || 200);
          }
        }
        rowHeights.push(maxRowH);
      }

      for (let c = 0; c < groupsColCount; c++) {
        let maxColW = 0;
        for (let r = 0; r < groupsRowCount; r++) {
          const idx = r * groupsColCount + c;
          if (idx < groups.length) {
            maxColW = Math.max(maxColW, groups[idx].width || 300);
          }
        }
        colWidths.push(maxColW);
      }

      groups.forEach((group, index) => {
        const col = index % groupsColCount;
        const row = Math.floor(index / groupsColCount);

        let targetX = startX;
        for (let c = 0; c < col; c++) {
          targetX += colWidths[c] + gapGroupsX;
        }

        let targetY = startY;
        for (let r = 0; r < row; r++) {
          targetY += rowHeights[r] + gapGroupsY;
        }

        const dx = targetX - group.x;
        const dy = targetY - group.y;

        group.x = targetX;
        group.y = targetY;

        state.tables.filter(t => t.groupId === group.id).forEach(table => {
          table.x += dx;
          table.y += dy;
        });
      });

      maxGroupsAreaWidth = colWidths.reduce((sum, w) => sum + w, 0) + (groupsColCount - 1) * gapGroupsX;
      maxGroupsAreaHeight = rowHeights.reduce((sum, h) => sum + h, 0) + (groupsRowCount - 1) * gapGroupsY;
    }

    const ungroupedTables = state.tables.filter(t => !t.groupId || !groupIds.has(t.groupId));
    if (ungroupedTables.length > 0) {
      let currentX = 100;
      let currentY = 100;

      if (groups.length > 0) {
        currentX = 100;
        currentY = startY + maxGroupsAreaHeight + 200;
      }

      const colCount = Math.ceil(Math.sqrt(ungroupedTables.length));
      const rowCount = Math.ceil(ungroupedTables.length / colCount);

      const gapX = 100;
      const gapY = 100;
      const tableWidth = 240;

      const rowHeights = [];
      for (let r = 0; r < rowCount; r++) {
        let maxH = 0;
        for (let c = 0; c < colCount; c++) {
          const idx = r * colCount + c;
          if (idx < ungroupedTables.length) {
            maxH = Math.max(maxH, estimateTableHeight(ungroupedTables[idx]));
          }
        }
        rowHeights.push(maxH);
      }

      ungroupedTables.forEach((table, index) => {
        const col = index % colCount;
        const row = Math.floor(index / colCount);

        table.x = currentX + col * (tableWidth + gapX);

        let yOffset = 0;
        for (let r = 0; r < row; r++) {
          yOffset += rowHeights[r] + gapY;
        }
        table.y = currentY + yOffset;
      });
    }

    this.centerContentOnCanvas(state.tables, state.groups);

    this.stateManager.notify();
    this.canvasManager.fitToContent(this.stateManager.getState().tables);

    requestAnimationFrame(() => {
      this.refreshCanvas();
    });

    this.uiManager.showToast("Tablas organizadas con éxito.", "success");
  }

  undo() {
    const previous = this.history.undo(this.stateManager.getState());
    if (previous) {
      this.stateManager.setState(previous);
      this.uiManager.showToast("Deshecho", "info");
    }
  }

  redo() {
    const next = this.history.redo(this.stateManager.getState());
    if (next) {
      this.stateManager.setState(next);
      this.uiManager.showToast("Rehecho", "info");
    }
  }

  scrollToTable(tableId) {
    const table = this.stateManager.getState().tables.find(t => t.id === tableId);
    if (!table) return;

    const container = this.dom.canvasContainer;
    const zoom = this.canvasManager.getZoom();
    const viewportW = container.clientWidth;
    const viewportH = container.clientHeight;

    const tableCenterX = table.x + 120;
    const tableCenterY = table.y + 80;

    container.scrollTo({
      left: Math.max(0, tableCenterX * zoom - viewportW / 2),
      top: Math.max(0, tableCenterY * zoom - viewportH / 2),
      behavior: "smooth"
    });
  }
}
