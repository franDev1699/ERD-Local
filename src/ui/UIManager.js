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
}
