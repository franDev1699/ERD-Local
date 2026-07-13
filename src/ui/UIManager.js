// src/ui/UIManager.js

export class UIManager {
  constructor(config) {
    this.toastContainer = config.toastContainer;
    this.sqlModal = config.sqlModal;
    this.imageModal = config.imageModal;
  }

  showToast(message, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast-msg ${type}`;
    
    const iconName = type === "success" ? "check-circle" : type === "error" ? "alert-circle" : "info";
    toast.innerHTML = `<i data-lucide="${iconName}"></i> <span>${message}</span>`;
    
    this.toastContainer.appendChild(toast);
    
    if (window.lucide) {
      window.lucide.createIcons({ attrs: { class: 'lucide-icon' } });
    }
    
    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  openSqlModal() {
    this.sqlModal.classList.remove("hidden");
  }

  closeSqlModal() {
    this.sqlModal.classList.add("hidden");
  }

  openImageModal() {
    this.imageModal.classList.remove("hidden");
  }

  closeImageModal() {
    this.imageModal.classList.add("hidden");
  }

  openImportSqlModal(modalElement) {
    if (modalElement) modalElement.classList.remove("hidden");
  }

  closeImportSqlModal(modalElement) {
    if (modalElement) modalElement.classList.add("hidden");
  }

  openAiModal(modalElement) {
    if (modalElement) modalElement.classList.remove("hidden");
  }

  closeAiModal(modalElement) {
    if (modalElement) modalElement.classList.add("hidden");
  }

  toggleSearch(container) {
    container.classList.toggle("hidden");
    if (!container.classList.contains("hidden")) {
      const input = container.querySelector("input");
      if (input) input.focus();
    }
  }

  confirm(message, title = "¿Estás seguro?") {
    return new Promise((resolve) => {
      const modal = document.getElementById("custom-confirm-modal");
      if (!modal) {
        // Fallback to native if not found
        resolve(window.confirm(message));
        return;
      }

      document.getElementById("confirm-modal-title").textContent = title;
      document.getElementById("confirm-modal-message").textContent = message;
      
      const btnOk = document.getElementById("btn-confirm-ok");
      const btnCancel = document.getElementById("btn-confirm-cancel");

      // Cleanup function to remove event listeners
      const cleanup = () => {
        btnOk.replaceWith(btnOk.cloneNode(true));
        btnCancel.replaceWith(btnCancel.cloneNode(true));
        modal.classList.add("hidden");
      };

      // Add new listeners
      document.getElementById("btn-confirm-ok").addEventListener("click", () => {
        cleanup();
        resolve(true);
      });

      document.getElementById("btn-confirm-cancel").addEventListener("click", () => {
        cleanup();
        resolve(false);
      });

      modal.classList.remove("hidden");
    });
  }

  prompt(message, defaultValue = "", title = "Ingresa un valor") {
    return new Promise((resolve) => {
      const modal = document.getElementById("custom-prompt-modal");
      if (!modal) {
        // Fallback
        resolve(window.prompt(message, defaultValue));
        return;
      }

      document.getElementById("prompt-modal-title").textContent = title;
      document.getElementById("prompt-modal-message").textContent = message;
      const input = document.getElementById("prompt-modal-input");
      input.value = defaultValue;
      
      const btnOk = document.getElementById("btn-prompt-ok");
      const btnCancel = document.getElementById("btn-prompt-cancel");
      const btnClose = document.getElementById("btn-close-prompt");

      const cleanup = () => {
        btnOk.replaceWith(btnOk.cloneNode(true));
        btnCancel.replaceWith(btnCancel.cloneNode(true));
        btnClose.replaceWith(btnClose.cloneNode(true));
        input.replaceWith(input.cloneNode(true)); // remove keydown listener
        modal.classList.add("hidden");
      };

      const submit = () => {
        const val = document.getElementById("prompt-modal-input").value;
        cleanup();
        resolve(val);
      };

      document.getElementById("btn-prompt-ok").addEventListener("click", submit);
      
      const cancelHandler = () => {
        cleanup();
        resolve(null);
      };

      document.getElementById("btn-prompt-cancel").addEventListener("click", cancelHandler);
      document.getElementById("btn-close-prompt").addEventListener("click", cancelHandler);

      document.getElementById("prompt-modal-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelHandler();
        }
      });

      modal.classList.remove("hidden");
      input.focus();
      input.select();
    });
  }

  openMarkdownModal(modalElement) {
    if (modalElement) modalElement.classList.remove("hidden");
  }

  closeMarkdownModal(modalElement) {
    if (modalElement) modalElement.classList.add("hidden");
  }

  showAiProgress(phase, message, progress) {
    const panel = document.getElementById("ai-loading-panel");
    const statusBar = document.getElementById("ai-progress-bar");
    const statusText = document.getElementById("ai-loading-overlay-status");
    const title = document.getElementById("ai-panel-title");
    const pulseRing = document.getElementById("ai-pulse-ring");
    const phasesContainer = document.getElementById("ai-phases-container");

    if (!panel) return;

    // Cancel any pending hide timeout
    if (this._hideAiTimeout) {
      clearTimeout(this._hideAiTimeout);
      this._hideAiTimeout = null;
    }

    panel.classList.remove("hidden");
    // Force reflow so the browser actually renders the panel
    panel.offsetHeight;
    panel.style.opacity = "1";
    panel.style.pointerEvents = "auto";

    const phaseConfig = {
      connecting: { title: "Conectando", progress: 10, icon: "wifi", color: "#6366f1" },
      thinking: { title: "Pensando", progress: 35, icon: "brain", color: "#8b5cf6" },
      generating: { title: "Generando", progress: 60, icon: "sparkles", color: "#a855f7" },
      processing: { title: "Procesando", progress: 85, icon: "code", color: "#6366f1" },
      complete: { title: "Completado", progress: 100, icon: "check", color: "#10b981" },
      error: { title: "Error", progress: 0, icon: "alert-circle", color: "#ef4444" }
    };

    const config = phaseConfig[phase] || phaseConfig.connecting;

    if (title) title.textContent = config.title;
    if (statusBar) {
      statusBar.style.width = `${progress || config.progress}%`;
      statusBar.style.background = phase === "error" 
        ? "#ef4444" 
        : `linear-gradient(90deg, ${config.color}, #8b5cf6)`;
    }
    if (statusText) statusText.textContent = message || `${config.title}...`;

    if (pulseRing) {
      if (phase === "complete" || phase === "error") {
        pulseRing.style.display = "none";
      } else {
        pulseRing.style.display = "block";
        pulseRing.style.borderColor = config.color;
      }
    }

    if (phasesContainer) {
      const steps = phasesContainer.querySelectorAll(".ai-phase-step");
      const phaseOrder = ["connecting", "thinking", "generating", "processing", "complete"];
      const currentIndex = phaseOrder.indexOf(phase);

      steps.forEach((step) => {
        const stepPhase = step.dataset.phase;
        const stepIndex = phaseOrder.indexOf(stepPhase);
        const icon = step.querySelector(".ai-phase-icon");
        const text = step.querySelector("span");

        if (stepIndex < currentIndex || (phase === "complete" && stepPhase === "complete")) {
          icon.style.background = "#10b981";
          icon.style.color = "#fff";
          text.style.color = "var(--color-text-main)";
          text.style.fontWeight = "500";
          step.style.background = "rgba(16, 185, 129, 0.08)";
        } else if (stepPhase === phase && phase !== "complete") {
          icon.style.background = config.color;
          icon.style.color = "#fff";
          text.style.color = "var(--color-text-main)";
          text.style.fontWeight = "600";
          step.style.background = `${config.color}15`;
        } else {
          icon.style.background = "var(--color-bg-tertiary)";
          icon.style.color = "var(--color-text-muted)";
          text.style.color = "var(--color-text-muted)";
          text.style.fontWeight = "400";
          step.style.background = "transparent";
        }
      });
    }

    if (window.lucide) window.lucide.createIcons();
  }

  hideAiProgress(delay = 2500) {
    const panel = document.getElementById("ai-loading-panel");
    if (!panel) return;

    // Cancel any previous pending hide
    if (this._hideAiTimeout) {
      clearTimeout(this._hideAiTimeout);
      this._hideAiTimeout = null;
    }

    this._hideAiTimeout = setTimeout(() => {
      panel.style.opacity = "0";

      // Wait for opacity transition to finish before adding hidden
      setTimeout(() => {
        panel.classList.add("hidden");
        panel.style.opacity = "";
        panel.style.pointerEvents = "";

        const statusBar = document.getElementById("ai-progress-bar");
        const statusText = document.getElementById("ai-loading-overlay-status");
        const title = document.getElementById("ai-panel-title");
        if (statusBar) statusBar.style.width = "0%";
        if (statusText) statusText.textContent = "Iniciando...";
        if (title) title.textContent = "IA Trabajando";

        const steps = document.querySelectorAll(".ai-phase-step");
        steps.forEach(step => {
          const icon = step.querySelector(".ai-phase-icon");
          const text = step.querySelector("span");
          if (icon) {
            icon.style.background = "var(--color-bg-tertiary)";
            icon.style.color = "var(--color-text-muted)";
          }
          if (text) {
            text.style.color = "var(--color-text-muted)";
            text.style.fontWeight = "400";
          }
          step.style.background = "transparent";
        });
      }, 400);
    }, delay);
  }

  addAiLog(message) {
    const logContainer = document.getElementById("ai-detail-log");
    if (!logContainer) return;

    logContainer.style.display = "block";
    const logEntry = document.createElement("div");
    logEntry.style.marginBottom = "2px";
    logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
  }
}
