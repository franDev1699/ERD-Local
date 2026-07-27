// src/controllers/AppController.js
import { StateManager } from '../core/StateManager.js';
import { HistoryManager } from '../core/HistoryManager.js';
import { StorageService } from '../services/StorageService.js';
import { WebSocketService } from '../services/WebSocketService.js';
import { Renderer } from '../ui/Renderer.js';
import { CanvasManager } from '../ui/CanvasManager.js';
import { SidebarEditor } from '../ui/SidebarEditor.js';
import { UIManager } from '../ui/UIManager.js';
import { FeedbackManager } from '../ui/FeedbackManager.js';
import { InteractionController } from './InteractionController.js';

// Special Sub-controllers
import { QueryController } from './QueryController.js';
import { AiController } from './AiController.js';
import { CollabController } from './CollabController.js';
import { DiagramController } from './DiagramController.js';
import { ToolbarController } from './ToolbarController.js';
import { NotesController } from './NotesController.js';

export class AppController {
  constructor(config) {
    this.config = config;
    this.projectId = config.projectId;
    
    // Services
    this.storage = new StorageService(this.projectId);
    this.webSocket = new WebSocketService(config.wsUrl);

    // Debounce timers for persistence
    this._saveDebounceTimer = null;
    this._SAVE_DEBOUNCE_MS = 400;
    
    // Parse pending project name from URL params if exists
    const urlParams = new URLSearchParams(window.location.search);
    const nameParam = urlParams.get('name');
    this.pendingProjectName = nameParam ? nameParam.trim() : null;

    // State & History
    const initialState = this.projectId ? (this.storage.load() || config.defaultState) : config.defaultState;
    this.stateManager = new StateManager(initialState, (newState, isRemote) => this.handleStateChange(newState, isRemote));
    this.history = new HistoryManager();
    
    // UI Components
    this.canvasManager = new CanvasManager({
      container: config.dom.canvasContainer,
      canvas: config.dom.erdCanvas,
      zoomText: config.dom.zoomText
    });
    this.uiManager = new UIManager({
      toastContainer: config.dom.toastContainer,
      sqlModal: config.dom.sqlModal,
      imageModal: config.dom.imageModal
    });
    window.UIManager = this.uiManager;

    // Diagram Controller (Manages diagrams layout, selection and mutations)
    this.diagramController = new DiagramController({
      stateManager: this.stateManager,
      history: this.history,
      uiManager: this.uiManager,
      canvasManager: this.canvasManager,
      dom: config.dom
    });

    this.renderer = new Renderer(config.dom, {
      onRelationshipDelete: (id) => this.diagramController.deleteRelationship(id),
      onRelationshipSelect: (id) => this.diagramController.selectRelationship(id),
      onRelationshipCardinalityChange: (id, cardinality) => this.diagramController.updateRelationshipCardinality(id, cardinality),
      onNotesBadgeClick: (tableId, badgeEl) => this.notesController?.showNotesPopover(tableId, badgeEl),
      onStickyNoteUpdate: (stickyId, updates) => this.notesController?.updateStickyNote(stickyId, updates),
      onStickyNoteDelete: (stickyId) => this.notesController?.deleteStickyNote(stickyId)
    });

    this.sidebarEditor = new SidebarEditor({
      container: config.dom.tablesListContainer,
      onTableSelect: (id, isCumulative) => this.diagramController.selectTable(id, isCumulative),
      onTableUpdate: (tableId, updates) => this.diagramController.updateTable(tableId, updates),
      onTableDelete: (tableId) => this.diagramController.deleteTable(tableId),
      onTableDuplicate: (tableId) => this.diagramController.duplicateTable(tableId),
      onFieldAdd: (tableId) => this.diagramController.addField(tableId),
      onFieldUpdate: (tableId, fieldId, updates) => this.diagramController.updateField(tableId, fieldId, updates),
      onFieldDelete: (tableId, fieldId) => this.diagramController.deleteField(tableId, fieldId),
      onFieldMove: (sourceTableId, fieldId, targetTableId, targetIndex) => this.diagramController.moveField(sourceTableId, fieldId, targetTableId, targetIndex),
      onFieldCopy: (sourceTableId, fieldId, targetTableId, targetIndex) => this.diagramController.copyField(sourceTableId, fieldId, targetTableId, targetIndex),
      onGroupUpdate: (groupId, updates) => this.diagramController.updateGroup(groupId, updates),
      onGroupDelete: (groupId) => this.diagramController.deleteGroup(groupId),
      onBatchDelete: (ids) => this.diagramController.deleteTables(ids),
      onBatchGroup: (ids, groupId) => this.diagramController.groupTables(ids, groupId)
    });

    this.diagramController.setUIComponents({
      renderer: this.renderer,
      sidebarEditor: this.sidebarEditor
    });

    this.diagramController.onRefreshUI = () => {
      this.toolbarController?.updateHistoryButtons();
      this.queryController?.renderQueriesList();
    };

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
      autoLayout: () => this.diagramController.autoLayout(),
      getSelectedTableIds: () => this.diagramController.selectedTableIds,
      onTableSelect: (tableId, isCumulative) => this.diagramController.selectTable(tableId, isCumulative)
    });

    this.collabController = new CollabController({
      projectId: this.projectId,
      webSocket: this.webSocket,
      stateManager: this.stateManager,
      history: this.history,
      uiManager: this.uiManager,
      canvasManager: this.canvasManager,
      pendingProjectName: this.pendingProjectName,
      onIncomingStateReset: () => this.diagramController.refreshUI()
    });

    this.notesController = new NotesController({
      stateManager: this.stateManager,
      uiManager: this.uiManager,
      collabController: this.collabController,
      onHistoryPush: (prevState) => {
        const currentState = this.stateManager.getState();
        this.history.push(prevState || currentState, currentState);
        this.toolbarController?.updateHistoryButtons();
      }
    });

    // Interaction Controller
    this.interactionController = new InteractionController({
      canvasManager: this.canvasManager,
      stateManager: this.stateManager,
      renderer: this.renderer,
      uiManager: this.uiManager,
      dom: config.dom,
      onTableSelect: (id, isCumulative) => this.diagramController.selectTable(id, isCumulative),
      onFieldSelect: (tableId, fieldId) => this.sidebarEditor.scrollToField(tableId, fieldId),
      onGroupSelect: (id) => this.diagramController.selectGroup(id),
      onSelectionArea: (ids, isCumulative) => this.diagramController.handleSelectionArea(ids, isCumulative),
      getSelectedTableIds: () => this.diagramController.selectedTableIds,
      getSelectedGroupId: () => this.diagramController.selectedGroupId,
      getSelectedRelationshipId: () => this.diagramController.selectedRelationshipId,
      onRelationshipDelete: (id) => this.diagramController.deleteRelationship(id),
      onHistoryPush: (prevState) => {
        const currentState = this.stateManager.getState();
        this.history.push(prevState || currentState, currentState);
        this.toolbarController?.updateHistoryButtons();
      },
      onRelationshipAdd: (fromTable, fromField, toTable, toField) => {
        this.diagramController.addRelationship(fromTable, fromField, toTable, toField);
      },
      onCursorMove: (coords) => {
        this.collabController.sendCursorMove(coords);
      },
      onZoomChange: () => {
        this.diagramController.refreshCanvas();
      },
      onTableContextMenu: (tableId, x, y) => this.notesController.showTableContextMenu(tableId, x, y),
      onStickyNoteContextMenu: (stickyId, x, y) => this.notesController.showStickyNoteContextMenu(stickyId, x, y),
      onCanvasContextMenu: (coords, x, y) => this.notesController.showCanvasContextMenu(coords, x, y),
      onStickyNoteUpdate: (stickyId, updates) => this.notesController.updateStickyNote(stickyId, updates),
      onStickyNoteDelete: (stickyId) => this.notesController.deleteStickyNote(stickyId)
    });

    // Toolbar Controller
    this.toolbarController = new ToolbarController({
      dom: config.dom,
      diagramController: this.diagramController,
      collabController: this.collabController,
      stateManager: this.stateManager,
      history: this.history,
      canvasManager: this.canvasManager,
      uiManager: this.uiManager,
      queryController: this.queryController,
      aiController: this.aiController,
      projectId: this.projectId
    });
  }

  async init() {
    window.appInstance = this;

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

    if (this.collabController.myUser) {
      this.renderer.currentUserId = this.collabController.myUser.userId;
      this.renderer.isAdmin = this.collabController.myUser.is_admin;
    }

    // Initial Render & Setup
    this.diagramController.refreshUI();
    this.notesController?.refreshGlobalNotes();
    this.interactionController.init();
    this.toolbarController.init();
    
    // If there are tables, fit viewport to content; otherwise, center empty canvas
    setTimeout(() => {
      const initTables = this.stateManager.getState().tables;
      if (initTables && initTables.length > 0) {
        this.canvasManager.fitToContent(initTables);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            this.diagramController.refreshCanvas();
          });
        });
      } else {
        this.canvasManager.centerCanvas();
      }
      if (window.lucide) {
        window.lucide.createIcons();
      }
    }, 200);

    // Setup query manager and AI configurations
    this.queryController.init();
    this.aiController.init();

    // Initialize feedback manager after user info is available
    this.initFeedbackManager();
  }

  initFeedbackManager() {
    const feedbackModal = document.getElementById('feedback-modal');
    if (!feedbackModal) return;

    this.feedbackManager = new FeedbackManager({
      modal: feedbackModal,
      title: document.getElementById('feedback-modal-title'),
      closeBtn: document.getElementById('btn-close-feedback-modal'),
      myList: document.getElementById('feedback-my-list'),
      manageList: document.getElementById('feedback-manage-list'),
      form: document.getElementById('feedback-form'),
      subjectInput: document.getElementById('feedback-subject'),
      descriptionInput: document.getElementById('feedback-description'),
      submitBtn: document.getElementById('btn-submit-feedback'),
      tabs: Array.from(document.querySelectorAll('.feedback-tab')),
      typeChips: null,
      manageTab: document.getElementById('btn-feedback-manage-tab'),
      currentUser: this.collabController?.myUser || null,
    });

    this.feedbackManager.initListeners();

    // Wire up the toolbar button to open the modal
    const btnFeedback = document.getElementById('btn-feedback-trigger');
    if (btnFeedback) {
      btnFeedback.addEventListener('click', () => {
        this.feedbackManager.open();
      });
    }
  }

  handleStateChange(newState, isRemote = false) {
    this.diagramController.refreshUI();
    this.notesController?.refreshGlobalNotes();

    if (this._saveDebounceTimer) clearTimeout(this._saveDebounceTimer);
    this._saveDebounceTimer = setTimeout(() => {
      this.storage.save(newState);
      if (!isRemote) {
        this.collabController.broadcastState(newState);
      }
    }, this._SAVE_DEBOUNCE_MS);
  }
}
