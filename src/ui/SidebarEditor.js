// src/ui/SidebarEditor.js

export class SidebarEditor {
  constructor(config) {
    this.container = config.container;
    this.onTableSelect = config.onTableSelect;
    this.onTableUpdate = config.onTableUpdate;
    this.onTableDelete = config.onTableDelete;
    this.onTableDuplicate = config.onTableDuplicate;
    this.onFieldAdd = config.onFieldAdd;
    this.onFieldUpdate = config.onFieldUpdate;
    this.onFieldDelete = config.onFieldDelete;
    this.onFieldMove = config.onFieldMove;
    this.onFieldCopy = config.onFieldCopy;
    this.onGroupUpdate = config.onGroupUpdate;
    this.onGroupDelete = config.onGroupDelete;
    this.onBatchDelete = config.onBatchDelete;
    this.onBatchGroup = config.onBatchGroup;

    // Drag & drop state for fields
    this._dragFieldData = null;
  }

  scrollToTable(tableId) {
    setTimeout(() => {
      const item = this.container.querySelector(`.table-accordion-item[data-id="${tableId}"]`);
      if (item) {
        item.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);
  }

  scrollToField(tableId, fieldId) {
    setTimeout(() => {
      const item = this.container.querySelector(
        `.table-accordion-item[data-id="${tableId}"] .field-editor-item[data-field-id="${fieldId}"]`
      );
      if (item) {
        item.scrollIntoView({ behavior: "smooth", block: "center" });
        
        // Highlight the field briefly
        const originalBg = item.style.backgroundColor;
        item.style.transition = "background-color 0.3s";
        item.style.backgroundColor = "rgba(99, 102, 241, 0.25)";
        setTimeout(() => {
          item.style.backgroundColor = originalBg;
        }, 1000);
      }
    }, 150);
  }

  render(tables, selectedTableIds, groups = []) {
    this.container.innerHTML = "";

    const selectedSet = selectedTableIds instanceof Set 
      ? selectedTableIds 
      : new Set(selectedTableIds ? [selectedTableIds] : []);

    if (selectedSet.size > 1) {
      this.renderBatchEditor(selectedSet, tables, groups);
      return;
    }

    if (tables.length === 0) {
      this.container.innerHTML = `
        <div class="editor-empty">
          <i data-lucide="mouse-pointer-click" class="empty-icon"></i>
          <p>No hay tablas en el diagrama. Agrega una nueva tabla para empezar.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    tables.forEach(table => {
      const isExpanded = selectedSet.has(table.id);
      const accordionItem = this._createAccordionItem(table, isExpanded, groups);
      this.container.appendChild(accordionItem);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  _createAccordionItem(table, isExpanded, groups = []) {
    const accordionItem = document.createElement("div");
    accordionItem.className = `table-accordion-item ${isExpanded ? "expanded" : ""}`;
    accordionItem.dataset.id = table.id;

    // Header
    const header = document.createElement("div");
    header.className = "table-accordion-header";
    header.innerHTML = `
      <div class="drag-handle"><i data-lucide="grip-vertical"></i></div>
      <h3>${table.name}</h3>
      <i data-lucide="chevron-down"></i>
    `;
    
    header.addEventListener("click", (e) => {
      if (!e.target.closest(".drag-handle")) {
        // Toggle selection
        if (isExpanded) {
          this.onTableSelect(null);
        } else {
          this.onTableSelect(table.id);
        }
      }
    });

    accordionItem.appendChild(header);

    // Allow dropping fields onto the table header/accordion item
    accordionItem.addEventListener("dragover", (e) => {
      if (!this._dragFieldData) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = e.ctrlKey ? "copy" : "move";
      accordionItem.classList.add("drop-target-active");

      // Auto-expand table if hovered for more than 600ms
      if (!isExpanded && !this._expandTimeout) {
        this._expandTimeout = setTimeout(() => {
          this.onTableSelect(table.id);
          this._expandTimeout = null;
        }, 600);
      }
    });

    accordionItem.addEventListener("dragleave", (e) => {
      if (!accordionItem.contains(e.relatedTarget)) {
        accordionItem.classList.remove("drop-target-active");
        if (this._expandTimeout) {
          clearTimeout(this._expandTimeout);
          this._expandTimeout = null;
        }
      }
    });

    accordionItem.addEventListener("drop", (e) => {
      if (!this._dragFieldData) return;
      e.preventDefault();
      e.stopPropagation();
      accordionItem.classList.remove("drop-target-active");
      if (this._expandTimeout) {
        clearTimeout(this._expandTimeout);
        this._expandTimeout = null;
      }

      const { fieldId: draggedFieldId, sourceTableId } = this._dragFieldData;
      const targetTableId = table.id;
      const targetIndex = table.fields.length;
      const isCopy = e.ctrlKey;

      if (isCopy) {
        if (this.onFieldCopy) {
          this.onFieldCopy(sourceTableId, draggedFieldId, targetTableId, targetIndex);
        }
      } else {
        if (this.onFieldMove) {
          this.onFieldMove(sourceTableId, draggedFieldId, targetTableId, targetIndex);
        }
      }
      this._dragFieldData = null;
    });

    // Content
    const content = document.createElement("div");
    content.className = "table-accordion-content";
    
    // Table Name Editor
    const nameGroup = document.createElement("div");
    nameGroup.className = "form-group";
    nameGroup.innerHTML = `
      <label>Nombre de la Tabla</label>
      <input type="text" class="edit-table-name-input" value="${table.name}" />
    `;
    const nameInput = nameGroup.querySelector("input");
    
    nameInput.addEventListener("change", (e) => {
      // Clean table name: lowercase and alphanumeric only (no spaces/special chars)
      const cleanName = e.target.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
      e.target.value = cleanName;
      this.onTableUpdate(table.id, { name: cleanName });
    });
    content.appendChild(nameGroup);

    // Table Color Selector
    const colorGroup = document.createElement("div");
    colorGroup.className = "form-group";
    colorGroup.style.marginTop = "10px";
    colorGroup.innerHTML = `
      <label>Color de Cabecera</label>
      <div class="color-presets-wrapper" style="display: flex; align-items: center; gap: 8px; margin-top: 5px;">
        <button class="color-preset" style="background-color: #6366f1; width: 20px; height: 20px; border-radius: 50%; border: 2px solid ${table.color === '#6366f1' ? '#fff' : 'transparent'}; cursor: pointer;" data-color="#6366f1"></button>
        <button class="color-preset" style="background-color: #10b981; width: 20px; height: 20px; border-radius: 50%; border: 2px solid ${table.color === '#10b981' ? '#fff' : 'transparent'}; cursor: pointer;" data-color="#10b981"></button>
        <button class="color-preset" style="background-color: #f43f5e; width: 20px; height: 20px; border-radius: 50%; border: 2px solid ${table.color === '#f43f5e' ? '#fff' : 'transparent'}; cursor: pointer;" data-color="#f43f5e"></button>
        <button class="color-preset" style="background-color: #f59e0b; width: 20px; height: 20px; border-radius: 50%; border: 2px solid ${table.color === '#f59e0b' ? '#fff' : 'transparent'}; cursor: pointer;" data-color="#f59e0b"></button>
        <button class="color-preset" style="background-color: #8b5cf6; width: 20px; height: 20px; border-radius: 50%; border: 2px solid ${table.color === '#8b5cf6' ? '#fff' : 'transparent'}; cursor: pointer;" data-color="#8b5cf6"></button>
        <button class="color-preset" style="background-color: #0ea5e9; width: 20px; height: 20px; border-radius: 50%; border: 2px solid ${table.color === '#0ea5e9' ? '#fff' : 'transparent'}; cursor: pointer;" data-color="#0ea5e9"></button>
        <input type="color" class="table-custom-color-picker" value="${table.color || '#6366f1'}" style="width: 24px; height: 24px; border: none; padding: 0; background: none; cursor: pointer;" />
      </div>
    `;

    colorGroup.querySelectorAll(".color-preset").forEach(btn => {
      btn.addEventListener("click", () => {
        const color = btn.dataset.color;
        this.onTableUpdate(table.id, { color });
      });
    });

    const tableColorPicker = colorGroup.querySelector(".table-custom-color-picker");
    tableColorPicker.addEventListener("change", (e) => {
      const color = e.target.value;
      this.onTableUpdate(table.id, { color });
    });

    content.appendChild(colorGroup);

    // Group Assignment Selector
    const groupSelectGroup = document.createElement("div");
    groupSelectGroup.className = "form-group";
    groupSelectGroup.style.marginTop = "10px";
    
    let groupOptions = `<option value="">Ninguno</option>`;
    groups.forEach(g => {
      groupOptions += `<option value="${g.id}" ${table.groupId === g.id ? 'selected' : ''}>${g.name}</option>`;
    });

    groupSelectGroup.innerHTML = `
      <label>Grupo</label>
      <select class="table-group-select">
        ${groupOptions}
      </select>
    `;

    const groupSelectEl = groupSelectGroup.querySelector(".table-group-select");
    groupSelectEl.addEventListener("change", (e) => {
      const selectedGroupId = e.target.value || null;
      this.onTableUpdate(table.id, { groupId: selectedGroupId });
    });
    content.appendChild(groupSelectGroup);

    // Header for fields list
    const fieldsHeader = document.createElement("div");
    fieldsHeader.className = "field-list-header";
    fieldsHeader.innerHTML = `<span>Campos</span>`;
    content.appendChild(fieldsHeader);

    // Fields List
    const fieldsList = document.createElement("div");
    fieldsList.className = "fields-list";
    fieldsList.dataset.tableId = table.id;
    table.fields.forEach(field => {
      fieldsList.appendChild(this._createFieldEditorItem(table.id, field));
    });

    // Allow dropping fields into this table's list (cross-table or end-of-list)
    fieldsList.addEventListener("dragover", (e) => {
      if (!this._dragFieldData) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      fieldsList.classList.add("drop-target-active");
    });

    fieldsList.addEventListener("dragleave", (e) => {
      // Only remove if leaving the container (not entering a child)
      if (!fieldsList.contains(e.relatedTarget)) {
        fieldsList.classList.remove("drop-target-active");
      }
    });

    fieldsList.addEventListener("drop", (e) => {
      e.preventDefault();
      fieldsList.classList.remove("drop-target-active");

      if (!this._dragFieldData) return;

      const { fieldId: draggedFieldId, sourceTableId } = this._dragFieldData;
      const targetTableId = table.id;
      // Drop at end of list
      const targetIndex = table.fields.length;
      const isCopy = e.ctrlKey;

      if (isCopy) {
        if (this.onFieldCopy) {
          this.onFieldCopy(sourceTableId, draggedFieldId, targetTableId, targetIndex);
        }
      } else {
        if (this.onFieldMove) {
          this.onFieldMove(sourceTableId, draggedFieldId, targetTableId, targetIndex);
        }
      }
      this._dragFieldData = null;
    });
    content.appendChild(fieldsList);

    // Button: Add Field
    const addFieldBtn = document.createElement("button");
    addFieldBtn.className = "btn btn-secondary btn-sm btn-full";
    addFieldBtn.style.marginTop = "10px";
    addFieldBtn.innerHTML = `<i data-lucide="plus"></i> Agregar Campo`;
    addFieldBtn.addEventListener("click", () => {
      this.onFieldAdd(table.id);
    });
    content.appendChild(addFieldBtn);

    // Button: Duplicate Table
    const duplicateTableBtn = document.createElement("button");
    duplicateTableBtn.className = "btn btn-secondary btn-sm btn-full";
    duplicateTableBtn.style.marginTop = "8px";
    duplicateTableBtn.innerHTML = `<i data-lucide="copy"></i> Duplicar Tabla`;
    duplicateTableBtn.addEventListener("click", () => {
      if (this.onTableDuplicate) this.onTableDuplicate(table.id);
    });
    content.appendChild(duplicateTableBtn);

    // Button: Delete Table
    const deleteTableBtn = document.createElement("button");
    deleteTableBtn.className = "btn btn-danger-outline btn-sm btn-full";
    deleteTableBtn.style.marginTop = "8px";
    deleteTableBtn.innerHTML = `<i data-lucide="trash-2"></i> Eliminar Tabla`;
    deleteTableBtn.addEventListener("click", () => {
      this.onTableDelete(table.id);
    });
    content.appendChild(deleteTableBtn);

    accordionItem.appendChild(content);
    return accordionItem;
  }

  _createFieldEditorItem(tableId, field) {
    const item = document.createElement("div");
    item.className = "field-editor-item";
    item.draggable = false; // Start as false so input fields can be interacted with / text selected
    item.dataset.fieldId = field.id;
    item.dataset.tableId = tableId;

    const pkChecked = field.isPK ? "checked" : "";
    const aiChecked = field.isAutoIncrement ? "checked" : "";
    const nnChecked = field.isNotNull ? "checked" : "";
    const uqChecked = field.isUnique ? "checked" : "";
    const defValue = field.defaultValue || "";

    const { baseType, length } = this._parseFieldType(field.type);
    const typeSelectHtml = this._getTypeSelectHtml(baseType);

    item.innerHTML = `
      <div class="field-editor-row-main">
        <div class="field-drag-handle" title="Arrastrar para mover · Ctrl+Arrastrar para copiar"><i data-lucide="grip-vertical"></i></div>
        <input type="text" class="field-name-input" value="${field.name}" placeholder="nombre_campo">
        ${typeSelectHtml}
        <input type="text" class="field-length-input" value="${length}" placeholder="Long." title="Longitud o Valores (ej: 255, 10,2 o 'a','b')">
        <label class="field-checkbox-label ${pkChecked}" title="Llave Primaria (PK)">
          <input type="checkbox" class="field-pk-checkbox" ${field.isPK ? 'checked' : ''}>
          PK
        </label>
        <button class="btn-icon btn-delete-field" title="Eliminar campo"><i data-lucide="trash-2"></i></button>
      </div>
      <div class="field-advanced-options">
        <label class="adv-checkbox" title="Auto Increment"><input type="checkbox" class="field-ai-checkbox" ${field.isAutoIncrement ? 'checked' : ''}> A.I.</label>
        <label class="adv-checkbox" title="Not Null"><input type="checkbox" class="field-nn-checkbox" ${field.isNotNull ? 'checked' : ''}> N.N.</label>
        <label class="adv-checkbox" title="Unique"><input type="checkbox" class="field-uq-checkbox" ${field.isUnique ? 'checked' : ''}> U.Q.</label>
        <div class="adv-default">
          <span>Def:</span>
          <input type="text" class="field-default-input" value="${defValue}" placeholder="Ej: '0'">
        </div>
      </div>
    `;

    // Make draggable dynamic based on handle grabbing
    const dragHandle = item.querySelector(".field-drag-handle");
    if (dragHandle) {
      dragHandle.addEventListener("mousedown", () => {
        item.draggable = true;
      });
      dragHandle.addEventListener("mouseup", () => {
        item.draggable = false;
      });
      dragHandle.addEventListener("mouseleave", () => {
        if (!item.classList.contains("dragging")) {
          item.draggable = false;
        }
      });
    }

    // --- Drag & Drop events ---
    item.addEventListener("dragstart", (e) => {
      this._dragFieldData = { fieldId: field.id, sourceTableId: tableId };
      e.dataTransfer.effectAllowed = "copyMove";
      e.dataTransfer.setData("text/plain", field.id);
      requestAnimationFrame(() => item.classList.add("dragging"));
    });

    item.addEventListener("dragend", () => {
      item.draggable = false;
      item.classList.remove("dragging");
      this._dragFieldData = null;
      // Clean all visual indicators
      this.container.querySelectorAll(".drag-over-top, .drag-over-bottom").forEach(el => {
        el.classList.remove("drag-over-top", "drag-over-bottom");
      });
      this.container.querySelectorAll(".fields-list.drop-target-active, .table-accordion-item.drop-target-active").forEach(el => {
        el.classList.remove("drop-target-active");
      });
    });

    item.addEventListener("dragover", (e) => {
      if (!this._dragFieldData) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = e.ctrlKey ? "copy" : "move";

      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      item.classList.remove("drag-over-top", "drag-over-bottom");
      if (e.clientY < midY) {
        item.classList.add("drag-over-top");
      } else {
        item.classList.add("drag-over-bottom");
      }
    });

    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-over-top", "drag-over-bottom");
    });

    item.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove("drag-over-top", "drag-over-bottom");

      if (!this._dragFieldData) return;

      const { fieldId: draggedFieldId, sourceTableId } = this._dragFieldData;
      const targetTableId = item.dataset.tableId;

      // Compute target index
      const fieldsList = item.closest(".fields-list");
      const fieldItems = Array.from(fieldsList.querySelectorAll(".field-editor-item"));
      let targetIndex = fieldItems.indexOf(item);

      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY >= midY) {
        targetIndex += 1;
      }

      const isCopy = e.ctrlKey;

      if (isCopy) {
        // Copy: duplicate the field at target position
        if (this.onFieldCopy) {
          this.onFieldCopy(sourceTableId, draggedFieldId, targetTableId, targetIndex);
        }
      } else {
        // Move: adjust index if reordering within same table and dragging downward
        if (sourceTableId === targetTableId) {
          const draggedItem = fieldsList.querySelector(`.field-editor-item[data-field-id="${draggedFieldId}"]`);
          const draggedIndex = fieldItems.indexOf(draggedItem);
          if (draggedIndex < targetIndex) {
            targetIndex -= 1;
          }
        }
        if (this.onFieldMove) {
          this.onFieldMove(sourceTableId, draggedFieldId, targetTableId, targetIndex);
        }
      }

      this._dragFieldData = null;
    });

    // Event listeners
    const nameInput = item.querySelector(".field-name-input");
    nameInput.addEventListener("change", (e) => {
      this.onFieldUpdate(tableId, field.id, { name: e.target.value.trim() });
    });

    const typeSelect = item.querySelector(".field-type-select");
    const lengthInput = item.querySelector(".field-length-input");

    const updateCombinedType = () => {
      const baseVal = typeSelect.value;
      const lenVal = lengthInput.value.trim();
      const combined = lenVal ? `${baseVal}(${lenVal})` : baseVal;
      this.onFieldUpdate(tableId, field.id, { type: combined });
    };

    typeSelect.addEventListener("change", updateCombinedType);
    lengthInput.addEventListener("change", updateCombinedType);

    const pkCheckbox = item.querySelector(".field-pk-checkbox");
    pkCheckbox.addEventListener("change", (e) => {
      this.onFieldUpdate(tableId, field.id, { isPK: e.target.checked });
    });

    const deleteBtn = item.querySelector(".btn-delete-field");
    deleteBtn.addEventListener("click", () => {
      this.onFieldDelete(tableId, field.id);
    });

    const aiCheckbox = item.querySelector(".field-ai-checkbox");
    aiCheckbox.addEventListener("change", (e) => {
      this.onFieldUpdate(tableId, field.id, { isAutoIncrement: e.target.checked });
    });

    const nnCheckbox = item.querySelector(".field-nn-checkbox");
    nnCheckbox.addEventListener("change", (e) => {
      this.onFieldUpdate(tableId, field.id, { isNotNull: e.target.checked });
    });

    const uqCheckbox = item.querySelector(".field-uq-checkbox");
    uqCheckbox.addEventListener("change", (e) => {
      this.onFieldUpdate(tableId, field.id, { isUnique: e.target.checked });
    });

    const defaultInput = item.querySelector(".field-default-input");
    defaultInput.addEventListener("change", (e) => {
      this.onFieldUpdate(tableId, field.id, { defaultValue: e.target.value.trim() });
    });

    return item;
  }

  renderGroupEditor(group, groups) {
    this.container.innerHTML = "";

    if (!group) {
      this.container.innerHTML = `
        <div class="editor-empty">
          <i data-lucide="mouse-pointer-click" class="empty-icon"></i>
          <p>Grupo no encontrado.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    const editorEl = document.createElement("div");
    editorEl.className = "group-editor-panel";
    editorEl.style.padding = "20px";
    editorEl.style.display = "flex";
    editorEl.style.flexDirection = "column";
    editorEl.style.gap = "15px";

    // Title
    const header = document.createElement("div");
    header.className = "section-title";
    header.style.marginBottom = "10px";
    header.innerHTML = `
      <h3>Editar Grupo</h3>
      <button class="btn btn-secondary btn-sm btn-back-to-tables"><i data-lucide="arrow-left"></i> Volver</button>
    `;
    header.querySelector(".btn-back-to-tables").addEventListener("click", () => {
      this.onTableSelect(null); // This clears group selection and shows tables list
    });
    editorEl.appendChild(header);

    // Group Name
    const nameGroup = document.createElement("div");
    nameGroup.className = "form-group";
    nameGroup.innerHTML = `
      <label>Nombre del Grupo</label>
      <input type="text" class="edit-group-name-input" value="${group.name}" />
    `;
    const nameInput = nameGroup.querySelector("input");
    nameInput.addEventListener("change", (e) => {
      const cleanName = e.target.value.trim();
      this.onGroupUpdate(group.id, { name: cleanName });
    });
    editorEl.appendChild(nameGroup);

    // Group Color Presets
    const colorGroup = document.createElement("div");
    colorGroup.className = "form-group";
    colorGroup.innerHTML = `
      <label>Color del Grupo</label>
      <div class="color-presets-wrapper" style="display: flex; align-items: center; gap: 8px; margin-top: 5px;">
        <button class="color-preset" style="background-color: #6366f1; width: 24px; height: 24px; border-radius: 50%; border: 2px solid ${group.color === '#6366f1' ? '#fff' : 'transparent'}; cursor: pointer;" data-color="#6366f1"></button>
        <button class="color-preset" style="background-color: #10b981; width: 24px; height: 24px; border-radius: 50%; border: 2px solid ${group.color === '#10b981' ? '#fff' : 'transparent'}; cursor: pointer;" data-color="#10b981"></button>
        <button class="color-preset" style="background-color: #f43f5e; width: 24px; height: 24px; border-radius: 50%; border: 2px solid ${group.color === '#f43f5e' ? '#fff' : 'transparent'}; cursor: pointer;" data-color="#f43f5e"></button>
        <button class="color-preset" style="background-color: #f59e0b; width: 24px; height: 24px; border-radius: 50%; border: 2px solid ${group.color === '#f59e0b' ? '#fff' : 'transparent'}; cursor: pointer;" data-color="#f59e0b"></button>
        <button class="color-preset" style="background-color: #8b5cf6; width: 24px; height: 24px; border-radius: 50%; border: 2px solid ${group.color === '#8b5cf6' ? '#fff' : 'transparent'}; cursor: pointer;" data-color="#8b5cf6"></button>
        <button class="color-preset" style="background-color: #0ea5e9; width: 24px; height: 24px; border-radius: 50%; border: 2px solid ${group.color === '#0ea5e9' ? '#fff' : 'transparent'}; cursor: pointer;" data-color="#0ea5e9"></button>
        <button class="color-preset" style="background-color: #14b8a6; width: 24px; height: 24px; border-radius: 50%; border: 2px solid ${group.color === '#14b8a6' ? '#fff' : 'transparent'}; cursor: pointer;" data-color="#14b8a6"></button>
        <button class="color-preset" style="background-color: #f97316; width: 24px; height: 24px; border-radius: 50%; border: 2px solid ${group.color === '#f97316' ? '#fff' : 'transparent'}; cursor: pointer;" data-color="#f97316"></button>
        <input type="color" class="group-custom-color-picker" value="${group.color || '#475569'}" style="width: 28px; height: 28px; border: none; padding: 0; background: none; cursor: pointer;" />
      </div>
    `;

    colorGroup.querySelectorAll(".color-preset").forEach(btn => {
      btn.addEventListener("click", () => {
        const color = btn.dataset.color;
        this.onGroupUpdate(group.id, { color });
      });
    });

    const customColorPicker = colorGroup.querySelector(".group-custom-color-picker");
    customColorPicker.addEventListener("change", (e) => {
      const color = e.target.value;
      this.onGroupUpdate(group.id, { color });
    });

    editorEl.appendChild(colorGroup);

    // Delete Group Button
    const deleteGroupBtn = document.createElement("button");
    deleteGroupBtn.className = "btn btn-danger-outline btn-full";
    deleteGroupBtn.style.marginTop = "20px";
    deleteGroupBtn.innerHTML = `<i data-lucide="trash-2"></i> Eliminar Grupo`;
    deleteGroupBtn.addEventListener("click", () => {
      this.onGroupDelete(group.id);
    });
    editorEl.appendChild(deleteGroupBtn);

    this.container.appendChild(editorEl);
    if (window.lucide) window.lucide.createIcons();
  }

  renderBatchEditor(selectedSet, tables, groups) {
    const count = selectedSet.size;
    const card = document.createElement("div");
    card.className = "batch-editor-panel";
    card.innerHTML = `
      <div class="batch-header">
        <i data-lucide="layers"></i>
        <h3>Selección Múltiple</h3>
        <span class="batch-badge">${count} tablas</span>
      </div>
      <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 20px;">
        Acciones para las tablas seleccionadas:
      </p>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div class="form-group">
          <label>Asignar a Grupo</label>
          <div style="display: flex; gap: 8px;">
            <select id="batch-group-select" style="flex: 1;">
              <option value="">Ninguno</option>
              <option value="NEW_GROUP" style="font-weight: 600; color: var(--color-primary-light);">+ Nuevo Grupo...</option>
              ${groups.map(g => `<option value="${g.id}">${g.name}</option>`).join("")}
            </select>
            <button id="btn-batch-group" class="btn btn-secondary btn-sm" style="padding-inline: 12px;">Aplicar</button>
          </div>
        </div>
        <hr style="border: none; border-top: 1px solid var(--color-border); margin-block: 8px;" />
        <button id="btn-batch-delete" class="btn btn-danger-outline btn-full">
          <i data-lucide="trash-2"></i> Eliminar ${count} Tablas
        </button>
      </div>
    `;

    const btnGroup = card.querySelector("#btn-batch-group");
    const groupSelect = card.querySelector("#batch-group-select");
    btnGroup.addEventListener("click", () => {
      const groupId = groupSelect.value || null;
      if (this.onBatchGroup) {
        this.onBatchGroup(Array.from(selectedSet), groupId);
      }
    });

    const btnDelete = card.querySelector("#btn-batch-delete");
    btnDelete.addEventListener("click", () => {
      if (this.onBatchDelete) {
        this.onBatchDelete(Array.from(selectedSet));
      }
    });

    this.container.appendChild(card);
    if (window.lucide) window.lucide.createIcons();
  }

  _parseFieldType(fullType) {
    if (!fullType) return { baseType: "VARCHAR", length: "255" };
    const match = fullType.match(/^([^(]+)(?:\(([^)]+)\))?$/);
    if (match) {
      return {
        baseType: match[1].trim().toUpperCase(),
        length: match[2] ? match[2].trim() : ""
      };
    }
    return { baseType: fullType.toUpperCase(), length: "" };
  }

  _getTypeSelectHtml(selectedBaseType) {
    const categories = {
      "Numérico": [
        "INT", "TINYINT", "SMALLINT", "MEDIUMINT", "BIGINT", 
        "DECIMAL", "FLOAT", "DOUBLE", "REAL", "BIT", "BOOLEAN", "SERIAL"
      ],
      "Fecha y Hora": [
        "DATE", "DATETIME", "TIMESTAMP", "TIME", "YEAR"
      ],
      "Cadena": [
        "VARCHAR", "CHAR", "TINYTEXT", "TEXT", "MEDIUMTEXT", "LONGTEXT",
        "BINARY", "VARBINARY", "TINYBLOB", "BLOB", "MEDIUMBLOB", "LONGBLOB",
        "ENUM", "SET"
      ],
      "Espacial": [
        "GEOMETRY", "POINT", "LINESTRING", "POLYGON", 
        "MULTIPOINT", "MULTILINESTRING", "MULTIPOLYGON", "GEOMETRYCOLLECTION"
      ],
      "JSON / Especiales": [
        "JSON", "UUID", "INET4", "INET6"
      ]
    };

    let typeExists = false;
    const cleanBase = selectedBaseType ? selectedBaseType.trim().toUpperCase() : "";
    for (const types of Object.values(categories)) {
      if (types.includes(cleanBase)) {
        typeExists = true;
        break;
      }
    }

    let html = `<select class="field-type-select">`;
    if (!typeExists && cleanBase) {
      html += `<optgroup label="Personalizado">`;
      html += `<option value="${cleanBase}" selected>${cleanBase}</option>`;
      html += `</optgroup>`;
    }

    for (const [category, types] of Object.entries(categories)) {
      html += `<optgroup label="${category}">`;
      types.forEach(t => {
        const isSelected = t === cleanBase ? 'selected' : '';
        html += `<option value="${t}" ${isSelected}>${t}</option>`;
      });
      html += `</optgroup>`;
    }
    html += `</select>`;
    return html;
  }
}
