// src/controllers/CollabController.js

export class CollabController {
  constructor({ projectId, webSocket, stateManager, history, uiManager, canvasManager, pendingProjectName, onIncomingStateReset }) {
    this.projectId = projectId;
    this.webSocket = webSocket;
    this.stateManager = stateManager;
    this.history = history;
    this.uiManager = uiManager;
    this.canvasManager = canvasManager;
    this.pendingProjectName = pendingProjectName;
    this.onIncomingStateReset = onIncomingStateReset;
    
    this.myUser = null;
    this.isInitialConnection = true;
  }

  async initCollab() {
    // Setup WebSocket
    try {
      this.webSocket.onOpen(() => {
        if (this.isInitialConnection) {
          this.uiManager.showToast("Conectado al servidor", "success");
          this.isInitialConnection = false;
        }
        this._updateCollabStatus(true, "Colaborativo");
        if (this.myUser) {
          this.webSocket.send({ type: 'join', payload: this.myUser });
        }
      });

      this.webSocket.onMessage((data) => this.handleIncomingSync(data));

      this.webSocket.onReconnecting((attempt) => {
        this._updateCollabStatus(false, `Conectando (${attempt}/5)`);
      });

      this.webSocket.onReconnected(() => {
        this._updateCollabStatus(true, "Colaborativo");
        if (this.myUser) {
          this.webSocket.send({ type: 'join', payload: this.myUser });
        }
      });

      this.webSocket.onDisconnect(() => {
        this.uiManager.showToast("No se pudo conectar al servidor tras 5 intentos. Trabajando en modo local.", "error");
        this._updateCollabStatus(false, "Modo Local");
      });

      await this.webSocket.connect();
    } catch (e) {
      console.warn("No se pudo conectar al WebSocket. Iniciando en modo local.", e);
      this._updateCollabStatus(false, "Modo Local");
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

  _updateCollabStatus(connected, text) {
    const badge = document.querySelector("#collab-status .collab-badge");
    if (badge) {
      badge.className = connected ? "collab-badge status-connected" : "collab-badge status-disconnected";
    }
    const textEl = document.getElementById("collab-status-text");
    if (textEl) textEl.textContent = text;
  }

  handleIncomingSync(data) {
    if (data.type === 'init_state') {
      if (data.payload) {
        if (data.payload.state) {
          let state = data.payload.state;
          const nameParam = this.pendingProjectName;
          if (nameParam && (!state.name || state.name === 'Mi Diagrama Local')) {
            state.name = nameParam;
            this.pendingProjectName = null;
            const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + `?project=${this.projectId}`;
            window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
            this.stateManager.setState(state, false);
          } else {
            this.stateManager.setState(state, true);
            if (this.history) {
              this.history.resyncBaseline(state);
            }
          }

          // After initial state load, fit viewport to content so all tables are visible
          const tables = state.tables;
          if (tables && tables.length > 0) {
            // Double rAF: first applies zoom, second re-renders connections with correct coords
            requestAnimationFrame(() => {
              this.canvasManager.fitToContent(tables);
              requestAnimationFrame(() => {
                if (this.onIncomingStateReset) {
                  this.onIncomingStateReset();
                }
                // Ensure all Lucide icons are initialized after drawing the loaded state
                if (window.lucide) {
                  window.lucide.createIcons();
                }
              });
            });
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
        if (this.history) {
          this.history.resyncBaseline(data.payload);
        }
      }
    } else if (data.type === 'user_list') {
      this.updateActiveUsersList(data.payload);
    } else if (data.type === 'cursor_update') {
      this.updateCollaboratorCursor(data.payload);
    } else if (data.type === 'save_ack' && data.error) {
      this.uiManager.showToast(data.error, "error");
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

    await this.setupUserIdentity();
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
        let roleText = 'Público';
        let roleClass = 'badge bg-secondary';
        if (project.role === 'owner') {
          roleText = 'Creador';
          roleClass = 'badge bg-primary';
        } else if (project.role === 'editor') {
          roleText = 'Editor';
          roleClass = 'badge bg-success';
        } else if (project.role === 'viewer') {
          roleText = 'Lector';
          roleClass = 'badge bg-info text-dark';
        }

        const card = document.createElement("div");
        card.className = "project-card";
        card.innerHTML = `
          <div class="project-card-info">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span class="${roleClass}" style="font-size: 0.7rem; font-weight: 600; padding: 3px 6px; border-radius: 4px;">${roleText}</span>
              <span style="font-size: 0.7rem; color: var(--color-text-muted);">Por: ${project.owner_name || 'Sistema'}</span>
            </div>
            <h3 style="margin-top: 4px; font-size: 1.1rem; font-weight: 700; color: var(--color-text-main);">${project.name}</h3>
            <div class="project-card-stats" style="margin-top: 8px; display: flex; gap: 12px; font-size: 0.8rem; color: var(--color-text-muted);">
              <span><i data-lucide="database" style="width: 12px; height: 12px; vertical-align: middle; margin-right: 2px;"></i> ${project.tableCount} tablas</span>
              <span><i data-lucide="git-merge" style="width: 12px; height: 12px; vertical-align: middle; margin-right: 2px;"></i> ${project.relationshipCount} rel.</span>
            </div>
          </div>
          <div class="project-card-footer" style="display: flex; justify-content: space-between; align-items: center; margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.03); padding-top: 10px;">
            <span class="project-card-date" style="font-size: 0.75rem; color: var(--color-text-muted);">Modificado: ${new Date(project.lastModified).toLocaleDateString()}</span>
            ${(project.role === 'owner' || project.role === 'public') ? `
            <button class="project-card-delete" title="Eliminar proyecto" style="background: transparent; border: none; color: var(--color-danger); cursor: pointer; padding: 4px;">
              <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>` : ''}
          </div>
        `;

        card.addEventListener("click", (e) => {
          if (e.target.closest(".project-card-delete")) return;
          window.open(`?project=${encodeURIComponent(project.id)}`, '_blank');
        });

        const btnDelete = card.querySelector(".project-card-delete");
        if (btnDelete) {
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
                  this.uiManager.showToast(result.error || "Error al eliminar el proyecto.", "error");
                }
              } catch (err) {
                console.error(err);
                this.uiManager.showToast("Error al conectar con el servidor.", "error");
              }
            }
          });
        }

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
    return new Promise(async (resolve) => {
      try {
        const response = await fetch('/api/me');
        if (!response.ok) {
          window.location.reload();
          return;
        }
        
        const userData = await response.json();
        this.myUser = {
          userId: userData.userId,
          username: userData.display_name,
          color: userData.color || '#6366f1'
        };

        // Render user profile bar in sidebar
        const avatarEl = document.getElementById('user-profile-avatar');
        const nameEl = document.getElementById('user-profile-name');
        if (avatarEl) {
          avatarEl.style.backgroundColor = this.myUser.color;
          avatarEl.textContent = this.myUser.username.charAt(0).toUpperCase();
        }
        if (nameEl) {
          nameEl.textContent = this.myUser.username;
        }

        // Render user profile in dashboard
        const dashAvatarEl = document.getElementById('dashboard-user-avatar');
        const dashNameEl = document.getElementById('dashboard-user-name');
        if (dashAvatarEl) {
          dashAvatarEl.style.backgroundColor = this.myUser.color;
          dashAvatarEl.textContent = this.myUser.username.charAt(0).toUpperCase();
        }
        if (dashNameEl) {
          dashNameEl.textContent = this.myUser.username;
        }

        // Setup Logout event
        const btnLogout = document.getElementById('btn-logout');
        if (btnLogout) {
          btnLogout.addEventListener('click', async () => {
            await fetch('/api/logout', { method: 'POST' });
            window.location.reload();
          });
        }

        const btnDashLogout = document.getElementById('btn-dashboard-logout');
        if (btnDashLogout) {
          btnDashLogout.onclick = async () => {
            await fetch('/api/logout', { method: 'POST' });
            window.location.reload();
          };
        }

        // Setup Admin Panel event
        const btnAdminPanel = document.getElementById('btn-admin-panel');
        if (btnAdminPanel && userData.is_admin === 1) {
          btnAdminPanel.style.display = 'block';
          btnAdminPanel.onclick = () => this.openAdminPanel();
        }

        const btnDashAdmin = document.getElementById('btn-dashboard-admin-panel');
        if (btnDashAdmin && userData.is_admin === 1) {
          btnDashAdmin.style.display = 'inline-flex';
          btnDashAdmin.onclick = () => this.openAdminPanel();
        }

        // Setup Members Panel event
        const btnManageMembers = document.getElementById('btn-manage-members');
        if (btnManageMembers) {
          btnManageMembers.onclick = () => this.openMembersPanel();
        }

        if (this.webSocket.isConnected) {
          this.webSocket.send({ type: 'join', payload: this.myUser });
        }
      } catch (e) {
        console.error('Error al inicializar la identidad del usuario:', e);
      }
      resolve();
    });
  }

  async openMembersPanel() {
    const modal = document.getElementById('members-modal');
    if (!modal) return;

    modal.classList.remove('hidden');

    const btnClose = document.getElementById('btn-close-members-modal');
    btnClose.onclick = () => modal.classList.add('hidden');

    const membersTable = document.getElementById('members-list-table');
    const userSelect = document.getElementById('member-username-select');
    const roleSelect = document.getElementById('member-role-select');
    const btnAdd = document.getElementById('btn-add-member');

    // Populate user select dropdown list
    if (userSelect) {
      userSelect.innerHTML = '<option value="">Cargando colaboradores...</option>';
      try {
        const res = await fetch(`/api/users/list?project=${encodeURIComponent(this.projectId)}`);
        if (res.ok) {
          const users = await res.json();
          userSelect.innerHTML = '<option value="">Seleccionar colaborador...</option>';
          users.forEach(user => {
            const opt = document.createElement('option');
            opt.value = user.username;
            opt.textContent = `${user.display_name} (@${user.username})`;
            userSelect.appendChild(opt);
          });
        } else {
          userSelect.innerHTML = '<option value="">Error al cargar usuarios</option>';
        }
      } catch (e) {
        console.error('Error al cargar colaboradores:', e);
        userSelect.innerHTML = '<option value="">Error al cargar usuarios</option>';
      }
    }

    const loadMembers = async () => {
      membersTable.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 10px;">Cargando...</td></tr>';
      try {
        const res = await fetch(`/api/projects/members?project=${encodeURIComponent(this.projectId)}`);
        if (!res.ok) throw new Error();
        const members = await res.json();
        membersTable.innerHTML = '';
        members.forEach(member => {
          const isOwner = member.role === 'owner';
          const tr = document.createElement('tr');
          tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
          tr.innerHTML = `
            <td style="padding: 8px; display: flex; align-items: center; gap: 8px; vertical-align: middle;">
              <span style="width: 18px; height: 18px; border-radius: 50%; background-color: ${member.color || '#6366f1'}; display: inline-block;"></span>
              <span style="color: var(--color-text-main); font-weight: 500;">${member.display_name}</span>
            </td>
            <td style="padding: 8px; vertical-align: middle;">
              <span class="badge ${isOwner ? 'bg-primary' : member.role === 'editor' ? 'bg-success' : 'bg-secondary'}" style="font-size: 0.75rem;">
                ${isOwner ? 'Creador' : member.role === 'editor' ? 'Editor' : 'Lector'}
              </span>
            </td>
            <td style="padding: 8px; text-align: right; vertical-align: middle;">
              ${!isOwner ? `<button class="btn-remove-member btn-icon" data-userid="${member.user_id}" style="border: none; background: transparent; color: var(--color-danger); cursor: pointer;"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button>` : ''}
            </td>
          `;
          membersTable.appendChild(tr);
        });

        if (window.lucide) window.lucide.createIcons();

        membersTable.querySelectorAll('.btn-remove-member').forEach(btn => {
          btn.onclick = async () => {
            const userId = btn.getAttribute('data-userid');
            if (confirm('¿Estás seguro de que deseas remover a este colaborador?')) {
              const removeRes = await fetch(`/api/projects/remove-member?project=${encodeURIComponent(this.projectId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
              });
              if (removeRes.ok) {
                this.uiManager.showToast('Colaborador removido.', 'success');
                loadMembers();
              } else {
                const err = await removeRes.json();
                this.uiManager.showToast(err.error || 'Error al remover colaborador.', 'error');
              }
            }
          };
        });
      } catch (e) {
        membersTable.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--color-danger); padding: 10px;">Error al cargar miembros</td></tr>';
      }
    };

    btnAdd.onclick = async () => {
      const username = userSelect ? userSelect.value : '';
      const role = roleSelect.value;
      if (!username) {
        this.uiManager.showToast('Por favor, selecciona un colaborador.', 'warning');
        return;
      }

      btnAdd.disabled = true;
      try {
        const res = await fetch(`/api/projects/members?project=${encodeURIComponent(this.projectId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, role })
        });
        if (res.ok) {
          this.uiManager.showToast('Colaborador agregado con éxito.', 'success');
          if (userSelect) userSelect.value = '';
          loadMembers();
        } else {
          const err = await res.json();
          this.uiManager.showToast(err.error || 'Error al agregar colaborador.', 'error');
        }
      } catch (e) {
        this.uiManager.showToast('Error de conexión.', 'error');
      } finally {
        btnAdd.disabled = false;
      }
    };

    loadMembers();
  }

  async openAdminPanel() {
    const modal = document.getElementById('admin-modal');
    if (!modal) return;

    modal.classList.remove('hidden');

    const btnClose = document.getElementById('btn-close-admin-modal');
    btnClose.onclick = () => modal.classList.add('hidden');

    const usersTable = document.getElementById('admin-users-list-table');
    const usernameInput = document.getElementById('admin-user-username');
    const displaynameInput = document.getElementById('admin-user-displayname');
    const passwordInput = document.getElementById('admin-user-password');
    const isadminInput = document.getElementById('admin-user-isadmin');
    const btnAdd = document.getElementById('btn-admin-add-user');

    let selectedAdminColor = '#6366f1';
    const colorDots = modal.querySelectorAll('#admin-user-color-options .color-dot');
    colorDots.forEach(dot => {
      dot.onclick = () => {
        colorDots.forEach(d => d.classList.remove('selected'));
        dot.classList.add('selected');
        selectedAdminColor = dot.getAttribute('data-color');
      };
    });

    const loadUsers = async () => {
      usersTable.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 10px;">Cargando...</td></tr>';
      try {
        const res = await fetch('/api/admin/users');
        if (!res.ok) throw new Error();
        const users = await res.json();
        usersTable.innerHTML = '';
        users.forEach(user => {
          const tr = document.createElement('tr');
          tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
          tr.innerHTML = `
            <td style="padding: 10px; font-weight: 600; color: var(--color-text-main); vertical-align: middle;">${user.username}</td>
            <td style="padding: 10px; vertical-align: middle;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="width: 14px; height: 14px; border-radius: 50%; background-color: ${user.color || '#6366f1'}; display: inline-block;"></span>
                <span style="color: var(--color-text-main);">${user.display_name}</span>
              </div>
            </td>
            <td style="padding: 10px; vertical-align: middle;">
              <select class="admin-role-select form-select" data-userid="${user.id}" style="width: 130px; font-size: 0.8rem; background: var(--color-bg-app); border: 1px solid var(--color-border); color: white; padding: 2px 6px; border-radius: 4px;">
                <option value="user" ${user.is_admin === 0 ? 'selected' : ''}>Usuario</option>
                <option value="admin" ${user.is_admin === 1 ? 'selected' : ''}>Administrador</option>
              </select>
            </td>
            <td style="padding: 10px; text-align: right; vertical-align: middle;">
              <button class="btn-admin-delete-user btn-icon" data-userid="${user.id}" style="border: none; background: transparent; color: var(--color-danger); cursor: pointer;"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button>
            </td>
          `;
          usersTable.appendChild(tr);
        });

        if (window.lucide) window.lucide.createIcons();

        usersTable.querySelectorAll('.admin-role-select').forEach(select => {
          select.onchange = async () => {
            const userId = select.getAttribute('data-userid');
            const newRole = select.value;
            const userObj = users.find(u => u.id === userId);
            if (!userObj) return;

            const updateRes = await fetch('/api/admin/update-user', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId,
                displayName: userObj.display_name,
                color: userObj.color,
                is_admin: newRole === 'admin'
              })
            });

            if (updateRes.ok) {
              this.uiManager.showToast('Rol de usuario actualizado.', 'success');
              loadUsers();
            } else {
              const err = await updateRes.json();
              this.uiManager.showToast(err.error || 'Error al actualizar usuario.', 'error');
              loadUsers();
            }
          };
        });

        usersTable.querySelectorAll('.btn-admin-delete-user').forEach(btn => {
          btn.onclick = async () => {
            const userId = btn.getAttribute('data-userid');
            if (confirm('¿Estás seguro de que deseas eliminar permanentemente este usuario? Se cerrarán todas sus sesiones.')) {
              const delRes = await fetch('/api/admin/delete-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
              });
              if (delRes.ok) {
                this.uiManager.showToast('Usuario eliminado con éxito.', 'success');
                loadUsers();
              } else {
                const err = await delRes.json();
                this.uiManager.showToast(err.error || 'Error al eliminar usuario.', 'error');
              }
            }
          };
        });
      } catch (e) {
        usersTable.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--color-danger); padding: 10px;">Error al cargar lista de usuarios</td></tr>';
      }
    };

    btnAdd.onclick = async () => {
      const username = usernameInput.value.trim();
      const displayName = displaynameInput.value.trim();
      const password = passwordInput.value;
      const is_admin = isadminInput.checked;

      if (!username || !displayName || !password) {
        this.uiManager.showToast('Faltan campos obligatorios.', 'error');
        return;
      }

      btnAdd.disabled = true;
      try {
        const res = await fetch('/api/admin/create-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            displayName,
            password,
            color: selectedAdminColor,
            is_admin
          })
        });

        if (res.ok) {
          this.uiManager.showToast('Usuario creado con éxito.', 'success');
          usernameInput.value = '';
          displaynameInput.value = '';
          passwordInput.value = '';
          isadminInput.checked = false;
          loadUsers();
        } else {
          const err = await res.json();
          this.uiManager.showToast(err.error || 'Error al crear usuario.', 'error');
        }
      } catch (e) {
        this.uiManager.showToast('Error de conexión.', 'error');
      } finally {
        btnAdd.disabled = false;
      }
    };

    loadUsers();
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
