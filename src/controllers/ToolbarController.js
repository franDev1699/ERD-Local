// src/controllers/ToolbarController.js
import { ExportService } from '../services/ExportService.js';
import { ImportService } from '../services/ImportService.js';
import { AiService } from '../services/AiService.js';

export class ToolbarController {
  constructor({
    dom,
    diagramController,
    collabController,
    stateManager,
    history,
    canvasManager,
    uiManager,
    queryController,
    aiController,
    projectId
  }) {
    this.dom = dom;
    this.diagramController = diagramController;
    this.collabController = collabController;
    this.stateManager = stateManager;
    this.history = history;
    this.canvasManager = canvasManager;
    this.uiManager = uiManager;
    this.queryController = queryController;
    this.aiController = aiController;
    this.projectId = projectId;
  }

  init() {
    this.setupGlobalEventListeners();
    this.setupSidebarResizer();
  }

  setupSidebarResizer() {
    const sidebar = document.querySelector(".sidebar");
    const resizer = document.querySelector(".sidebar-resizer");
    if (!sidebar || !resizer) return;

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
      btnAddTable.addEventListener("click", () => this.diagramController.addTable());
    }

    // Nuevo Grupo
    const btnAddGroup = document.getElementById("btn-add-group");
    if (btnAddGroup) {
      btnAddGroup.addEventListener("click", () => this.diagramController.addGroup());
    }

    // Limpiar Todo
    const btnClearAll = document.getElementById("btn-clear-all");
    if (btnClearAll) {
      btnClearAll.addEventListener("click", () => this.diagramController.clearAll());
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
            this.dom.erdCanvas,
            format,
            this.stateManager.getState(),
            this.canvasManager.getZoom(),
            (z) => {
              this.canvasManager.setZoom(z);
              this.diagramController.refreshCanvas();
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

                this.diagramController.centerContentOnCanvas(importedState.tables, importedState.groups || []);

                this.stateManager.setState({
                  tables: importedState.tables,
                  relationships: importedState.relationships || [],
                  groups: importedState.groups || []
                });

                setTimeout(() => {
                  this.canvasManager.fitToContent(importedState.tables);
                }, 100);

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
            this.diagramController.autoLayout();
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
        this.canvasManager.zoomToCenter(this.canvasManager.getZoom() + 0.1);
        this.diagramController.refreshCanvas();
      });
    }

    const btnZoomOut = document.getElementById("btn-zoom-out");
    if (btnZoomOut) {
      btnZoomOut.addEventListener("click", () => {
        this.canvasManager.zoomToCenter(this.canvasManager.getZoom() - 0.1);
        this.diagramController.refreshCanvas();
      });
    }

    const btnZoomFit = document.getElementById("btn-zoom-fit");
    if (btnZoomFit) {
      btnZoomFit.addEventListener("click", () => {
        this.canvasManager.fitToContent(this.stateManager.getState().tables);
        this.diagramController.refreshCanvas();
        this.uiManager.showToast("Ajustado al lienzo", "info");
      });
    }

    const zoomInput = document.getElementById("zoom-level");
    if (zoomInput) {
      const applyZoomFromInput = () => {
        let val = zoomInput.value.trim();
        const hasPercent = val.includes('%');
        val = val.replace('%', '').trim();
        let num = parseFloat(val);
        if (!isNaN(num)) {
          let targetZoom = num;
          if (hasPercent || num > 1.5) {
            targetZoom = num / 100;
          }
          this.canvasManager.zoomToCenter(targetZoom);
          this.diagramController.refreshCanvas();
        } else {
          this.canvasManager.setZoom(this.canvasManager.getZoom());
        }
      };

      zoomInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          applyZoomFromInput();
          zoomInput.blur();
        } else if (e.key === "Escape") {
          this.canvasManager.setZoom(this.canvasManager.getZoom());
          zoomInput.blur();
        }
      });

      zoomInput.addEventListener("blur", () => {
        applyZoomFromInput();
      });

      zoomInput.addEventListener("focus", () => {
        let val = zoomInput.value.trim();
        if (val.endsWith('%')) {
          zoomInput.value = val.slice(0, -1);
        }
        zoomInput.select();
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
        this.diagramController.autoLayout();
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
      btnUndo.addEventListener("click", () => this.diagramController.undo());
    }

    const btnRedo = document.getElementById("btn-redo");
    if (btnRedo) {
      btnRedo.addEventListener("click", () => this.diagramController.redo());
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
          this.diagramController.selectTable(matched.id);
          this.diagramController.scrollToTable(matched.id);

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
          this.diagramController.redo();
        } else {
          this.diagramController.undo();
        }
      } else if (hasModifier && isY) {
        e.preventDefault();
        this.diagramController.redo();
      }
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
}
