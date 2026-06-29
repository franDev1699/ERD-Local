// src/controllers/CollabController.js

export class CollabController {
  constructor({ projectId, webSocket, stateManager, uiManager, canvasManager, pendingProjectName, onIncomingStateReset }) {
    this.projectId = projectId;
    this.webSocket = webSocket;
    this.stateManager = stateManager;
    this.uiManager = uiManager;
    this.canvasManager = canvasManager;
    this.pendingProjectName = pendingProjectName;
    this.onIncomingStateReset = onIncomingStateReset;
    
    this.myUser = null;
  }

  async initCollab() {
    // Setup WebSocket
    try {
      await this.webSocket.connect();
      this.webSocket.onOpen(() => {
        this.uiManager.showToast("Conectado al servidor", "success");
        const badge = document.querySelector("#collab-status .collab-badge");
        if (badge) {
          badge.className = "collab-badge status-connected";
          const text = document.getElementById("collab-status-text");
          if (text) text.textContent = "Colaborativo";
        }
        if (this.myUser) {
          this.webSocket.send({ type: 'join', payload: this.myUser });
        }
      });
      this.webSocket.onMessage((data) => this.handleIncomingSync(data));
    } catch (e) {
      console.warn("No se pudo conectar al WebSocket. Iniciando en modo local.", e);
    }

    // Load or setup user identity
    await this.setupUserIdentity();

    // Check if there is a name param in URL for new local project initialization (fallback if offline)
    if (this.pendingProjectName) {
      const state = this.stateManager.getState();
      if (!state.name || state.name === 'Mi Diagrama Local') {
        state.name = this.pendingProjectName;
        this.stateManager.setState(state, false);
      }
      // Clean URL parameters without reloading
      const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + `?project=${this.projectId}`;
      window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
      this.pendingProjectName = null;
    }
  }

  broadcastState(newState) {
    if (this.webSocket.isConnected) {
      this.webSocket.send({ type: 'update_state', payload: newState });
    }
  }

  sendCursorMove(coords) {
    if (this.webSocket.isConnected && this.myUser) {
      this.webSocket.send({ type: 'cursor_move', payload: coords });
    }
  }

  handleIncomingSync(data) {
    if (data.type === 'init_state') {
      if (data.payload) {
        if (data.payload.state) {
          let state = data.payload.state;
          const nameParam = this.pendingProjectName;
          if (nameParam && (!state.name || state.name === 'Mi Diagrama Local')) {
            state.name = nameParam;
            this.pendingProjectName = null; // Consume it
            const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + `?project=${this.projectId}`;
            window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
            this.stateManager.setState(state, false);
          } else {
            this.stateManager.setState(state, true);
          }
        }
        if (data.payload.shareUrl) {
          const shareInput = document.getElementById("share-link-input");
          if (shareInput) shareInput.value = data.payload.shareUrl;
          const container = document.getElementById("collab-link-container");
          if (container) container.classList.remove("hidden");
        }
      }
    } else if (data.type === 'sync_state') {
      if (data.payload) {
        this.stateManager.setState(data.payload, true);
      }
    } else if (data.type === 'user_list') {
      this.updateActiveUsersList(data.payload);
    } else if (data.type === 'cursor_update') {
      this.updateCollaboratorCursor(data.payload);
    }
  }

  // --- Dashboard and Collaborative Presence Methods ---
  async initDashboard() {
    const dashboardEl = document.getElementById("project-dashboard");
    if (dashboardEl) dashboardEl.classList.remove("hidden");
    const appContainerEl = document.querySelector(".app-container");
    if (appContainerEl) appContainerEl.classList.add("hidden");

    const btnNewProject = document.getElementById("btn-dashboard-new-project");
    if (btnNewProject) {
      btnNewProject.replaceWith(btnNewProject.cloneNode(true));
      document.getElementById("btn-dashboard-new-project").addEventListener("click", () => this.createNewProject());
    }

    this.loadProjectsList();
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  async loadProjectsList() {
    const grid = document.getElementById("projects-grid");
    if (!grid) return;
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--color-text-muted); padding: 40px;">Cargando proyectos...</div>`;

    try {
      const response = await fetch("/api/projects");
      const projects = await response.json();

      if (projects.length === 0) {
        grid.innerHTML = `
          <div style="grid-column: 1/-1; text-align: center; color: var(--color-text-muted); padding: 60px; border: 1.5px dashed var(--color-border); border-radius: 12px; display: flex; flex-direction: column; align-items: center; gap: 15px;">
            <i data-lucide="folder-open" style="width: 48px; height: 48px; color: var(--color-text-muted);"></i>
            <div>
              <h3 style="color: var(--color-text-main); margin-bottom: 5px;">No hay proyectos creados</h3>
              <p style="font-size: 0.9rem;">Crea tu primer proyecto colaborativo usando el botón de arriba.</p>
            </div>
          </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
      }

      grid.innerHTML = "";
      projects.forEach(project => {
        const card = document.createElement("div");
        card.className = "project-card";
        card.innerHTML = `
          <div class="project-card-info">
            <h3>${project.name}</h3>
            <div class="project-card-stats">
              <span><i data-lucide="database"></i> ${project.tableCount} tablas</span>
              <span><i data-lucide="git-merge"></i> ${project.relationshipCount} rel.</span>
            </div>
          </div>
          <div class="project-card-footer">
            <span class="project-card-date">Modificado: ${new Date(project.lastModified).toLocaleDateString()}</span>
            <button class="project-card-delete" title="Eliminar proyecto">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        `;

        card.addEventListener("click", (e) => {
          if (e.target.closest(".project-card-delete")) return;
          window.open(`?project=${encodeURIComponent(project.id)}`, '_blank');
        });

        const btnDelete = card.querySelector(".project-card-delete");
        btnDelete.addEventListener("click", async (e) => {
          e.stopPropagation();
          const confirmed = await this.uiManager.confirm(`¿Estás seguro de que deseas eliminar el proyecto "${project.name}"? Esta acción borrará permanentemente todos sus archivos.`, "Eliminar Proyecto");
          if (confirmed) {
            try {
              const res = await fetch(`/api/delete-project?project=${encodeURIComponent(project.id)}`, { method: "POST" });
              const result = await res.json();
              if (result.success) {
                this.uiManager.showToast(`Proyecto "${project.name}" eliminado.`, "success");
                this.loadProjectsList();
              } else {
                this.uiManager.showToast("Error al eliminar el proyecto.", "error");
              }
            } catch (err) {
              console.error(err);
              this.uiManager.showToast("Error al conectar con el servidor.", "error");
            }
          }
        });

        grid.appendChild(card);
      });

      if (window.lucide) {
        window.lucide.createIcons();
      }
    } catch (err) {
      console.error(err);
      grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--color-danger); padding: 40px;">Error al conectar con el servidor.</div>`;
    }
  }

  async createNewProject() {
    const name = await this.uiManager.prompt("Nombre del nuevo proyecto:", "", "Nuevo Proyecto");
    if (name && name.trim()) {
      const projectId = 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      window.open(`?project=${encodeURIComponent(projectId)}&name=${encodeURIComponent(name.trim())}`, '_blank');
    }
  }

  setupUserIdentity() {
    return new Promise((resolve) => {
      const savedProfile = localStorage.getItem("erd_user_profile");
      if (savedProfile) {
        try {
          this.myUser = JSON.parse(savedProfile);
          if (!this.myUser.userId) {
            this.myUser.userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            localStorage.setItem("erd_user_profile", JSON.stringify(this.myUser));
          }
          if (this.webSocket.isConnected) {
            this.webSocket.send({ type: 'join', payload: this.myUser });
          }
          resolve();
          return;
        } catch (e) {
          localStorage.removeItem("erd_user_profile");
        }
      }

      const modal = document.getElementById("user-identity-modal");
      if (!modal) {
        const name = prompt("Escribe tu nombre:") || `Usuario_${Math.floor(Math.random() * 1000)}`;
        this.myUser = {
          userId: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          username: name,
          color: "#6366f1"
        };
        localStorage.setItem("erd_user_profile", JSON.stringify(this.myUser));
        resolve();
        return;
      }

      const colorDots = modal.querySelectorAll(".color-dot");
      let selectedColor = "#6366f1";
      colorDots.forEach(dot => {
        dot.addEventListener("click", () => {
          colorDots.forEach(d => d.classList.remove("selected"));
          dot.classList.add("selected");
          selectedColor = dot.dataset.color;
        });
      });

      const btnSave = document.getElementById("btn-save-user-identity");
      const nameInput = document.getElementById("user-name-input");

      const handleSave = () => {
        const username = nameInput.value.trim();
        if (!username) {
          this.uiManager.showToast("El nombre de usuario no puede estar vacío.", "error");
          return;
        }

        this.myUser = {
          userId: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          username: username,
          color: selectedColor
        };
        localStorage.setItem("erd_user_profile", JSON.stringify(this.myUser));
        modal.classList.add("hidden");

        if (this.webSocket.isConnected) {
          this.webSocket.send({ type: 'join', payload: this.myUser });
        }

        resolve();
      };

      btnSave.replaceWith(btnSave.cloneNode(true));
      document.getElementById("btn-save-user-identity").addEventListener("click", handleSave);
      
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleSave();
      });

      modal.classList.remove("hidden");
      nameInput.focus();
    });
  }

  updateActiveUsersList(users) {
    const listContainer = document.getElementById("active-users-list");
    if (!listContainer) return;

    if (!users || users.length <= 1) {
      listContainer.innerHTML = "";
      listContainer.classList.add("hidden");
      
      const cursorsContainer = document.getElementById("erd-cursors-container");
      if (cursorsContainer) cursorsContainer.innerHTML = "";
      return;
    }

    listContainer.classList.remove("hidden");
    listContainer.innerHTML = "";

    users.forEach(user => {
      const isMe = user.userId === this.myUser?.userId;
      const avatar = document.createElement("div");
      avatar.className = "user-avatar";
      avatar.style.backgroundColor = user.color;
      avatar.title = `${user.username}${isMe ? " (Tú) - Haz clic para editar" : ""}`;
      avatar.textContent = user.username.charAt(0).toUpperCase();

      if (isMe) {
        avatar.style.boxShadow = "0 0 0 2px var(--color-text-main)";
        avatar.addEventListener("click", () => this.editMyProfile());
      }

      listContainer.appendChild(avatar);
    });

    const activeIds = users.map(u => u.userId);
    const cursorEls = document.querySelectorAll(".user-cursor");
    cursorEls.forEach(el => {
      const userId = el.id.replace("cursor-", "");
      if (!activeIds.includes(userId)) {
        el.remove();
      }
    });
  }

  async editMyProfile() {
    const modal = document.getElementById("user-identity-modal");
    if (!modal) return;

    const nameInput = document.getElementById("user-name-input");
    nameInput.value = this.myUser?.username || "";

    const colorDots = modal.querySelectorAll(".color-dot");
    colorDots.forEach(d => {
      d.classList.remove("selected");
      if (d.dataset.color === this.myUser?.color) {
        d.classList.add("selected");
      }
    });

    let selectedColor = this.myUser?.color || "#6366f1";
    colorDots.forEach(dot => {
      dot.replaceWith(dot.cloneNode(true));
    });

    const newDots = modal.querySelectorAll(".color-dot");
    newDots.forEach(dot => {
      dot.addEventListener("click", () => {
        newDots.forEach(d => d.classList.remove("selected"));
        dot.classList.add("selected");
        selectedColor = dot.dataset.color;
      });
    });

    const btnSave = document.getElementById("btn-save-user-identity");
    btnSave.textContent = "Guardar Cambios";

    const handleSave = () => {
      const username = nameInput.value.trim();
      if (!username) {
        this.uiManager.showToast("El nombre de usuario no puede estar vacío.", "error");
        return;
      }

      this.myUser.username = username;
      this.myUser.color = selectedColor;
      localStorage.setItem("erd_user_profile", JSON.stringify(this.myUser));
      modal.classList.add("hidden");

      if (this.webSocket.isConnected) {
        this.webSocket.send({ type: 'join', payload: this.myUser });
      }
      this.uiManager.showToast("Perfil de usuario actualizado.", "success");
    };

    btnSave.replaceWith(btnSave.cloneNode(true));
    const newBtnSave = document.getElementById("btn-save-user-identity");
    newBtnSave.addEventListener("click", handleSave);

    modal.classList.remove("hidden");
    nameInput.focus();
  }

  updateCollaboratorCursor(payload) {
    const cursorsContainer = document.getElementById("erd-cursors-container");
    if (!cursorsContainer) return;

    if (payload.userId === this.myUser?.userId) return;

    let cursorEl = document.getElementById(`cursor-${payload.userId}`);
    if (!cursorEl) {
      cursorEl = document.createElement("div");
      cursorEl.className = "user-cursor";
      cursorEl.id = `cursor-${payload.userId}`;
      cursorEl.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="var(--user-color)" stroke="white" stroke-width="1.5">
          <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.87-4.87a.5.5 0 0 1 .35-.15h6.81c.45 0 .67-.54.35-.85L6.35 2.86a.5.5 0 0 0-.85.35Z"/>
        </svg>
        <div class="user-cursor-label"></div>
      `;
      cursorsContainer.appendChild(cursorEl);
    }
    cursorEl.style.setProperty("--user-color", payload.color);
    cursorEl.style.left = `${payload.x}px`;
    cursorEl.style.top = `${payload.y}px`;
    
    const label = cursorEl.querySelector(".user-cursor-label");
    if (label) label.textContent = payload.username;
  }
}
