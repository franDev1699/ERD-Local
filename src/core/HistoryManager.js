// src/core/HistoryManager.js
import { DiffEngine } from './DiffEngine.js';

export class HistoryManager {
  constructor(maxHistory = 40) {
    this.maxHistory = maxHistory;
    this.undoStack = []; // stores { patch, reversePatch }
    this.redoStack = []; // stores { patch, reversePatch }
    this.lastState = null;
  }

  push(stateOrPrev, newState) {
    let prevState, nextState;
    if (newState === undefined) {
      prevState = this.lastState;
      nextState = stateOrPrev;
    } else {
      prevState = stateOrPrev;
      nextState = newState;
    }

    this.lastState = JSON.parse(JSON.stringify(nextState));

    if (!prevState) {
      // First push or no previous state to compare with.
      // Generate a patch from an empty schema structure to capture the initial creation
      prevState = { tables: [], relationships: [], groups: [], queries: [] };
    }

    const patch = DiffEngine.diff(prevState, nextState);
    if (!patch) return; // No changes detected

    const reversePatch = DiffEngine.reversePatch(patch);

    this.undoStack.push({ patch, reversePatch });
    
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    
    this.redoStack = [];
  }

  undo(currentState) {
    if (!this.canUndo) return null;
    
    const entry = this.undoStack.pop();
    const prev = DiffEngine.applyPatch(currentState, entry.reversePatch);
    
    this.redoStack.push(entry);
    this.lastState = JSON.parse(JSON.stringify(prev));
    return prev;
  }

  redo(currentState) {
    if (!this.canRedo) return null;
    
    const entry = this.redoStack.pop();
    const next = DiffEngine.applyPatch(currentState, entry.patch);
    
    this.undoStack.push(entry);
    this.lastState = JSON.parse(JSON.stringify(next));
    return next;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.lastState = null;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}
