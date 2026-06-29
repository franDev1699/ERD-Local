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

// Special Sub-controllers
import { QueryController } from './QueryController.js';
import { AiController } from './AiController.js';
import { CollabController } from './CollabController.js';

export class AppController {
  constructor(config) {
    this.config = config;
    this.projectId = config.projectId;
    
    // Services
    this.storage = new StorageService(this.projectId);
    this.webSocket = new WebSocketService(config.wsUrl);
    
    // Parse pending project name from URL params if exists
    const urlParams = new URLSearchParams(window.location.search);
    const nameParam = urlParams.get('name');
    this.pendingProjectName = nameParam ? nameParam.trim() : null;

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

    // Instantiate Sub-controllers
    this.queryController = new QueryController({
      stateManager: this.stateManager,
      uiManager: this.uiManager
    });

    this.aiController = new AiController({
      stateManager: this.stateManager,
      uiManager: this.uiManager,
      history: this.history,
      canvasManager: this.canvasManager,
      autoLayout: () => this.autoLayout()
    });

    this.collabController = new CollabController({
      projectId: this.projectId,
      webSocket: this.webSocket,
      stateManager: this.stateManager,
      uiManager: this.uiManager,
      canvasManager: this.canvasManager,
      pendingProjectName: this.pendingProjectName,
      onIncomingStateReset: () => this.refreshUI()
    });

    // Interaction Controller
    this.interactionController = new InteractionController({
      canvasManager: this.canvasManager,
      stateManager: this.stateManager,
      renderer: this.renderer,
      uiManager: this.uiManager,
      dom: config.dom,
      onTableSelect: (id, isCumulative) => this.selectTable(id, isCumulative),
      onFieldSelect: (tableId, fieldId) => this.sidebarEditor.scrollToField(tableId, fieldId),
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
        this.collabController.sendCursorMove(coords);
      }
    });

    this.selectedTableIds = new Set();
    this.selectedGroupId = null;
  }

  async init() {
    if (!this.projectId) {
      this.collabController.initDashboard();
      this.aiController.init();
      return;
    }

    // Hide dashboard, show app container
    const dashboardEl = document.getElementById("project-dashboard");
    if (dashboardEl) dashboardEl.classList.add("hidden");
    const appContainerEl = document.querySelector(".app-container");
    if (appContainerEl) appContainerEl.classList.remove("hidden");

    // Setup Collaboration
    await this.collabController.initCollab();

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

    // Setup query manager and AI configurations
    this.queryController.init();
    this.aiController.init();
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
    if (!isRemote) {
      this.collabController.broadcastState(newState);
    }
    this.refreshUI();
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
    this.queryController.renderQueriesList();
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

    // Scroll selected table into view in the sidebar
    if (tableId !== null && !isCumulative) {
      this.sidebarEditor.scrollToTable(tableId);
    }
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

  centerContentOnCanvas(tables, groups) {
    const CANVAS_SIZE = 3000;
    const CANVAS_CENTER = CANVAS_SIZE / 2;
    const PADDING = 100;

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

    const dx = CANVAS_CENTER - contentCenterX;
    const dy = CANVAS_CENTER - contentCenterY;

    const finalMinX = minX + dx;
    const finalMinY = minY + dy;
    const finalMaxX = maxX + dx;
    const finalMaxY = maxY + dy;

    let adjustX = 0, adjustY = 0;
    if (finalMinX < PADDING) adjustX = PADDING - finalMinX;
    if (finalMinY < PADDING) adjustY = PADDING - finalMinY;
    if (finalMaxX > CANVAS_SIZE - PADDING) adjustX = (CANVAS_SIZE - PADDING) - finalMaxX;
    if (finalMaxY > CANVAS_SIZE - PADDING) adjustY = (CANVAS_SIZE - PADDING) - finalMaxY;

    const totalDx = dx + adjustX;
    const totalDy = dy + adjustY;

    if (Math.abs(totalDx) < 1 && Math.abs(totalDy) < 1) return;

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

    // 2. Organizar grupos en una cuadrícula
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

    // 3. Organizar tablas sin grupo debajo
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

    // 4. Centrar
    this.centerContentOnCanvas(state.tables, state.groups);

    this.stateManager.notify();
    this.canvasManager.fitToContent(this.stateManager.getState().tables);
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

  async copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        console.warn("Failed to copy with navigator.clipboard: ", e);
      }
    }

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

    document.querySelectorAll('input[name="sql-dialect"]').forEach(radio => {
      radio.addEventListener("change", (e) => {
        const sqlCodeBlock = document.getElementById("sql-code-block");
        if (sqlCodeBlock) {
          sqlCodeBlock.textContent = ExportService.exportToSql(this.stateManager.getState(), e.target.value);
        }
      });
    });

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

    // Renombrar Proyecto
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

    // Copiar link de compartir
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

    // Auto Layout normal & AI
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
        this.aiController.autoLayoutWithAi();
      });
    }

    // Undo / Redo
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
            void el.offsetWidth;
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
}
