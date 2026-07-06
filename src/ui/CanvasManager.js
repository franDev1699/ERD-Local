// src/ui/CanvasManager.js

export class CanvasManager {
  constructor(config) {
    this.container = config.container;
    this.canvas = config.canvas;
    this.zoomText = config.zoomText;
    
    this.zoom = 1.0;
    this.ZOOM_MIN = 0.1;
    this.ZOOM_MAX = 1.5;
  }

  setZoom(newZoom) {
    this.zoom = Math.max(this.ZOOM_MIN, Math.min(this.ZOOM_MAX, newZoom));
    this.canvas.style.transform = `scale(${this.zoom})`;
    this.canvas.style.setProperty('--zoom-level', this.zoom);
    
    if (this.zoomText) {
      const zoomString = `${Math.round(this.zoom * 100)}%`;
      if (this.zoomText.tagName === 'INPUT') {
        this.zoomText.value = zoomString;
      } else {
        this.zoomText.textContent = zoomString;
      }
    }
  }

  /**
   * Zoom while keeping the viewport center point stable on the canvas.
   * Used by toolbar zoom buttons and manual zoom input.
   */
  zoomToCenter(newZoom) {
    const oldZoom = this.zoom;
    newZoom = Math.max(this.ZOOM_MIN, Math.min(this.ZOOM_MAX, newZoom));
    if (newZoom === oldZoom) return;

    const viewportW = this.container.clientWidth;
    const viewportH = this.container.clientHeight;

    // Canvas coordinate at the center of the viewport before zoom
    const centerCanvasX = (this.container.scrollLeft + viewportW / 2) / oldZoom;
    const centerCanvasY = (this.container.scrollTop + viewportH / 2) / oldZoom;

    this.setZoom(newZoom);

    // Adjust scroll so that same canvas point stays at viewport center
    this.container.scrollLeft = centerCanvasX * newZoom - viewportW / 2;
    this.container.scrollTop = centerCanvasY * newZoom - viewportH / 2;
  }

  getZoom() {
    return this.zoom;
  }

  centerCanvas() {
    const canvasWidth = this.canvas.clientWidth * this.zoom;
    const canvasHeight = this.canvas.clientHeight * this.zoom;
    
    this.container.scrollLeft = (canvasWidth - this.container.clientWidth) / 2;
    this.container.scrollTop = (canvasHeight - this.container.clientHeight) / 2;
  }

  fitToContent(tables) {
    if (tables.length === 0) return;

    const padding = 50;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    tables.forEach(table => {
      if (table.x < minX) minX = table.x;
      if (table.x + 240 > maxX) maxX = table.x + 240;
      if (table.y < minY) minY = table.y;
      
      const tableHeight = 50 + (table.fields ? table.fields.length * 28 : 0);
      if (table.y + tableHeight > maxY) maxY = table.y + tableHeight;
    });

    const viewportWidth = this.container.clientWidth || 1000;
    const viewportHeight = this.container.clientHeight || 800;
    const contentWidth = (maxX - minX) + padding * 2;
    const contentHeight = (maxY - minY) + padding * 2;

    const scaleX = viewportWidth / contentWidth;
    const scaleY = viewportHeight / contentHeight;
    const newZoom = Math.min(scaleX, scaleY, 1.0);

    this.setZoom(newZoom);

    const centerX = minX + (maxX - minX) / 2;
    const centerY = minY + (maxY - minY) / 2;

    this.container.scrollLeft = (centerX * newZoom) - (this.container.clientWidth / 2);
    this.container.scrollTop = (centerY * newZoom) - (this.container.clientHeight / 2);
  }
}
