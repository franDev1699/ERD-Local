// src/controllers/AiController.js
import { AiService } from '../services/AiService.js';

export class AiController {
  constructor({ stateManager, uiManager, history, canvasManager, autoLayout }) {
    this.stateManager = stateManager;
    this.uiManager = uiManager;
    this.history = history;
    this.canvasManager = canvasManager;
    this.autoLayout = autoLayout;
  }

  init() {
    this.setupAiModal();
  }

  setupAiModal() {
    const modal = document.getElementById("ai-modal");
    const btnTrigger = document.getElementById("btn-ai-modal-trigger");
    const btnClose = document.getElementById("btn-close-ai-modal");
    
    if (!modal) return;

    // Tabs
    const tabAssistant = document.getElementById("tab-ai-assistant");
    const tabConfig = document.getElementById("tab-ai-config");
    const tabPrompts = document.getElementById("tab-ai-prompts");
    const viewAssistant = document.getElementById("ai-assistant-view");
    const viewConfig = document.getElementById("ai-config-view");
    const viewPrompts = document.getElementById("ai-prompts-view");

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

    // Prompts Fields
    const selectPrompt = document.getElementById("ai-prompt-select");
    const editorPrompt = document.getElementById("ai-prompt-editor");
    const btnSavePrompts = document.getElementById("btn-save-ai-prompts");
    const btnResetPrompts = document.getElementById("btn-reset-ai-prompts");
    const btnDownloadPrompts = document.getElementById("btn-download-ai-prompts");

    let loadedPrompts = {};

    const loadPromptsFromServer = async () => {
      try {
        const response = await fetch('/api/ai/prompts');
        if (response.ok) {
          loadedPrompts = await response.json();
          updatePromptEditor();
        }
      } catch (err) {
        console.error('Error al cargar prompts:', err);
        this.uiManager.showToast("No se pudieron cargar los prompts del servidor.", "error");
      }
    };

    const updatePromptEditor = () => {
      if (!selectPrompt || !editorPrompt) return;
      const selectedKey = selectPrompt.value;
      editorPrompt.value = loadedPrompts[selectedKey] || '';
    };

    if (selectPrompt) {
      selectPrompt.addEventListener("change", updatePromptEditor);
    }

    if (editorPrompt) {
      editorPrompt.addEventListener("input", (e) => {
        const selectedKey = selectPrompt.value;
        loadedPrompts[selectedKey] = e.target.value;
      });
    }

    // Open/Close
    const btnDashboardConfig = document.getElementById("btn-dashboard-ai-config");

    const openConfigModal = () => {
      const config = AiService.loadConfig();
      if (selectProvider) selectProvider.value = config.provider;
      if (inputModel) inputModel.value = config.model;
      if (inputApiKey) inputApiKey.value = config.apiKey;
      if (inputApiUrl) inputApiUrl.value = config.apiUrl;

      // Mostrar/ocultar inputs según el proveedor
      toggleProviderFields(config.provider);

      // Pre-cargar prompts en segundo plano
      loadPromptsFromServer();
    };

    if (btnTrigger) {
      btnTrigger.addEventListener("click", () => {
        openConfigModal();
        switchTab("assistant");
        this.uiManager.openAiModal(modal);
      });
    }

    if (btnDashboardConfig) {
      btnDashboardConfig.addEventListener("click", () => {
        openConfigModal();
        switchTab("config");
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
      const isDashboard = !window.location.search.includes("project=");
      if (isDashboard && tab === "assistant") {
        tab = "config";
      }

      if (tab === "assistant") {
        if (tabAssistant) tabAssistant.classList.add("active");
        if (tabConfig) tabConfig.classList.remove("active");
        if (tabPrompts) tabPrompts.classList.remove("active");
        if (viewAssistant) viewAssistant.classList.remove("hidden");
        if (viewConfig) viewConfig.classList.add("hidden");
        if (viewPrompts) viewPrompts.classList.add("hidden");
      } else if (tab === "config") {
        if (tabAssistant) tabAssistant.classList.remove("active");
        if (tabConfig) tabConfig.classList.add("active");
        if (tabPrompts) tabPrompts.classList.remove("active");
        if (viewAssistant) viewAssistant.classList.add("hidden");
        if (viewConfig) viewConfig.classList.remove("hidden");
        if (viewPrompts) viewPrompts.classList.add("hidden");
      } else {
        if (tabAssistant) tabAssistant.classList.remove("active");
        if (tabConfig) tabConfig.classList.remove("active");
        if (tabPrompts) tabPrompts.classList.add("active");
        if (viewAssistant) viewAssistant.classList.add("hidden");
        if (viewConfig) viewConfig.classList.add("hidden");
        if (viewPrompts) viewPrompts.classList.remove("hidden");
        
        loadPromptsFromServer();
      }

      // Ocultar la pestaña del Asistente si estamos en el dashboard
      if (tabAssistant) {
        tabAssistant.style.display = isDashboard ? "none" : "block";
      }
    }

    if (tabAssistant && tabConfig && tabPrompts) {
      tabAssistant.addEventListener("click", () => switchTab("assistant"));
      tabConfig.addEventListener("click", () => switchTab("config"));
      tabPrompts.addEventListener("click", () => switchTab("prompts"));
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

    // Save Prompts
    if (btnSavePrompts) {
      btnSavePrompts.addEventListener("click", async () => {
        btnSavePrompts.disabled = true;
        const originalText = btnSavePrompts.innerHTML;
        btnSavePrompts.innerHTML = `<span class="spinner-loader"></span> Guardando...`;
        
        try {
          const response = await fetch('/api/ai/prompts', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(loadedPrompts)
          });
          
          if (response.ok) {
            const data = await response.json();
            loadedPrompts = data.prompts;
            this.uiManager.showToast("Prompts del sistema actualizados globalmente.", "success");
            switchTab("assistant");
          } else {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'Error al guardar');
          }
        } catch (err) {
          console.error(err);
          this.uiManager.showToast("No se pudieron guardar los prompts: " + err.message, "error");
        } finally {
          btnSavePrompts.disabled = false;
          btnSavePrompts.innerHTML = originalText;
        }
      });
    }

    // Download Prompts
    if (btnDownloadPrompts) {
      btnDownloadPrompts.addEventListener("click", () => {
        try {
          const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(loadedPrompts, null, 2));
          const downloadAnchor = document.createElement('a');
          downloadAnchor.setAttribute("href", dataStr);
          downloadAnchor.setAttribute("download", "ai_prompts.json");
          document.body.appendChild(downloadAnchor);
          downloadAnchor.click();
          downloadAnchor.remove();
          this.uiManager.showToast("Prompts descargados correctamente.", "success");
        } catch (err) {
          console.error(err);
          this.uiManager.showToast("Error al exportar los prompts.", "error");
        }
      });
    }

    // Reset Prompts
    if (btnResetPrompts) {
      btnResetPrompts.addEventListener("click", async () => {
        if (!confirm("¿Estás seguro de que deseas restablecer todos los prompts a sus valores de fábrica? Esta acción afectará a todos los proyectos.")) {
          return;
        }
        
        btnResetPrompts.disabled = true;
        const originalText = btnResetPrompts.innerHTML;
        btnResetPrompts.innerHTML = `Restableciendo...`;
        
        try {
          const response = await fetch('/api/ai/prompts', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reset: true })
          });
          
          if (response.ok) {
            const data = await response.json();
            loadedPrompts = data.prompts;
            updatePromptEditor();
            this.uiManager.showToast("Prompts restablecidos a valores por defecto.", "success");
          } else {
            throw new Error('Error al restablecer');
          }
        } catch (err) {
          console.error(err);
          this.uiManager.showToast("No se pudieron restablecer los prompts.", "error");
        } finally {
          btnResetPrompts.disabled = false;
          btnResetPrompts.innerHTML = originalText;
        }
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
          const selectContextDepth = document.getElementById("ai-context-depth");
          const contextDepth = selectContextDepth ? selectContextDepth.value : "all";
          
          // Realizar llamada al proxy
          const result = await AiService.generate(prompt, mode !== 'replace' ? currentState : null, mode, {
            contextDepth: contextDepth
          });

          if (!result || !result.tables || !Array.isArray(result.tables)) {
            throw new Error("El JSON retornado por la IA no tiene el formato correcto o está vacío.");
          }

          // Guardar estado actual para deshacer
          this.history.push(JSON.parse(JSON.stringify(currentState)));

          if (mode === 'replace') {
            this.stateManager.setState({
              tables: result.tables,
              relationships: result.relationships || [],
              groups: result.groups || []
            });
            this.uiManager.showToast("Diagrama generado por IA con éxito.", "success");
          } else if (mode === 'edit') {
            const currentTables = currentState.tables || [];
            const currentRelationships = currentState.relationships || [];
            const currentGroups = currentState.groups || [];

            const newTables = [];
            const tableIdMap = {};
            const fieldIdMap = {};
            const processedOriginalTableIds = new Set();

            result.tables.forEach(aiTable => {
              const originalTable = currentTables.find(t => t.id === aiTable.id) || 
                                    currentTables.find(t => t.name.toLowerCase() === aiTable.name.toLowerCase());
              const finalTableId = originalTable ? originalTable.id : (aiTable.id || `tbl-ai-${Date.now()}-${Math.floor(Math.random() * 1000)}`);
              tableIdMap[aiTable.id] = finalTableId;
              if (originalTable) processedOriginalTableIds.add(originalTable.id);

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

              // Si la tabla existía, mantener sus coordenadas x, y (a menos que no estén definidas) y su groupId
              newTables.push({
                id: finalTableId,
                name: aiTable.name,
                x: originalTable ? originalTable.x : (aiTable.x || 150),
                y: originalTable ? originalTable.y : (aiTable.y || 150),
                fields: finalFields,
                color: originalTable ? originalTable.color : (aiTable.color || "#6366f1"),
                groupId: originalTable ? originalTable.groupId : (aiTable.groupId || null)
              });
            });

            // Conservar tablas que no devolvió la IA, excepto si el prompt indica borrado explícito de tablas
            const isDeleteAction = /delete|remove|elimina|borra|quita/i.test(prompt);
            if (!isDeleteAction) {
              currentTables.forEach(t => {
                if (!processedOriginalTableIds.has(t.id)) {
                  newTables.push(t);
                }
              });
            }

            // Mapear relaciones
            const newRelationships = [];
            if (result.relationships && Array.isArray(result.relationships)) {
              result.relationships.forEach(rel => {
                const mappedFromTable = tableIdMap[rel.fromTable] || rel.fromTable;
                const mappedToTable = tableIdMap[rel.toTable] || rel.toTable;
                const mappedFromField = fieldIdMap[rel.fromField] || rel.fromField;
                const mappedToField = fieldIdMap[rel.toField] || rel.toField;

                if (mappedFromTable && mappedToTable && mappedFromField && mappedToField) {
                  newRelationships.push({
                    id: rel.id || `rel-ai-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                    fromTable: mappedFromTable,
                    fromField: mappedFromField,
                    toTable: mappedToTable,
                    toField: mappedToField
                  });
                }
              });
            }

            // Si no fue borrado, conservar relaciones antiguas donde ambas tablas sigan existiendo y no estén redefinidas
            if (!isDeleteAction) {
              currentRelationships.forEach(oldRel => {
                const tableFromStillExists = newTables.some(t => t.id === oldRel.fromTable);
                const tableToStillExists = newTables.some(t => t.id === oldRel.toTable);
                const relationshipAlreadyRedefined = newRelationships.some(
                  newRel => newRel.fromTable === oldRel.fromTable && newRel.toTable === oldRel.toTable
                );

                if (tableFromStillExists && tableToStillExists && !relationshipAlreadyRedefined) {
                  newRelationships.push(oldRel);
                }
              });
            }

            // Mapear grupos
            const newGroups = [];
            if (result.groups && Array.isArray(result.groups)) {
              result.groups.forEach(g => {
                const originalGroup = currentGroups.find(og => og.id === g.id) ||
                                      currentGroups.find(og => og.name.toLowerCase() === g.name.toLowerCase());
                newGroups.push({
                  id: originalGroup ? originalGroup.id : (g.id || `group-ai-${Date.now()}-${Math.floor(Math.random() * 100)}`),
                  name: g.name,
                  color: originalGroup ? originalGroup.color : (g.color || "#374151"),
                  x: originalGroup ? originalGroup.x : (g.x || 100),
                  y: originalGroup ? originalGroup.y : (g.y || 100),
                  width: originalGroup ? originalGroup.width : (g.width || 300),
                  height: originalGroup ? originalGroup.height : (g.height || 200)
                });
              });
            }

            // Conservar grupos antiguos que no se modificaron
            currentGroups.forEach(cg => {
              if (!newGroups.some(ng => ng.id === cg.id)) {
                newGroups.push(cg);
              }
            });

            this.stateManager.setState({
              tables: newTables,
              relationships: newRelationships,
              groups: newGroups
            });
            this.uiManager.showToast("Diagrama modificado por IA con éxito.", "success");

          } else if (mode === 'append') {
            // Modo agregar
            const currentTables = currentState.tables || [];
            const currentRelationships = currentState.relationships || [];
            const currentGroups = currentState.groups || [];

            const tableIdMap = {};
            const fieldIdMap = {};

            if (result.tables && Array.isArray(result.tables)) {
              result.tables.forEach(aiTable => {
                const uniqueTableId = `tbl-ai-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                tableIdMap[aiTable.id] = uniqueTableId;

                const finalFields = [];
                if (aiTable.fields && Array.isArray(aiTable.fields)) {
                  aiTable.fields.forEach(aiField => {
                    const uniqueFieldId = `f-ai-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
                    fieldIdMap[aiField.id] = uniqueFieldId;

                    finalFields.push({
                      id: uniqueFieldId,
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

                currentTables.push({
                  id: uniqueTableId,
                  name: aiTable.name,
                  x: aiTable.x || 150,
                  y: aiTable.y || 150,
                  fields: finalFields,
                  color: aiTable.color || "#10b981",
                  groupId: aiTable.groupId || null
                });
              });
            }

            if (result.relationships && Array.isArray(result.relationships)) {
              result.relationships.forEach(rel => {
                const mappedFromTable = tableIdMap[rel.fromTable] || rel.fromTable;
                const mappedToTable = tableIdMap[rel.toTable] || rel.toTable;
                const mappedFromField = fieldIdMap[rel.fromField] || rel.fromField;
                const mappedToField = fieldIdMap[rel.toField] || rel.toField;

                if (mappedFromTable && mappedToTable && mappedFromField && mappedToField) {
                  currentRelationships.push({
                    id: rel.id || `rel-ai-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                    fromTable: mappedFromTable,
                    fromField: mappedFromField,
                    toTable: mappedToTable,
                    toField: mappedToField
                  });
                }
              });
            }

            // Mapear grupos nuevos en modo append
            if (result.groups && Array.isArray(result.groups)) {
              result.groups.forEach(g => {
                currentGroups.push({
                  id: g.id || `group-ai-${Date.now()}-${Math.floor(Math.random() * 100)}`,
                  name: g.name,
                  color: g.color || "#374151",
                  x: g.x || 100,
                  y: g.y || 100,
                  width: g.width || 300,
                  height: g.height || 200
                });
              });
            }

            this.stateManager.setState({
              tables: currentTables,
              relationships: currentRelationships,
              groups: currentGroups
            });
            this.uiManager.showToast("Elementos agregados por IA con éxito.", "success");
          }

          // Determinar si debemos ejecutar autoLayout
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
      
      const result = await AiService.generate(layoutPrompt, state, 'layout', { contextDepth: 'layout' });

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

      // Mezclar grupos
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
}
