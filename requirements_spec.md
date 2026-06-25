# Requirements Specification: ERD Designer Project

## 1. Project Overview
Collaborative, real-time Entity-Relationship Diagram (ERD) designer. The system allows multiple users to design database schemas simultaneously using a modular ES6 architecture and a custom WebSocket implementation.

## 2. Functional Requirements
- **Real-time Collaboration:** Synchronized state across all connected clients via WebSockets.
- **Entity Management:** Creation, editing, and deletion of Tables, Fields, and Relationships.
- **Canvas Interaction:** Zoom, pan, and drag-and-drop capabilities.
- **Visual Feedback:** Use of Toasts and Modals for user notifications and confirmations.

## 3. Technical Architecture & Logic

### 3.1 Data Persistence & Synchronization
- **Primary Authority:** The Server is the source of truth while active (persisting to `shared_state.json`).
- **Fallback Mechanism:** In case of server downtime or disconnection, the system must rely on `localStorage` (via `StorageService.js`) to maintain the last known state received from the server.
- **Conflict Strategy:** To be refined (Current focus: Server-driven synchronization).

### 3.2 History Management (Undo/Redo)
- **Strategy:** Snapshot-based approach.
- **Implementation:** The `HistoryManager.js` will store state snapshots to allow robust navigation through the application's timeline.

### 3.3 Export Capabilities
- **Formats:** JSON, SQL, and Images.
- **Image Export Strategy:** *PENDING DEFINITION* (Current baseline: Canvas capture/Screenshot).

### 3.4 Relationship & Validation Logic
- **Validation Mode:** Assisted.
- **Behavior:** The system will not strictly block complex patterns (like circular relationships) but will actively warn the user via `UIManager.showToast` when potentially problematic designs are detected.

## 4. Non-Functional Requirements
- **Architecture:** SOLID principles (SRP, DIP, OCP).
- **Communication:** Custom RFC 6455 compliant WebSocket protocol.
- **Performance:** Real-time updates without perceptible lag in the UI.

## 5. Edge Cases & Error Handling
- **Server Disconnection:** Graceful fallback to local state.
- **Complex Schemas:** Visual warnings for circular or redundant relationships.
- **Data Integrity:** Validation of field types and table names during the design process.
