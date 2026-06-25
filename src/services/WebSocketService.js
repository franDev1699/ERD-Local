// src/services/WebSocketService.js

export class WebSocketService {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.onMessageCallback = null;
    this.onOpenCallback = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(this.url);

        this.socket.onopen = () => {
          if (this.onOpenCallback) this.onOpenCallback();
          resolve();
        };

        this.socket.onmessage = (event) => {
          if (this.onMessageCallback) {
            const data = JSON.parse(event.data);
            this.onMessageCallback(data);
          }
        };

        this.socket.onerror = (error) => {
          reject(error);
        };

        this.socket.onclose = () => {
          console.log("WebSocket connection closed");
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  send(data) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    } else {
      console.warn("WebSocket no está conectado. No se pudo enviar el mensaje.", data);
    }
  }

  onMessage(callback) {
    this.onMessageCallback = callback;
  }

  onOpen(callback) {
    this.onOpenCallback = callback;
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
    }
  }

  get isConnected() {
    return this.socket && this.socket.readyState === WebSocket.OPEN;
  }
}
