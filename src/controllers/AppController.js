// src/controllers/AppController.js
import { StateManager } from '../core/StateManager.js';
import { HistoryManager } from '../core/HistoryManager.js';
import { StorageService } from '../services/StorageService.js';
import { WebSocketService } from '../services/WebSocketService.js';
import { ExportService } from '../services/ExportService.js';
import { ImportService } from '../services/ImportService.js';
import { AiService } from '../services/AiService.js';
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
      onFieldMove: (sourceTableId, fieldId, targetTableId, targetIndex) => this.moveField(sourceTableId, fieldId, targetTableId, targetIndex),
      onFieldCopy: (sourceTableId, fieldId, targetTableId, targetIndex) => this.copyField(sourceTableId, fieldId, targetTableId, targetIndex),
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
    this.pendingProjectName = null;
  }

  async init() {
    const urlParams = new URLSearchParams(window.location.search);
    const nameParam = urlParams.get('name');
    if (nameParam) {
      this.pendingProjectName = nameParam.trim();
    }

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

    // Check if there is a name param in URL for new local project initialization (fallback if offline)
    if (this.pendingProjectName) {
      const state = this.stateManager.getState();
      if (!state.name || state.name === 'Mi Diagrama Local') {
        state.name = this.pendingProjectName;
        this.stateManager.setState(state, false);
      }
      // Clean URL parameters without reloading
      const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + `?project=${this.projectId}`;
      window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
    }

    // Initial Render & Setup
    this.refreshUI();
    this.interactionController.init();
    this.setupGlobalEventListeners();
    this.setupSidebarResizer();
    
    // Si hay tablas, centrar vista en el contenido; si no, centrar canvas vacío
    setTimeout(() => {
      const initTables = this.stateManager.getState().tables;
      if (initTables && initTables.length > 0) {
        this.canvasManager.fitToContent(initTables);
      } else {
        this.canvasManager.centerCanvas();
      }
    }, 100);
    this.setupAiModal();
    this.setupQueryManager();
  }

  setupSidebarResizer() {
    const sidebar = document.querySelector(".sidebar");
    const resizer = document.querySelector(".sidebar-resizer");
    if (!sidebar || !resizer) return;

    // Load saved width
    const savedWidth = localStorage.getItem("erd-sidebar-width");
    if (savedWidth) {
      sidebar.style.width = `${savedWidth}px`;
    }

    let isResizing = false;

    resizer.addEventListener("mousedown", (e) => {
      isResizing = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      resizer.classList.add("resizing");
    });

    document.addEventListener("mousemove", (e) => {
      if (!isResizing) return;
      const newWidth = Math.max(300, Math.min(800, e.clientX));
      sidebar.style.width = `${newWidth}px`;
    });

    document.addEventListener("mouseup", () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        resizer.classList.remove("resizing");
        localStorage.setItem("erd-sidebar-width", parseInt(sidebar.style.width, 10));
      }
    });
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
          let state = data.payload.state;
          const nameParam = this.pendingProjectName;
          if (nameParam && (!state.name || state.name === 'Mi Diagrama Local')) {
            state.name = nameParam;
            this.pendingProjectName = null; // Consume it
            // Clean up the URL to remove the name param so it looks nice and doesn't override future renames on refresh
            const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + `?project=${this.projectId}`;
            window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
            this.stateManager.setState(state, false);
          } else {
            this.stateManager.setState(state, true);
          }
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
    
    const projectTitle = document.getElementById("project-title");
    if (projectTitle && projectTitle.contentEditable !== "true") {
      projectTitle.textContent = state.name || "Mi Diagrama Local";
    }
    
    this.updateHistoryButtons();
    this.renderQueriesList();
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

  /**
   * Centra todo el contenido (tablas y grupos) en el canvas 3000x3000.
   * Calcula el bounding box y aplica un offset para que el centro del contenido
   * coincida con el centro del canvas.
   */
  centerContentOnCanvas(tables, groups) {
    const CANVAS_SIZE = 3000;
    const CANVAS_CENTER = CANVAS_SIZE / 2;
    const PADDING = 100;

    // Calcular bounding box de todo el contenido
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

    if (!isFinite(minX)) return; // Sin contenido

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const contentCenterX = minX + contentWidth / 2;
    const contentCenterY = minY + contentHeight / 2;

    const dx = CANVAS_CENTER - contentCenterX;
    const dy = CANVAS_CENTER - contentCenterY;

    // Verificar que no se salga del canvas
    const finalMinX = minX + dx;
    const finalMinY = minY + dy;
    const finalMaxX = maxX + dx;
    const finalMaxY = maxY + dy;

    // Ajustar si se desborda
    let adjustX = 0, adjustY = 0;
    if (finalMinX < PADDING) adjustX = PADDING - finalMinX;
    if (finalMinY < PADDING) adjustY = PADDING - finalMinY;
    if (finalMaxX > CANVAS_SIZE - PADDING) adjustX = (CANVAS_SIZE - PADDING) - finalMaxX;
    if (finalMaxY > CANVAS_SIZE - PADDING) adjustY = (CANVAS_SIZE - PADDING) - finalMaxY;

    const totalDx = dx + adjustX;
    const totalDy = dy + adjustY;

    if (Math.abs(totalDx) < 1 && Math.abs(totalDy) < 1) return; // Ya centrado

    tables.forEach(table => {
      table.x += totalDx;
      table.y += totalDy;
    });

    if (groups && groups.length > 0) {
      groups.forEach(group => {
        group.x += totalDx;
        group.y += totalDy;
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

    // 1. Organizar tablas dentro de cada grupo
    groups.forEach(group => {
      const groupTables = state.tables.filter(t => t.groupId === group.id);
      if (groupTables.length === 0) {
        group.width = group.width || 300;
        group.height = group.height || 200;
        return;
      }

      const paddingLeft = 40;
      const paddingTop = 75; // Espacio extra para el título del grupo
      const paddingRight = 40;
      const paddingBottom = 40;
      const gapX = 80;
      const gapY = 80;
      const tableWidth = 240;
      
      const colCount = Math.ceil(Math.sqrt(groupTables.length));
      const rowCount = Math.ceil(groupTables.length / colCount);

      // Calcular la altura máxima de cada fila
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

      // Expandir el tamaño del grupo si contiene más tablas de las que caben
      const totalWidth = paddingLeft + colCount * tableWidth + (colCount - 1) * gapX + paddingRight;
      const totalHeight = paddingTop + rowHeights.reduce((sum, h) => sum + h, 0) + (rowCount - 1) * gapY + paddingBottom;

      group.width = Math.max(group.width || 0, totalWidth);
      group.height = Math.max(group.height || 0, totalHeight);
    });

    // 2. Organizar grupos en una cuadrícula (grid) para evitar que se pongan uno sobre otro
    let startX = 100;
    let startY = 100;
    let maxGroupsAreaHeight = 0;
    let maxGroupsAreaWidth = 0;

    if (groups.length > 0) {
      const groupsColCount = Math.ceil(Math.sqrt(groups.length));
      const groupsRowCount = Math.ceil(groups.length / groupsColCount);
      const gapGroupsX = 150;
      const gapGroupsY = 150;

      // Calcular anchos máximos de columna de grupos y alturas máximas de fila de grupos
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

      // Reposicionar grupos y trasladar sus tablas correspondientes
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

        // Desplazar tablas dentro de este grupo por la misma diferencia
        state.tables.filter(t => t.groupId === group.id).forEach(table => {
          table.x += dx;
          table.y += dy;
        });
      });

      // Calcular las dimensiones totales ocupadas por los grupos
      maxGroupsAreaWidth = colWidths.reduce((sum, w) => sum + w, 0) + (groupsColCount - 1) * gapGroupsX;
      maxGroupsAreaHeight = rowHeights.reduce((sum, h) => sum + h, 0) + (groupsRowCount - 1) * gapGroupsY;
    }

    // 3. Organizar tablas sin grupo (o con el groupId inválido) debajo del área de grupos
    const ungroupedTables = state.tables.filter(t => !t.groupId || !groupIds.has(t.groupId));
    if (ungroupedTables.length > 0) {
      let currentX = 100;
      let currentY = 100;

      if (groups.length > 0) {
        currentX = 100;
        currentY = startY + maxGroupsAreaHeight + 200; // Colocar con margen generoso debajo del bloque de grupos
      }

      const colCount = Math.ceil(Math.sqrt(ungroupedTables.length));
      const rowCount = Math.ceil(ungroupedTables.length / colCount);

      const gapX = 100;
      const gapY = 100;
      const tableWidth = 240;

      // Calcular alturas de fila para las tablas sin grupo
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

    // 4. Centrar todo el contenido en el canvas
    this.centerContentOnCanvas(state.tables, state.groups);

    this.stateManager.notify();
    this.canvasManager.fitToContent(this.stateManager.getState().tables);
    this.uiManager.showToast("Tablas organizadas con éxito.", "success");
  }

  async autoLayoutWithAi() {
    const state = this.stateManager.getState();
    if (state.tables.length === 0) {
      this.uiManager.showToast("No hay tablas para organizar.", "error");
      return;
    }

    const config = AiService.loadConfig();
    const requiresApiKey = ['gemini', 'openai'].includes(config.provider);
    if (requiresApiKey && !config.apiKey) {
      this.uiManager.showToast("Configura primero tu clave API en el Asistente (Configuración IA).", "error");
      return;
    }

    const btnAutoLayout = document.getElementById("btn-auto-layout");
    const originalHtml = btnAutoLayout ? btnAutoLayout.innerHTML : "";
    if (btnAutoLayout) {
      btnAutoLayout.disabled = true;
      btnAutoLayout.innerHTML = `<span class="spinner-loader"></span>`;
    }

    this.uiManager.showToast("Organizando lienzo con IA...", "info");

    try {
      const layoutPrompt = "Organiza las posiciones de las tablas y grupos del diagrama actual de manera lógica, limpia y balanceada. Agrupa físicamente las tablas que tengan relaciones entre sí. Conserva los campos, nombres y relaciones existentes, y solo ajusta las posiciones (x, y) de las tablas y de los grupos, y las dimensiones (width, height) de los grupos.";
      
      const result = await AiService.generate(layoutPrompt, state, 'layout');

      if (!result || !result.tables || !Array.isArray(result.tables)) {
        throw new Error("El formato del resultado devuelto por la IA es inválido.");
      }

      // Mezclar ÚNICAMENTE coordenadas y pertenencia a grupos (groupId)
      const updatedTables = state.tables.map(origTable => {
        const aiTable = result.tables.find(t => t.id === origTable.id) || 
                         result.tables.find(t => t.name.toLowerCase() === origTable.name.toLowerCase());
        if (aiTable) {
          return { 
            ...origTable, 
            x: aiTable.x !== undefined ? aiTable.x : origTable.x, 
            y: aiTable.y !== undefined ? aiTable.y : origTable.y,
            groupId: aiTable.groupId !== undefined ? aiTable.groupId : origTable.groupId
          };
        }
        return origTable;
      });

      // Mezclar grupos (actualizar posiciones de los existentes, e incorporar nuevos si los sugiere la IA)
      const updatedGroups = [...(state.groups || [])];
      if (result.groups && Array.isArray(result.groups)) {
        result.groups.forEach(aiGroup => {
          const existingGroup = updatedGroups.find(g => g.id === aiGroup.id || g.name.toLowerCase() === aiGroup.name.toLowerCase());
          if (existingGroup) {
            existingGroup.x = aiGroup.x !== undefined ? aiGroup.x : existingGroup.x;
            existingGroup.y = aiGroup.y !== undefined ? aiGroup.y : existingGroup.y;
            existingGroup.width = aiGroup.width !== undefined ? aiGroup.width : existingGroup.width;
            existingGroup.height = aiGroup.height !== undefined ? aiGroup.height : existingGroup.height;
          } else {
            updatedGroups.push({
              id: aiGroup.id || `group-ai-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              name: aiGroup.name,
              color: aiGroup.color || "#374151",
              x: aiGroup.x !== undefined ? aiGroup.x : 1500,
              y: aiGroup.y !== undefined ? aiGroup.y : 1500,
              width: aiGroup.width !== undefined ? aiGroup.width : 300,
              height: aiGroup.height !== undefined ? aiGroup.height : 200
            });
          }
        });
      }

      this.history.push(JSON.parse(JSON.stringify(state)));

      this.stateManager.setState({
        ...state,
        tables: updatedTables,
        groups: updatedGroups
      });

      this.canvasManager.fitToContent(updatedTables);
      this.uiManager.showToast("Organizado con IA con éxito.", "success");
    } catch (err) {
      console.error("Error al organizar con IA:", err);
      this.uiManager.showToast("La ordenación por IA falló: " + err.message, "error");
    } finally {
      if (btnAutoLayout) {
        btnAutoLayout.disabled = false;
        btnAutoLayout.innerHTML = originalHtml;
      }
    }
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

  async copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        console.warn("Failed to copy with navigator.clipboard: ", e);
      }
    }

    // Fallback for non-HTTPS or other blocked clipboard API situations
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);
      return !!successful;
    } catch (err) {
      document.body.removeChild(textArea);
      console.error("Fallback copy failed: ", err);
      return false;
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

    // Generar Documentación Markdown con IA
    const btnExportMarkdownAi = document.getElementById("btn-export-markdown-ai");
    const markdownModal = document.getElementById("markdown-modal");
    const btnCloseMarkdownModal = document.getElementById("btn-close-markdown-modal");
    const markdownTextArea = document.getElementById("markdown-text-area");
    const btnCopyMarkdown = document.getElementById("btn-copy-markdown");
    const btnDownloadMarkdown = document.getElementById("btn-download-markdown");

    if (btnExportMarkdownAi) {
      btnExportMarkdownAi.addEventListener("click", async () => {
        const state = this.stateManager.getState();
        if (state.tables.length === 0) {
          this.uiManager.showToast("El diagrama está vacío. Crea tablas antes de documentar.", "error");
          return;
        }

        // Cargar config y validar
        const config = AiService.loadConfig();
        const requiresApiKey = ['gemini', 'openai'].includes(config.provider);
        if (requiresApiKey && !config.apiKey) {
          this.uiManager.showToast("Configura primero tu clave de API de IA.", "error");
          const modalAi = document.getElementById("ai-modal");
          if (modalAi) {
            this.uiManager.openAiModal(modalAi);
            const tabConfig = document.getElementById("tab-ai-config");
            if (tabConfig) tabConfig.click();
          }
          return;
        }

        this.uiManager.showToast("Generando documentación con IA...", "info");
        btnExportMarkdownAi.disabled = true;
        const originalText = btnExportMarkdownAi.innerHTML;
        btnExportMarkdownAi.innerHTML = `<span class="spinner-loader"></span> Documentando...`;

        try {
          const markdownDoc = await AiService.document(state);
          if (markdownTextArea) {
            markdownTextArea.value = markdownDoc;
          }
          this.uiManager.openMarkdownModal(markdownModal);
          this.uiManager.showToast("Documentación generada correctamente.", "success");
        } catch (err) {
          console.error("Error al generar documentación:", err);
          this.uiManager.showToast(`Error: ${err.message}`, "error");
        } finally {
          btnExportMarkdownAi.disabled = false;
          btnExportMarkdownAi.innerHTML = originalText;
        }
      });
    }

    if (btnCloseMarkdownModal && markdownModal) {
      btnCloseMarkdownModal.addEventListener("click", () => {
        this.uiManager.closeMarkdownModal(markdownModal);
      });
    }

    if (btnCopyMarkdown && markdownTextArea) {
      btnCopyMarkdown.addEventListener("click", async () => {
        const success = await this.copyToClipboard(markdownTextArea.value);
        if (success) {
          this.uiManager.showToast("Documentación copiada al portapapeles.", "success");
        } else {
          this.uiManager.showToast("Error al copiar al portapapeles. Selecciónalo manualmente.", "error");
        }
      });
    }

    if (btnDownloadMarkdown && markdownTextArea) {
      btnDownloadMarkdown.addEventListener("click", () => {
        const name = this.stateManager.getState().name || this.projectId || 'db';
        const cleanName = name.trim().replace(/[^a-z0-9_-]/gi, "_");
        const defaultName = `documentacion_${cleanName}_${new Date().toISOString().split('T')[0]}.md`;
        const dataStr = "data:text/markdown;charset=utf-8," + encodeURIComponent(markdownTextArea.value);
        ExportService._downloadFile(dataStr, defaultName);
        this.uiManager.showToast("Archivo Markdown descargado.", "success");
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
      btnCopySql.addEventListener("click", async () => {
        const sqlCodeBlock = document.getElementById("sql-code-block");
        if (sqlCodeBlock) {
          const success = await this.copyToClipboard(sqlCodeBlock.textContent);
          if (success) {
            this.uiManager.showToast("Código SQL copiado al portapapeles.", "success");
          } else {
            this.uiManager.showToast("Error al copiar código. Selecciónalo manualmente.", "error");
          }
        }
      });
    }

    // Guardar Proyecto (JSON)
    const btnSaveProject = document.getElementById("btn-save-project");
    if (btnSaveProject) {
      btnSaveProject.addEventListener("click", async () => {
        const defaultName = this.stateManager.getState().name || `proyecto_erd_${new Date().toISOString().split('T')[0]}`;
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
           projectTitle.textContent = this.stateManager.getState().name || "Mi Diagrama Local";
           return;
        }
        
        const state = this.stateManager.getState();
        this.history.push(state);
        this.stateManager.setState({
          ...state,
          name: newName
        });
        
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
      btnCopyShare.addEventListener("click", async () => {
        if (!shareLinkInput.value) return;
        const success = await this.copyToClipboard(shareLinkInput.value);
        if (success) {
          this.uiManager.showToast("Enlace de compartir copiado.", "success");
        } else {
          this.uiManager.showToast("Presiona Ctrl+C para copiar el enlace seleccionado.", "info");
          shareLinkInput.select();
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
    const layoutDropdownMenu = document.getElementById("layout-dropdown-menu");
    const btnLayoutNormal = document.getElementById("btn-layout-normal");
    const btnLayoutAi = document.getElementById("btn-layout-ai");

    if (btnAutoLayout && layoutDropdownMenu) {
      btnAutoLayout.addEventListener("click", (e) => {
        e.stopPropagation();
        layoutDropdownMenu.classList.toggle("hidden");
      });

      document.addEventListener("click", (e) => {
        if (!layoutDropdownMenu.classList.contains("hidden") && !e.target.closest(".toolbar-dropdown-container")) {
          layoutDropdownMenu.classList.add("hidden");
        }
      });
    }

    if (btnLayoutNormal) {
      btnLayoutNormal.addEventListener("click", () => {
        if (layoutDropdownMenu) layoutDropdownMenu.classList.add("hidden");
        this.autoLayout();
      });
    }

    if (btnLayoutAi) {
      btnLayoutAi.addEventListener("click", () => {
        if (layoutDropdownMenu) layoutDropdownMenu.classList.add("hidden");
        this.autoLayoutWithAi();
      });
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

    // Global Key Listener for undo/redo shortcuts
    window.addEventListener("keydown", (e) => {
      const target = e.target;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const isZ = e.key.toLowerCase() === "z";
      const isY = e.key.toLowerCase() === "y";
      const hasModifier = e.ctrlKey || e.metaKey;

      if (hasModifier && isZ) {
        e.preventDefault();
        if (e.shiftKey) {
          this.redo();
        } else {
          this.undo();
        }
      } else if (hasModifier && isY) {
        e.preventDefault();
        this.redo();
      }
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
          window.open(`?project=${encodeURIComponent(project.id)}`, '_blank');
        });

        const btnDelete = card.querySelector(".project-card-delete");
        btnDelete.addEventListener("click", async (e) => {
          e.stopPropagation();
          const confirmed = await this.uiManager.confirm(`¿Estás seguro de que deseas eliminar el proyecto "${project.name}"? Esta acción borrará permanentemente todos sus archivos.`, "Eliminar Proyecto");
          if (confirmed) {
            try {
              const res = await fetch(`/api/delete-project?project=${encodeURIComponent(project.id)}`, { method: "POST" });
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
      const projectId = 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      window.open(`?project=${encodeURIComponent(projectId)}&name=${encodeURIComponent(name.trim())}`, '_blank');
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

  setupAiModal() {
    const modal = document.getElementById("ai-modal");
    const btnTrigger = document.getElementById("btn-ai-modal-trigger");
    const btnClose = document.getElementById("btn-close-ai-modal");
    
    if (!modal) return;

    // Tabs
    const tabAssistant = document.getElementById("tab-ai-assistant");
    const tabConfig = document.getElementById("tab-ai-config");
    const viewAssistant = document.getElementById("ai-assistant-view");
    const viewConfig = document.getElementById("ai-config-view");

    // Config Fields
    const selectProvider = document.getElementById("ai-provider");
    const inputModel = document.getElementById("ai-model");
    const inputApiKey = document.getElementById("ai-apikey");
    const inputApiUrl = document.getElementById("ai-apiurl");
    const btnSaveConfig = document.getElementById("btn-save-ai-config");

    // Assistant Fields
    const textareaPrompt = document.getElementById("ai-prompt");
    const btnGenerate = document.getElementById("btn-ai-generate");
    const statusLog = document.getElementById("ai-status-log");
    const selectMode = document.getElementById("ai-generation-mode");

    // Open/Close
    if (btnTrigger) {
      btnTrigger.addEventListener("click", () => {
        // Cargar config actual al abrir
        const config = AiService.loadConfig();
        if (selectProvider) selectProvider.value = config.provider;
        if (inputModel) inputModel.value = config.model;
        if (inputApiKey) inputApiKey.value = config.apiKey;
        if (inputApiUrl) inputApiUrl.value = config.apiUrl;

        // Mostrar/ocultar inputs según el proveedor
        toggleProviderFields(config.provider);

        // Resetear tab
        switchTab("assistant");

        this.uiManager.openAiModal(modal);
      });
    }

    if (btnClose) {
      btnClose.addEventListener("click", () => {
        this.uiManager.closeAiModal(modal);
      });
    }

    // Toggle provider fields helper
    function toggleProviderFields(provider) {
      const apiKeyGroup = document.getElementById("ai-apikey-group");
      const apiKeyLabel = apiKeyGroup ? apiKeyGroup.querySelector("label") : null;
      const apiKeyInput = document.getElementById("ai-apikey");
      
      const apiUrlGroup = document.getElementById("ai-apiurl-group");
      const apiUrlLabel = apiUrlGroup ? apiUrlGroup.querySelector("label") : null;
      const apiUrlInput = document.getElementById("ai-apiurl");

      if (provider === 'gemini' || provider === 'openai') {
        if (apiKeyGroup) apiKeyGroup.classList.remove("hidden");
        if (apiKeyLabel) apiKeyLabel.textContent = "API Key:";
        if (apiKeyInput) apiKeyInput.placeholder = "Ingresa tu clave de API...";
        if (apiUrlGroup) apiUrlGroup.classList.add("hidden");
      } else {
        // Local/Custom servers (Ollama, vLLM, LiteLLM, Custom OpenAI)
        if (apiKeyGroup) apiKeyGroup.classList.remove("hidden");
        if (apiKeyLabel) apiKeyLabel.textContent = "API Key / Token (Opcional):";
        if (apiKeyInput) apiKeyInput.placeholder = "Token de autorización (opcional)...";
        if (apiUrlGroup) apiUrlGroup.classList.remove("hidden");

        if (apiUrlLabel) {
          if (provider === 'ollama') {
            apiUrlLabel.textContent = "URL de Ollama:";
            if (apiUrlInput && (!apiUrlInput.value || apiUrlInput.value.includes('localhost:4000') || apiUrlInput.value.includes('localhost:8000') || apiUrlInput.value.includes('api.groq.com'))) {
              apiUrlInput.value = "http://localhost:11434";
            }
          } else if (provider === 'vllm') {
            apiUrlLabel.textContent = "URL de vLLM Server:";
            if (apiUrlInput && (!apiUrlInput.value || apiUrlInput.value.includes('localhost:11434') || apiUrlInput.value.includes('localhost:4000') || apiUrlInput.value.includes('api.groq.com'))) {
              apiUrlInput.value = "http://localhost:8000/v1";
            }
          } else if (provider === 'litellm') {
            apiUrlLabel.textContent = "URL de LiteLLM Proxy:";
            if (apiUrlInput && (!apiUrlInput.value || apiUrlInput.value.includes('localhost:11434') || apiUrlInput.value.includes('localhost:8000') || apiUrlInput.value.includes('api.groq.com'))) {
              apiUrlInput.value = "http://localhost:4000";
            }
          } else if (provider === 'custom-openai') {
            apiUrlLabel.textContent = "URL de Endpoint Compatible:";
            if (apiUrlInput && (apiUrlInput.value.includes('localhost:'))) {
              apiUrlInput.value = "";
              apiUrlInput.placeholder = "e.g., https://api.groq.com/openai/v1";
            }
          }
        }
      }
    }

    if (selectProvider) {
      selectProvider.addEventListener("change", (e) => {
        toggleProviderFields(e.target.value);
        // Sugerir modelos comunes al cambiar
        if (e.target.value === 'gemini') {
          inputModel.value = 'gemini-1.5-flash';
        } else if (e.target.value === 'openai') {
          inputModel.value = 'gpt-4o-mini';
        } else if (e.target.value === 'ollama') {
          inputModel.value = 'qwen2.5-coder';
        } else if (e.target.value === 'vllm') {
          inputModel.value = 'Qwen/Qwen2.5-Coder-7B-Instruct';
        } else if (e.target.value === 'litellm') {
          inputModel.value = 'qwen2.5-coder';
        } else if (e.target.value === 'custom-openai') {
          inputModel.value = '';
          inputModel.placeholder = "ej: llama-3.1-8b-instant";
        }
      });
    }

    // Tabs switching helper
    function switchTab(tab) {
      if (tab === "assistant") {
        if (tabAssistant) tabAssistant.classList.add("active");
        if (tabConfig) tabConfig.classList.remove("active");
        if (viewAssistant) viewAssistant.classList.remove("hidden");
        if (viewConfig) viewConfig.classList.add("hidden");
      } else {
        if (tabAssistant) tabAssistant.classList.remove("active");
        if (tabConfig) tabConfig.classList.add("active");
        if (viewAssistant) viewAssistant.classList.add("hidden");
        if (viewConfig) viewConfig.classList.remove("hidden");
      }
    }

    if (tabAssistant && tabConfig) {
      tabAssistant.addEventListener("click", () => switchTab("assistant"));
      tabConfig.addEventListener("click", () => switchTab("config"));
    }

    // Save Config
    if (btnSaveConfig) {
      btnSaveConfig.addEventListener("click", () => {
        const config = {
          provider: selectProvider.value,
          model: inputModel.value.trim(),
          apiKey: inputApiKey.value.trim(),
          apiUrl: inputApiUrl.value.trim()
        };

        const requiresApiKey = ['gemini', 'openai'].includes(config.provider);
        if (requiresApiKey && !config.apiKey) {
          this.uiManager.showToast("La clave API es requerida para este proveedor.", "error");
          return;
        }

        const requiresUrl = ['ollama', 'vllm', 'litellm', 'custom-openai'].includes(config.provider);
        if (requiresUrl && !config.apiUrl) {
          this.uiManager.showToast("La URL del servidor es requerida para este proveedor.", "error");
          return;
        }

        AiService.saveConfig(config);
        this.uiManager.showToast("Configuración de IA guardada.", "success");
        switchTab("assistant");
      });
    }

    // Chips de prompts rápidos
    document.querySelectorAll(".quick-prompt-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        textareaPrompt.value = chip.dataset.prompt;
        textareaPrompt.focus();
      });
    });

    // Acción principal: Generar
    if (btnGenerate) {
      btnGenerate.addEventListener("click", async () => {
        const prompt = textareaPrompt.value.trim();
        if (!prompt) {
          this.uiManager.showToast("Por favor describe lo que necesitas.", "error");
          return;
        }

        // Cargar config y validar
        const config = AiService.loadConfig();
        const requiresApiKey = ['gemini', 'openai'].includes(config.provider);
        if (requiresApiKey && !config.apiKey) {
          this.uiManager.showToast("Configura primero tu clave API en la pestaña de Configuración.", "error");
          switchTab("config");
          return;
        }

        // Bloquear UI y mostrar spinner
        btnGenerate.disabled = true;
        btnGenerate.innerHTML = `<span class="spinner-loader"></span> Generando...`;
        if (statusLog) {
          statusLog.className = "ai-status-log info";
          statusLog.innerHTML = `<i data-lucide="loader" class="animate-spin" style="width: 14px; height: 14px; margin-right: 6px;"></i> Conectando con ${config.provider}...`;
          if (window.lucide) window.lucide.createIcons();
        }

        try {
          const mode = selectMode ? selectMode.value : "replace";
          const currentState = this.stateManager.getState();
          
          // Realizar llamada al proxy (pasamos el estado actual si no es modo reemplazar, e incluimos el modo)
          const result = await AiService.generate(prompt, mode !== 'replace' ? currentState : null, mode);

          if (!result || !result.tables || !Array.isArray(result.tables)) {
            throw new Error("El JSON retornado por la IA no tiene el formato correcto o está vacío.");
          }

          // Guardar estado actual para deshacer
          this.history.push(JSON.parse(JSON.stringify(currentState)));

          if (mode === 'replace') {
            // Reemplazar todo el estado
            this.stateManager.setState({
              tables: result.tables,
              relationships: result.relationships || [],
              groups: result.groups || []
            });
            this.uiManager.showToast("Diagrama generado por IA con éxito.", "success");
          } else if (mode === 'edit') {
            // Modo editar inteligente (Modificar/Editar conservando IDs y posiciones)
            const currentTables = currentState.tables || [];
            const currentRelationships = currentState.relationships || [];
            const currentGroups = currentState.groups || [];

            const newTables = [];
            const tableIdMap = {};
            const fieldIdMap = {};
            const processedOriginalTableIds = new Set();

            result.tables.forEach(aiTable => {
              // Buscar tabla original coincidente por ID o por nombre (case-insensitive)
              const originalTable = currentTables.find(t => t.id === aiTable.id) || 
                                    currentTables.find(t => t.name.toLowerCase() === aiTable.name.toLowerCase());

              const finalTableId = originalTable ? originalTable.id : (aiTable.id || `tbl-ai-${Date.now()}-${Math.floor(Math.random() * 1000)}`);
              tableIdMap[aiTable.id] = finalTableId;
              if (originalTable) {
                processedOriginalTableIds.add(originalTable.id);
              }

              // Mezclar campos
              const finalFields = [];
              if (aiTable.fields && Array.isArray(aiTable.fields)) {
                aiTable.fields.forEach(aiField => {
                  let originalField = null;
                  if (originalTable && originalTable.fields) {
                    originalField = originalTable.fields.find(f => f.id === aiField.id) ||
                                    originalTable.fields.find(f => f.name.toLowerCase() === aiField.name.toLowerCase());
                  }

                  const finalFieldId = originalField ? originalField.id : (aiField.id || `f-ai-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
                  fieldIdMap[aiField.id] = finalFieldId;

                  finalFields.push({
                    id: finalFieldId,
                    name: aiField.name,
                    type: aiField.type,
                    isPK: !!aiField.isPK,
                    isAutoIncrement: !!aiField.isAutoIncrement,
                    isNotNull: !!aiField.isNotNull,
                    isUnique: !!aiField.isUnique,
                    defaultValue: aiField.defaultValue || ""
                  });
                });
              }

              // Construir la tabla combinada
              newTables.push({
                id: finalTableId,
                name: aiTable.name,
                // Preservar coordenadas originales si existen
                x: originalTable ? originalTable.x : (aiTable.x !== undefined ? aiTable.x : 1500),
                y: originalTable ? originalTable.y : (aiTable.y !== undefined ? aiTable.y : 1500),
                fields: finalFields,
                color: aiTable.color || (originalTable ? originalTable.color : "#6366f1"),
                groupId: aiTable.groupId || (originalTable ? originalTable.groupId : null)
              });
            });

            // Conservar tablas que no devolvió la IA, excepto si el prompt indica borrado explícito de tablas
            const isDeleteAction = /delete|remove|elimina|borra|quita/i.test(prompt);
            if (!isDeleteAction) {
              currentTables.forEach(origTable => {
                if (!processedOriginalTableIds.has(origTable.id)) {
                  newTables.push(origTable);
                  tableIdMap[origTable.id] = origTable.id;
                  if (origTable.fields) {
                    origTable.fields.forEach(f => {
                      fieldIdMap[f.id] = f.id;
                    });
                  }
                }
              });
            }

            // Mezclar grupos
            const newGroups = [];
            if (result.groups && Array.isArray(result.groups)) {
              result.groups.forEach(aiGroup => {
                const originalGroup = currentGroups.find(g => g.id === aiGroup.id) ||
                                      currentGroups.find(g => g.name.toLowerCase() === aiGroup.name.toLowerCase());
                
                const finalGroupId = originalGroup ? originalGroup.id : (aiGroup.id || `group-ai-${Date.now()}-${Math.floor(Math.random() * 1000)}`);
                
                // Actualizar tablas que referencian este grupo
                result.tables.forEach(t => {
                  if (t.groupId === aiGroup.id) {
                    t.groupId = finalGroupId;
                  }
                });

                newGroups.push({
                  id: finalGroupId,
                  name: aiGroup.name,
                  color: aiGroup.color || (originalGroup ? originalGroup.color : "#374151"),
                  x: originalGroup ? originalGroup.x : (aiGroup.x !== undefined ? aiGroup.x : 1500),
                  y: originalGroup ? originalGroup.y : (aiGroup.y !== undefined ? aiGroup.y : 1500),
                  width: originalGroup ? originalGroup.width : (aiGroup.width !== undefined ? aiGroup.width : 300),
                  height: originalGroup ? originalGroup.height : (aiGroup.height !== undefined ? aiGroup.height : 200)
                });
              });
            }

            // Agregar grupos que no fueron devueltos por la IA (si no es acción de borrado)
            if (!isDeleteAction) {
              currentGroups.forEach(origGroup => {
                if (!newGroups.some(ng => ng.id === origGroup.id)) {
                  newGroups.push(origGroup);
                }
              });
            }

            // Mezclar relaciones con los IDs finales mapeados
            const newRelationships = [];
            if (result.relationships && Array.isArray(result.relationships)) {
              result.relationships.forEach(rel => {
                const mappedFromTable = tableIdMap[rel.fromTable] || rel.fromTable;
                const mappedToTable = tableIdMap[rel.toTable] || rel.toTable;
                const mappedFromField = fieldIdMap[rel.fromField] || rel.fromField;
                const mappedToField = fieldIdMap[rel.toField] || rel.toField;

                const fromTableObj = newTables.find(t => t.id === mappedFromTable);
                const toTableObj = newTables.find(t => t.id === mappedToTable);

                if (fromTableObj && toTableObj) {
                  const fromFieldExists = fromTableObj.fields.some(f => f.id === mappedFromField);
                  const toFieldExists = toTableObj.fields.some(f => f.id === mappedToField);

                  if (fromFieldExists && toFieldExists) {
                    newRelationships.push({
                      id: rel.id || `rel-ai-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                      fromTable: mappedFromTable,
                      fromField: mappedFromField,
                      toTable: mappedToTable,
                      toField: mappedToField
                    });
                  }
                }
              });
            }

            // Conservar relaciones originales que no fueron redefinidas por la IA si ambas tablas aún existen
            currentRelationships.forEach(origRel => {
              const isRedefined = result.relationships && result.relationships.some(rel => {
                const mappedFromTable = tableIdMap[rel.fromTable] || rel.fromTable;
                const mappedToTable = tableIdMap[rel.toTable] || rel.toTable;
                return (mappedFromTable === origRel.fromTable && mappedToTable === origRel.toTable) ||
                       (mappedFromTable === origRel.toTable && mappedToTable === origRel.fromTable);
              });

              if (!isRedefined) {
                const fromExists = newTables.some(t => t.id === origRel.fromTable);
                const toExists = newTables.some(t => t.id === origRel.toTable);
                if (fromExists && toExists) {
                  newRelationships.push(origRel);
                }
              }
            });

            this.stateManager.setState({
              tables: newTables,
              relationships: newRelationships,
              groups: newGroups
            });
            this.uiManager.showToast("Diagrama modificado con IA con éxito.", "success");
          } else {
            // Combinar estados (modo append / Agregar tablas)
            const currentTables = [...currentState.tables];
            const currentRelationships = [...currentState.relationships];
            const currentGroups = [...(currentState.groups || [])];

            const tableIdMap = {};
            const fieldIdMap = {};

            result.tables.forEach(newTable => {
              const originalId = newTable.id;
              // Si ya existe una tabla con ese ID o ese nombre, generar nuevo ID
              const colisionId = currentTables.some(t => t.id === newTable.id);
              const colisionName = currentTables.some(t => t.name.toLowerCase() === newTable.name.toLowerCase());
              
              if (colisionId || colisionName) {
                newTable.id = `tbl-ai-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                if (colisionName) {
                  newTable.name = `${newTable.name}_ai`;
                }
              }
              tableIdMap[originalId] = newTable.id;

              // Mapear campos
              newTable.fields.forEach(field => {
                const origFieldId = field.id;
                field.id = `f-ai-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
                fieldIdMap[origFieldId] = field.id;
              });

              currentTables.push(newTable);
            });

            // Combinar grupos
            if (result.groups && Array.isArray(result.groups)) {
              result.groups.forEach(newGroup => {
                const originalGroupId = newGroup.id;
                newGroup.id = `group-ai-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                
                // Actualizar tablas asociadas a este grupo
                result.tables.forEach(t => {
                  if (t.groupId === originalGroupId) {
                    t.groupId = newGroup.id;
                  }
                });

                currentGroups.push(newGroup);
              });
            }

            // Combinar relaciones actualizando referencias a los nuevos IDs mapeados
            if (result.relationships && Array.isArray(result.relationships)) {
              result.relationships.forEach(rel => {
                const mappedFromTable = tableIdMap[rel.fromTable] || rel.fromTable;
                const mappedToTable = tableIdMap[rel.toTable] || rel.toTable;
                const mappedFromField = fieldIdMap[rel.fromField] || rel.fromField;
                const mappedToField = fieldIdMap[rel.toField] || rel.toField;

                // Agregar relación si ambas tablas existen en el lienzo
                const fromExists = currentTables.some(t => t.id === mappedFromTable);
                const toExists = currentTables.some(t => t.id === mappedToTable);

                if (fromExists && toExists) {
                  currentRelationships.push({
                    id: `rel-ai-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                    fromTable: mappedFromTable,
                    fromField: mappedFromField,
                    toTable: mappedToTable,
                    toField: mappedToField
                  });
                }
              });
            }

            this.stateManager.setState({
              tables: currentTables,
              relationships: currentRelationships,
              groups: currentGroups
            });
            this.uiManager.showToast(`IA agregó ${result.tables.length} tablas y ${result.relationships?.length || 0} relaciones.`, "success");
          }

          // Determinar si debemos ejecutar autoLayout (sólo si es replace o si el usuario pide explícitamente organizar)
          const promptLower = prompt.toLowerCase();
          const containsLayoutKeyword = promptLower.includes("organiza") || 
                                        promptLower.includes("acomoda") || 
                                        promptLower.includes("layout") || 
                                        promptLower.includes("alinea") || 
                                        promptLower.includes("distribuye") ||
                                        promptLower.includes("margin") || 
                                        promptLower.includes("margen") ||
                                        promptLower.includes("orden");

          if (mode === 'replace' || containsLayoutKeyword) {
            this.autoLayout();
          } else {
            // Solo notificar cambios y centrar
            this.stateManager.notify();
            this.canvasManager.fitToContent(this.stateManager.getState().tables);
          }

          // Cerrar modal
          textareaPrompt.value = "";
          if (statusLog) {
            statusLog.className = "ai-status-log hidden";
            statusLog.innerHTML = "";
          }
          this.uiManager.closeAiModal(modal);

        } catch (err) {
          console.error("Error al generar diagrama con IA:", err);
          if (statusLog) {
            statusLog.className = "ai-status-log error";
            statusLog.innerHTML = `<i data-lucide="alert-circle" style="width: 14px; height: 14px; margin-right: 6px;"></i> Error: ${err.message}`;
            if (window.lucide) window.lucide.createIcons();
          }
          this.uiManager.showToast("La generación falló. Verifica el log en el modal.", "error");
        } finally {
          btnGenerate.disabled = false;
          btnGenerate.innerHTML = `<i data-lucide="sparkles" style="width: 14px; height: 14px; margin-right: 6px;"></i> Generar Diagrama con IA`;
          if (window.lucide) window.lucide.createIcons();
        }
      });
    }
  }

  setupQueryManager() {
    this.activeQueryId = null;
    
    const btnTrigger = document.getElementById("btn-query-manager-trigger");
    const modal = document.getElementById("query-modal");
    const btnClose = document.getElementById("btn-close-query-modal");
    const btnNew = document.getElementById("btn-query-new");
    const btnSave = document.getElementById("btn-query-save");
    const btnDelete = document.getElementById("btn-query-delete");
    const btnCopy = document.getElementById("btn-query-copy");
    const btnTest = document.getElementById("btn-query-test");
    const btnAiGenerate = document.getElementById("btn-query-ai-generate");
    const btnAiSuggest = document.getElementById("btn-query-ai-suggest");
    const btnExplain = document.getElementById("btn-query-explain");
    const resultsPanel = document.getElementById("query-results-panel");
    const btnCloseResultsPanel = document.getElementById("btn-close-results-panel");
    const modalContent = modal ? modal.querySelector(".query-modal-content") : null;

    if (btnCloseResultsPanel) {
      btnCloseResultsPanel.addEventListener("click", () => this.hideQueryResultsPanel());
    }

    const tabExplainBtn = document.getElementById("btn-tab-explain");
    const tabTestBtn = document.getElementById("btn-tab-test");

    if (tabExplainBtn) {
      tabExplainBtn.addEventListener("click", () => this.switchQueryTab('explain'));
    }
    if (tabTestBtn) {
      tabTestBtn.addEventListener("click", () => this.switchQueryTab('test'));
    }

    // Trigger open
    if (btnTrigger) {
      btnTrigger.addEventListener("click", () => {
        this.selectQuery(null);
        modal.classList.remove("hidden");
        this.renderQueriesList();
      });
    }

    // Close
    if (btnClose) {
      btnClose.addEventListener("click", () => {
        modal.classList.add("hidden");
        this.hideQueryResultsPanel();
      });
    }

    // New Query
    if (btnNew) {
      btnNew.addEventListener("click", () => {
        const id = `query-${Date.now()}`;
        const newQ = {
          id: id,
          name: `Nueva Consulta ${this.stateManager.getState().queries ? this.stateManager.getState().queries.length + 1 : 1}`,
          dbEngine: "postgres",
          sql: "-- Escribe tu consulta SQL aquí\nSELECT * FROM "
        };
        this.stateManager.addQuery(newQ);
        this.selectQuery(id);
      });
    }

    // Save Query
    if (btnSave) {
      btnSave.addEventListener("click", () => {
        if (!this.activeQueryId) return;
        const nameInput = document.getElementById("query-name-input");
        const engineSelect = document.getElementById("query-engine-select");
        const sqlTextarea = document.getElementById("query-sql-textarea");

        const name = nameInput ? nameInput.value.trim() : "";
        const engine = engineSelect ? engineSelect.value : "postgres";
        const sql = sqlTextarea ? sqlTextarea.value : "";

        this.stateManager.updateQuery(this.activeQueryId, {
          name: name || "Consulta sin nombre",
          dbEngine: engine,
          sql: sql
        });

        this.uiManager.showToast("Consulta SQL guardada.", "success");
        this.renderQueriesList();
      });
    }

    // Delete Query
    if (btnDelete) {
      btnDelete.addEventListener("click", async () => {
        if (!this.activeQueryId) return;
        const confirmDelete = await this.uiManager.confirm("¿Seguro que deseas eliminar esta consulta?");
        if (confirmDelete) {
          this.stateManager.deleteQuery(this.activeQueryId);
          this.uiManager.showToast("Consulta eliminada.", "success");
          this.selectQuery(null);
        }
      });
    }

    // Copy SQL to clipboard (with fallback for non-HTTPS)
    if (btnCopy) {
      btnCopy.addEventListener("click", () => {
        const sqlTextarea = document.getElementById("query-sql-textarea");
        if (!sqlTextarea || !sqlTextarea.value.trim()) return;
        
        const textToCopy = sqlTextarea.value;
        
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(textToCopy)
            .then(() => this.uiManager.showToast("SQL copiado al portapapeles.", "success"))
            .catch(() => this.copyFallback(textToCopy));
        } else {
          this.copyFallback(textToCopy);
        }
      });
    }

    // Test (Simulate) Query on Mock Data
    if (btnTest) {
      btnTest.addEventListener("click", () => {
        const sqlTextarea = document.getElementById("query-sql-textarea");
        const resultsDiv = document.getElementById("query-test-results");

        if (!sqlTextarea || !resultsDiv) return;

        const sql = sqlTextarea.value.trim();
        if (!sql) {
          this.uiManager.showToast("Escribe primero una consulta SELECT para probar.", "error");
          return;
        }

        const state = this.stateManager.getState();
        const simResult = this.simulateQuery(sql, state.tables);

        this.showQueryResultsPanel("Resultado de Simulación (Datos Muestra):");
        this.switchQueryTab('test');

        if (!simResult.success) {
          resultsDiv.style.color = "#ef4444";
          resultsDiv.textContent = `Error de simulación: ${simResult.error}`;
          return;
        }

        // Render mock rows as a nice HTML/ASCII table
        resultsDiv.style.color = "#10b981";
        resultsDiv.innerHTML = ""; // Clear
        
        const titleEl = document.createElement("div");
        titleEl.style.fontWeight = "bold";
        titleEl.style.marginBottom = "6px";
        titleEl.textContent = `Simulado con éxito usando tablas: ${simResult.tables.join(", ")}`;
        resultsDiv.appendChild(titleEl);

        const tableEl = document.createElement("table");
        tableEl.style.width = "100%";
        tableEl.style.borderCollapse = "collapse";
        tableEl.style.marginTop = "6px";
        tableEl.style.border = "1px solid var(--color-border)";

        // Table Header
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        headerRow.style.background = "rgba(16, 185, 129, 0.1)";
        
        const keys = Object.keys(simResult.rows[0]);
        keys.forEach(k => {
          const th = document.createElement("th");
          th.style.padding = "6px 8px";
          th.style.border = "1px solid var(--color-border)";
          th.style.textAlign = "left";
          th.textContent = k;
          headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        tableEl.appendChild(thead);

        // Table Body
        const tbody = document.createElement("tbody");
        simResult.rows.forEach(row => {
          const tr = document.createElement("tr");
          keys.forEach(k => {
            const td = document.createElement("td");
            td.style.padding = "6px 8px";
            td.style.border = "1px solid var(--color-border)";
            td.textContent = row[k];
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        tableEl.appendChild(tbody);
        resultsDiv.appendChild(tableEl);
      });
    }

    // AI Generate SQL Query
    if (btnAiGenerate) {
      btnAiGenerate.addEventListener("click", async () => {
        const promptInput = document.getElementById("query-prompt-input");
        const sqlTextarea = document.getElementById("query-sql-textarea");
        const engineSelect = document.getElementById("query-engine-select");
        const nameInput = document.getElementById("query-name-input");

        if (!promptInput || !sqlTextarea) return;

        const prompt = promptInput.value.trim();
        if (!prompt) {
          this.uiManager.showToast("Por favor describe lo que necesitas generar con la IA.", "error");
          return;
        }

        // Cargar config y validar
        const config = AiService.loadConfig();
        const requiresApiKey = ['gemini', 'openai'].includes(config.provider);
        if (requiresApiKey && !config.apiKey) {
          this.uiManager.showToast("Configura primero tu clave API en la pestaña de Configuración.", "error");
          return;
        }

        btnAiGenerate.disabled = true;
        const originalText = btnAiGenerate.innerHTML;
        btnAiGenerate.innerHTML = `<span class="spinner-loader"></span> Generando...`;

        try {
          const state = this.stateManager.getState();
          const engine = engineSelect ? engineSelect.value : "postgres";
          const currentSql = sqlTextarea.value.trim();

          const result = await AiService.generate(prompt, state, 'query_generate', {
            engine: engine,
            currentQuerySql: currentSql
          });

          if (result.sql) {
            sqlTextarea.value = result.sql;
            if (nameInput && result.name && (!nameInput.value.trim() || nameInput.value.startsWith("Nueva Consulta"))) {
              nameInput.value = result.name;
            }
            this.uiManager.showToast("SQL generado con IA exitosamente.", "success");
            
            // Auto save in state
            this.stateManager.updateQuery(this.activeQueryId, {
              name: (nameInput ? nameInput.value.trim() : "") || result.name || "Consulta IA",
              dbEngine: engine,
              sql: result.sql
            });
            this.renderQueriesList();
          } else {
            throw new Error("No se pudo obtener el código SQL generado.");
          }
        } catch (err) {
          console.error("Error al generar consulta con IA:", err);
          this.uiManager.showToast(`Error de IA: ${err.message}`, "error");
        } finally {
          btnAiGenerate.disabled = false;
          btnAiGenerate.innerHTML = originalText;
          if (window.lucide) window.lucide.createIcons();
        }
      });
    }

    // AI Suggest Queries
    if (btnAiSuggest) {
      btnAiSuggest.addEventListener("click", async () => {
        const suggestionsList = document.getElementById("query-suggestions-list");
        if (!suggestionsList) return;

        // Cargar config y validar
        const config = AiService.loadConfig();
        const requiresApiKey = ['gemini', 'openai'].includes(config.provider);
        if (requiresApiKey && !config.apiKey) {
          this.uiManager.showToast("Configura primero tu clave API en la pestaña de Configuración.", "error");
          return;
        }

        btnAiSuggest.disabled = true;
        const originalText = btnAiSuggest.innerHTML;
        btnAiSuggest.innerHTML = `<i data-lucide="loader" class="animate-spin" style="width: 12px; height: 12px; margin-right: 4px;"></i> Sugiriendo...`;
        if (window.lucide) window.lucide.createIcons();

        try {
          const state = this.stateManager.getState();
          
          const result = await AiService.generate("sugerir", state, 'query_suggest');

          suggestionsList.innerHTML = ""; // Clear
          
          if (Array.isArray(result)) {
            result.forEach(s => {
              const pill = document.createElement("button");
              pill.className = "quick-prompt-chip";
              pill.style.padding = "4px 8px";
              pill.style.borderRadius = "12px";
              pill.style.border = "1px solid var(--color-border)";
              pill.style.background = "var(--color-bg-app)";
              pill.style.color = "var(--color-text-muted)";
              pill.style.fontSize = "0.7rem";
              pill.style.cursor = "pointer";
              pill.style.transition = "all 0.2s";
              pill.textContent = s.name;
              pill.title = s.prompt;

              pill.addEventListener("click", () => {
                const promptInput = document.getElementById("query-prompt-input");
                if (promptInput) {
                  promptInput.value = s.prompt;
                  promptInput.focus();
                }
              });

              suggestionsList.appendChild(pill);
            });
          } else {
            throw new Error("Formato de respuesta de sugerencias inválido.");
          }
        } catch (err) {
          console.error("Error al sugerir consultas con IA:", err);
          this.uiManager.showToast(`Error de IA: ${err.message}`, "error");
        } finally {
          btnAiSuggest.disabled = false;
          btnAiSuggest.innerHTML = originalText;
          if (window.lucide) window.lucide.createIcons();
        }
      });
    }

    // Explain Query with AI
    if (btnExplain) {
      btnExplain.addEventListener("click", async () => {
        const sqlTextarea = document.getElementById("query-sql-textarea");
        const explainDiv = document.getElementById("query-explain-results");
        const engineSelect = document.getElementById("query-engine-select");

        if (!sqlTextarea || !explainDiv) return;

        const sql = sqlTextarea.value.trim();
        if (!sql) {
          this.uiManager.showToast("Escribe primero una consulta SQL para explicar.", "error");
          return;
        }

        const config = AiService.loadConfig();
        const requiresApiKey = ['gemini', 'openai'].includes(config.provider);
        if (requiresApiKey && !config.apiKey) {
          this.uiManager.showToast("Configura primero tu clave API en la pestaña de Configuración.", "error");
          return;
        }

        btnExplain.disabled = true;
        const originalText = btnExplain.innerHTML;
        btnExplain.innerHTML = `<span class="spinner-loader"></span> Explicando...`;

        try {
          const state = this.stateManager.getState();
          const engine = engineSelect ? engineSelect.value : "postgres";

          const result = await AiService.generate(sql, state, 'query_explain', { engine });

          this.showQueryResultsPanel();
          this.switchQueryTab('explain');
          explainDiv.style.color = "var(--color-text)";
          explainDiv.innerHTML = "";

          const titleEl = document.createElement("div");
          titleEl.style.fontWeight = "bold";
          titleEl.style.marginBottom = "8px";
          titleEl.style.color = "#818cf8";
          titleEl.innerHTML = `<i data-lucide="book-open" style="width: 14px; height: 14px; display: inline; vertical-align: middle; margin-right: 4px;"></i> Explicación de la Consulta`;
          explainDiv.appendChild(titleEl);

          const explanationText = typeof result === 'string' ? result : (result.explanation || JSON.stringify(result));
          
          // Render explanation as formatted text
          const contentEl = document.createElement("div");
          contentEl.style.whiteSpace = "pre-wrap";
          contentEl.style.lineHeight = "1.6";
          contentEl.style.fontSize = "0.8rem";
          contentEl.textContent = explanationText;
          explainDiv.appendChild(contentEl);

          if (window.lucide) window.lucide.createIcons();
          this.uiManager.showToast("Consulta explicada con IA.", "success");
        } catch (err) {
          console.error("Error al explicar consulta con IA:", err);
          this.showQueryResultsPanel();
          this.switchQueryTab('explain');
          explainDiv.innerHTML = `<div style="padding: 12px; background: rgba(239, 68, 68, 0.08); border-radius: 6px; border: 1px solid rgba(239, 68, 68, 0.2); color: #fca5a5; line-height: 1.5; font-family: sans-serif; font-size: 0.8rem;">
            <strong style="color: #ef4444; display: block; margin-bottom: 4px;">No se pudo generar la explicación</strong>
            El proveedor de IA no pudo responder o devolvió un formato inválido. Por favor, asegúrate de que la consulta sea correcta e intenta de nuevo.
          </div>`;
          this.uiManager.showToast("No se pudo obtener la explicación de la IA.", "error");
        } finally {
          btnExplain.disabled = false;
          btnExplain.innerHTML = originalText;
          if (window.lucide) window.lucide.createIcons();
        }
      });
    }
  }

  /**
   * Fallback para copiar al portapapeles cuando navigator.clipboard no está disponible
   * (contextos no HTTPS o navegadores sin soporte).
   */
  copyFallback(text) {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "-9999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      this.uiManager.showToast("SQL copiado al portapapeles.", "success");
    } catch (err) {
      this.uiManager.showToast("Error al copiar al portapapeles.", "error");
    }
  }

  simulateQuery(sql, tables) {
    const sqlUpper = sql.toUpperCase();
    if (!sqlUpper.includes("SELECT")) {
      return { success: false, error: "Actualmente solo se simula la ejecución de sentencias SELECT para pruebas." };
    }
    
    // Find matched tables
    const matchedTables = tables.filter(t => {
      const regex = new RegExp(`\\b${t.name}\\b`, "i");
      return regex.test(sql);
    });
    
    if (matchedTables.length === 0) {
      return { success: false, error: "No se encontraron tablas del diagrama referenciadas en la consulta SQL." };
    }
    
    let columns = [];
    matchedTables.forEach(t => {
      t.fields.forEach(f => {
        columns.push({
          tableName: t.name,
          fieldName: f.name,
          type: f.type,
          isPK: f.isPK
        });
      });
    });
    
    const mockRows = [];
    for (let i = 1; i <= 3; i++) {
      const row = {};
      columns.forEach(col => {
        let val = "";
        const typeUpper = col.type.toUpperCase();
        if (typeUpper.includes("INT")) {
          val = col.isPK ? i : Math.floor(Math.random() * 100) + 1;
        } else if (typeUpper.includes("VARCHAR") || typeUpper.includes("TEXT")) {
          val = `${col.fieldName}_val_${i}`;
        } else if (typeUpper.includes("DECIMAL") || typeUpper.includes("FLOAT") || typeUpper.includes("DOUBLE")) {
          val = (Math.random() * 100).toFixed(2);
        } else if (typeUpper.includes("DATE") || typeUpper.includes("TIME")) {
          val = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        } else if (typeUpper.includes("BOOL") || typeUpper.includes("TINYINT")) {
          val = Math.random() > 0.5 ? "true" : "false";
        } else {
          val = `val_${i}`;
        }
        row[col.fieldName] = val;
      });
      mockRows.push(row);
    }
    
    return { success: true, rows: mockRows, tables: matchedTables.map(t => t.name) };
  }

  selectQuery(queryId) {
    this.activeQueryId = queryId;
    this.renderQueriesList();

    const emptyState = document.getElementById("query-editor-empty-state");
    const content = document.getElementById("query-editor-content");
    const resultsDiv = document.getElementById("query-test-results");

    const explainDiv = document.getElementById("query-explain-results");
    const testDiv = document.getElementById("query-test-results");

    this.hideQueryResultsPanel();
    this.switchQueryTab('explain');
    if (explainDiv) {
      explainDiv.innerHTML = `<div style="color: var(--color-text-muted); font-style: italic; text-align: center; margin-top: 40px;">
        Haz clic en "Explicar" para analizar esta consulta SQL con la IA.
      </div>`;
    }
    if (testDiv) {
      testDiv.innerHTML = `<div style="color: var(--color-text-muted); font-style: italic; text-align: center; margin-top: 40px; font-family: sans-serif;">
        Haz clic en "Probar" para simular la consulta con datos muestra del diagrama.
      </div>`;
    }

    if (!queryId) {
      if (emptyState) {
        emptyState.style.display = "flex";
        emptyState.classList.remove("hidden");
      }
      if (content) {
        content.style.display = "none";
        content.classList.add("hidden");
      }
      return;
    }

    if (emptyState) {
      emptyState.style.display = "none";
      emptyState.classList.add("hidden");
    }
    if (content) {
      content.style.display = "flex";
      content.classList.remove("hidden");
    }

    const queries = this.stateManager.getState().queries || [];
    const q = queries.find(item => item.id === queryId);
    if (q) {
      const nameInput = document.getElementById("query-name-input");
      const engineSelect = document.getElementById("query-engine-select");
      const sqlTextarea = document.getElementById("query-sql-textarea");
      const promptInput = document.getElementById("query-prompt-input");
      const suggestionsList = document.getElementById("query-suggestions-list");

      if (nameInput) nameInput.value = q.name || "";
      if (engineSelect) engineSelect.value = q.dbEngine || "postgres";
      if (sqlTextarea) sqlTextarea.value = q.sql || "";
      if (promptInput) promptInput.value = "";
      if (suggestionsList) suggestionsList.innerHTML = "";
    }
  }

  showQueryResultsPanel() {
    const resultsPanel = document.getElementById("query-results-panel");
    const modal = document.getElementById("query-modal");
    const modalContent = modal ? modal.querySelector(".query-modal-content") : null;
    if (resultsPanel) {
      resultsPanel.classList.remove("hidden");
      resultsPanel.style.display = "flex";
    }
    if (modalContent) modalContent.style.maxWidth = "1480px";
    if (window.lucide) window.lucide.createIcons();
  }

  hideQueryResultsPanel() {
    const resultsPanel = document.getElementById("query-results-panel");
    const modal = document.getElementById("query-modal");
    const modalContent = modal ? modal.querySelector(".query-modal-content") : null;
    if (resultsPanel) {
      resultsPanel.classList.add("hidden");
      resultsPanel.style.display = "none";
    }
    if (modalContent) modalContent.style.maxWidth = "900px";
  }

  switchQueryTab(tabName) {
    const tabExplain = document.getElementById("btn-tab-explain");
    const tabTest = document.getElementById("btn-tab-test");
    const explainContent = document.getElementById("query-tab-explain-content");
    const testContent = document.getElementById("query-tab-test-content");

    if (!tabExplain || !tabTest || !explainContent || !testContent) return;

    if (tabName === 'explain') {
      tabExplain.style.background = "var(--color-bg-tertiary)";
      tabExplain.style.borderColor = "var(--color-border)";
      tabExplain.style.color = "var(--color-text)";
      
      tabTest.style.background = "transparent";
      tabTest.style.borderColor = "transparent";
      tabTest.style.color = "var(--color-text-muted)";

      explainContent.classList.remove("hidden");
      explainContent.style.display = "flex";
      testContent.classList.add("hidden");
      testContent.style.display = "none";
    } else {
      tabTest.style.background = "var(--color-bg-tertiary)";
      tabTest.style.borderColor = "var(--color-border)";
      tabTest.style.color = "var(--color-text)";

      tabExplain.style.background = "transparent";
      tabExplain.style.borderColor = "transparent";
      tabExplain.style.color = "var(--color-text-muted)";

      testContent.classList.remove("hidden");
      testContent.style.display = "flex";
      explainContent.classList.add("hidden");
      explainContent.style.display = "none";
    }
  }

  renderQueriesList() {
    const container = document.getElementById("query-list-container");
    if (!container) return;
    container.innerHTML = "";

    const queries = this.stateManager.getState().queries || [];
    if (queries.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--color-text-muted); font-size: 0.8rem; padding: 10px;">Sin consultas guardadas</div>`;
      return;
    }

    queries.forEach(q => {
      const btn = document.createElement("button");
      btn.className = "query-item-btn";
      btn.style.width = "100%";
      btn.style.padding = "8px 10px";
      btn.style.borderRadius = "6px";
      btn.style.border = "1px solid var(--color-border)";
      btn.style.background = this.activeQueryId === q.id ? "var(--color-primary-light, rgba(99, 102, 241, 0.1))" : "var(--color-bg-tertiary)";
      btn.style.borderColor = this.activeQueryId === q.id ? "var(--color-primary)" : "var(--color-border)";
      btn.style.color = this.activeQueryId === q.id ? "var(--color-text-main)" : "var(--color-text-muted)";
      btn.style.textAlign = "left";
      btn.style.cursor = "pointer";
      btn.style.display = "flex";
      btn.style.justifyContent = "space-between";
      btn.style.alignItems = "center";
      btn.style.fontSize = "0.85rem";
      
      const nameSpan = document.createElement("span");
      nameSpan.textContent = q.name || "Consulta sin nombre";
      nameSpan.style.whiteSpace = "nowrap";
      nameSpan.style.overflow = "hidden";
      nameSpan.style.textOverflow = "ellipsis";
      nameSpan.style.marginRight = "6px";
      btn.appendChild(nameSpan);

      const icon = document.createElement("i");
      icon.setAttribute("data-lucide", "chevron-right");
      icon.style.width = "12px";
      icon.style.height = "12px";
      btn.appendChild(icon);

      btn.addEventListener("click", () => {
        this.selectQuery(q.id);
      });

      container.appendChild(btn);
    });

    if (window.lucide) window.lucide.createIcons();
  }
}
