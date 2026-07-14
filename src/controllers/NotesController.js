// src/controllers/NotesController.js

export class NotesController {
  constructor({ stateManager, uiManager, collabController, onHistoryPush }) {
    this.stateManager = stateManager;
    this.uiManager = uiManager;
    this.collabController = collabController;
    this.onHistoryPush = onHistoryPush;

    this.activeTableId = null;
    this.activeStickyId = null;
    this.activeCanvasCoords = null;

    // Elements
    this.contextMenuContainer = document.getElementById("notes-context-menu-container");
    this.popoverContainer = document.getElementById("notes-popover-container");

    this._setupGlobalClickClose();
    this._setupGlobalNotesToggleButton();
  }

  get myUser() {
    return this.collabController.myUser || { userId: 'local-user', username: 'Usuario Local', color: '#6366f1', is_admin: true };
  }

  get myRole() {
    return this.collabController.myProjectRole || 'owner'; // default to owner if local
  }

  get canWrite() {
    return this.myRole === 'owner' || this.myRole === 'editor';
  }

  _setupGlobalClickClose() {
    document.addEventListener("click", (e) => {
      // Close context menu if clicked outside
      if (this.contextMenuContainer && !this.contextMenuContainer.contains(e.target)) {
        this.hideContextMenu();
      }
      // Close notes popover if clicked outside of popover and badge
      if (this.popoverContainer && !this.popoverContainer.contains(e.target) && !e.target.closest(".notes-badge")) {
        this.hideNotesPopover();
      }
    });
  }

  showTableContextMenu(tableId, clientX, clientY) {
    if (!this.contextMenuContainer) return;
    this.activeTableId = tableId;

    this.contextMenuContainer.innerHTML = `
      <div class="notes-context-menu" style="left: ${clientX}px; top: ${clientY}px;">
        <div class="notes-context-item add-note-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Comentar tabla
        </div>
      </div>
    `;

    const addNoteBtn = this.contextMenuContainer.querySelector(".add-note-btn");
    if (addNoteBtn) {
      addNoteBtn.onclick = (e) => {
        e.stopPropagation();
        this.hideContextMenu();
        
        // Find notes badge on that table to attach the popover to it
        const tableEl = document.querySelector(`.erd-table[data-id="${tableId}"]`);
        let badgeEl = tableEl ? tableEl.querySelector(".notes-badge") : null;
        if (!badgeEl && tableEl) {
          // Temporarily anchor to table header
          badgeEl = tableEl.querySelector(".erd-table-header") || tableEl;
        }
        this.showNotesPopover(tableId, badgeEl);
      };
    }
  }

  showCanvasContextMenu(coords, clientX, clientY) {
    if (!this.contextMenuContainer) return;
    this.activeCanvasCoords = coords;

    this.contextMenuContainer.innerHTML = `
      <div class="notes-context-menu" style="left: ${clientX}px; top: ${clientY}px;">
        <div class="notes-context-item add-sticky-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8.5L15.5 3z"/><path d="M15 3v6h6"/><path d="M12 18v-6"/><path d="M9 15h6"/></svg>
          Crear Sticky Note
        </div>
      </div>
    `;

    const addStickyBtn = this.contextMenuContainer.querySelector(".add-sticky-btn");
    if (addStickyBtn) {
      addStickyBtn.onclick = (e) => {
        e.stopPropagation();
        this.hideContextMenu();
        this.createStickyNote(coords.x, coords.y);
      };
    }
  }

  showStickyNoteContextMenu(stickyId, clientX, clientY) {
    if (!this.contextMenuContainer) return;
    this.activeStickyId = stickyId;

    const state = this.stateManager.getState();
    const sticky = state.stickyNotes.find(s => s.id === stickyId);
    const isEditable = sticky && (this.myUser.is_admin || sticky.authorId === this.myUser.userId);

    this.contextMenuContainer.innerHTML = `
      <div class="notes-context-menu" style="left: ${clientX}px; top: ${clientY}px;">
        ${isEditable ? `
          <div class="notes-context-item edit-sticky-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"/></svg>
            Editar nota
          </div>
          <div class="notes-context-item delete-sticky-btn" style="color: var(--color-danger);">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            Eliminar nota
          </div>
        ` : `
          <div class="notes-context-item" style="color: var(--color-text-muted); cursor: not-allowed;">
            Sin permisos para editar
          </div>
        `}
      </div>
    `;

    if (isEditable) {
      const editStickyBtn = this.contextMenuContainer.querySelector(".edit-sticky-btn");
      if (editStickyBtn) {
        editStickyBtn.onclick = (e) => {
          e.stopPropagation();
          this.hideContextMenu();
          const container = document.getElementById("erd-sticky-notes-container");
          const el = container ? container.querySelector(`[data-id="${stickyId}"]`) : null;
          if (el) {
            const app = window.appInstance;
            if (app && app.renderer) {
              app.renderer.enterStickyNoteEditMode(el, sticky);
            }
          }
        };
      }

      const deleteStickyBtn = this.contextMenuContainer.querySelector(".delete-sticky-btn");
      if (deleteStickyBtn) {
        deleteStickyBtn.onclick = (e) => {
          e.stopPropagation();
          this.hideContextMenu();
          this.deleteStickyNote(stickyId);
        };
      }
    }
  }

  hideContextMenu() {
    if (this.contextMenuContainer) {
      this.contextMenuContainer.innerHTML = "";
    }
  }

  showNotesPopover(tableId, badgeEl) {
    if (!this.popoverContainer || !badgeEl) return;
    this.activeTableId = tableId;

    const state = this.stateManager.getState();
    const table = state.tables.find(t => t.id === tableId);
    if (!table) return;

    const notes = (state.notes || []).filter(n => n.tableId === tableId);
    
    // Position popover relative to the badge or table
    const rect = badgeEl.getBoundingClientRect();
    let left = rect.right + 10;
    let top = rect.top;

    // Boundary check
    if (left + 320 > window.innerWidth) {
      left = rect.left - 330;
    }
    if (top + 400 > window.innerHeight) {
      top = window.innerHeight - 410;
    }

    this.popoverContainer.innerHTML = `
      <div class="notes-popover" style="left: ${Math.max(10, left)}px; top: ${Math.max(10, top)}px;">
        <div class="notes-popover-header">
          <h3>Notas: ${table.name}</h3>
          <button class="notes-popover-close">✕</button>
        </div>
        <div class="notes-popover-list">
          ${notes.length === 0 ? `
            <div style="color: var(--color-text-muted); font-size: 0.8rem; text-align: center; margin-top: 20px;">
              No hay notas. Añade una para comenzar la discusión.
            </div>
          ` : notes.map(note => {
            const isNoteOwner = note.authorId === this.myUser.userId || this.myUser.is_admin;
            const initials = (note.authorName || "U").charAt(0).toUpperCase();
            const dateText = new Date(note.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            return `
              <div class="note-item" data-id="${note.id}">
                <div class="note-meta">
                  <div class="note-avatar" style="background-color: ${note.authorColor || '#6366f1'};">
                    ${initials}
                  </div>
                  <span class="note-author">${note.authorName}</span>
                  <span class="note-time">${dateText}</span>
                  ${isNoteOwner ? `
                    <div class="note-actions">
                      <button class="note-action-btn delete" title="Eliminar">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/></svg>
                      </button>
                    </div>
                  ` : ""}
                </div>
                <div class="note-text">${note.text}</div>
              </div>
            `;
          }).join("")}
        </div>
        ${this.canWrite ? `
          <div class="notes-popover-form">
            <textarea class="notes-popover-textarea" placeholder="Escribe un comentario..."></textarea>
            <button class="notes-popover-submit">Enviar</button>
          </div>
        ` : `
          <div style="padding: 10px; font-size: 0.75rem; color: var(--color-text-muted); text-align: center; border-top: 1px solid rgba(255,255,255,0.05);">
            Solo lectura
          </div>
        `}
      </div>
    `;

    // Hook events
    const closeBtn = this.popoverContainer.querySelector(".notes-popover-close");
    if (closeBtn) closeBtn.onclick = () => this.hideNotesPopover();

    // Notes list delete action
    this.popoverContainer.querySelectorAll(".note-item").forEach(itemEl => {
      const noteId = itemEl.dataset.id;
      const delBtn = itemEl.querySelector(".note-action-btn.delete");
      if (delBtn) {
        delBtn.onclick = (e) => {
          e.stopPropagation();
          this.deleteNote(noteId);
        };
      }
    });

    // Form submit
    const submitBtn = this.popoverContainer.querySelector(".notes-popover-submit");
    const textarea = this.popoverContainer.querySelector(".notes-popover-textarea");

    if (submitBtn && textarea) {
      const addNote = () => {
        const text = textarea.value.trim();
        if (!text) return;
        this.createNote(tableId, text);
        textarea.value = "";
      };

      submitBtn.onclick = addNote;
      textarea.onkeydown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          addNote();
        }
      };
    }
  }

  hideNotesPopover() {
    if (this.popoverContainer) {
      this.popoverContainer.innerHTML = "";
    }
  }

  createNote(tableId, text) {
    if (!this.canWrite) {
      this.uiManager.showToast("No tienes permisos de edición en este proyecto.", "error");
      return;
    }

    const note = {
      id: `note-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tableId,
      text,
      authorId: this.myUser.userId,
      authorName: this.myUser.username,
      authorColor: this.myUser.color,
      createdAt: new Date().toISOString()
    };

    if (this.onHistoryPush) this.onHistoryPush();
    this.stateManager.addNote(note);

    // Refresh popover list
    const badgeEl = document.querySelector(`.erd-table[data-id="${tableId}"] .notes-badge`) || document.querySelector(`.erd-table[data-id="${tableId}"]`);
    this.showNotesPopover(tableId, badgeEl);
  }

  deleteNote(noteId) {
    const state = this.stateManager.getState();
    const note = state.notes.find(n => n.id === noteId);
    if (!note) return;

    const isNoteOwner = note.authorId === this.myUser.userId || this.myUser.is_admin;
    if (!isNoteOwner) {
      this.uiManager.showToast("Solo el autor o un administrador puede eliminar esta nota.", "error");
      return;
    }

    if (this.onHistoryPush) this.onHistoryPush();
    this.stateManager.deleteNote(noteId);

    // Refresh popover list
    const badgeEl = document.querySelector(`.erd-table[data-id="${note.tableId}"] .notes-badge`) || document.querySelector(`.erd-table[data-id="${note.tableId}"]`);
    this.showNotesPopover(note.tableId, badgeEl);
  }

  createStickyNote(x, y) {
    if (!this.canWrite) {
      this.uiManager.showToast("No tienes permisos de edición en este proyecto.", "error");
      return;
    }

    const sticky = {
      id: `sticky-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      x,
      y,
      text: "Nueva nota",
      color: "#fef08a",
      authorId: this.myUser.userId,
      authorName: this.myUser.username,
      createdAt: new Date().toISOString()
    };

    if (this.onHistoryPush) this.onHistoryPush();
    this.stateManager.addStickyNote(sticky);

    // Enter edit mode on the newly created sticky note automatically
    setTimeout(() => {
      const container = document.getElementById("erd-sticky-notes-container");
      const el = container ? container.querySelector(`[data-id="${sticky.id}"]`) : null;
      if (el) {
        const app = window.appInstance;
        if (app && app.renderer) {
          app.renderer.enterStickyNoteEditMode(el, sticky);
        }
      }
    }, 100);
  }

  updateStickyNote(stickyId, updates) {
    if (!this.canWrite) return;
    
    // Check permission
    const state = this.stateManager.getState();
    const sticky = state.stickyNotes.find(s => s.id === stickyId);
    if (!sticky) return;

    const isEditable = this.myUser.is_admin || sticky.authorId === this.myUser.userId;
    if (!isEditable) {
      this.uiManager.showToast("Solo el autor o un administrador puede editar esta nota.", "error");
      return;
    }

    if (this.onHistoryPush) this.onHistoryPush();
    this.stateManager.updateStickyNote(stickyId, updates);
  }

  deleteStickyNote(stickyId) {
    // Check permission
    const state = this.stateManager.getState();
    const sticky = state.stickyNotes.find(s => s.id === stickyId);
    if (!sticky) return;

    const isEditable = this.myUser.is_admin || sticky.authorId === this.myUser.userId;
    if (!isEditable) {
      this.uiManager.showToast("Solo el autor o un administrador puede eliminar esta nota.", "error");
      return;
    }

    if (this.onHistoryPush) this.onHistoryPush();
    this.stateManager.deleteStickyNote(stickyId);
  }

  _setupGlobalNotesToggleButton() {
    const btnGlobal = document.getElementById("btn-global-notes");
    const panel = document.getElementById("global-notes-panel");
    const btnClose = document.getElementById("btn-close-global-notes");

    if (btnGlobal && panel) {
      btnGlobal.addEventListener("click", (e) => {
        e.stopPropagation();
        panel.classList.toggle("hidden");
        if (!panel.classList.contains("hidden")) {
          this.refreshGlobalNotes();
        }
      });
    }

    if (btnClose && panel) {
      btnClose.addEventListener("click", (e) => {
        e.stopPropagation();
        panel.classList.add("hidden");
      });
    }
  }

  refreshGlobalNotes() {
    const state = this.stateManager.getState();
    const notes = state.notes || [];
    const stickies = state.stickyNotes || [];
    const totalCount = notes.length + stickies.length;

    // Update counter badge
    const counterEl = document.getElementById("global-notes-counter");
    if (counterEl) {
      counterEl.textContent = totalCount;
      if (totalCount > 0) {
        counterEl.classList.remove("hidden");
      } else {
        counterEl.classList.add("hidden");
      }
    }

    // Update panel list
    const listEl = document.getElementById("global-notes-panel-list");
    if (!listEl) return;

    if (totalCount === 0) {
      listEl.innerHTML = `
        <div style="color: var(--color-text-muted); font-size: 0.8rem; text-align: center; margin-top: 40px; font-family: var(--font-family-sans);">
          No hay notas ni comentarios en este diagrama.
        </div>
      `;
      return;
    }

    // Merge notes and stickies
    const allItems = [];
    notes.forEach(note => {
      const table = state.tables.find(t => t.id === note.tableId);
      allItems.push({
        type: 'comment',
        id: note.id,
        tableId: note.tableId,
        targetName: table ? table.name : 'Tabla eliminada',
        text: note.text,
        author: note.authorName,
        createdAt: note.createdAt,
        x: table ? table.x : 0,
        y: table ? table.y : 0
      });
    });

    stickies.forEach(sticky => {
      allItems.push({
        type: 'sticky',
        id: sticky.id,
        targetName: 'Nota Adhesiva',
        text: sticky.text,
        author: sticky.authorName,
        createdAt: sticky.createdAt,
        x: sticky.x,
        y: sticky.y
      });
    });

    // Sort by date desc
    allItems.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    listEl.innerHTML = allItems.map(item => {
      const tagClass = item.type === 'sticky' ? 'sticky' : '';
      const tagLabel = item.type === 'sticky' ? 'Nota' : `Tabla: ${item.targetName}`;
      const dateText = new Date(item.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      return `
        <div class="global-note-card" data-type="${item.type}" data-id="${item.id}" data-x="${item.x}" data-y="${item.y}" data-table-id="${item.tableId || ''}">
          <div class="global-note-card-header">
            <span class="global-note-card-tag ${tagClass}">${tagLabel}</span>
            <span>${dateText}</span>
          </div>
          <div class="global-note-card-body">${item.text}</div>
          <div class="global-note-card-meta">
            <span>Por: <strong>${item.author}</strong></span>
          </div>
        </div>
      `;
    }).join("");

    // Add click events to zoom/center on item
    listEl.querySelectorAll(".global-note-card").forEach(card => {
      card.onclick = () => {
        const type = card.dataset.type;
        const x = parseFloat(card.dataset.x);
        const y = parseFloat(card.dataset.y);
        
        // Scroll & center on canvas
        const app = window.appInstance;
        if (app && app.canvasManager) {
          const container = app.config.dom.canvasContainer;
          const zoom = app.canvasManager.getZoom();
          const viewportW = container.clientWidth;
          const viewportH = container.clientHeight;

          // Offset to center it
          container.scrollTo({
            left: Math.max(0, (x + 100) * zoom - viewportW / 2),
            top: Math.max(0, (y + 80) * zoom - viewportH / 2),
            behavior: "smooth"
          });
        }

        // Highlight/open details
        if (type === 'comment') {
          const tableId = card.dataset.tableId;
          const tableEl = document.querySelector(`.erd-table[data-id="${tableId}"]`);
          const badgeEl = tableEl ? tableEl.querySelector(".notes-badge") : null;
          if (badgeEl) {
            this.showNotesPopover(tableId, badgeEl);
          }
        }
      };
    });
  }
}
