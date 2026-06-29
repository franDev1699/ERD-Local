// src/controllers/QueryController.js
import { AiService } from '../services/AiService.js';

export class QueryController {
  constructor({ stateManager, uiManager }) {
    this.stateManager = stateManager;
    this.uiManager = uiManager;
    this.activeQueryId = null;
  }

  init() {
    this.setupQueryManager();
  }

  setupQueryManager() {
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
        const state = this.stateManager.getState();
        if (!state.tables || state.tables.length === 0) {
          this.uiManager.showToast("Crea al menos una tabla antes de usar el Gestor de Consultas.", "error");
          return;
        }
        this.selectQuery(null);
        if (modal) modal.classList.remove("hidden");
        this.renderQueriesList();
      });
    }

    // Close
    if (btnClose) {
      btnClose.addEventListener("click", () => {
        if (modal) modal.classList.add("hidden");
        this.hideQueryResultsPanel();
      });
    }

    // New Query
    if (btnNew) {
      btnNew.addEventListener("click", () => {
        const state = this.stateManager.getState();
        if (!state.tables || state.tables.length === 0) {
          this.uiManager.showToast("Crea al menos una tabla antes de crear consultas.", "error");
          return;
        }
        const id = `query-${Date.now()}`;
        const queries = state.queries || [];
        const newQ = {
          id: id,
          name: `Nueva Consulta ${queries.length + 1}`,
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
