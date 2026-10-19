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
    this.connectionsListContainer = document.getElementById('mcp-connections-list');
    this.testStatusEl = document.getElementById('mcp-test-status');

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
  }

  openModal() {
    if (!this.modal) return;
    this.modal.classList.remove('hidden');
    this.loadConnections();
    if (window.lucide) window.lucide.createIcons();
  }

  closeModal() {
    if (!this.modal) return;
    this.modal.classList.add('hidden');
    this._clearStatus();
  }

  switchTab(tab) {
    if (tab === 'list') {
      this.panelList?.classList.remove('hidden');
      this.panelAdd?.classList.add('hidden');
      this.tabListBtn?.classList.add('active-tab');
      this.tabAddBtn?.classList.remove('active-tab');
    } else {
      this.panelList?.classList.add('hidden');
      this.panelAdd?.classList.remove('hidden');
      this.tabListBtn?.classList.remove('active-tab');
      this.tabAddBtn?.classList.add('active-tab');
      this._resetForm();
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
    if (!confirm('¿Deseas importar el esquema de esta base de datos al diagrama actual?')) return;

    this._showStatus('Introspeccionando esquema de base de datos vía MCP...', 'info');
    try {
      const res = await fetch('/api/mcp-connections/introspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.success && data.schema) {
        const { tables = [], relationships = [] } = data.schema;
        if (tables.length === 0) {
          this.uiManager.showToast('No se encontraron tablas en la base de datos.', 'info');
          this._showStatus('No se encontraron tablas en la base de datos.', 'info');
          return;
        }

        // Push current state to undo history
        const prevState = this.stateManager.getState();
        this.history.push(prevState);

        // Merge or replace
        const currentTables = prevState.tables || [];
        const currentRels = prevState.relationships || [];

        // Simple merge: keep existing, add new tables avoiding name collisions
        const mergedTables = [...currentTables];
        const existingNames = new Set(currentTables.map(t => t.name.toLowerCase()));

        let addedCount = 0;
        tables.forEach(newTbl => {
          if (!existingNames.has(newTbl.name.toLowerCase())) {
            mergedTables.push(newTbl);
            addedCount++;
          }
        });

        const mergedRels = [...currentRels, ...relationships];

        this.stateManager.setState({
          ...prevState,
          tables: mergedTables,
          relationships: mergedRels
        });

        this.uiManager.showToast(`Esquema importado: ${addedCount} tablas añadidas.`, 'success');
        this._showStatus(`✅ Esquema importado con éxito: ${addedCount} tablas agregadas y ${relationships.length} relaciones.`, 'success');
        
        // Auto layout and refresh
        if (this.diagramController) {
          this.diagramController.refreshUI();
          this.diagramController.autoLayout();
        }

        setTimeout(() => this.closeModal(), 1200);
      } else {
        this._showStatus(`❌ Error en introspección: ${data.error}`, 'error');
        this.uiManager.showToast(data.error || 'Error al importar esquema', 'error');
      }
    } catch (err) {
      this._showStatus(`❌ Error de red: ${err.message}`, 'error');
      this.uiManager.showToast('Error de red al introspeccionar', 'error');
    }
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
