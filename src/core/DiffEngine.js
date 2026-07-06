// src/core/DiffEngine.js

export class DiffEngine {
  /**
   * Generates a structural diff (patch) between oldObj and newObj.
   * If there are no changes, returns null.
   * @param {any} oldObj 
   * @param {any} newObj 
   * @returns {object|null}
   */
  static diff(oldObj, newObj) {
    if (oldObj === newObj) return null;

    if (this._isPrimitive(oldObj) || this._isPrimitive(newObj)) {
      return { type: 'update', value: newObj, oldValue: oldObj };
    }

    if (Array.isArray(oldObj) && Array.isArray(newObj)) {
      return this._diffArray(oldObj, newObj);
    }

    if (typeof oldObj === 'object' && typeof newObj === 'object') {
      if (oldObj === null || newObj === null) {
        return { type: 'update', value: newObj, oldValue: oldObj };
      }
      return this._diffObject(oldObj, newObj);
    }

    return { type: 'update', value: newObj, oldValue: oldObj };
  }

  /**
   * Applies a patch to an object, returning a new object (immutable updates).
   * @param {any} obj 
   * @param {object} patch 
   * @returns {any}
   */
  static applyPatch(obj, patch) {
    if (!patch) return obj;

    if (patch.type === 'update') {
      return JSON.parse(JSON.stringify(patch.value));
    }

    if (patch.type === 'object_diff') {
      const result = { ...obj };
      
      if (patch.set) {
        for (const [key, value] of Object.entries(patch.set)) {
          result[key] = JSON.parse(JSON.stringify(value));
        }
      }
      
      if (patch.delete) {
        for (const key of patch.delete) {
          delete result[key];
        }
      }
      
      if (patch.nested) {
        for (const [key, nestedPatch] of Object.entries(patch.nested)) {
          result[key] = this.applyPatch(result[key], nestedPatch);
        }
      }

      return result;
    }

    if (patch.type === 'array_diff') {
      // Reconstruct array by ID or direct values
      if (patch.isIdArray) {
        // Map existing items by ID
        const itemMap = new Map();
        obj.forEach(item => {
          if (item && item.id) {
            itemMap.set(item.id, item);
          }
        });

        // Handle updates on existing items
        if (patch.nested) {
          for (const [itemId, nestedPatch] of Object.entries(patch.nested)) {
            const item = itemMap.get(itemId);
            if (item) {
              itemMap.set(itemId, this.applyPatch(item, nestedPatch));
            }
          }
        }

        // Handle additions
        if (patch.added) {
          for (const [itemId, itemValue] of Object.entries(patch.added)) {
            itemMap.set(itemId, itemValue);
          }
        }

        // Build the final array based on the new ID order
        const result = [];
        patch.order.forEach(id => {
          const item = itemMap.get(id);
          if (item) {
            result.push(JSON.parse(JSON.stringify(item)));
          }
        });

        return result;
      } else {
        // Fallback for primitive or non-id arrays
        return JSON.parse(JSON.stringify(patch.value));
      }
    }

    return obj;
  }

  /**
   * Reverses a patch so applying it to newState yields prevState.
   * @param {object} patch 
   * @returns {object|null}
   */
  static reversePatch(patch) {
    if (!patch) return null;

    if (patch.type === 'update') {
      return { type: 'update', value: patch.oldValue, oldValue: patch.value };
    }

    if (patch.type === 'object_diff') {
      const reversed = { type: 'object_diff' };
      
      if (patch.delete && patch.delete.length > 0) {
        reversed.set = {};
        // We need the original values to restore them.
        // We stored the old values in patch.oldValues for deletions/updates
        if (patch.oldValues) {
          patch.delete.forEach(key => {
            reversed.set[key] = patch.oldValues[key];
          });
        }
      }

      if (patch.set) {
        reversed.delete = Object.keys(patch.set);
        // If there were old values for updated keys, restore them instead of deleting
        if (patch.oldValues) {
          const toDelete = [];
          Object.keys(patch.set).forEach(key => {
            if (patch.oldValues[key] !== undefined) {
              if (!reversed.set) reversed.set = {};
              reversed.set[key] = patch.oldValues[key];
            } else {
              toDelete.push(key);
            }
          });
          if (toDelete.length > 0) {
            reversed.delete = toDelete;
          } else {
            delete reversed.delete;
          }
        }
      }

      if (patch.nested) {
        reversed.nested = {};
        for (const [key, nestedPatch] of Object.entries(patch.nested)) {
          reversed.nested[key] = this.reversePatch(nestedPatch);
        }
      }

      return reversed;
    }

    if (patch.type === 'array_diff') {
      if (patch.isIdArray) {
        const reversed = {
          type: 'array_diff',
          isIdArray: true,
          order: patch.oldOrder
        };

        if (patch.added && Object.keys(patch.added).length > 0) {
          reversed.deleted = Object.keys(patch.added);
        }

        if (patch.deleted && patch.deleted.length > 0) {
          reversed.added = {};
          if (patch.oldValues) {
            patch.deleted.forEach(id => {
              reversed.added[id] = patch.oldValues[id];
            });
          }
        }

        if (patch.nested) {
          reversed.nested = {};
          for (const [itemId, nestedPatch] of Object.entries(patch.nested)) {
            reversed.nested[itemId] = this.reversePatch(nestedPatch);
          }
        }

        return reversed;
      } else {
        return { type: 'update', value: patch.oldValue, oldValue: patch.value };
      }
    }

    return null;
  }

  static _isPrimitive(val) {
    if (val === null) return true;
    const type = typeof val;
    return type !== 'object' && type !== 'function';
  }

  static _diffObject(oldObj, newObj) {
    const patch = { type: 'object_diff' };
    const set = {};
    const del = [];
    const nested = {};
    const oldValues = {};

    const oldKeys = Object.keys(oldObj);
    const newKeys = Object.keys(newObj);

    // Keys in old but not in new: deleted
    oldKeys.forEach(key => {
      if (!(key in newObj)) {
        del.push(key);
        oldValues[key] = oldObj[key];
      }
    });

    // Keys in new
    newKeys.forEach(key => {
      if (!(key in oldObj)) {
        // Added
        set[key] = newObj[key];
      } else {
        // Present in both, check for changes
        const valDiff = this.diff(oldObj[key], newObj[key]);
        if (valDiff) {
          if (valDiff.type === 'object_diff' || valDiff.type === 'array_diff') {
            nested[key] = valDiff;
          } else {
            // Update primitive or complete replacement
            set[key] = newObj[key];
            oldValues[key] = oldObj[key];
          }
        }
      }
    });

    let hasChanges = false;
    if (Object.keys(set).length > 0) {
      patch.set = set;
      hasChanges = true;
    }
    if (del.length > 0) {
      patch.delete = del;
      hasChanges = true;
    }
    if (Object.keys(nested).length > 0) {
      patch.nested = nested;
      hasChanges = true;
    }

    if (hasChanges) {
      if (Object.keys(oldValues).length > 0) {
        patch.oldValues = oldValues;
      }
      return patch;
    }

    return null;
  }

  static _diffArray(oldArr, newArr) {
    // Check if the array is composed of objects with 'id'
    const isIdArray = oldArr.every(item => item && typeof item === 'object' && 'id' in item) &&
                      newArr.every(item => item && typeof item === 'object' && 'id' in item);

    if (!isIdArray) {
      // Primitive array check for exact match
      const str1 = JSON.stringify(oldArr);
      const str2 = JSON.stringify(newArr);
      if (str1 === str2) return null;
      return { type: 'update', value: newArr, oldValue: oldArr };
    }

    const patch = {
      type: 'array_diff',
      isIdArray: true,
      order: newArr.map(item => item.id),
      oldOrder: oldArr.map(item => item.id)
    };

    const oldMap = new Map(oldArr.map(item => [item.id, item]));
    const newMap = new Map(newArr.map(item => [item.id, item]));

    const added = {};
    const deleted = [];
    const nested = {};
    const oldValues = {};

    // Deleted items
    oldArr.forEach(item => {
      if (!newMap.has(item.id)) {
        deleted.push(item.id);
        oldValues[item.id] = item;
      }
    });

    // Added and updated items
    newArr.forEach(item => {
      const oldItem = oldMap.get(item.id);
      if (!oldItem) {
        // Added
        added[item.id] = item;
      } else {
        // Diff item details recursively
        const itemDiff = this.diff(oldItem, item);
        if (itemDiff) {
          nested[item.id] = itemDiff;
        }
      }
    });

    let hasChanges = false;
    // Check if orders are different
    const orderChanged = JSON.stringify(patch.order) !== JSON.stringify(patch.oldOrder);
    
    if (orderChanged) hasChanges = true;

    if (Object.keys(added).length > 0) {
      patch.added = added;
      hasChanges = true;
    }
    if (deleted.length > 0) {
      patch.deleted = deleted;
      hasChanges = true;
    }
    if (Object.keys(nested).length > 0) {
      patch.nested = nested;
      hasChanges = true;
    }

    if (hasChanges) {
      if (Object.keys(oldValues).length > 0) {
        patch.oldValues = oldValues;
      }
      return patch;
    }

    return null;
  }
}
