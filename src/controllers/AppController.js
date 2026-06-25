// src/controllers/AppController.js

import { StateManager } from '../core/StateManager.js';
import { HistoryManager } from '../core/HistoryManager.js';
import { StorageService } from '../services/StorageService.js';
import { WebSocketService } from '../services/WebSocketService.js';
import { ExportService } from '../services/ExportService.js';
import { ImportService } from '../services/ImportService.js';
import { Renderer } from '../ui/Renderer.js';
import { CanvasManager } from '../ui/CanvasManager.js';
import { SidebarEditor } from '../ui/SidebarEditor.js';
import { UIManager } from '../ui/UIManager.js';
import { InteractionController } from './InteractionController.js';

export class AppController {
  constructor(config) {
    this.config = config;
    this.projectId = config.projectId;
    
    // Services
    this.storage = new StorageService(this.projectId);
    this.webSocket = new WebSocketService(config.wsUrl);
    
    // State & History
    const initialState = this.projectId ? (this.storage.load() || config.defaultState) : config.defaultState;
    this.stateManager = new StateManager(initialState, (newState, isRemote) => this.handleStateChange(newState, isRemote));
    this.history = new HistoryManager();
    
    // UI Components
    this.renderer = new Renderer(config.dom, {
      onRelationshipDelete: (id) => this.deleteRelationship(id)
    });
    this.canvasManager = new CanvasManager({
      container: config.dom.canvasContainer,
      canvas: config.dom.erdCanvas,
      zoomText: config.dom.zoomText
    });
    this.sidebarEditor = new SidebarEditor({
      container: config.dom.tablesListContainer,
      onTableSelect: (id, isCumulative) => this.selectTable(id, isCumulative),
      onTableUpdate: (tableId, updates) => this.updateTable(tableId, updates),
      onTableDelete: (tableId) => this.deleteTable(tableId),
      onTableDuplicate: (tableId) => this.duplicateTable(tableId),
      onFieldAdd: (tableId) => this.addField(tableId),
      onFieldUpdate: (tableId, fieldId, updates) => this.updateField(tableId, fieldId, updates),
      onFieldDelete: (tableId, fieldId) => this.deleteField(tableId, fieldId),
      onGroupUpdate: (groupId, updates) => this.updateGroup(groupId, updates),
      onGroupDelete: (groupId) => this.deleteGroup(groupId),
      onBatchDelete: (ids) => this.deleteTables(ids),
      onBatchGroup: (ids, groupId) => this.groupTables(ids, groupId)
    });
    this.uiManager = new UIManager({
      toastContainer: config.dom.toastContainer,
      sqlModal: config.dom.sqlModal,
      imageModal: config.dom.imageModal
    });

    // Interaction Controller
    this.interactionController = new InteractionController({
      canvasManager: this.canvasManager,
      stateManager: this.stateManager,
      renderer: this.renderer,
      uiManager: this.uiManager,
      dom: config.dom,
      onTableSelect: (id, isCumulative) => this.selectTable(id, isCumulative),
      onGroupSelect: (id) => this.selectGroup(id),
      onSelectionArea: (ids, isCumulative) => this.handleSelectionArea(ids, isCumulative),
      getSelectedTableIds: () => this.selectedTableIds,
      getSelectedGroupId: () => this.selectedGroupId,
      onHistoryPush: (prevState) => {
        this.history.push(prevState || this.stateManager.getState());
        this.updateHistoryButtons();
      },
      onRelationshipAdd: (fromTable, fromField, toTable, toField) => {
        this.addRelationship(fromTable, fromField, toTable, toField);
      },
      onCursorMove: (coords) => {
        if (this.webSocket.isConnected && this.myUser) {
          this.webSocket.send({ type: 'cursor_move', payload: coords });
        }
      }
    });

    this.selectedTableIds = new Set();
    this.selectedGroupId = null;
    this.myUser = null;
  }

  async init() {
    if (!this.projectId) {
      this.initDashboard();
      return;
    }

    // Hide dashboard, show app container
    const dashboardEl = document.getElementById("project-dashboard");
    if (dashboardEl) dashboardEl.classList.add("hidden");
    const appContainerEl = document.querySelector(".app-container");
    if (appContainerEl) appContainerEl.classList.remove("hidden");

    // Setup WebSocket
    try {
      await this.webSocket.connect();
      this.webSocket.onOpen(() => {
        this.uiManager.showToast("Conectado al servidor", "success");
        const badge = document.querySelector("#collab-status .collab-badge");
        if (badge) {
          badge.className = "collab-badge status-connected";
          const text = document.getElementById("collab-status-text");
          if (text) text.textContent = "Colaborativo";
        }
        if (this.myUser) {
          this.webSocket.send({ type: 'join', payload: this.myUser });
        }
      });
      this.webSocket.onMessage((data) => this.handleIncomingSync(data));
    } catch (e) {
      console.warn("No se pudo conectar al WebSocket. Iniciando en modo local.", e);
    }

    // Load or setup user identity
    await this.setupUserIdentity();

    // Initial Render & Setup
    this.refreshUI();
    this.interactionController.init();
    this.setupGlobalEventListeners();
    this.canvasManager.centerCanvas();
  }

  handleStateChange(newState, isRemote = false) {
    this.storage.save(newState);
    if (!isRemote && this.webSocket.isConnected) {
      this.webSocket.send({ type: 'update_state', payload: newState });
    }
    this.refreshUI();
  }

  handleIncomingSync(data) {
    if (data.type === 'init_state') {
      if (data.payload) {
        if (data.payload.state) {
          this.stateManager.setState(data.payload.state, true);
        }
        if (data.payload.shareUrl) {
          const shareInput = document.getElementById("share-link-input");
          if (shareInput) shareInput.value = data.payload.shareUrl;
          const container = document.getElementById("collab-link-container");
          if (container) container.classList.remove("hidden");
        }
      }
    } else if (data.type === 'sync_state') {
      if (data.payload) {
        // Update state without infinite broadcast loop (setState triggers onStateChange which runs handleStateChange)
        this.stateManager.setState(data.payload, true);
      }
    } else if (data.type === 'user_list') {
      this.updateActiveUsersList(data.payload);
    } else if (data.type === 'cursor_update') {
      this.updateCollaboratorCursor(data.payload);
    }
  }

  refreshUI() {
    const state = this.stateManager.getState();
    const zoom = this.canvasManager.getZoom();
    this.renderer.render(state, this.selectedTableIds, this.selectedGroupId, zoom);
    
    if (this.selectedGroupId) {
      const group = state.groups.find(g => g.id === this.selectedGroupId);
      this.sidebarEditor.renderGroupEditor(group, state.groups);
    } else {
      this.sidebarEditor.render(state.tables, this.selectedTableIds, state.groups);
    }
    
    this.updateHistoryButtons();
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

    // Toggle selected class on table DOM nodes
    const tables = this.config.dom.tablesContainer.querySelectorAll(".erd-table");
    tables.forEach(tableEl => {
      if (this.selectedTableIds.has(tableEl.dataset.id)) {
        tableEl.classList.add("selected");
      } else {
        tableEl.classList.remove("selected");
      }
    });

    // Toggle selected class on group DOM nodes (deselect groups)
    const groups = this.config.dom.canvasContainer.querySelectorAll(".erd-group");
    groups.forEach(groupEl => {
      groupEl.classList.remove("selected");
    });

    // Render updated sidebar accordion
    this.refreshUI();
  }

  selectGroup(groupId) {
    if (this.selectedGroupId === groupId) return;
    this.selectedGroupId = groupId;
    this.selectedTableIds.clear();

    // Toggle selected class on group DOM nodes
    const groups = this.config.dom.canvasContainer.querySelectorAll(".erd-group");
    groups.forEach(groupEl => {
      if (groupEl.dataset.id === groupId) {
        groupEl.classList.add("selected");
      } else {
        groupEl.classList.remove("selected");
      }
    });

    // Toggle selected class on table DOM nodes (deselect tables)
    const tables = this.config.dom.tablesContainer.querySelectorAll(".erd-table");
    tables.forEach(tableEl => {
      tableEl.classList.remove("selected");
    });

    // Render updated sidebar accordion
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

  // --- Table Operations ---
  addTable() {
    const rect = this.config.dom.canvasContainer.getBoundingClientRect();
    const zoom = this.canvasManager.getZoom();
    const x = (this.config.dom.canvasContainer.scrollLeft + rect.width / 2) / zoom - 120;
    const y = (this.config.dom.canvasContainer.scrollTop + rect.height / 2) / zoom - 50;

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
      
      // Remove deleted table ids from selection
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

      // Compute bounding box of selected tables
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
        color: "#475569" // slate default
      };

      // Update tables to be assigned to newGroupId
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
      // Assigning to existing group (or null)
      const targetGroup = state.groups.find(g => g.id === groupId);
      
      const newTables = state.tables.map(table => {
        if (tableIds.includes(table.id)) {
          return { ...table, groupId };
        }
        return table;
      });

      if (targetGroup) {
        // Lay out ALL tables that will be in this group
        const groupTablesList = newTables.filter(t => t.groupId === groupId);
        
        const paddingLeft = 30;
        const paddingTop = 60; // leave room for group title
        const spacingX = 280;  // 240 width + 40 gap
        
        const colCount = Math.ceil(Math.sqrt(groupTablesList.length));
        
        groupTablesList.forEach((table, index) => {
          const col = index % colCount;
          const row = Math.floor(index / colCount);
          table.x = targetGroup.x + paddingLeft + col * spacingX;
          
          // Compute Y based on table heights in preceding rows of the same column
          let totalHeightBefore = 0;
          for (let r = 0; r < row; r++) {
            const prevIndex = r * colCount + col;
            if (prevIndex < groupTablesList.length) {
              const prevTable = groupTablesList[prevIndex];
              const prevHeight = 50 + prevTable.fields.length * 28;
              totalHeightBefore += prevHeight + 30; // 30px gap between tables vertically
            }
          }
          table.y = targetGroup.y + paddingTop + totalHeightBefore;
        });

        // Expand the group size if there are more tables than fit
        const cols = colCount;
        const rows = Math.ceil(groupTablesList.length / cols);
        const minWidth = paddingLeft + cols * spacingX;
        
        // Compute needed height based on columns max height
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

    const rect = this.config.dom.canvasContainer.getBoundingClientRect();
    const zoom = this.canvasManager.getZoom();
    const x = (this.config.dom.canvasContainer.scrollLeft + rect.width / 2) / zoom - 225;
    const y = (this.config.dom.canvasContainer.scrollTop + rect.height / 2) / zoom - 175;

    this.history.push(this.stateManager.getState());
    
    const newId = `group-${Date.now()}`;
    const newGroup = {
      id: newId,
      name: `nuevo_grupo_${(this.stateManager.getState().groups || []).length + 1}`,
      x: Math.max(50, Math.min(2500, x)),
      y: Math.max(50, Math.min(2500, y)),
      width: 450,
      height: 350,
      color: "#475569" // slate default
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

  // --- Field Operations ---
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

  // --- Relationship Operations ---
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

  // --- Global Diagram Actions ---
  async clearAll() {
    const confirmed = await this.uiManager.confirm("¿Estás seguro de que deseas limpiar todo el diagrama? Esta acción no se puede deshacer.", "Limpiar Todo");
    if (confirmed) {
      this.history.push(this.stateManager.getState());
      this.stateManager.setState({
        tables: [],
        relationships: []
      });
      this.selectedTableId = null;
      this.uiManager.showToast("Todo limpiado.", "success");
    }
  }

  autoLayout() {
    const state = this.stateManager.getState();
    if (state.tables.length === 0) return;

    this.history.push(JSON.parse(JSON.stringify(state)));

    const groups = state.groups || [];
    
    // 1. Organize tables within each group
    groups.forEach(group => {
      const groupTables = state.tables.filter(t => t.groupId === group.id);
      if (groupTables.length === 0) return;

      const paddingLeft = 30;
      const paddingTop = 60; // leave room for group title
      const spacingX = 280;  // 240 width + 40 gap
      const spacingY = 160;  // approx height + gap
      
      const colCount = Math.ceil(Math.sqrt(groupTables.length));
      
      groupTables.forEach((table, index) => {
        const col = index % colCount;
        const row = Math.floor(index / colCount);
        table.x = group.x + paddingLeft + col * spacingX;
        table.y = group.y + paddingTop + row * spacingY;
      });

      // Expand the group size if there are more tables than fit
      const cols = colCount;
      const rows = Math.ceil(groupTables.length / cols);
      const minWidth = paddingLeft + cols * spacingX;
      const minHeight = paddingTop + rows * spacingY;

      if (group.width < minWidth) group.width = minWidth;
      if (group.height < minHeight) group.height = minHeight;
    });

    // 2. Globally organize groups first, then ungrouped tables
    let currentX = 100;
    let currentY = 100;
    let maxRowHeight = 0;

    // Arrange groups side-by-side
    groups.forEach(group => {
      const dx = currentX - group.x;
      const dy = currentY - group.y;

      group.x = currentX;
      group.y = currentY;

      // Shift all tables inside this group by the delta
      state.tables.filter(t => t.groupId === group.id).forEach(table => {
        table.x += dx;
        table.y += dy;
      });

      currentX += group.width + 100; // Spacing between groups
      maxRowHeight = Math.max(maxRowHeight, group.height);
    });

    // Arrange ungrouped tables below the groups row
    const ungroupedTables = state.tables.filter(t => !t.groupId);
    if (ungroupedTables.length > 0) {
      if (groups.length > 0) {
        currentX = 100;
        currentY += maxRowHeight + 150; // Spacing below groups
      }

      const colCount = Math.ceil(Math.sqrt(ungroupedTables.length));
      const spacingX = 280;
      const spacingY = 220;

      ungroupedTables.forEach((table, index) => {
        const col = index % colCount;
        const row = Math.floor(index / colCount);
        table.x = currentX + col * spacingX;
        table.y = currentY + row * spacingY;
      });
    }

    this.stateManager.notify();
    this.canvasManager.fitToContent(this.stateManager.getState().tables);
    this.uiManager.showToast("Tablas organizadas.", "success");
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

    const container = this.config.dom.canvasContainer;
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

  updateHistoryButtons() {
    const btnUndo = document.getElementById("btn-undo");
    const btnRedo = document.getElementById("btn-redo");
    
    const canUndo = this.history.canUndo;
    const canRedo = this.history.canRedo;

    if (btnUndo) {
      btnUndo.disabled = !canUndo;
      btnUndo.style.opacity = !canUndo ? "0.4" : "1";
      btnUndo.style.pointerEvents = !canUndo ? "none" : "auto";
    }
    if (btnRedo) {
      btnRedo.disabled = !canRedo;
      btnRedo.style.opacity = !canRedo ? "0.4" : "1";
      btnRedo.style.pointerEvents = !canRedo ? "none" : "auto";
    }
  }

  setupGlobalEventListeners() {
    // Logo / Volver a Dashboard
    const logoBack = document.getElementById("logo-back-to-dashboard");
    if (logoBack) {
      logoBack.addEventListener("click", () => {
        window.location.search = "";
      });
    }

    // Nueva Tabla
    const btnAddTable = document.getElementById("btn-add-table");
    if (btnAddTable) {
      btnAddTable.addEventListener("click", () => this.addTable());
    }

    // Nuevo Grupo
    const btnAddGroup = document.getElementById("btn-add-group");
    if (btnAddGroup) {
      btnAddGroup.addEventListener("click", () => this.addGroup());
    }

    // Limpiar Todo
    const btnClearAll = document.getElementById("btn-clear-all");
    if (btnClearAll) {
      btnClearAll.addEventListener("click", () => this.clearAll());
    }

    // Exportar Imagen
    const btnExportImage = document.getElementById("btn-export-image");
    if (btnExportImage) {
      btnExportImage.addEventListener("click", () => this.uiManager.openImageModal());
    }

    const btnCloseImageModal = document.getElementById("btn-close-image-modal");
    if (btnCloseImageModal) {
      btnCloseImageModal.addEventListener("click", () => this.uiManager.closeImageModal());
    }

    const btnDownloadImage = document.getElementById("btn-download-image");
    if (btnDownloadImage) {
      btnDownloadImage.addEventListener("click", async () => {
        const format = document.querySelector('input[name="image-format"]:checked').value;
        this.uiManager.showToast("Generando imagen...", "info");
        try {
          await ExportService.exportToImage(
            this.config.dom.erdCanvas,
            format,
            this.stateManager.getState(),
            this.canvasManager.getZoom(),
            (z) => {
              this.canvasManager.setZoom(z);
              this.refreshUI();
            }
          );
          this.uiManager.showToast("Imagen descargada.", "success");
        } catch (err) {
          console.error(err);
          this.uiManager.showToast("Error al exportar la imagen.", "error");
        }
        this.uiManager.closeImageModal();
      });
    }

    // Exportar SQL
    const btnExportSql = document.getElementById("btn-export-sql");
    if (btnExportSql) {
      btnExportSql.addEventListener("click", () => {
        const activeDialect = document.querySelector('input[name="sql-dialect"]:checked').value;
        const sqlCodeBlock = document.getElementById("sql-code-block");
        if (sqlCodeBlock) {
          sqlCodeBlock.textContent = ExportService.exportToSql(this.stateManager.getState(), activeDialect);
        }
        this.uiManager.openSqlModal();
      });
    }

    const btnCloseSqlModal = document.getElementById("btn-close-sql-modal");
    if (btnCloseSqlModal) {
      btnCloseSqlModal.addEventListener("click", () => this.uiManager.closeSqlModal());
    }

    // Dialect Change in SQL Modal
    document.querySelectorAll('input[name="sql-dialect"]').forEach(radio => {
      radio.addEventListener("change", (e) => {
        const sqlCodeBlock = document.getElementById("sql-code-block");
        if (sqlCodeBlock) {
          sqlCodeBlock.textContent = ExportService.exportToSql(this.stateManager.getState(), e.target.value);
        }
      });
    });

    // Copiar SQL
    const btnCopySql = document.getElementById("btn-copy-sql");
    if (btnCopySql) {
      btnCopySql.addEventListener("click", () => {
        const sqlCodeBlock = document.getElementById("sql-code-block");
        if (sqlCodeBlock) {
          navigator.clipboard.writeText(sqlCodeBlock.textContent)
            .then(() => this.uiManager.showToast("Código SQL copiado al portapapeles.", "success"))
            .catch(() => this.uiManager.showToast("Error al copiar código.", "error"));
        }
      });
    }

    // Guardar Proyecto (JSON)
    const btnSaveProject = document.getElementById("btn-save-project");
    if (btnSaveProject) {
      btnSaveProject.addEventListener("click", async () => {
        const defaultName = `proyecto_erd_${new Date().toLocaleDateString().replace(/\//g, "-")}`;
        const fileName = await this.uiManager.prompt("Ingresa el nombre para guardar el proyecto:", defaultName, "Guardar Proyecto");
        if (fileName && fileName.trim()) {
          const cleanName = fileName.trim().replace(/[^a-z0-9_-]/gi, "_");
          const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.stateManager.getState(), null, 2));
          ExportService._downloadFile(dataStr, `${cleanName}.json`);
          this.uiManager.showToast(`Proyecto "${cleanName}.json" guardado.`, "success");
        }
      });
    }

    // Exportar JSON
    const btnExportJson = document.getElementById("btn-export-json");
    if (btnExportJson) {
      btnExportJson.addEventListener("click", () => {
        ExportService.exportToJson(this.stateManager.getState());
        this.uiManager.showToast("Archivo JSON descargado.", "success");
      });
    }

    // Cargar JSON
    const btnImportJsonTrigger = document.getElementById("btn-import-json-trigger");
    const inputImportJson = document.getElementById("input-import-json");
    if (btnImportJsonTrigger && inputImportJson) {
      btnImportJsonTrigger.addEventListener("click", () => inputImportJson.click());
      
      inputImportJson.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            try {
              const importedState = JSON.parse(event.target.result);
              if (importedState.tables && Array.isArray(importedState.tables)) {
                this.history.push(this.stateManager.getState());
                this.stateManager.setState({
                  tables: importedState.tables,
                  relationships: importedState.relationships || [],
                  groups: importedState.groups || []
                });
                this.uiManager.showToast("Proyecto importado correctamente.", "success");
              } else {
                this.uiManager.showToast("Formato de archivo inválido.", "error");
              }
            } catch (err) {
              console.error("Error importing JSON:", err);
              this.uiManager.showToast("Error al importar el archivo.", "error");
            }
          };
          reader.readAsText(file);
          e.target.value = '';
        }
      });
    }

    // Importar SQL Modal
    const btnImportSqlModalTrigger = document.getElementById("btn-import-sql-modal-trigger");
    const importSqlModal = document.getElementById("import-sql-modal");
    const btnCloseImportSqlModal = document.getElementById("btn-close-import-sql-modal");
    const btnExecuteImportSql = document.getElementById("btn-execute-import-sql");
    const importSqlTextarea = document.getElementById("import-sql-textarea");

    if (btnImportSqlModalTrigger) {
      btnImportSqlModalTrigger.addEventListener("click", () => this.uiManager.openImportSqlModal(importSqlModal));
    }

    if (btnCloseImportSqlModal) {
      btnCloseImportSqlModal.addEventListener("click", () => this.uiManager.closeImportSqlModal(importSqlModal));
    }

    if (btnExecuteImportSql && importSqlTextarea) {
      btnExecuteImportSql.addEventListener("click", () => {
        const sqlCode = importSqlTextarea.value.trim();
        if (!sqlCode) {
          this.uiManager.showToast("El código SQL está vacío.", "error");
          return;
        }

        try {
          const parsedState = ImportService.parseSql(sqlCode);
          if (parsedState.tables.length > 0) {
            this.history.push(this.stateManager.getState());
            
            // Append or overwrite? Usually import appends or user should clear first
            // Let's append to existing state so it's additive
            const currentState = this.stateManager.getState();
            const newTables = [...currentState.tables, ...parsedState.tables];
            const newRelationships = [...currentState.relationships, ...parsedState.relationships];
            
            this.stateManager.setState({ tables: newTables, relationships: newRelationships });
            this.autoLayout();
            this.uiManager.showToast(`Importadas ${parsedState.tables.length} tablas.`, "success");
            
            importSqlTextarea.value = "";
            this.uiManager.closeImportSqlModal(importSqlModal);
          } else {
            this.uiManager.showToast("No se encontraron tablas válidas en el SQL.", "error");
          }
        } catch (err) {
          console.error("Error parsing SQL:", err);
          this.uiManager.showToast("Error al parsear el SQL.", "error");
        }
      });
    }

    // Renombrar Proyecto (Inline Editing)
    const btnRenameProject = document.getElementById("btn-rename-project");
    const projectTitle = document.getElementById("project-title");
    if (btnRenameProject && projectTitle) {
      const saveTitle = () => {
        projectTitle.contentEditable = "false";
        projectTitle.style.borderBottom = "none";
        projectTitle.style.backgroundColor = "transparent";
        projectTitle.style.padding = "0";
        const newName = projectTitle.textContent.trim();
        if (!newName) {
           projectTitle.textContent = "Mi Diagrama Local";
        }
        this.uiManager.showToast("Nombre del proyecto actualizado.", "success");
      };

      btnRenameProject.addEventListener("click", () => {
        projectTitle.contentEditable = "true";
        projectTitle.style.borderBottom = "2px solid var(--color-primary)";
        projectTitle.style.backgroundColor = "rgba(0,0,0,0.2)";
        projectTitle.style.padding = "2px 8px";
        projectTitle.style.borderRadius = "4px";
        projectTitle.style.outline = "none";
        projectTitle.focus();
        
        // Select all text
        const range = document.createRange();
        range.selectNodeContents(projectTitle);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });

      projectTitle.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          saveTitle();
        } else if (e.key === "Escape") {
          e.preventDefault();
          saveTitle();
        }
      });

      projectTitle.addEventListener("blur", () => {
        if (projectTitle.contentEditable === "true") {
          saveTitle();
        }
      });
    }

    // Copiar link de compartir (Con Fallback)
    const btnCopyShare = document.getElementById("btn-copy-share");
    const shareLinkInput = document.getElementById("share-link-input");
    if (btnCopyShare && shareLinkInput) {
      btnCopyShare.addEventListener("click", () => {
        if (!shareLinkInput.value) return;

        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(shareLinkInput.value)
            .then(() => this.uiManager.showToast("Enlace de compartir copiado.", "success"))
            .catch(() => this.uiManager.showToast("Error al copiar enlace.", "error"));
        } else {
          // Fallback if clipboard API is blocked (e.g. non-HTTPS local network IP)
          shareLinkInput.select();
          shareLinkInput.setSelectionRange(0, 99999);
          try {
            document.execCommand("copy");
            this.uiManager.showToast("Enlace copiado.", "success");
          } catch (e) {
            this.uiManager.showToast("Presiona Ctrl+C para copiar el enlace seleccionado.", "info");
          }
        }
      });
    }

    // Zoom Controls
    const btnZoomIn = document.getElementById("btn-zoom-in");
    if (btnZoomIn) {
      btnZoomIn.addEventListener("click", () => {
        this.canvasManager.setZoom(this.canvasManager.getZoom() + 0.1);
        this.refreshUI();
      });
    }

    const btnZoomOut = document.getElementById("btn-zoom-out");
    if (btnZoomOut) {
      btnZoomOut.addEventListener("click", () => {
        this.canvasManager.setZoom(this.canvasManager.getZoom() - 0.1);
        this.refreshUI();
      });
    }

    const btnZoomFit = document.getElementById("btn-zoom-fit");
    if (btnZoomFit) {
      btnZoomFit.addEventListener("click", () => {
        this.canvasManager.fitToContent(this.stateManager.getState().tables);
        this.refreshUI();
        this.uiManager.showToast("Ajustado al lienzo", "info");
      });
    }

    const btnAutoLayout = document.getElementById("btn-auto-layout");
    if (btnAutoLayout) {
      btnAutoLayout.addEventListener("click", () => this.autoLayout());
    }

    // Undo / Redo buttons
    const btnUndo = document.getElementById("btn-undo");
    if (btnUndo) {
      btnUndo.addEventListener("click", () => this.undo());
    }

    const btnRedo = document.getElementById("btn-redo");
    if (btnRedo) {
      btnRedo.addEventListener("click", () => this.redo());
    }

    // Search Toggle and filter
    const btnSearchToggle = document.getElementById("btn-search-toggle");
    const searchContainer = document.getElementById("search-container");
    const searchInput = document.getElementById("search-tables-input");
    const btnClearSearch = document.getElementById("btn-clear-search");

    if (btnSearchToggle && searchContainer) {
      btnSearchToggle.addEventListener("click", () => this.uiManager.toggleSearch(searchContainer));
    }

    if (btnClearSearch && searchContainer && searchInput) {
      btnClearSearch.addEventListener("click", () => {
        searchInput.value = "";
        searchContainer.classList.add("hidden");
        document.querySelectorAll(".erd-table").forEach(t => t.classList.remove("highlight-pulse"));
      });
    }

    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        const q = e.target.value.trim().toLowerCase();
        if (!q) return;

        const state = this.stateManager.getState();
        const matched = state.tables.find(t => t.name.toLowerCase().includes(q));
        if (matched) {
          this.selectTable(matched.id);
          this.scrollToTable(matched.id);
          
          const el = document.querySelector(`.erd-table[data-id="${matched.id}"]`);
          if (el) {
            el.classList.remove("highlight-pulse");
            void el.offsetWidth; // Trigger reflow
            el.classList.add("highlight-pulse");
          }
        }
      });
    }

    // Escape Key Handler for Cancelling connections & closing modals
    window.addEventListener("keydown", (e) => {
    });
  }

  // --- Dashboard and Collaborative Presence Methods ---
  async initDashboard() {
    const dashboardEl = document.getElementById("project-dashboard");
    if (dashboardEl) dashboardEl.classList.remove("hidden");
    const appContainerEl = document.querySelector(".app-container");
    if (appContainerEl) appContainerEl.classList.add("hidden");

    const btnNewProject = document.getElementById("btn-dashboard-new-project");
    if (btnNewProject) {
      btnNewProject.replaceWith(btnNewProject.cloneNode(true));
      document.getElementById("btn-dashboard-new-project").addEventListener("click", () => this.createNewProject());
    }

    this.loadProjectsList();
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  async loadProjectsList() {
    const grid = document.getElementById("projects-grid");
    if (!grid) return;
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--color-text-muted); padding: 40px;">Cargando proyectos...</div>`;

    try {
      const response = await fetch("/api/projects");
      const projects = await response.json();

      if (projects.length === 0) {
        grid.innerHTML = `
          <div style="grid-column: 1/-1; text-align: center; color: var(--color-text-muted); padding: 60px; border: 1.5px dashed var(--color-border); border-radius: 12px; display: flex; flex-direction: column; align-items: center; gap: 15px;">
            <i data-lucide="folder-open" style="width: 48px; height: 48px; color: var(--color-text-muted);"></i>
            <div>
              <h3 style="color: var(--color-text-main); margin-bottom: 5px;">No hay proyectos creados</h3>
              <p style="font-size: 0.9rem;">Crea tu primer proyecto colaborativo usando el botón de arriba.</p>
            </div>
          </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
      }

      grid.innerHTML = "";
      projects.forEach(project => {
        const card = document.createElement("div");
        card.className = "project-card";
        card.innerHTML = `
          <div class="project-card-info">
            <h3>${project.name}</h3>
            <div class="project-card-stats">
              <span><i data-lucide="database"></i> ${project.tableCount} tablas</span>
              <span><i data-lucide="git-merge"></i> ${project.relationshipCount} rel.</span>
            </div>
          </div>
          <div class="project-card-footer">
            <span class="project-card-date">Modificado: ${new Date(project.lastModified).toLocaleDateString()}</span>
            <button class="project-card-delete" title="Eliminar proyecto">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        `;

        card.addEventListener("click", (e) => {
          if (e.target.closest(".project-card-delete")) return;
          window.location.search = `?project=${encodeURIComponent(project.name)}`;
        });

        const btnDelete = card.querySelector(".project-card-delete");
        btnDelete.addEventListener("click", async (e) => {
          e.stopPropagation();
          const confirmed = await this.uiManager.confirm(`¿Estás seguro de que deseas eliminar el proyecto "${project.name}"? Esta acción borrará permanentemente todos sus archivos.`, "Eliminar Proyecto");
          if (confirmed) {
            try {
              const res = await fetch(`/api/delete-project?project=${encodeURIComponent(project.name)}`, { method: "POST" });
              const result = await res.json();
              if (result.success) {
                this.uiManager.showToast(`Proyecto "${project.name}" eliminado.`, "success");
                this.loadProjectsList();
              } else {
                this.uiManager.showToast("Error al eliminar el proyecto.", "error");
              }
            } catch (err) {
              console.error(err);
              this.uiManager.showToast("Error al conectar con el servidor.", "error");
            }
          }
        });

        grid.appendChild(card);
      });

      if (window.lucide) {
        window.lucide.createIcons();
      }
    } catch (err) {
      console.error(err);
      grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--color-danger); padding: 40px;">Error al conectar con el servidor.</div>`;
    }
  }

  async createNewProject() {
    const name = await this.uiManager.prompt("Nombre del nuevo proyecto:", "", "Nuevo Proyecto");
    if (name && name.trim()) {
      const cleanName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      window.location.search = `?project=${encodeURIComponent(cleanName)}`;
    }
  }

  setupUserIdentity() {
    return new Promise((resolve) => {
      const savedProfile = localStorage.getItem("erd_user_profile");
      if (savedProfile) {
        try {
          this.myUser = JSON.parse(savedProfile);
          if (!this.myUser.userId) {
            this.myUser.userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            localStorage.setItem("erd_user_profile", JSON.stringify(this.myUser));
          }
          if (this.webSocket.isConnected) {
            this.webSocket.send({ type: 'join', payload: this.myUser });
          }
          resolve();
          return;
        } catch (e) {
          localStorage.removeItem("erd_user_profile");
        }
      }

      const modal = document.getElementById("user-identity-modal");
      if (!modal) {
        const name = prompt("Escribe tu nombre:") || `Usuario_${Math.floor(Math.random() * 1000)}`;
        this.myUser = {
          userId: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          username: name,
          color: "#6366f1"
        };
        localStorage.setItem("erd_user_profile", JSON.stringify(this.myUser));
        resolve();
        return;
      }

      const colorDots = modal.querySelectorAll(".color-dot");
      let selectedColor = "#6366f1";
      colorDots.forEach(dot => {
        dot.addEventListener("click", () => {
          colorDots.forEach(d => d.classList.remove("selected"));
          dot.classList.add("selected");
          selectedColor = dot.dataset.color;
        });
      });

      const btnSave = document.getElementById("btn-save-user-identity");
      const nameInput = document.getElementById("user-name-input");

      const handleSave = () => {
        const username = nameInput.value.trim();
        if (!username) {
          this.uiManager.showToast("El nombre de usuario no puede estar vacío.", "error");
          return;
        }

        this.myUser = {
          userId: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          username: username,
          color: selectedColor
        };
        localStorage.setItem("erd_user_profile", JSON.stringify(this.myUser));
        modal.classList.add("hidden");

        if (this.webSocket.isConnected) {
          this.webSocket.send({ type: 'join', payload: this.myUser });
        }

        resolve();
      };

      btnSave.replaceWith(btnSave.cloneNode(true));
      document.getElementById("btn-save-user-identity").addEventListener("click", handleSave);
      
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleSave();
      });

      modal.classList.remove("hidden");
      nameInput.focus();
    });
  }

  updateActiveUsersList(users) {
    const listContainer = document.getElementById("active-users-list");
    if (!listContainer) return;

    if (!users || users.length <= 1) {
      listContainer.innerHTML = "";
      listContainer.classList.add("hidden");
      
      const cursorsContainer = document.getElementById("erd-cursors-container");
      if (cursorsContainer) cursorsContainer.innerHTML = "";
      return;
    }

    listContainer.classList.remove("hidden");
    listContainer.innerHTML = "";

    users.forEach(user => {
      const isMe = user.userId === this.myUser?.userId;
      const avatar = document.createElement("div");
      avatar.className = "user-avatar";
      avatar.style.backgroundColor = user.color;
      avatar.title = `${user.username}${isMe ? " (Tú) - Haz clic para editar" : ""}`;
      avatar.textContent = user.username.charAt(0).toUpperCase();

      if (isMe) {
        avatar.style.boxShadow = "0 0 0 2px var(--color-text-main)";
        avatar.addEventListener("click", () => this.editMyProfile());
      }

      listContainer.appendChild(avatar);
    });

    const activeIds = users.map(u => u.userId);
    const cursorEls = document.querySelectorAll(".user-cursor");
    cursorEls.forEach(el => {
      const userId = el.id.replace("cursor-", "");
      if (!activeIds.includes(userId)) {
        el.remove();
      }
    });
  }

  async editMyProfile() {
    const modal = document.getElementById("user-identity-modal");
    if (!modal) return;

    const nameInput = document.getElementById("user-name-input");
    nameInput.value = this.myUser?.username || "";

    const colorDots = modal.querySelectorAll(".color-dot");
    colorDots.forEach(d => {
      d.classList.remove("selected");
      if (d.dataset.color === this.myUser?.color) {
        d.classList.add("selected");
      }
    });

    let selectedColor = this.myUser?.color || "#6366f1";
    colorDots.forEach(dot => {
      dot.replaceWith(dot.cloneNode(true));
    });

    const newDots = modal.querySelectorAll(".color-dot");
    newDots.forEach(dot => {
      dot.addEventListener("click", () => {
        newDots.forEach(d => d.classList.remove("selected"));
        dot.classList.add("selected");
        selectedColor = dot.dataset.color;
      });
    });

    const btnSave = document.getElementById("btn-save-user-identity");
    btnSave.textContent = "Guardar Cambios";

    const handleSave = () => {
      const username = nameInput.value.trim();
      if (!username) {
        this.uiManager.showToast("El nombre de usuario no puede estar vacío.", "error");
        return;
      }

      this.myUser.username = username;
      this.myUser.color = selectedColor;
      localStorage.setItem("erd_user_profile", JSON.stringify(this.myUser));
      modal.classList.add("hidden");

      if (this.webSocket.isConnected) {
        this.webSocket.send({ type: 'join', payload: this.myUser });
      }
      this.uiManager.showToast("Perfil de usuario actualizado.", "success");
    };

    btnSave.replaceWith(btnSave.cloneNode(true));
    const newBtnSave = document.getElementById("btn-save-user-identity");
    newBtnSave.addEventListener("click", handleSave);

    modal.classList.remove("hidden");
    nameInput.focus();
  }

  updateCollaboratorCursor(payload) {
    const cursorsContainer = document.getElementById("erd-cursors-container");
    if (!cursorsContainer) return;

    if (payload.userId === this.myUser?.userId) return;

    let cursorEl = document.getElementById(`cursor-${payload.userId}`);
    if (!cursorEl) {
      cursorEl = document.createElement("div");
      cursorEl.className = "user-cursor";
      cursorEl.id = `cursor-${payload.userId}`;
      cursorEl.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="var(--user-color)" stroke="white" stroke-width="1.5">
          <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.87-4.87a.5.5 0 0 1 .35-.15h6.81c.45 0 .67-.54.35-.85L6.35 2.86a.5.5 0 0 0-.85.35Z"/>
        </svg>
        <div class="user-cursor-label"></div>
      `;
      cursorsContainer.appendChild(cursorEl);
    }

    cursorEl.style.setProperty("--user-color", payload.color);
    cursorEl.style.left = `${payload.x}px`;
    cursorEl.style.top = `${payload.y}px`;
    
    const label = cursorEl.querySelector(".user-cursor-label");
    if (label) label.textContent = payload.username;
  }
}
