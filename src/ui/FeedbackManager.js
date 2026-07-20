// src/ui/FeedbackManager.js

const TYPE_ICONS = {
  bug: 'bug',
  suggestion: 'lightbulb',
  feature: 'zap',
  other: 'message-circle',
};

const TYPE_LABELS = {
  bug: 'Bug',
  suggestion: 'Sugerencia',
  feature: 'Nueva Funcionalidad',
  other: 'Otro',
};

const STATUS_LABELS = {
  new: 'Nuevo',
  in_progress: 'En Progreso',
  resolved: 'Resuelto',
  closed: 'Cerrado',
};

const STATUS_COLORS = {
  new: '#ef4444',
  in_progress: '#f59e0b',
  resolved: '#22c55e',
  closed: '#6b7280',
};

export class FeedbackManager {
  constructor(config) {
    this.modal = config.modal;
    this.closeBtn = config.closeBtn;
    this.myList = config.myList;
    this.manageList = config.manageList;
    this.subjectInput = config.subjectInput;
    this.descriptionInput = config.descriptionInput;
    this.submitBtn = config.submitBtn;
    this.tabs = config.tabs;
    this.manageTab = config.manageTab;
    this.currentUser = config.currentUser;
    this.activeTab = 'new';
  }

  initListeners() {
    this.closeBtn.addEventListener('click', () => this.close());

    this.tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.switchToTab(tab.dataset.tab);
      });
    });

    this.submitBtn.addEventListener('click', () => this.submitFeedback());

    if (this.manageTab) {
      this.manageTab.addEventListener('click', () => {
        this.switchToTab('manage');
        this.loadAllFeedback();
      });
    }

    window.addEventListener('feedbackUpdated', () => {
      if (this.modal.classList && !this.modal.classList.contains('hidden')) {
        if (this.activeTab === 'my') this.loadMyFeedback();
        if (this.activeTab === 'manage') this.loadAllFeedback();
      }
    });

    this.initManageListeners();

    // Wire up radio chips to update selection and highlight
    document.querySelectorAll('input[name="feedback-type"]').forEach(radio => {
      radio.addEventListener('change', () => {
        this.applyChipStyling();
        if (window.lucide) window.lucide.createIcons();
      });
    });

    // Initial highlight
    this.applyChipStyling();
  }

  applyChipStyling() {
    const selected = document.querySelector('input[name="feedback-type"]:checked')?.value;
    document.querySelectorAll('.feedback-type-chip').forEach(chip => {
      const isSelected = chip.dataset.type === selected;
      if (isSelected) {
        chip.style.borderColor = 'var(--color-primary)';
        chip.style.background = 'rgba(99, 102, 241, 0.15)';
        chip.style.color = 'var(--color-primary)';
      } else {
        chip.style.borderColor = 'var(--color-border)';
        chip.style.background = 'var(--color-bg-tertiary)';
        chip.style.color = 'var(--color-text-main)';
      }
    });
  }

  open() {
    this.modal.classList.remove('hidden');

    // Activate current tab
    this.activateTab(this.currentTab || this.tabs[0]);

    // Show admin tab if admin
    if (this.manageTab) {
      this.manageTab.style.display = (this.currentUser && (this.currentUser.isAdmin || this.currentUser.is_admin)) ? 'flex' : 'none';
    }

    // Highlight selected chip
    this.applyChipStyling();

    // Render Lucide icons
    if (window.lucide) window.lucide.createIcons();

    // Load data if needed
    if (this.activeTab === 'manage' && this.currentUser && (this.currentUser.isAdmin || this.currentUser.is_admin)) {
      this.loadAllFeedback();
    }
  }

  close() {
    this.modal.classList.add('hidden');
  }

  switchToTab(tab) {
    this.activeTab = tab;
    const tabEl = this.tabs.find(t => t.dataset.tab === tab);
    if (tabEl) {
      this.currentTab = tabEl;
      this.activateTab(tabEl);
      // Load data
      if (tab === 'my') this.loadMyFeedback();
      if (tab === 'manage') this.loadAllFeedback();
      if (window.lucide) window.lucide.createIcons();
    }
  }

  activateTab(activeTabEl) {
    if (!activeTabEl) return;
    this.tabs.forEach(t => {
      t.style.borderBottomColor = 'transparent';
      t.style.color = 'var(--color-text-muted)';
    });
    activeTabEl.style.borderBottomColor = 'var(--color-primary)';
    activeTabEl.style.color = 'var(--color-text-main)';

    document.getElementById('feedback-tab-new').classList.toggle('hidden', activeTabEl.dataset.tab !== 'new');
    document.getElementById('feedback-tab-my').classList.toggle('hidden', activeTabEl.dataset.tab !== 'my');
    document.getElementById('feedback-tab-manage').classList.toggle('hidden', activeTabEl.dataset.tab !== 'manage');
  }

  async submitFeedback() {
    const type = document.querySelector('input[name="feedback-type"]:checked')?.value || 'suggestion';
    const subject = this.subjectInput.value.trim();
    const description = this.descriptionInput.value.trim();

    if (!subject || subject.length < 3) {
      if (window.UIManager) window.UIManager.showToast('El asunto debe tener al menos 3 caracteres.', 'error');
      return;
    }
    if (!description || description.length < 10) {
      if (window.UIManager) window.UIManager.showToast('La descripciÃ³n debe tener al menos 10 caracteres.', 'error');
      return;
    }

    this.submitBtn.disabled = true;
    this.submitBtn.innerHTML = `<i data-lucide="loader-2" style="width: 14px; height: 14px; display: inline; vertical-align: middle; margin-right: 6px; animation: spin 1s linear infinite;" /> Enviando...`;
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, subject, description }),
      });
      const data = await res.json();
      if (data.success) {
        this.subjectInput.value = '';
        this.descriptionInput.value = '';
        if (this.activeTab === 'my') this.loadMyFeedback();
        if (window.UIManager) window.UIManager.showToast('Comentario enviado con Ã©xito.', 'success');
        window.dispatchEvent(new Event('feedbackUpdated'));
      } else {
        throw new Error(data.error || 'Error desconocido');
      }
    } catch (err) {
      if (window.UIManager) window.UIManager.showToast('Error al enviar: ' + err.message, 'error');
    } finally {
      this.submitBtn.disabled = false;
      this.submitBtn.innerHTML = `<i data-lucide="send" style="width: 14px; height: 14px; display: inline; vertical-align: middle; margin-right: 6px;" /> Enviar Comentario`;
      if (window.lucide) window.lucide.createIcons();
    }
  }

  async loadMyFeedback() {
    if (!this.currentUser) {
      this.myList.innerHTML = '<p style="color: var(--color-text-muted); font-size: 0.85rem; text-align: center; padding: 20px 0;">Perfil no disponible.</p>';
      if (window.lucide) window.lucide.createIcons();
      return;
    }
    try {
      const res = await fetch('/api/feedback');
      if (!res.ok) {
        if (res.status === 401) { window.location.href = '/login.html'; return; }
        throw new Error('Error al cargar.');
      }
      const allData = await res.json();
      const myFeedback = (this.currentUser.isAdmin || this.currentUser.is_admin) ? allData : allData.filter(f => f.user_id === this.currentUser.userId);

      if (myFeedback.length === 0) {
        this.myList.innerHTML = '<p style="color: var(--color-text-muted); font-size: 0.85rem; text-align: center; padding: 20px 0;">No tienes comentarios aÃºn.</p>';
      } else {
        this.myList.innerHTML = myFeedback.map(f => this.renderFeedbackItem(f)).join('');
      }
    } catch (err) {
      this.myList.innerHTML = `<p style="color: var(--color-text-muted); font-size: 0.85rem; text-align: center; padding: 20px 0;">Error al cargar: ${this.escapeHtml(err.message)}</p>`;
    }
    if (window.lucide) window.lucide.createIcons();
  }

  async loadAllFeedback() {
    if (!this.currentUser || !(this.currentUser.isAdmin || this.currentUser.is_admin)) {
      this.manageList.innerHTML = '<p style="color: var(--color-text-muted); font-size: 0.85rem; text-align: center; padding: 20px 0;">No tienes acceso.</p>';
      if (window.lucide) window.lucide.createIcons();
      return;
    }
    try {
      const res = await fetch('/api/feedback');
      if (!res.ok) throw new Error('Error al cargar');
      const data = await res.json();

      if (data.length === 0) {
        this.manageList.innerHTML = '<p style="color: var(--color-text-muted); font-size: 0.85rem; text-align: center; padding: 20px 0;">No hay comentarios registrados.</p>';
      } else {
        this.manageList.innerHTML = data.map(f => this.renderManageItem(f)).join('');
      }
    } catch (err) {
      this.manageList.innerHTML = `<p style="color: var(--color-text-muted); font-size: 0.85rem; text-align: center; padding: 20px 0;">Error al cargar: ${this.escapeHtml(err.message)}</p>`;
    }
    if (window.lucide) window.lucide.createIcons();
  }

  renderFeedbackItem(f) {
    const icon = TYPE_ICONS[f.type] || 'message-circle';
    const label = TYPE_LABELS[f.type] || f.type;
    const statusColor = STATUS_COLORS[f.status] || '#6b7280';
    const statusLabel = STATUS_LABELS[f.status] || f.status;
    const date = f.created_at ? new Date(f.created_at).toLocaleString('es-MX') : '';

    return `<div style="background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: 8px; padding: 14px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <i data-lucide="${icon}" style="width: 16px; height: 16px; color: ${statusColor};"></i>
          <span style="font-weight: 600; font-size: 0.85rem; color: var(--color-text-main);">${this.escapeHtml(f.subject)}</span>
        </div>
        <span style="background: ${statusColor}22; color: ${statusColor}; padding: 3px 10px; border-radius: 12px; font-size: 0.72rem; font-weight: 600;">${statusLabel}</span>
      </div>
      <p style="font-size: 0.82rem; color: var(--color-text-dim); margin: 0 0 8px 0; line-height: 1.4;">${this.escapeHtml(f.description)}</p>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 0.72rem; color: var(--color-text-muted);">${date}</span>
        <span style="font-size: 0.72rem; color: var(--color-text-muted); background: ${statusColor || STATUS_COLORS.new}22; padding: 2px 8px; border-radius: 10px;">${label}</span>
      </div>
    </div>`;
  }

  renderManageItem(f) {
    const icon = TYPE_ICONS[f.type] || 'message-circle';
    const label = TYPE_LABELS[f.type] || f.type;
    const statusColor = STATUS_COLORS[f.status] || '#6b7280';
    const statusColor15 = this.hexToRgba(statusColor, 0.15);
    const statusColor44 = `${statusColor}44`;

    const statusOptions = Object.entries(STATUS_LABELS)
      .map(([key, val]) => `<option value="${key}" ${f.status === key ? 'selected' : ''}>${val}</option>`)
      .join('');

    let userBadge = '';
    if (f.user_color) {
      userBadge = `<span style="display:inline-flex; align-items:center; gap:4px; background:${this.hexToRgba(f.user_color, 0.15)}; padding:2px 8px; border-radius:8px; font-size:0.72rem; color:${f.user_color};">
        <span style="width:8px; height:8px; border-radius:50%; background:${f.user_color};"></span>
        ${this.escapeHtml(f.user_name || f.username)}
      </span>`;
    } else if (f.user_name) {
      userBadge = `<span style="font-size:0.72rem; color:var(--color-text-muted);">${this.escapeHtml(f.user_name)}</span>`;
    }

    const date = f.created_at ? new Date(f.created_at).toLocaleString('es-MX') : '';

    return `<div style="background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: 8px; padding: 14px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 8px;">
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <i data-lucide="${icon}" style="width: 15px; height: 15px; color: ${statusColor}; flex-shrink: 0;"></i>
            <span style="font-weight: 600; font-size: 0.85rem; color: var(--color-text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${this.escapeHtml(f.subject)}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;">
            ${userBadge}
            <span style="font-size: 0.72rem; color: var(--color-text-muted);">${date}</span>
          </div>
          <p style="font-size: 0.82rem; color: var(--color-text-dim); margin: 0; line-height: 1.4;">${this.escapeHtml(f.description)}</p>
        </div>
        <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 8px; flex-shrink: 0;">
          <span style="font-size: 0.72rem; color: var(--color-text-muted); background: ${statusColor15}; padding: 3px 10px; border-radius: 12px; font-weight: 600; border: 1px solid ${statusColor44}; white-space: nowrap;">
            ${STATUS_LABELS[f.status] || f.status}
          </span>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <select class="feedback-status-select" data-feedback-id="${f.id}" style="background: var(--color-bg-app); border: 1px solid var(--color-border); color: var(--color-text-main); padding: 4px 8px; border-radius: 4px; font-size: 0.72rem; width: 100px; cursor: pointer;">
              ${statusOptions}
            </select>
            <button class="btn-feedback-delete" data-feedback-id="${f.id}" style="background: none; border: 1px solid #ef444455; color: #ef4444; padding: 3px 10px; border-radius: 4px; font-size: 0.7rem; cursor: pointer;">
              <i data-lucide="trash-2" style="width: 11px; height: 11px; display: inline; vertical-align: middle;"></i> Eliminar
            </button>
          </div>
        </div>
      </div>
      <span style="font-size: 0.7rem; color: var(--color-text-muted); background: ${statusColor15}; padding: 2px 8px; border-radius: 10px;">${label}</span>
    </div>`;
  }

  setStatus(itemId, newStatus) {
    if (!this.currentUser || !(this.currentUser.isAdmin || this.currentUser.is_admin)) return;
    fetch(`/api/feedback/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) { window.dispatchEvent(new Event('feedbackUpdated')); }
    })
    .catch(err => {
      if (window.UIManager) window.UIManager.showToast('Error al actualizar estado: ' + err.message, 'error');
    });
  }

  deleteFeedback(itemId) {
    if (!this.currentUser || !(this.currentUser.isAdmin || this.currentUser.is_admin)) return;
    fetch(`/api/feedback/${itemId}`, { method: 'DELETE' })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        window.dispatchEvent(new Event('feedbackUpdated'));
        if (window.UIManager) window.UIManager.showToast('Comentario eliminado.', 'success');
      }
    })
    .catch(err => {
      if (window.UIManager) window.UIManager.showToast('Error al eliminar: ' + err.message, 'error');
    });
  }

  initManageListeners() {
    this.manageList.addEventListener('change', (e) => {
      if (e.target.classList.contains('feedback-status-select')) {
        this.setStatus(e.target.dataset.feedbackId, e.target.value);
      }
    });

    this.manageList.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-feedback-delete');
      if (btn) {
        const id = btn.dataset.feedbackId;
        if (confirm('ÃÂ¿EstÃ¡s seguro de eliminar este comentario?')) {
          this.deleteFeedback(id);
        }
      }
    });
  }

  setAdminVisible(visible) {
    if (this.manageTab) {
      this.manageTab.style.display = visible ? 'flex' : 'none';
    }
  }

  escapeHtml(text) {
    if (!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
    return String(text).replace(/[&<>"']/g, (s) => map[s]);
  }

  hexToRgba(hex, alpha) {
    if (!hex) return `rgba(100, 100, 100, ${alpha})`;
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}