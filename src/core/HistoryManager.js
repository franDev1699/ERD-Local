// src/core/HistoryManager.js

export class HistoryManager {
  constructor(maxHistory = 30) {
    this.maxHistory = maxHistory;
    this.undoStack = [];
    this.redoStack = [];
  }

  push(state) {
    this.undoStack.push(JSON.stringify(state));
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo(currentState) {
    if (!this.canUndo) return null;
    this.redoStack.push(JSON.stringify(currentState));
    return JSON.parse(this.undoStack.pop());
  }

  redo(currentState) {
    if (!this.canRedo) return null;
    this.undoStack.push(JSON.stringify(currentState));
    return JSON.parse(this.redoStack.pop());
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}
