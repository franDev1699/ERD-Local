// src/services/StorageService.js

export class StorageService {
  constructor(projectId = "default") {
    this.storageKey = `local_erd_state_${projectId}`;
  }

  save(state) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(state));
    } catch (error) {
      console.error("Error al guardar en localStorage:", error);
    }
  }

  load() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      return saved ? JSON.parse(saved) : null;
    } catch (error) {
      console.error("Error al cargar de localStorage:", error);
      return null;
    }
  }

  clear() {
    localStorage.removeItem(this.storageKey);
  }
}
