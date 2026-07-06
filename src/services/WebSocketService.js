// src/services/WebSocketService.js

export class WebSocketService {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.onMessageCallback = null;
    this.onOpenCallback = null;
    this.onCloseCallback = null;
    
    // Reconnection config
    this.maxReconnectAttempts = 5;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.userClosed = false;
    
    // Callbacks for UI/lifecycle
    this.onReconnectingCallback = null;
    this.onReconnectedCallback = null;
    this.onDisconnectCallback = null;

    // Buffer for offline messages
    this.messageQueue = [];

    // Heartbeat (Ping/Pong)
    this.pingInterval = 30000; // 30 seconds
    this.pongTimeout = 10000;  // 10 seconds to respond
    this.pingTimer = null;
    this.pongTimer = null;
  }

  connect() {
    this.userClosed = false;
    return new Promise((resolve, reject) => {
      this._doConnect(resolve, reject);
    });
  }

  _doConnect(resolve = null, reject = null) {
    if (this.socket) {
      this._cleanupSocket();
    }

    try {
      this.socket = new WebSocket(this.url);

      this.socket.onopen = () => {
        const isReconnecting = this.reconnectAttempt > 0;
        this.reconnectAttempt = 0;

        if (this.onOpenCallback) this.onOpenCallback();
        
        if (isReconnecting && this.onReconnectedCallback) {
          this.onReconnectedCallback();
        }

        // Flush offline messages buffer
        this._flushQueue();

        // Start heartbeat
        this._startHeartbeat();

        if (resolve) resolve();
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'pong') {
            // Received pong, clear timeout timer
            this._resetPongTimeout();
            return;
          }

          if (this.onMessageCallback) {
            this.onMessageCallback(data);
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };

      this.socket.onerror = (error) => {
        if (reject) reject(error);
      };

      this.socket.onclose = (event) => {
        this._stopHeartbeat();
        
        if (this.onCloseCallback) {
          this.onCloseCallback(event);
        }

        // Auto-reconnect if not explicitly closed by user
        if (!this.userClosed) {
          this._handleReconnect();
        }
      };
    } catch (error) {
      if (reject) reject(error);
    }
  }

  send(data) {
    if (this.isConnected) {
      try {
        this.socket.send(JSON.stringify(data));
      } catch (err) {
        console.error("Error sending WebSocket message, queuing instead:", err);
        this.messageQueue.push(data);
      }
    } else {
      console.warn("WebSocket is not connected. Queuing message:", data);
      this.messageQueue.push(data);
    }
  }

  _flushQueue() {
    while (this.messageQueue.length > 0 && this.isConnected) {
      const data = this.messageQueue.shift();
      try {
        this.socket.send(JSON.stringify(data));
      } catch (err) {
        console.error("Error flushing queued message:", err);
        this.messageQueue.unshift(data);
        break;
      }
    }
  }

  _handleReconnect() {
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      console.error(`WebSocket connection failed after ${this.maxReconnectAttempts} attempts.`);
      if (this.onDisconnectCallback) {
        this.onDisconnectCallback();
      }
      return;
    }

    this.reconnectAttempt++;
    
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s... with jitter
    const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempt)) + (Math.random() * 1000);
    
    console.log(`Reconnecting to WebSocket in ${(delay/1000).toFixed(1)}s (Attempt ${this.reconnectAttempt}/${this.maxReconnectAttempts})`);
    
    if (this.onReconnectingCallback) {
      this.onReconnectingCallback(this.reconnectAttempt);
    }

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this._doConnect();
    }, delay);
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (this.isConnected) {
        // Send heartbeat ping
        this.send({ type: 'ping' });
        
        // Start timeout timer for pong
        this.pongTimer = setTimeout(() => {
          console.warn("WebSocket heartbeat timeout. Reconnecting...");
          this.socket.close(); // Triggers onclose and auto-reconnect
        }, this.pongTimeout);
      }
    }, this.pingInterval);
  }

  _resetPongTimeout() {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  _stopHeartbeat() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this._resetPongTimeout();
  }

  _cleanupSocket() {
    this._stopHeartbeat();
    if (this.socket) {
      try {
        this.socket.onopen = null;
        this.socket.onmessage = null;
        this.socket.onerror = null;
        this.socket.onclose = null;
        this.socket.close();
      } catch (e) {
        // ignore
      }
      this.socket = null;
    }
  }

  onMessage(callback) {
    this.onMessageCallback = callback;
  }

  onOpen(callback) {
    this.onOpenCallback = callback;
  }

  onClose(callback) {
    this.onCloseCallback = callback;
  }

  onReconnecting(callback) {
    this.onReconnectingCallback = callback;
  }

  onReconnected(callback) {
    this.onReconnectedCallback = callback;
  }

  onDisconnect(callback) {
    this.onDisconnectCallback = callback;
  }

  disconnect() {
    this.userClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._cleanupSocket();
  }

  get isConnected() {
    return this.socket && this.socket.readyState === WebSocket.OPEN;
  }
}
