// src/ui/CanvasManager.js

export class CanvasManager {
  constructor(config) {
    this.container = config.container;
    this.canvas = config.canvas;
    this.zoomText = config.zoomText;
    
    this.zoom = 1.0;
    this.ZOOM_MIN = 0.4;
    this.ZOOM_MAX = 1.5;
  }

  setZoom(newZoom) {
    this.zoom = Math.max(this.ZOOM_MIN, Math.min(this.ZOOM_MAX, newZoom));
    this.canvas.style.transform = `scale(${this.zoom})`;
    this.canvas.style.setProperty('--zoom-level', this.zoom);
    
    if (this.zoomText) {
      this.zoomText.textContent = `${Math.round(this.zoom * 100)}%`;
    }
  }

  getZoom() {
    return this.zoom;
  }

  centerCanvas() {
    const canvasWidth = this.canvas.clientWidth;
    const canvasHeight = this.canvas.clientHeight;
    
    this.container.scrollLeft = (this.canvas.clientWidth - this.container.clientWidth) / 2;
    this.container.scrollTop = (this.canvas.clientHeight - this.container.clientHeight) / 2;
  }

  fitToContent(tables) {
    if (tables.length === 0) return;

    const padding = 50;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    tables.forEach(table => {
      if (table.x < minX) minX = table.x;
      if (table.x + 240 > maxX) maxX = table.x + 240;
      if (table.y < minY) minY = table.y;
      
      const tableHeight = 50 + table.fields.length * 28;
      if (table.y + tableHeight > maxY) maxY = table.y + tableHeight;
    });

    const canvasWidth = this.canvas.clientWidth;
    const canvasHeight = this.canvas.clientHeight;
    const contentWidth = (maxX - minX) + padding * 2;
    const contentHeight = (maxY - minY) + padding * 2;

    const scaleX = canvasWidth / contentWidth;
    const scaleY = canvasHeight / contentHeight;
    const newZoom = Math.min(scaleX, scaleY, 1.0);

    this.setZoom(newZoom);

    const centerX = minX + (maxX - minX) / 2;
    const centerY = minY + (maxY - minY) / 2;

    this.container.scrollLeft = (centerX * newZoom) - (this.container.clientWidth / 2);
    this.container.scrollTop = (centerY * newZoom) - (this.container.clientHeight / 2);
  }
}
