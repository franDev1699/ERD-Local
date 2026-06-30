// app.js - Entry Point
import { AppController } from './src/controllers/AppController.js';

const urlParams = new URLSearchParams(window.location.search);
const projectId = urlParams.get('project') || '';

const config = {
  projectId,
  wsUrl: `ws://${window.location.hostname}:3000${projectId ? `/?project=${encodeURIComponent(projectId)}` : ''}`,
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

const app = new AppController(config);

document.addEventListener("DOMContentLoaded", () => {
  app.init();
});
