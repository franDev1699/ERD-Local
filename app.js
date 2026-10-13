// app.js - Entry Point
import { AppController } from './src/controllers/AppController.js';

const urlParams = new URLSearchParams(window.location.search);
const projectId = urlParams.get('project') || '';

const config = {
  projectId,
  wsUrl: `ws://${window.location.hostname}:3000${projectId ? `/?project=${encodeURIComponent(projectId)}${urlParams.get('name') ? `&name=${encodeURIComponent(urlParams.get('name'))}` : ''}` : ''}`,
  defaultState: {
    tables: [],
    relationships: [],
    groups: [],
    queries: []
  },
  dom: {
    canvasContainer: document.getElementById("canvas-container"),
    erdCanvas: document.getElementById("erd-canvas"),
    tablesContainer: document.getElementById("erd-tables-container"),
    stickyNotesContainer: document.getElementById("erd-sticky-notes-container"),
    connectionsSvg: document.getElementById("erd-connections-svg"),
    zoomText: document.getElementById("zoom-level"),
    tablesListContainer: document.getElementById("tables-list-container"),
    toastContainer: document.getElementById("toast-container"),
    sqlModal: document.getElementById("sql-modal"),
    imageModal: document.getElementById("image-modal"),
    queryModal: document.getElementById("query-modal"),
    btnQueryModalTrigger: document.getElementById("btn-query-manager-trigger")
  }
};

// Theme Management Helper
export class ThemeManager {
  static STORAGE_KEY = 'gnome_erd_theme';

  static init() {
    const savedTheme = localStorage.getItem(this.STORAGE_KEY) || 'dark';
    this.applyTheme(savedTheme);
    this.setupListeners();
  }

  static applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(this.STORAGE_KEY, theme);
    this.updateIcons(theme);
  }

  static toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'light' ? 'dark' : 'light';
    this.applyTheme(next);
  }

  static updateIcons(theme) {
    const isLight = theme === 'light';
    document.querySelectorAll('.theme-icon-sun').forEach(el => {
      el.style.display = isLight ? 'none' : 'inline-block';
    });
    document.querySelectorAll('.theme-icon-moon').forEach(el => {
      el.style.display = isLight ? 'inline-block' : 'none';
    });
    document.querySelectorAll('.btn-theme-toggle').forEach(btn => {
      btn.title = isLight ? 'Cambiar a Tema Oscuro' : 'Cambiar a Tema Claro';
    });
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  static setupListeners() {
    document.querySelectorAll('.btn-theme-toggle').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        this.toggleTheme();
      };
    });
  }
}

// Apply theme immediately before DOM complete to avoid dark flash
window.ThemeManager = ThemeManager;
ThemeManager.init();

const app = new AppController(config);

document.addEventListener("DOMContentLoaded", () => {
  ThemeManager.setupListeners();
  app.init();
});
