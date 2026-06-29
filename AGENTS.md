# AGENTS.md - Developer & Agent Guide

This document provides essential context, technical specifications, and operational guidelines for agents and developers working on the ERD Designer project.

## 🚀 Project Overview
A collaborative, real-time Entity-Relationship Diagram (ERD) designer. It uses a custom-built WebSocket implementation for synchronization and a modular ES6 architecture for the frontend.

## 🛠 Architecture & Modularization (SOLID)

The project has been refactored from a monolithic `app.js` into a modular structure located in the `src/` directory.

### Directory Structure
- `src/core/`: Core logic and state management.
    - `StateManager.js`: Central source of truth for the application state. Manages `appState`, notifies subscribers of changes, and manages actions like moving (`moveField`) or copying (`copyField`) fields.
    - `HistoryManager.js`: (To be implemented) Logic for Undo/Redo operations.
- `src/models/`: Domain entities.
    - `Table.js`, `Field.js`, `Relationship.js`: Classes representing the ERD entities.
- `src/services/`: Infrastructure and external integrations.
    - `StorageService.js`: Abstraction for `localStorage` persistence.
    - `WebSocketService.js`: Handles real-time communication via WebSockets.
    - `ExportService.js`: Logic for exporting data (JSON, SQL - MySQL, PostgreSQL, SQLite, and SQL Server, Images).
- `src/ui/`: User Interface components.
    - `Renderer.js`: Purely responsible for transforming state into DOM elements.
    - `CanvasManager.js`: Manages the interactive canvas (zoom, pan, fit-to-content).
    - `SidebarEditor.js`: Manages the side panel for table and field editing, supporting HTML5 drag & drop for reordering, moving, and Ctrl+drag copying fields.
    - `UIManager.js`: Manages global UI elements (Toasts, Modals, Search).
- `src/controllers/`: Orchestration and event handling.
    - `AppController.js`: The main orchestrator that initializes services and connects UI to state (e.g., wiring sidebar callbacks to state operations).
    - `InteractionController.js`: Handles canvas-level user interactions (mouse dragging, connection drawing, keyboard events).
    - `AiController.js`: Handles AI prompt-based generation/modifications, global prompts config, and AI layout.
    - `QueryController.js`: Manages the SQL Query Library, simulated query testing, and SQL AI suggestions/explanations.
    - `CollabController.js`: Coordinates real-time project management (dashboard view, identity selection, cursor presence, WebSocket broadcast).

### Key Design Principles
- **Single Responsibility (SRP):** Each module has one specific job (e.g., `Renderer` only renders, `StorageService` only saves).
- **Dependency Inversion (DIP):** High-level controllers depend on abstractions/services rather than direct DOM manipulation or global variables.
- **Open-Closed (OCP):** New features (like new export formats) can be added to services without modifying the core state logic.

## 🛠 Build, Run & Test

### Running the Project
The project uses a pure Node.js backend with no external heavy dependencies for the server.

- **Start Development Server:**
  ```bash
  node server.js
  ```
- **Access:**
  - Local: `http://localhost:3000`
  - Network: `http://<your-local-ip>:3000` (Check terminal output for IP)

### Testing & Linting
*Note: Currently, the project lacks a formal test suite (Jest/Mocha) and a linter (ESLint). Agents are encouraged to implement them following these standards:*
- **Linting:** Use `eslint` with a standard configuration.
- **Testing:** Implement unit tests for the `appState` logic and WebSocket message parsing.

## 🎨 Code Style Guidelines

### 1. JavaScript (Frontend)
- **Paradigm:** ES6+ Modules. Avoid using frameworks like React/Vue unless explicitly requested.
- **State Management:** Use the `StateManager` class. All changes must go through `StateManager` to ensure persistence and WebSocket synchronization.
- **DOM Manipulation:** 
  - Prefer `document.createElement` and `element.appendChild` for dynamic content to prevent XSS.
  - Use `dataset` for storing metadata (e.g., `table.dataset.id`).
- **Naming Conventions:**
  - `camelCase` for variables and functions.
  - `PascalCase` for Classes.
  - `UPPER_SNAKE_CASE` for constants (e.g., `DEFAULT_STATE`, `ZOOM_MIN`).
  - `kebab-case` for HTML IDs and CSS classes.
- **Error Handling:**
  - Use `try...catch` blocks when parsing JSON or interacting with `localStorage`.
  - Use `UIManager.showToast(message, type)` to provide visual feedback.

### 2. Node.js (Backend - `server.js`)
- **Paradigm:** Event-driven using the built-in `http` and `crypto` modules.
- **WebSocket Protocol:** The server implements a custom RFC 6455 compliant handler. 
  - **CRITICAL:** When adding new WebSocket features, follow the `sendFrame` and `parseFrame` patterns to ensure compatibility with the existing hand-rolled protocol.
- **File I/O:** State is persisted in `shared_state.json`. Ensure atomic writes where possible.

### 3. CSS & UI (`styles.css`, `index.html`)
- **Variables:** Use CSS variables for the color palette (e.g., `var(--color-primary)`).
- **Icons:** Use the `lucide` library via `lucide.createIcons()`.
- **Layout:** Use Flexbox and Grid for the workspace and toolbar.

## 🤝 Collaboration & Synchronization (WebSocket)
All agents must ensure that any state-altering action (adding a table, moving a field, changing a relation) triggers:
1. `pushToUndo()` (via `HistoryManager`).
2. `saveState()` (via `StateManager` and `StorageService`).

The `StateManager` handles the broadcasting of `update_state` messages to all connected clients through the `WebSocketService`.

## ⚠️ Security & Safety
- **Directory Traversal:** The server includes checks to ensure `filePath` stays within `__dirname`. Do not remove these.
- **Input Sanitization:** When rendering user-provided names (like table names), ensure they are sanitized to prevent XSS and invalid SQL generation.
- **Destructive Actions:** Always implement `confirm()` dialogs for actions like "Clear All" or "Delete Table".
