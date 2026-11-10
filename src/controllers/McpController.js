// src/controllers/McpController.js

export class McpController {
  constructor({ projectId, stateManager, history, uiManager, diagramController }) {
    this.projectId = projectId;
    this.stateManager = stateManager;
    this.history = history;
    this.uiManager = uiManager;
    this.diagramController = diagramController;

    this.connections = [];
    this.activeConnectionId = null;
    this.editingId = null;
    this.onConnectionsChanged = null;

    // DOM references
    this.modal = document.getElementById('mcp-modal');
    this.triggerBtn = document.getElementById('btn-mcp-modal-trigger');
    this.closeBtn = document.getElementById('btn-close-mcp-modal');

    // Tabs & Panels
    this.tabListBtn = document.getElementById('btn-mcp-tab-list');
    this.tabAddBtn = document.getElementById('btn-mcp-tab-add');
    this.panelList = document.getElementById('mcp-panel-list');
    this.panelAdd = document.getElementById('mcp-panel-add');
    this.panelImport = document.getElementById('mcp-panel-import');
    this.connectionsListContainer = document.getElementById('mcp-connections-list');
    this.testStatusEl = document.getElementById('mcp-test-status');

    // Selective Import UI elements
    this.pendingSchema = null;
    this.pendingImportConn = null;
    this.selectedImportTableIds = new Set();
    this.importConnTitle = document.getElementById('mcp-import-conn-title');
    this.importSelectionCount = document.getElementById('mcp-import-selection-count');
    this.importSearchInput = document.getElementById('mcp-import-search');
    this.importPrefixSection = document.getElementById('mcp-import-prefix-section');
    this.importPrefixGroups = document.getElementById('mcp-import-prefix-groups');
    this.importTablesList = document.getElementById('mcp-import-tables-list');
    this.importGroupModeSelect = document.getElementById('mcp-import-group-mode');
    this.importGroupNameInput = document.getElementById('mcp-import-group-name');
    this.importExistingGroupSelect = document.getElementById('mcp-import-existing-group');
    this.importOverwriteCheckbox = document.getElementById('mcp-import-overwrite-existing');
    this.btnBackFromImport = document.getElementById('btn-mcp-back-from-import');
    this.btnSelectAll = document.getElementById('btn-mcp-select-all');
    this.btnDeselectAll = document.getElementById('btn-mcp-deselect-all');
    this.btnSelectRelated = document.getElementById('btn-mcp-select-related');
    this.btnCancelImport = document.getElementById('btn-mcp-cancel-import');
    this.btnConfirmImport = document.getElementById('btn-mcp-confirm-import');

    // Form inputs
    this.nameInput = document.getElementById('mcp-name-input');
    this.typeSelect = document.getElementById('mcp-type-select');
    this.sqlitePathInput = document.getElementById('mcp-sqlite-path');
    this.stdioCommandInput = document.getElementById('mcp-stdio-command');
    this.stdioArgsInput = document.getElementById('mcp-stdio-args');
    this.stdioEnvInput = document.getElementById('mcp-stdio-env');
    this.httpUrlInput = document.getElementById('mcp-http-url');
    this.readonlyCheckbox = document.getElementById('mcp-readonly-checkbox');
    this.saveBtn = document.getElementById('btn-mcp-save');
    this.cancelAddBtn = document.getElementById('btn-mcp-cancel-add');

    // Field containers
    this.fieldsSqlite = document.getElementById('mcp-fields-sqlite');
    this.fieldsStdio = document.getElementById('mcp-fields-stdio');
    this.fieldsHttp = document.getElementById('mcp-fields-http');
  }

  init() {
    this._setupEventListeners();
    if (this.projectId) {
      this.loadConnections();
    }
  }

  _setupEventListeners() {
    if (this.triggerBtn) {
      this.triggerBtn.addEventListener('click', () => this.openModal());
    }

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.closeModal());
    }

    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) this.closeModal();
      });
    }

    if (this.tabListBtn && this.tabAddBtn) {
      this.tabListBtn.addEventListener('click', () => this.switchTab('list'));
      this.tabAddBtn.addEventListener('click', () => this.switchTab('add'));
    }

    if (this.cancelAddBtn) {
      this.cancelAddBtn.addEventListener('click', () => this.switchTab('list'));
    }

    if (this.typeSelect) {
      this.typeSelect.addEventListener('change', () => this._handleTypeChange());
    }

    if (this.saveBtn) {
      this.saveBtn.addEventListener('click', () => this.saveConnection());
    }

    if (this.btnBackFromImport) {
      this.btnBackFromImport.addEventListener('click', () => this.switchTab('list'));
    }

    if (this.btnCancelImport) {
      this.btnCancelImport.addEventListener('click', () => this.switchTab('list'));
    }

    if (this.importSearchInput) {
      this.importSearchInput.addEventListener('input', () => this._renderImportTablesList());
    }

    if (this.btnSelectAll) {
      this.btnSelectAll.addEventListener('click', () => this._toggleVisibleTables(true));
    }

    if (this.btnDeselectAll) {
      this.btnDeselectAll.addEventListener('click', () => this._toggleVisibleTables(false));
    }

    if (this.btnSelectRelated) {
      this.btnSelectRelated.addEventListener('click', () => this._selectRelatedTables());
    }

    if (this.importGroupModeSelect) {
      this.importGroupModeSelect.addEventListener('change', () => this._handleImportGroupModeChange());
    }

    if (this.btnConfirmImport) {
      this.btnConfirmImport.addEventListener('click', () => this.executeSelectiveImport());
    }
  }

  openModal() {
    if (!this.modal) return;
    this.modal.classList.remove('hidden');
    this.switchTab('list');
    this.loadConnections();
    if (window.lucide) window.lucide.createIcons();
  }

  closeModal() {
    if (!this.modal) return;
    this.modal.classList.add('hidden');
    this._clearStatus();
  }

  switchTab(tab) {
    this.panelList?.classList.toggle('hidden', tab !== 'list');
    this.panelAdd?.classList.toggle('hidden', tab !== 'add');
    this.panelImport?.classList.toggle('hidden', tab !== 'import');

    if (tab === 'list') {
      this.tabListBtn?.classList.add('active-tab');
      this.tabAddBtn?.classList.remove('active-tab');
    } else if (tab === 'add') {
      this.tabListBtn?.classList.remove('active-tab');
      this.tabAddBtn?.classList.add('active-tab');
      this._resetForm();
    } else if (tab === 'import') {
      this.tabListBtn?.classList.remove('active-tab');
      this.tabAddBtn?.classList.remove('active-tab');
    }
    this.editingId = null;
    if (this.saveBtn) this.saveBtn.textContent = 'Guardar Conexión';
    this._clearStatus();
  }

  _handleTypeChange() {
    const type = this.typeSelect.value;
    if (this.fieldsSqlite) this.fieldsSqlite.classList.toggle('hidden', type !== 'builtin_sqlite');
    if (this.fieldsStdio) this.fieldsStdio.classList.toggle('hidden', type !== 'stdio');
    if (this.fieldsHttp) this.fieldsHttp.classList.toggle('hidden', type !== 'http');
  }

  editConnection(conn) {
    this.switchTab('add');
    this.editingId = conn.id;
    if (this.saveBtn) this.saveBtn.textContent = 'Actualizar Conexión';
    if (this.nameInput) this.nameInput.value = conn.name || '';
    if (this.typeSelect) this.typeSelect.value = conn.type;
    if (this.sqlitePathInput) this.sqlitePathInput.value = conn.db_path || 'data/app.db';
    if (this.stdioCommandInput) this.stdioCommandInput.value = conn.command || 'npx';
    if (this.stdioArgsInput) this.stdioArgsInput.value = conn.args || '';
    if (this.stdioEnvInput) this.stdioEnvInput.value = this._envToText(conn.env);
    if (this.httpUrlInput) this.httpUrlInput.value = conn.url || '';
    if (this.readonlyCheckbox) this.readonlyCheckbox.checked = conn.is_read_only === 1;
    this._handleTypeChange();
  }

  _resetForm() {
    if (this.nameInput) this.nameInput.value = '';
    if (this.typeSelect) this.typeSelect.value = 'builtin_sqlite';
    if (this.sqlitePathInput) this.sqlitePathInput.value = 'data/app.db';
    if (this.stdioCommandInput) this.stdioCommandInput.value = 'npx';
    if (this.stdioArgsInput) this.stdioArgsInput.value = '';
    if (this.stdioEnvInput) this.stdioEnvInput.value = '';
    if (this.httpUrlInput) this.httpUrlInput.value = '';
    if (this.readonlyCheckbox) this.readonlyCheckbox.checked = true;
    this._handleTypeChange();
  }

  async loadConnections() {
    if (!this.projectId) return;
    try {
      const res = await fetch(`/api/mcp-connections?project=${encodeURIComponent(this.projectId)}`);
      const data = await res.json();
      if (data.success) {
        this.connections = data.connections || [];
        this.renderConnectionsList();
        if (typeof this.onConnectionsChanged === 'function') {
          this.onConnectionsChanged(this.connections);
        }
      }
    } catch (err) {
      console.error('[McpController] Error al cargar conexiones:', err);
    }
  }

  renderConnectionsList() {
    if (!this.connectionsListContainer) return;
    this.connectionsListContainer.innerHTML = '';

    if (this.connections.length === 0) {
      this.connectionsListContainer.innerHTML = `
        <div style="text-align: center; padding: 30px 10px; color: var(--color-text-muted);">
          <i data-lucide="database" style="width: 36px; height: 36px; margin-bottom: 8px; opacity: 0.5;"></i>
          <p style="margin: 0; font-size: 0.85rem;">No hay conexiones configuradas para este proyecto.</p>
          <button id="btn-mcp-first-conn" class="btn btn-secondary" style="margin-top: 10px; font-size: 0.8rem; padding: 6px 12px;">
            <i data-lucide="plus" style="width: 14px; height: 14px;"></i> Crear primera conexión
          </button>
        </div>
      `;
      const firstBtn = document.getElementById('btn-mcp-first-conn');
      if (firstBtn) {
        firstBtn.addEventListener('click', () => this.switchTab('add'));
      }
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    this.connections.forEach(conn => {
      const card = document.createElement('div');
      card.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        background: var(--color-bg-tertiary);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        gap: 12px;
      `;

      const typeLabel = conn.type === 'builtin_sqlite' 
        ? 'SQLite Nativo' 
        : conn.type === 'stdio' 
        ? 'MCP Stdio (CLI)' 
        : 'MCP HTTP/SSE';

      const readOnlyBadge = conn.is_read_only === 1
        ? `<span style="background: rgba(16, 185, 129, 0.15); color: #10b981; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 500;">Sólo Lectura</span>`
        : `<span style="background: rgba(239, 68, 68, 0.15); color: #ef4444; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 500;">Lectura/Escritura</span>`;

      card.innerHTML = `
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <strong style="font-size: 0.9rem; color: var(--color-text-main);">${this._escape(conn.name)}</strong>
            <span style="background: rgba(99, 102, 241, 0.15); color: #818cf8; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 500;">${typeLabel}</span>
            ${readOnlyBadge}
          </div>
          <div style="font-size: 0.75rem; color: var(--color-text-muted); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
            ${conn.type === 'builtin_sqlite' ? `Archivo: ${this._escape(conn.db_path || 'data/app.db')}` : ''}
            ${conn.type === 'stdio' ? `Comando: ${this._escape(conn.command || '')} ${this._escape(conn.args || '')}` : ''}
            ${conn.type === 'http' ? `URL: ${this._escape(conn.url || '')}` : ''}
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          <button class="btn btn-secondary btn-mcp-test" data-id="${conn.id}" style="font-size: 0.78rem; padding: 5px 9px;" title="Probar conexión y listar herramientas">
            <i data-lucide="check-circle" style="width: 13px; height: 13px; color: #10b981;"></i> Probar
          </button>
          <button class="btn btn-primary btn-mcp-introspect" data-id="${conn.id}" style="font-size: 0.78rem; padding: 5px 9px;" title="Importar esquema y tablas al diagrama">
            <i data-lucide="download" style="width: 13px; height: 13px;"></i> Importar Esquema
          </button>
          <button class="btn btn-secondary btn-mcp-edit" data-id="${conn.id}" style="font-size: 0.78rem; padding: 5px 9px;" title="Editar conexión">
            <i data-lucide="pencil" style="width: 13px; height: 13px;"></i>
          </button>
          <button class="btn btn-danger-outline btn-mcp-delete" data-id="${conn.id}" style="font-size: 0.78rem; padding: 5px 9px;" title="Eliminar conexión">
            <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>
          </button>
        </div>
      `;

      // Event handlers
      card.querySelector('.btn-mcp-test').addEventListener('click', () => this.testConnection(conn.id));
      card.querySelector('.btn-mcp-introspect').addEventListener('click', () => this.introspectConnection(conn.id));
      card.querySelector('.btn-mcp-edit').addEventListener('click', () => this.editConnection(conn));
      card.querySelector('.btn-mcp-delete').addEventListener('click', () => this.deleteConnection(conn.id));

      this.connectionsListContainer.appendChild(card);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  async saveConnection() {
    const name = this.nameInput?.value.trim();
    const type = this.typeSelect?.value;

    if (!name) {
      this.uiManager.showToast('El nombre de la conexión es requerido.', 'error');
      return;
    }

    const payload = {
      ...(this.editingId ? { id: this.editingId } : {}),
      projectId: this.projectId,
      name,
      type,
      is_read_only: this.readonlyCheckbox?.checked ? 1 : 0
    };

    if (type === 'builtin_sqlite') {
      payload.db_path = this.sqlitePathInput?.value.trim() || 'data/app.db';
    } else if (type === 'stdio') {
      payload.command = this.stdioCommandInput?.value.trim() || 'npx';
      payload.args = this.stdioArgsInput?.value.trim() || '';
      payload.env = this._parseEnvText(this.stdioEnvInput?.value || '');
    } else if (type === 'http') {
      payload.url = this.httpUrlInput?.value.trim();
      if (!payload.url) {
        this.uiManager.showToast('La URL HTTP del servidor MCP es requerida.', 'error');
        return;
      }
    }

    try {
      this.saveBtn.disabled = true;
      const res = await fetch('/api/mcp-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        this.uiManager.showToast('Conexión guardada con éxito.', 'success');
        await this.loadConnections();
        this.switchTab('list');
      } else {
        this.uiManager.showToast(data.error || 'Error al guardar conexión.', 'error');
      }
    } catch (err) {
      this.uiManager.showToast('Error de red al guardar conexión.', 'error');
    } finally {
      this.saveBtn.disabled = false;
    }
  }

  async deleteConnection(id) {
    if (!confirm('¿Estás seguro de eliminar esta conexión MCP?')) return;
    try {
      const res = await fetch('/api/mcp-connections/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.success) {
        this.uiManager.showToast('Conexión eliminada.', 'success');
        await this.loadConnections();
      } else {
        this.uiManager.showToast(data.error || 'Error al eliminar.', 'error');
      }
    } catch (err) {
      this.uiManager.showToast('Error de red al eliminar conexión.', 'error');
    }
  }

  async testConnection(id) {
    this._showStatus('Probando conexión MCP...', 'info');
    try {
      const res = await fetch('/api/mcp-connections/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.success) {
        const toolsCount = data.result?.tools?.length || 0;
        const toolsList = (data.result?.tools || []).map(t => t.name).join(', ');
        this._showStatus(`✅ Conexión exitosa. Herramientas MCP detectadas (${toolsCount}): ${toolsList}`, 'success');
        this.uiManager.showToast('Conexión MCP verificada.', 'success');
      } else {
        this._showStatus(`❌ Error de conexión: ${data.error}`, 'error');
        this.uiManager.showToast(`Error: ${data.error}`, 'error');
      }
    } catch (err) {
      this._showStatus(`❌ Error de red al probar conexión: ${err.message}`, 'error');
    }
  }

  async introspectConnection(id) {
    const conn = this.connections.find(c => c.id === id);
    this._showStatus('Obteniendo lista de tablas y esquema vía MCP...', 'info');
    try {
      const res = await fetch('/api/mcp-connections/introspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.success && data.schema) {
        const { tables = [] } = data.schema;
        if (tables.length === 0) {
          this.uiManager.showToast('No se encontraron tablas en la base de datos.', 'info');
          this._showStatus('No se encontraron tablas en la base de datos.', 'info');
          return;
        }

        this._openSelectiveImportPanel(conn || { id, name: 'Base de Datos' }, data.schema);
      } else {
        this._showStatus(`❌ Error en introspección: ${data.error}`, 'error');
        this.uiManager.showToast(data.error || 'Error al obtener esquema', 'error');
      }
    } catch (err) {
      this._showStatus(`❌ Error de red: ${err.message}`, 'error');
      this.uiManager.showToast('Error de red al introspeccionar', 'error');
    }
  }

  _extractTablePrefix(tableName) {
    if (!tableName) return '';
    const idx = tableName.indexOf('_');
    if (idx > 0 && idx <= 15) {
      return tableName.slice(0, idx).toLowerCase();
    }
    return '';
  }

  _getPrefixGroupsMap(tables) {
    const rawCounts = new Map();
    tables.forEach(t => {
      const p = this._extractTablePrefix(t.name);
      if (p) {
        if (!rawCounts.has(p)) rawCounts.set(p, []);
        rawCounts.get(p).push(t);
      }
    });

    const groups = new Map();
    const ungrouped = [];

    tables.forEach(t => {
      const p = this._extractTablePrefix(t.name);
      if (p && rawCounts.get(p).length >= 2) {
        const key = `${p}_*`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(t);
      } else {
        ungrouped.push(t);
      }
    });

    if (groups.size > 0 && ungrouped.length > 0) {
      groups.set('Otros / Sin prefijo', ungrouped);
    }

    return groups;
  }

  _openSelectiveImportPanel(conn, schema) {
    this.pendingImportConn = conn;
    this.pendingSchema = schema;

    const currentState = this.stateManager.getState();
    const existingNames = new Set((currentState.tables || []).map(t => t.name.toLowerCase()));

    // Pre-select tables that are not yet in the diagram (or all if all are already in the diagram)
    this.selectedImportTableIds = new Set();
    const newTables = (schema.tables || []).filter(t => !existingNames.has(t.name.toLowerCase()));
    if (newTables.length > 0) {
      newTables.forEach(t => this.selectedImportTableIds.add(t.id));
    } else {
      (schema.tables || []).forEach(t => this.selectedImportTableIds.add(t.id));
    }

    if (this.importConnTitle) {
      this.importConnTitle.textContent = `Importar desde: ${conn.name} (${schema.tables.length} tablas)`;
    }
    if (this.importSearchInput) {
      this.importSearchInput.value = '';
    }
    if (this.importGroupNameInput) {
      this.importGroupNameInput.value = conn.name || 'Importación MCP';
    }
    if (this.importOverwriteCheckbox) {
      this.importOverwriteCheckbox.checked = false;
    }

    // Populate existing diagram groups
    const existingGroups = currentState.groups || [];
    if (this.importExistingGroupSelect) {
      this.importExistingGroupSelect.innerHTML = '';
      existingGroups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = g.name;
        this.importExistingGroupSelect.appendChild(opt);
      });
    }

    if (this.importGroupModeSelect) {
      const existingOption = this.importGroupModeSelect.querySelector('option[value="existing"]');
      if (existingOption) {
        existingOption.disabled = existingGroups.length === 0;
      }
      this.importGroupModeSelect.value = 'none';
      this._handleImportGroupModeChange();
    }

    this.switchTab('import');
    this._renderPrefixGroups();
    this._renderImportTablesList();
    this._updateImportSelectionCounter();
    if (window.lucide) window.lucide.createIcons();
  }

  _handleImportGroupModeChange() {
    const mode = this.importGroupModeSelect?.value || 'none';
    this.importGroupNameInput?.classList.toggle('hidden', mode !== 'single');
    this.importExistingGroupSelect?.classList.toggle('hidden', mode !== 'existing');
  }

  _renderPrefixGroups() {
    if (!this.importPrefixSection || !this.importPrefixGroups || !this.pendingSchema) return;
    const tables = this.pendingSchema.tables || [];
    const groupsMap = this._getPrefixGroupsMap(tables);

    this.importPrefixGroups.innerHTML = '';
    if (groupsMap.size === 0) {
      this.importPrefixSection.classList.add('hidden');
      return;
    }

    this.importPrefixSection.classList.remove('hidden');

    groupsMap.forEach((groupTables, groupLabel) => {
      const selectedCount = groupTables.filter(t => this.selectedImportTableIds.has(t.id)).length;
      const allSelected = selectedCount === groupTables.length;
      const someSelected = selectedCount > 0 && !allSelected;

      const chip = document.createElement('button');
      chip.type = 'button';
      chip.style.cssText = `
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 0.74rem;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        transition: all 0.15s ease;
        border: 1px solid ${allSelected ? 'var(--color-primary)' : someSelected ? 'rgba(99, 102, 241, 0.5)' : 'var(--color-border)'};
        background: ${allSelected ? 'rgba(99, 102, 241, 0.2)' : someSelected ? 'rgba(99, 102, 241, 0.08)' : 'var(--color-bg-primary)'};
        color: ${allSelected ? '#818cf8' : 'var(--color-text-main)'};
        font-weight: ${allSelected || someSelected ? '600' : '400'};
      `;
      chip.innerHTML = `
        <span>${this._escape(groupLabel)}</span>
        <span style="opacity: 0.75; font-size: 0.68rem;">(${selectedCount}/${groupTables.length})</span>
      `;
      chip.title = allSelected ? `Desmarcar grupo ${groupLabel}` : `Marcar grupo ${groupLabel}`;

      chip.addEventListener('click', () => {
        const shouldSelect = !allSelected;
        groupTables.forEach(t => {
          if (shouldSelect) {
            this.selectedImportTableIds.add(t.id);
          } else {
            this.selectedImportTableIds.delete(t.id);
          }
        });
        this._renderPrefixGroups();
        this._renderImportTablesList();
        this._updateImportSelectionCounter();
      });

      this.importPrefixGroups.appendChild(chip);
    });
  }

  _getFilteredImportTables() {
    if (!this.pendingSchema) return [];
    const tables = this.pendingSchema.tables || [];
    const query = (this.importSearchInput?.value || '').trim().toLowerCase();
    if (!query) return tables;
    return tables.filter(t => t.name.toLowerCase().includes(query));
  }

  _renderImportTablesList() {
    if (!this.importTablesList || !this.pendingSchema) return;
    this.importTablesList.innerHTML = '';

    const filtered = this._getFilteredImportTables();
    const relationships = this.pendingSchema.relationships || [];
    const currentState = this.stateManager.getState();
    const existingNames = new Set((currentState.tables || []).map(t => t.name.toLowerCase()));

    if (filtered.length === 0) {
      this.importTablesList.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 20px; color: var(--color-text-muted); font-size: 0.8rem;">
          No hay tablas que coincidan con el filtro.
        </div>
      `;
      return;
    }

    // Count FK relations per table
    const fkCounts = new Map();
    relationships.forEach(r => {
      fkCounts.set(r.fromTable, (fkCounts.get(r.fromTable) || 0) + 1);
      if (r.toTable !== r.fromTable) {
        fkCounts.set(r.toTable, (fkCounts.get(r.toTable) || 0) + 1);
      }
    });

    filtered.forEach(tbl => {
      const isSelected = this.selectedImportTableIds.has(tbl.id);
      const alreadyExists = existingNames.has(tbl.name.toLowerCase());
      const colsCount = (tbl.fields || []).length;
      const relCount = fkCounts.get(tbl.id) || 0;

      const item = document.createElement('label');
      item.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 7px 10px;
        border-radius: 6px;
        border: 1px solid ${isSelected ? 'rgba(99, 102, 241, 0.5)' : 'var(--color-border)'};
        background: ${isSelected ? 'rgba(99, 102, 241, 0.08)' : 'var(--color-bg-tertiary)'};
        cursor: pointer;
        user-select: none;
        font-size: 0.8rem;
      `;

      const existsBadge = alreadyExists
        ? `<span style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-size: 0.65rem; padding: 1px 5px; border-radius: 4px; flex-shrink: 0;" title="Esta tabla ya existe en el diagrama">En diagrama</span>`
        : '';

      item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1;">
          <input type="checkbox" data-table-id="${tbl.id}" ${isSelected ? 'checked' : ''} style="cursor: pointer; flex-shrink: 0;" />
          <span style="font-weight: 500; color: var(--color-text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${this._escape(tbl.name)}">${this._escape(tbl.name)}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
          ${existsBadge}
          <span style="font-size: 0.68rem; color: var(--color-text-muted); background: var(--color-bg-primary); padding: 1px 5px; border-radius: 4px;">${colsCount}c${relCount > 0 ? ` · ${relCount}fk` : ''}</span>
        </div>
      `;

      const checkbox = item.querySelector('input[type="checkbox"]');
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selectedImportTableIds.add(tbl.id);
        } else {
          this.selectedImportTableIds.delete(tbl.id);
        }
        this._renderPrefixGroups();
        this._renderImportTablesList();
        this._updateImportSelectionCounter();
      });

      this.importTablesList.appendChild(item);
    });
  }

  _toggleVisibleTables(select) {
    const visible = this._getFilteredImportTables();
    visible.forEach(t => {
      if (select) {
        this.selectedImportTableIds.add(t.id);
      } else {
        this.selectedImportTableIds.delete(t.id);
      }
    });
    this._renderPrefixGroups();
    this._renderImportTablesList();
    this._updateImportSelectionCounter();
  }

  _selectRelatedTables() {
    if (!this.pendingSchema) return;
    if (this.selectedImportTableIds.size === 0) {
      this.uiManager.showToast('Selecciona al menos una tabla primero para buscar sus relacionadas.', 'info');
      return;
    }

    const relationships = this.pendingSchema.relationships || [];
    let added = 0;
    const currentSelected = new Set(this.selectedImportTableIds);

    relationships.forEach(rel => {
      if (currentSelected.has(rel.fromTable) && !this.selectedImportTableIds.has(rel.toTable)) {
        this.selectedImportTableIds.add(rel.toTable);
        added++;
      }
      if (currentSelected.has(rel.toTable) && !this.selectedImportTableIds.has(rel.fromTable)) {
        this.selectedImportTableIds.add(rel.fromTable);
        added++;
      }
    });

    if (added > 0) {
      this._renderPrefixGroups();
      this._renderImportTablesList();
      this._updateImportSelectionCounter();
      this.uiManager.showToast(`Se añadieron ${added} tabla(s) relacionada(s) por FK.`, 'success');
    } else {
      this.uiManager.showToast('Todas las tablas directamente relacionadas ya están seleccionadas.', 'info');
    }
  }

  _updateImportSelectionCounter() {
    if (!this.importSelectionCount || !this.pendingSchema) return;
    const total = (this.pendingSchema.tables || []).length;
    const selected = this.selectedImportTableIds.size;
    this.importSelectionCount.textContent = `${selected} de ${total} seleccionadas`;
    if (this.btnConfirmImport) {
      this.btnConfirmImport.disabled = selected === 0;
    }
  }

  executeSelectiveImport() {
    if (!this.pendingSchema) return;
    const allSchemaTables = this.pendingSchema.tables || [];
    const allSchemaRels = this.pendingSchema.relationships || [];
    const selectedTables = allSchemaTables.filter(t => this.selectedImportTableIds.has(t.id));

    if (selectedTables.length === 0) {
      this.uiManager.showToast('Selecciona al menos una tabla para importar.', 'error');
      return;
    }

    const overwriteExisting = Boolean(this.importOverwriteCheckbox?.checked);
    const groupMode = this.importGroupModeSelect?.value || 'none';

    const prevState = this.stateManager.getState();
    this.history.push(prevState);

    const currentTables = JSON.parse(JSON.stringify(prevState.tables || []));
    const currentRels = JSON.parse(JSON.stringify(prevState.relationships || []));
    const currentGroups = JSON.parse(JSON.stringify(prevState.groups || []));

    // Palette for newly created groups
    const groupColors = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444', '#14b8a6'];
    let singleTargetGroupId = null;

    if (groupMode === 'single') {
      const groupName = (this.importGroupNameInput?.value || '').trim() || (this.pendingImportConn?.name || 'Importación MCP');
      const existingGroup = currentGroups.find(g => g.name.toLowerCase() === groupName.toLowerCase());
      if (existingGroup) {
        singleTargetGroupId = existingGroup.id;
      } else {
        singleTargetGroupId = `grp-mcp-${Date.now()}`;
        currentGroups.push({
          id: singleTargetGroupId,
          name: groupName,
          color: groupColors[currentGroups.length % groupColors.length],
          x: 60,
          y: 60,
          width: 600,
          height: 400
        });
      }
    } else if (groupMode === 'existing') {
      singleTargetGroupId = this.importExistingGroupSelect?.value || null;
    }

    // Prefix group creation if groupMode === 'prefix'
    const prefixToGroupId = new Map();
    if (groupMode === 'prefix') {
      const prefixCounts = new Map();
      selectedTables.forEach(t => {
        const p = this._extractTablePrefix(t.name);
        if (p) prefixCounts.set(p, (prefixCounts.get(p) || 0) + 1);
      });

      prefixCounts.forEach((count, prefix) => {
        if (count >= 2) {
          const groupName = `Módulo ${prefix.toUpperCase()}`;
          let grp = currentGroups.find(g => g.name.toLowerCase() === groupName.toLowerCase() || g.name.toLowerCase() === prefix.toLowerCase());
          if (!grp) {
            grp = {
              id: `grp-mcp-${Date.now()}-${prefix}`,
              name: groupName,
              color: groupColors[currentGroups.length % groupColors.length],
              x: 60,
              y: 60,
              width: 600,
              height: 400
            };
            currentGroups.push(grp);
          }
          prefixToGroupId.set(prefix, grp.id);
        }
      });
    }

    // Map existing tables by lowercase name
    const existingByName = new Map();
    currentTables.forEach(t => existingByName.set(t.name.toLowerCase(), t));

    // Map introspected table ID -> actual table object in mergedTables
    const schemaTableById = new Map();
    allSchemaTables.forEach(t => schemaTableById.set(t.id, t));

    let addedCount = 0;
    let updatedCount = 0;

    selectedTables.forEach(newTbl => {
      const nameKey = newTbl.name.toLowerCase();
      let targetGroupId = undefined;
      if (groupMode === 'single' || groupMode === 'existing') {
        targetGroupId = singleTargetGroupId;
      } else if (groupMode === 'prefix') {
        const p = this._extractTablePrefix(newTbl.name);
        if (p && prefixToGroupId.has(p)) {
          targetGroupId = prefixToGroupId.get(p);
        }
      }

      const existingTbl = existingByName.get(nameKey);
      if (!existingTbl) {
        const tblToAdd = {
          ...newTbl,
          ...(targetGroupId ? { groupId: targetGroupId } : {})
        };
        currentTables.push(tblToAdd);
        existingByName.set(nameKey, tblToAdd);
        addedCount++;
      } else if (overwriteExisting) {
        // Update fields while preserving existing table ID, coordinates, and existing field IDs where names match
        const oldFieldsByName = new Map((existingTbl.fields || []).map(f => [f.name.toLowerCase(), f]));
        existingTbl.fields = (newTbl.fields || []).map((nf, idx) => {
          const oldF = oldFieldsByName.get(nf.name.toLowerCase());
          return {
            ...nf,
            id: oldF ? oldF.id : `fld-${existingTbl.id}-${Date.now()}-${idx}`
          };
        });
        if (targetGroupId) {
          existingTbl.groupId = targetGroupId;
        }
        updatedCount++;
      } else if (targetGroupId && !existingTbl.groupId) {
        existingTbl.groupId = targetGroupId;
      }
    });

    // Resolve relationships between any tables present in the diagram (newly added or previously existing)
    // as long as at least one endpoint was in the selected import set
    const selectedIdsSet = this.selectedImportTableIds;
    const existingRelKeys = new Set(
      currentRels.map(r => `${r.fromTable}:${r.fromField}->${r.toTable}:${r.toField}`)
    );

    let addedRelsCount = 0;
    allSchemaRels.forEach((rel, idx) => {
      if (!selectedIdsSet.has(rel.fromTable) && !selectedIdsSet.has(rel.toTable)) {
        return;
      }

      const schemaFromTbl = schemaTableById.get(rel.fromTable);
      const schemaToTbl = schemaTableById.get(rel.toTable);
      if (!schemaFromTbl || !schemaToTbl) return;

      const actualFromTbl = existingByName.get(schemaFromTbl.name.toLowerCase());
      const actualToTbl = existingByName.get(schemaToTbl.name.toLowerCase());
      if (!actualFromTbl || !actualToTbl) return;

      const schemaFromFld = (schemaFromTbl.fields || []).find(f => f.id === rel.fromField);
      const schemaToFld = (schemaToTbl.fields || []).find(f => f.id === rel.toField);
      if (!schemaFromFld || !schemaToFld) return;

      const actualFromFld = (actualFromTbl.fields || []).find(f => f.name.toLowerCase() === schemaFromFld.name.toLowerCase());
      const actualToFld = (actualToTbl.fields || []).find(f => f.name.toLowerCase() === schemaToFld.name.toLowerCase());
      if (!actualFromFld || !actualToFld) return;

      const relKey = `${actualFromTbl.id}:${actualFromFld.id}->${actualToTbl.id}:${actualToFld.id}`;
      if (!existingRelKeys.has(relKey)) {
        existingRelKeys.add(relKey);
        currentRels.push({
          ...rel,
          id: `rel-mcp-${Date.now()}-${idx}`,
          fromTable: actualFromTbl.id,
          fromField: actualFromFld.id,
          toTable: actualToTbl.id,
          toField: actualToFld.id
        });
        addedRelsCount++;
      }
    });

    this.stateManager.setState({
      ...prevState,
      tables: currentTables,
      relationships: currentRels,
      groups: currentGroups
    });

    const summaryParts = [`${addedCount} nueva(s)`];
    if (updatedCount > 0) summaryParts.push(`${updatedCount} actualizada(s)`);
    if (addedRelsCount > 0) summaryParts.push(`${addedRelsCount} relación(es)`);

    this.uiManager.showToast(`Importación completada: ${summaryParts.join(', ')}.`, 'success');

    if (this.diagramController) {
      this.diagramController.refreshUI();
      if (addedCount > 0) {
        this.diagramController.autoLayout();
      }
    }

    this.closeModal();
  }

  _showStatus(message, type = 'info') {
    if (!this.testStatusEl) return;
    this.testStatusEl.classList.remove('hidden');
    const color = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#818cf8';
    const bg = type === 'success' ? 'rgba(16, 185, 129, 0.1)' : type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(99, 102, 241, 0.1)';
    this.testStatusEl.style.backgroundColor = bg;
    this.testStatusEl.style.color = color;
    this.testStatusEl.textContent = message;
  }

  _clearStatus() {
    if (!this.testStatusEl) return;
    this.testStatusEl.classList.add('hidden');
    this.testStatusEl.textContent = '';
  }

  _parseEnvText(text) {
    const env = {};
    text.split(/\r?\n/).forEach(line => {
      const idx = line.indexOf('=');
      if (idx <= 0) return;
      const key = line.slice(0, idx).trim();
      if (key) env[key] = line.slice(idx + 1); // value kept verbatim (passwords)
    });
    return env;
  }

  _envToText(env) {
    if (!env) return '';
    let obj = env;
    if (typeof env === 'string') {
      try { obj = JSON.parse(env); } catch (e) { return ''; }
    }
    return Object.entries(obj || {}).map(([k, v]) => `${k}=${v}`).join('\n');
  }

  _escape(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
