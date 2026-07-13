// src/controllers/AiController.js
import { AiService } from '../services/AiService.js';
import { LayoutEngine } from '../core/LayoutEngine.js';

export class AiController {
  constructor({ stateManager, uiManager, history, canvasManager, autoLayout, getSelectedTableIds, onTableSelect }) {
    this.stateManager = stateManager;
    this.uiManager = uiManager;
    this.history = history;
    this.canvasManager = canvasManager;
    this.autoLayout = autoLayout;
    this.getSelectedTableIds = getSelectedTableIds;
    this.onTableSelect = onTableSelect;
  }

  init() {
    this.setupAiModal();
    // Sincronizar y enmascarar la configuración del servidor en segundo plano
    AiService.fetchConfigFromServer().catch(err => console.error("Error al inicializar la configuración de IA:", err));
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

    // Triggers and Header Elements
    const btnConfigTrigger = document.getElementById("btn-ai-config-trigger");
    const iconSparkles = document.getElementById("ai-modal-icon-sparkles");
    const iconSettings = document.getElementById("ai-modal-icon-settings");
    const titleText = document.getElementById("ai-modal-title-text");
    const tabsContainer = document.getElementById("ai-tabs-container");

    let currentModalMode = 'assistant'; // 'assistant' or 'settings'

    // Config Fields
    const selectProvider = document.getElementById("ai-provider");
    const inputModel = document.getElementById("ai-model");
    const selectModel = document.getElementById("ai-model-select");
    const btnSyncModels = document.getElementById("btn-sync-models");
    const customModelGroup = document.getElementById("ai-custom-model-group");
    const btnTestConnection = document.getElementById("btn-test-ai-connection");
    const testConnectionStatus = document.getElementById("ai-test-connection-status");
    const inputApiKey = document.getElementById("ai-apikey");
    const inputApiUrl = document.getElementById("ai-apiurl");
    const btnSaveConfig = document.getElementById("btn-save-ai-config");
    const checkboxThinking = document.getElementById("ai-enable-thinking");

    // Assistant Fields
    const textareaPrompt = document.getElementById("ai-prompt");
    const btnGenerate = document.getElementById("btn-ai-generate");
    const statusLog = document.getElementById("ai-status-log");
    const selectMode = document.getElementById("ai-generation-mode");
    const selectContextDepth = document.getElementById("ai-context-depth");

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

    const DEFAULT_MODELS = {
      gemini: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp', 'gemini-2.5-flash'],
      openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo', 'o1-mini', 'o3-mini'],
      ollama: ['qwen2.5-coder', 'llama3', 'mistral', 'codegemma'],
      vllm: ['Qwen/Qwen2.5-Coder-7B-Instruct', 'meta-llama/Meta-Llama-3-8B-Instruct'],
      litellm: ['qwen2.5-coder', 'gpt-4o-mini'],
      'custom-openai': []
    };

    const populateModelsList = async (provider, selectedValue = '') => {
      if (!selectModel) return;
      selectModel.innerHTML = "";

      // Add loading option
      selectModel.innerHTML = `<option value="">Cargando modelos...</option>`;

      let models = [];
      const config = {
        provider: provider,
        apiKey: inputApiKey ? inputApiKey.value.trim() : '',
        apiUrl: inputApiUrl ? inputApiUrl.value.trim() : ''
      };

      try {
        const requiresApiKey = ['gemini', 'openai'].includes(provider);
        const requiresUrl = ['ollama', 'vllm', 'litellm', 'custom-openai'].includes(provider);

        if ((requiresApiKey && config.apiKey) || (requiresUrl && config.apiUrl) || (!requiresApiKey && !requiresUrl)) {
          models = await AiService.fetchModels(config);
        }
      } catch (err) {
        console.warn("No se pudieron obtener modelos del servidor, usando predefinidos:", err.message);
      }

      if (!models || models.length === 0) {
        const defaults = DEFAULT_MODELS[provider] || [];
        models = defaults.map(m => ({ id: m, name: m }));
      }

      selectModel.innerHTML = "";

      if (models.length === 0) {
        const optCustom = document.createElement("option");
        optCustom.value = "custom";
        optCustom.textContent = "Personalizado (especificar...)";
        selectModel.appendChild(optCustom);
      } else {
        models.forEach(m => {
          const opt = document.createElement("option");
          opt.value = m.id;
          opt.textContent = m.name;
          selectModel.appendChild(opt);
        });

        const optCustom = document.createElement("option");
        optCustom.value = "custom";
        optCustom.textContent = "Otro / Personalizado (especificar...)";
        selectModel.appendChild(optCustom);
      }

      const optionsArray = Array.from(selectModel.options).map(o => o.value);
      if (selectedValue && optionsArray.includes(selectedValue)) {
        selectModel.value = selectedValue;
        if (customModelGroup) customModelGroup.classList.add("hidden");
      } else if (selectedValue) {
        selectModel.value = "custom";
        if (inputModel) inputModel.value = selectedValue;
        if (customModelGroup) customModelGroup.classList.remove("hidden");
      } else {
        if (selectModel.value !== 'custom') {
          if (inputModel) inputModel.value = selectModel.value;
          if (customModelGroup) customModelGroup.classList.add("hidden");
        } else {
          if (customModelGroup) customModelGroup.classList.remove("hidden");
        }
      }
    };

    if (selectModel) {
      selectModel.addEventListener("change", (e) => {
        if (e.target.value === "custom") {
          if (customModelGroup) customModelGroup.classList.remove("hidden");
          if (inputModel) {
            inputModel.value = "";
            inputModel.focus();
          }
        } else {
          if (customModelGroup) customModelGroup.classList.add("hidden");
          if (inputModel) inputModel.value = e.target.value;
        }
      });
    }

    if (btnSyncModels) {
      btnSyncModels.addEventListener("click", async () => {
        btnSyncModels.disabled = true;
        const currentIcon = btnSyncModels.innerHTML;
        btnSyncModels.innerHTML = `<span class="spinner-loader" style="width: 14px; height: 14px; border-width: 2px;"></span>`;
        
        try {
          const provider = selectProvider ? selectProvider.value : 'gemini';
          const currentVal = inputModel ? inputModel.value.trim() : '';
          await populateModelsList(provider, currentVal);
          this.uiManager.showToast("Modelos sincronizados correctamente.", "success");
        } catch (err) {
          this.uiManager.showToast("Error al sincronizar modelos: " + err.message, "error");
        } finally {
          btnSyncModels.disabled = false;
          btnSyncModels.innerHTML = currentIcon;
          if (window.lucide) window.lucide.createIcons();
        }
      });
    }

    if (btnTestConnection) {
      btnTestConnection.addEventListener("click", async () => {
        btnTestConnection.disabled = true;
        if (testConnectionStatus) {
          testConnectionStatus.innerHTML = `<i data-lucide="loader" class="animate-spin" style="width: 14px; height: 14px; color: var(--color-primary);"></i> <span style="color: var(--color-text-muted);">Probando...</span>`;
          if (window.lucide) window.lucide.createIcons();
        }

        const config = {
          provider: selectProvider ? selectProvider.value : 'gemini',
          model: inputModel ? inputModel.value.trim() : '',
          apiKey: inputApiKey ? inputApiKey.value.trim() : '',
          apiUrl: inputApiUrl ? inputApiUrl.value.trim() : '',
          enableThinking: checkboxThinking ? checkboxThinking.checked : false
        };

        const requiresApiKey = ['gemini', 'openai'].includes(config.provider);
        if (requiresApiKey && !config.apiKey) {
          this.uiManager.showToast("La clave API es requerida para probar la conexión.", "error");
          btnTestConnection.disabled = false;
          if (testConnectionStatus) {
            testConnectionStatus.innerHTML = `<i data-lucide="x-circle" style="width: 14px; height: 14px; color: #ef4444;"></i> <span style="color: #ef4444; font-weight: 500;">Falta API Key</span>`;
            if (window.lucide) window.lucide.createIcons();
          }
          return;
        }

        const requiresUrl = ['ollama', 'vllm', 'litellm', 'custom-openai'].includes(config.provider);
        if (requiresUrl && !config.apiUrl) {
          this.uiManager.showToast("La URL del servidor es requerida para probar la conexión.", "error");
          btnTestConnection.disabled = false;
          if (testConnectionStatus) {
            testConnectionStatus.innerHTML = `<i data-lucide="x-circle" style="width: 14px; height: 14px; color: #ef4444;"></i> <span style="color: #ef4444; font-weight: 500;">Falta URL</span>`;
            if (window.lucide) window.lucide.createIcons();
          }
          return;
        }

        try {
          await AiService.testConnection(config);
          if (testConnectionStatus) {
            testConnectionStatus.innerHTML = `<i data-lucide="check-circle" style="width: 14px; height: 14px; color: #10b981;"></i> <span style="color: #10b981; font-weight: 600;">Exitosa</span>`;
          }
          this.uiManager.showToast("Conexión con el proveedor de IA establecida con éxito.", "success");
        } catch (err) {
          console.error(err);
          if (testConnectionStatus) {
            testConnectionStatus.innerHTML = `<i data-lucide="x-circle" style="width: 14px; height: 14px; color: #ef4444;"></i> <span style="color: #ef4444; font-weight: 500;" title="${err.message}">Fallida</span>`;
          }
          this.uiManager.showToast("La prueba de conexión falló: " + err.message, "error");
        } finally {
          btnTestConnection.disabled = false;
          if (window.lucide) window.lucide.createIcons();
        }
      });
    }

    const openConfigModal = async () => {
      const config = await AiService.fetchConfigFromServer();
      if (selectProvider) selectProvider.value = config.provider;
      if (inputModel) inputModel.value = config.model;
      if (inputApiKey) inputApiKey.value = config.apiKey;
      if (inputApiUrl) inputApiUrl.value = config.apiUrl;
      if (checkboxThinking) checkboxThinking.checked = !!config.enableThinking;

      if (testConnectionStatus) {
        testConnectionStatus.innerHTML = `<span style="font-style: italic;">Sin verificar</span>`;
      }

      // Mostrar/ocultar inputs según el proveedor
      toggleProviderFields(config.provider);

      // Poblar el selector de modelos con el valor seleccionado actualmente
      populateModelsList(config.provider, config.model);

      // Pre-cargar prompts en segundo plano
      loadPromptsFromServer();
    };

    const renderAiTableCheckboxList = () => {
      const listContainer = document.getElementById("ai-table-checkboxes-list");
      if (!listContainer) return;
      listContainer.innerHTML = "";

      const state = this.stateManager.getState();
      const tables = state.tables || [];
      const groups = state.groups || [];
      const selectedIds = this.getSelectedTableIds ? this.getSelectedTableIds() : new Set();

      if (tables.length === 0) {
        listContainer.innerHTML = `<span style="font-size: 0.8rem; color: var(--color-text-muted);">No hay tablas en el diagrama.</span>`;
        return;
      }

      // Group tables by groupId
      const tablesByGroup = {};
      const ungroupedTables = [];

      tables.forEach(table => {
        if (table.groupId) {
          if (!tablesByGroup[table.groupId]) {
            tablesByGroup[table.groupId] = [];
          }
          tablesByGroup[table.groupId].push(table);
        } else {
          ungroupedTables.push(table);
        }
      });

      const createCheckboxItem = (table) => {
        const div = document.createElement("div");
        div.className = "form-check";
        div.style.display = "flex";
        div.style.alignItems = "center";
        div.style.gap = "8px";
        div.style.paddingLeft = "4px";

        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "form-check-input";
        input.id = `ai-chk-table-${table.id}`;
        input.checked = selectedIds.has(table.id);
        input.style.cursor = "pointer";

        input.addEventListener("change", () => {
          if (this.onTableSelect) {
            this.onTableSelect(table.id, true);
          }
          updateContextDepthOptionText();
        });

        const label = document.createElement("label");
        label.className = "form-check-label";
        label.htmlFor = `ai-chk-table-${table.id}`;
        label.textContent = table.name;
        label.style.cursor = "pointer";
        label.style.fontSize = "0.85rem";
        label.style.color = "var(--color-text-main)";

        div.appendChild(input);
        div.appendChild(label);
        return div;
      };

      const updateContextDepthOptionText = () => {
        if (selectContextDepth) {
          const selectedOption = selectContextDepth.querySelector('option[value="selected"]');
          if (selectedOption) {
            const currentSelected = this.getSelectedTableIds ? this.getSelectedTableIds() : new Set();
            selectedOption.textContent = currentSelected.size > 0 ? `Solo tablas seleccionadas (${currentSelected.size})` : "Solo tablas seleccionadas (Seleccionar...)";
          }
        }
      };

      // 1. Render Grouped Tables
      groups.forEach(group => {
        const groupTables = tablesByGroup[group.id] || [];
        if (groupTables.length === 0) return;

        const groupDiv = document.createElement("div");
        groupDiv.style.marginBottom = "8px";

        const groupHeader = document.createElement("div");
        groupHeader.style.fontSize = "0.75rem";
        groupHeader.style.fontWeight = "600";
        groupHeader.style.color = group.color || "var(--color-primary)";
        groupHeader.style.marginBottom = "4px";
        groupHeader.style.display = "flex";
        groupHeader.style.alignItems = "center";
        groupHeader.style.gap = "6px";
        groupHeader.innerHTML = `<i data-lucide="folder" style="width: 12px; height: 12px; display: inline-block;"></i> ${group.name}`;
        groupDiv.appendChild(groupHeader);

        const itemsDiv = document.createElement("div");
        itemsDiv.style.paddingLeft = "16px";
        itemsDiv.style.display = "flex";
        itemsDiv.style.flexDirection = "column";
        itemsDiv.style.gap = "4px";

        groupTables.forEach(table => {
          itemsDiv.appendChild(createCheckboxItem(table));
        });

        groupDiv.appendChild(itemsDiv);
        listContainer.appendChild(groupDiv);
      });

      // 2. Render Ungrouped Tables
      if (ungroupedTables.length > 0) {
        const ungroupedDiv = document.createElement("div");
        ungroupedDiv.style.marginBottom = "8px";

        if (groups.length > 0) {
          const ungroupedHeader = document.createElement("div");
          ungroupedHeader.style.fontSize = "0.75rem";
          ungroupedHeader.style.fontWeight = "600";
          ungroupedHeader.style.color = "var(--color-text-muted)";
          ungroupedHeader.style.marginBottom = "4px";
          ungroupedHeader.textContent = "Sin Grupo / Generales";
          ungroupedDiv.appendChild(ungroupedHeader);
        }

        const itemsDiv = document.createElement("div");
        if (groups.length > 0) {
          itemsDiv.style.paddingLeft = "16px";
        }
        itemsDiv.style.display = "flex";
        itemsDiv.style.flexDirection = "column";
        itemsDiv.style.gap = "4px";

        ungroupedTables.forEach(table => {
          itemsDiv.appendChild(createCheckboxItem(table));
        });

        ungroupedDiv.appendChild(itemsDiv);
        listContainer.appendChild(ungroupedDiv);
      }

      if (window.lucide) window.lucide.createIcons();
    };

    const updateContextDepthOptions = () => {
      if (!selectContextDepth) return;
      
      let selectedOption = selectContextDepth.querySelector('option[value="selected"]');
      if (!selectedOption) {
        selectedOption = document.createElement("option");
        selectedOption.value = "selected";
        selectContextDepth.appendChild(selectedOption);
      }

      const selectedIds = this.getSelectedTableIds ? this.getSelectedTableIds() : new Set();
      const count = selectedIds ? selectedIds.size : 0;
      
      selectedOption.disabled = false;
      selectedOption.textContent = count > 0 ? `Solo tablas seleccionadas (${count})` : "Solo tablas seleccionadas (Seleccionar...)";

      const tableSelectorGroup = document.getElementById("ai-table-selector-group");
      if (selectContextDepth.value === "selected") {
        if (tableSelectorGroup) tableSelectorGroup.classList.remove("hidden");
        renderAiTableCheckboxList();
      } else {
        if (count > 0) {
          selectContextDepth.value = "selected";
          if (tableSelectorGroup) tableSelectorGroup.classList.remove("hidden");
          renderAiTableCheckboxList();
        } else {
          if (tableSelectorGroup) tableSelectorGroup.classList.add("hidden");
        }
      }
    };

    if (selectContextDepth) {
      selectContextDepth.addEventListener("change", () => {
        const tableSelectorGroup = document.getElementById("ai-table-selector-group");
        if (selectContextDepth.value === "selected") {
          if (tableSelectorGroup) tableSelectorGroup.classList.remove("hidden");
          renderAiTableCheckboxList();
        } else {
          if (tableSelectorGroup) tableSelectorGroup.classList.add("hidden");
        }
      });
    }

    if (btnTrigger) {
      btnTrigger.addEventListener("click", () => {
        currentModalMode = 'assistant';
        openConfigModal();
        switchTab("assistant");
        updateContextDepthOptions();
        this.uiManager.openAiModal(modal);
      });
    }

    if (btnDashboardConfig) {
      btnDashboardConfig.addEventListener("click", () => {
        currentModalMode = 'settings';
        openConfigModal();
        switchTab("config");
        this.uiManager.openAiModal(modal);
      });
    }

    if (btnConfigTrigger) {
      btnConfigTrigger.addEventListener("click", () => {
        currentModalMode = 'settings';
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

    const panel = document.getElementById("ai-loading-panel");
    const btnMinimizePanel = document.getElementById("btn-minimize-ai-panel");
    const btnClosePanel = document.getElementById("btn-close-ai-panel");
    const panelBody = document.getElementById("ai-loading-panel-body");
    const iconMinimize = document.getElementById("icon-ai-panel-minimize");

    if (btnMinimizePanel && panelBody && iconMinimize) {
      btnMinimizePanel.addEventListener("click", () => {
        panelBody.classList.toggle("hidden");
        if (panelBody.classList.contains("hidden")) {
          iconMinimize.setAttribute("data-lucide", "chevron-up");
        } else {
          iconMinimize.setAttribute("data-lucide", "chevron-down");
        }
        if (window.lucide) window.lucide.createIcons();
      });
    }

    if (btnClosePanel && panel) {
      btnClosePanel.addEventListener("click", () => {
        panel.classList.add("hidden");
        if (panelBody) panelBody.classList.remove("hidden");
        if (iconMinimize) iconMinimize.setAttribute("data-lucide", "chevron-down");
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
        const provider = e.target.value;
        toggleProviderFields(provider);
        
        let defaultModel = '';
        if (provider === 'gemini') {
          defaultModel = 'gemini-1.5-flash';
        } else if (provider === 'openai') {
          defaultModel = 'gpt-4o-mini';
        } else if (provider === 'ollama') {
          defaultModel = 'qwen2.5-coder';
        } else if (provider === 'vllm') {
          defaultModel = 'Qwen/Qwen2.5-Coder-7B-Instruct';
        } else if (provider === 'litellm') {
          defaultModel = 'qwen2.5-coder';
        } else if (provider === 'custom-openai') {
          defaultModel = '';
        }

        if (inputModel) {
          inputModel.value = defaultModel;
          if (provider === 'custom-openai') {
            inputModel.placeholder = "ej: llama-3.1-8b-instant";
          }
        }

        if (testConnectionStatus) {
          testConnectionStatus.innerHTML = `<span style="font-style: italic;">Sin verificar</span>`;
        }

        populateModelsList(provider, defaultModel);
      });
    }

    // Tabs switching helper
    function switchTab(tab) {
      const isDashboard = !window.location.search.includes("project=");
      const isSettingsMode = isDashboard || currentModalMode === 'settings';

      if (isSettingsMode && tab === "assistant") {
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

      // Configurar visibilidad del contenedor de pestañas
      if (tabsContainer) {
        tabsContainer.style.display = isSettingsMode ? "flex" : "none";
      }

      // Ocultar la pestaña del Asistente en modo configuración, y viceversa
      if (tabAssistant) {
        tabAssistant.style.display = isSettingsMode ? "none" : "block";
      }
      if (tabConfig) {
        tabConfig.style.display = isSettingsMode ? "block" : "none";
      }
      if (tabPrompts) {
        tabPrompts.style.display = isSettingsMode ? "block" : "none";
      }

      // Modificar el título e icono del modal de forma dinámica
      if (isSettingsMode) {
        if (iconSparkles) iconSparkles.classList.add("hidden");
        if (iconSettings) iconSettings.classList.remove("hidden");
        if (titleText) titleText.textContent = "Configuración de IA y Prompts";
      } else {
        if (iconSparkles) iconSparkles.classList.remove("hidden");
        if (iconSettings) iconSettings.classList.add("hidden");
        if (titleText) titleText.textContent = "Asistente de IA";
      }
    }

    if (tabAssistant && tabConfig && tabPrompts) {
      tabAssistant.addEventListener("click", () => switchTab("assistant"));
      tabConfig.addEventListener("click", () => switchTab("config"));
      tabPrompts.addEventListener("click", () => switchTab("prompts"));
    }

    // Save Config
    if (btnSaveConfig) {
      btnSaveConfig.addEventListener("click", async () => {
        const config = {
          provider: selectProvider.value,
          model: inputModel.value.trim(),
          apiKey: inputApiKey.value.trim(),
          apiUrl: inputApiUrl.value.trim(),
          enableThinking: checkboxThinking ? checkboxThinking.checked : false
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

        btnSaveConfig.disabled = true;
        const originalText = btnSaveConfig.textContent;
        btnSaveConfig.textContent = "Guardando...";

        try {
          await AiService.saveConfig(config);
          this.uiManager.showToast("Configuración de IA guardada.", "success");
          this.uiManager.closeAiModal(modal);
        } catch (err) {
          this.uiManager.showToast("Error al guardar configuración: " + err.message, "error");
        } finally {
          btnSaveConfig.disabled = false;
          btnSaveConfig.textContent = originalText;
        }
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
            this.uiManager.closeAiModal(modal);
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

        this.uiManager.showAiProgress("connecting", `Conectando con ${config.provider}...`, 5);
        this.uiManager.addAiLog(`Iniciando conexión con ${config.provider}`);

        try {
          const mode = selectMode ? selectMode.value : "replace";
          const currentState = this.stateManager.getState();
          const selectContextDepth = document.getElementById("ai-context-depth");
          const contextDepth = selectContextDepth ? selectContextDepth.value : "all";

          this.uiManager.showAiProgress("thinking", "Analizando el prompt y contexto...", 20);
          this.uiManager.addAiLog("Analizando requerimientos del prompt");
          
          // Realizar llamada al proxy
          const result = await AiService.generate(prompt, mode !== 'replace' ? currentState : null, mode, {
            contextDepth: contextDepth,
            selectedTableIds: this.getSelectedTableIds ? Array.from(this.getSelectedTableIds()) : []
          });

          if (!result || !result.tables || !Array.isArray(result.tables)) {
            throw new Error("El JSON retornado por la IA no tiene el formato correcto o está vacío.");
          }

          this.uiManager.showAiProgress("generating", "Generando estructura del diagrama...", 55);
          this.uiManager.addAiLog(`Generadas ${result.tables.length} tabla(s)`);

          // Guardar estado actual para deshacer
          this.history.push(JSON.parse(JSON.stringify(currentState)));

          if (mode === 'replace') {
            this.uiManager.showAiProgress("processing", "Aplicando cambios al diagrama...", 75);
            this.uiManager.addAiLog("Reemplazando diagrama completo");

            this.stateManager.setState({
              tables: result.tables,
              relationships: result.relationships || [],
              groups: result.groups || []
            });
            this.uiManager.showToast("Diagrama generado por IA con éxito.", "success");
          } else if (mode === 'edit') {
            this.uiManager.showAiProgress("processing", "Integrando cambios en el diagrama...", 70);
            this.uiManager.addAiLog("Modificando tablas existentes");
            const currentTables = currentState.tables || [];
            const currentRelationships = currentState.relationships || [];
            const currentGroups = currentState.groups || [];

            const newTables = [];
            const tableIdMap = {};
            const fieldIdMap = {};
            const processedOriginalTableIds = new Set();

            // Mapear grupos primero para tener el groupIdMap
            const newGroups = [];
            const groupIdMap = {};
            if (result.groups && Array.isArray(result.groups)) {
              result.groups.forEach(g => {
                const originalGroup = currentGroups.find(og => og.id === g.id) ||
                                      currentGroups.find(og => og.name.toLowerCase() === g.name.toLowerCase());
                const finalGroupId = originalGroup ? originalGroup.id : (g.id || `group-ai-${Date.now()}-${Math.floor(Math.random() * 100)}`);
                groupIdMap[g.id] = finalGroupId;

                newGroups.push({
                  id: finalGroupId,
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

            // Mapear tablas usando groupIdMap
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

              // Resolver groupId mapeando el ID retornado por la IA al ID real
              let finalGroupId = null;
              if (aiTable.groupId) {
                finalGroupId = groupIdMap[aiTable.groupId] || aiTable.groupId;
              } else if (originalTable) {
                finalGroupId = originalTable.groupId;
              }

              newTables.push({
                id: finalTableId,
                name: aiTable.name,
                x: originalTable ? originalTable.x : (aiTable.x || 150),
                y: originalTable ? originalTable.y : (aiTable.y || 150),
                fields: finalFields,
                color: originalTable ? originalTable.color : (aiTable.color || "#6366f1"),
                groupId: finalGroupId
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

            this.stateManager.setState({
              tables: newTables,
              relationships: newRelationships,
              groups: newGroups
            });
            this.uiManager.showToast("Diagrama modificado por IA con éxito.", "success");

          } else if (mode === 'append') {
            this.uiManager.showAiProgress("processing", "Agregando nuevas tablas...", 70);
            this.uiManager.addAiLog("Agregando elementos al diagrama");
            // Modo agregar
            const currentTables = currentState.tables || [];
            const currentRelationships = currentState.relationships || [];
            const currentGroups = currentState.groups || [];

            const tableIdMap = {};
            const fieldIdMap = {};
            const groupIdMap = {};

            // Mapear grupos primero para tener el groupIdMap
            if (result.groups && Array.isArray(result.groups)) {
              result.groups.forEach(g => {
                const originalGroup = currentGroups.find(og => og.id === g.id) ||
                                      currentGroups.find(og => og.name.toLowerCase() === g.name.toLowerCase());
                const finalGroupId = originalGroup ? originalGroup.id : (g.id || `group-ai-${Date.now()}-${Math.floor(Math.random() * 100)}`);
                groupIdMap[g.id] = finalGroupId;

                if (!originalGroup) {
                  currentGroups.push({
                    id: finalGroupId,
                    name: g.name,
                    color: g.color || "#374151",
                    x: g.x || 100,
                    y: g.y || 100,
                    width: g.width || 300,
                    height: g.height || 200
                  });
                }
              });
            }

            // Mapear tablas usando groupIdMap
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

                // Resolver groupId con mapeo o dejar el retornado por la IA si es preexistente
                let finalGroupId = null;
                if (aiTable.groupId) {
                  finalGroupId = groupIdMap[aiTable.groupId] || aiTable.groupId;
                }

                currentTables.push({
                  id: uniqueTableId,
                  name: aiTable.name,
                  x: aiTable.x || 150,
                  y: aiTable.y || 150,
                  fields: finalFields,
                  color: aiTable.color || "#10b981",
                  groupId: finalGroupId
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

          this.uiManager.showAiProgress("processing", "Organizando layout...", 90);

          if (mode === 'replace' || mode === 'append' || containsLayoutKeyword) {
            this.autoLayout();
          } else {
            this.stateManager.notify();
            this.canvasManager.fitToContent(this.stateManager.getState().tables);
          }

          this.uiManager.showAiProgress("complete", `¡Listo! ${result.tables.length} tabla(s) generada(s)`, 100);
          this.uiManager.addAiLog(`Resultado: ${result.tables.length} tabla(s), ${(result.relationships || []).length} relación(es)`);

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
          this.uiManager.showAiProgress("error", `Error: ${err.message}`, 0);
          this.uiManager.addAiLog(`ERROR: ${err.message}`);
          this.uiManager.showToast("La generación falló. Verifica el log en el modal.", "error");
        } finally {
          btnGenerate.disabled = false;
          btnGenerate.innerHTML = `<i data-lucide="sparkles" style="width: 14px; height: 14px; margin-right: 6px;"></i> Generar Diagrama con IA`;
          if (window.lucide) window.lucide.createIcons();
          this.uiManager.hideAiProgress();
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

    this.uiManager.showAiProgress("connecting", `Conectando con ${config.provider}...`, 10);
    this.uiManager.addAiLog("Iniciando auto-layout con IA");

    try {
      const payload = {
        provider: config.provider,
        apiKey: config.apiKey,
        apiUrl: config.apiUrl,
        model: config.model,
        enableThinking: !!config.enableThinking,
        currentState: state
      };

      this.uiManager.showAiProgress("thinking", "Agrupando tablas por dominio funcional...", 30);
      this.uiManager.addAiLog("Analizando dominios funcionales");

      const response = await fetch('/api/ai/layout-group', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const resData = await response.json();
      if (!resData.success || !Array.isArray(resData.groups) || !Array.isArray(resData.assignments)) {
        throw new Error("El formato del resultado devuelto por el servidor es inválido.");
      }

      this.uiManager.showAiProgress("generating", "Calculando coordenadas...", 60);
      this.uiManager.addAiLog(`Grupos detectados: ${resData.groups.length}`);

      // Merge new groups with existing ones to preserve custom settings
      const updatedGroups = resData.groups.map(aiGroup => {
        const existing = (state.groups || []).find(g => g.id === aiGroup.id);
        return {
          id: aiGroup.id,
          name: aiGroup.name,
          color: aiGroup.color,
          layoutCols: existing ? existing.layoutCols : null,
          layoutRows: existing ? existing.layoutRows : null,
          x: 0,
          y: 0,
          width: 300,
          height: 200
        };
      });

      // Preserve existing table-to-group assignments - no cambiar grupos de tablas que ya tienen uno válido
      const preservedGroupIds = new Map();
      state.tables.forEach(t => {
        if (t.groupId) {
          preservedGroupIds.set(t.id, t.groupId);
        }
      });

      const updatedTables = state.tables.map(origTable => {
        const asgn = resData.assignments.find(a => a.tableId === origTable.id);
        // Si la tabla ya tenía grupo existente, preservarlo incluso si la IA sugiere otro
        let finalGroupId = preservedGroupIds.has(origTable.id) ? preservedGroupIds.get(origTable.id) : (asgn ? asgn.groupId : null);
        return {
          ...origTable,
          groupId: finalGroupId
        };
      });

      // Stage 2: Layout each group grid locally
      const relativeTablesMap = {};
      updatedGroups.forEach(group => {
        const groupTables = updatedTables.filter(t => t.groupId === group.id);
        const layoutResult = LayoutEngine.layoutGroupGrid(groupTables, state.relationships || [], {
          cols: group.layoutCols,
          rows: group.layoutRows
        });
        
        group.width = layoutResult.groupWidth;
        group.height = layoutResult.groupHeight;
        relativeTablesMap[group.id] = layoutResult.tables;
      });

      // Stage 3: Shelf pack all groups and ungrouped tables
      const updatedGroupIds = new Set(updatedGroups.map(g => g.id));
      const ungroupedTables = updatedTables.filter(t => !t.groupId || !updatedGroupIds.has(t.groupId));
      const packingResult = LayoutEngine.shelfPackGroups(
        updatedGroups,
        ungroupedTables,
        state.relationships || [],
        relativeTablesMap
      );

      // Apply coordinates and group assignments back to original state tables
      const finalTables = state.tables.map(origTable => {
        const packedTable = packingResult.tables.find(t => t.id === origTable.id);
        if (packedTable) {
          return {
            ...origTable,
            x: packedTable.x,
            y: packedTable.y,
            groupId: packedTable.groupId
          };
        }
        return origTable;
      });

      this.history.push(JSON.parse(JSON.stringify(state)));

      this.uiManager.showAiProgress("processing", "Aplicando layout...", 85);
      this.uiManager.addAiLog("Aplicando posiciones finales");

      this.stateManager.setState({
        ...state,
        tables: finalTables,
        groups: packingResult.groups
      });

      this.canvasManager.fitToContent(finalTables);
      this.uiManager.showToast("Organizado con IA con éxito.", "success");

      this.uiManager.showAiProgress("complete", "¡Layout completado!", 100);
      this.uiManager.addAiLog(`${finalTables.length} tabla(s) organizadas en ${packingResult.groups.length} grupo(s)`);
    } catch (err) {
      console.error("Error al organizar con IA:", err);
      this.uiManager.showAiProgress("error", `Error: ${err.message}`, 0);
      this.uiManager.addAiLog(`ERROR: ${err.message}`);
      this.uiManager.showToast("La ordenación por IA falló: " + err.message, "error");
    } finally {
      if (btnAutoLayout) {
        btnAutoLayout.disabled = false;
        btnAutoLayout.innerHTML = originalHtml;
      }
      this.uiManager.hideAiProgress();
    }
  }
}
