// src/core/LayoutEngine.js

export class LayoutEngine {
  static TABLE_WIDTH = 240;
  static HEADER_HEIGHT = 52;
  static FIELD_ROW_HEIGHT = 32;
  static TABLE_PADDING = 16;
  
  static GAP_X = 60;
  static GAP_Y = 60;
  
  static PADDING_LEFT = 30;
  static PADDING_TOP = 60;
  static PADDING_RIGHT = 30;
  static PADDING_BOTTOM = 60;

  /**
   * Estimates the height of a table based on its fields count
   * @param {Object} table 
   * @returns {number}
   */
  static estimateTableHeight(table) {
    const fieldCount = table.fields ? table.fields.length : 0;
    return this.HEADER_HEIGHT + (fieldCount * this.FIELD_ROW_HEIGHT) + this.TABLE_PADDING;
  }

  /**
   * Sorts tables within a group deterministically to place connected tables in adjacent cells.
   * @param {Array} tables 
   * @param {Array} relationships 
   * @returns {Array} Ordered tables
   */
  static sortTablesByConnections(tables, relationships) {
    if (tables.length <= 1) return [...tables];

    // Initial sort to ensure determinism
    const sortedBase = [...tables].sort((a, b) => a.id.localeCompare(b.id));
    const tableIds = new Set(tables.map(t => t.id));

    // Build adjacency list for relationships within this group
    const adj = {};
    tables.forEach(t => {
      adj[t.id] = new Set();
    });

    relationships.forEach(rel => {
      if (tableIds.has(rel.fromTable) && tableIds.has(rel.toTable)) {
        if (rel.fromTable !== rel.toTable) {
          adj[rel.fromTable].add(rel.toTable);
          adj[rel.toTable].add(rel.fromTable);
        }
      }
    });

    const placedIds = new Set();
    const ordered = [];

    // Helper to get overall degree of a table
    const getDegree = (id) => adj[id].size;

    while (ordered.length < tables.length) {
      let nextTable = null;

      if (ordered.length === 0) {
        // Start with the table with highest connectivity degree
        let maxDegree = -1;
        for (const t of sortedBase) {
          const d = getDegree(t.id);
          if (d > maxDegree) {
            maxDegree = d;
            nextTable = t;
          }
        }
      } else {
        // Greedily select the table connected to placed tables with highest overlap
        let maxOverlap = -1;
        let maxDegree = -1;

        for (const t of sortedBase) {
          if (placedIds.has(t.id)) continue;

          // Count connections to already placed tables
          let overlap = 0;
          adj[t.id].forEach(neighborId => {
            if (placedIds.has(neighborId)) {
              overlap++;
            }
          });

          const d = getDegree(t.id);

          // Select based on overlap first, then overall degree, then alphabetical tie-break
          if (overlap > maxOverlap) {
            maxOverlap = overlap;
            maxDegree = d;
            nextTable = t;
          } else if (overlap === maxOverlap && overlap > 0) {
            if (d > maxDegree) {
              maxDegree = d;
              nextTable = t;
            }
          }
        }

        // If no table is connected to any placed table (unconnected component)
        if (!nextTable) {
          let maxDegree = -1;
          for (const t of sortedBase) {
            if (placedIds.has(t.id)) continue;
            const d = getDegree(t.id);
            if (d > maxDegree) {
              maxDegree = d;
              nextTable = t;
            }
          }
        }
      }

      if (nextTable) {
        ordered.push(nextTable);
        placedIds.add(nextTable.id);
      } else {
        // Fallback for safety
        const remaining = sortedBase.find(t => !placedIds.has(t.id));
        if (remaining) {
          ordered.push(remaining);
          placedIds.add(remaining.id);
        } else {
          break;
        }
      }
    }

    return ordered;
  }

  /**
   * Stage 2: Positions tables inside a group deterministically in a grid.
   * @param {Array} tables 
   * @param {Array} relationships 
   * @param {Object} options { cols, rows }
   * @returns {Object} { tables: [{id, x, y, width, height}], groupWidth, groupHeight }
   */
  static layoutGroupGrid(tables, relationships, options = {}) {
    if (tables.length === 0) {
      return { tables: [], groupWidth: 300, groupHeight: 200 };
    }

    const orderedTables = this.sortTablesByConnections(tables, relationships);

    let colCount;
    if (options && options.cols) {
      colCount = parseInt(options.cols, 10);
    } else if (options && options.rows) {
      const rowCount = parseInt(options.rows, 10);
      colCount = Math.ceil(tables.length / rowCount);
    } else {
      colCount = Math.ceil(Math.sqrt(tables.length));
    }
    if (isNaN(colCount) || colCount < 1) colCount = 1;

    const placed = [];
    const rowHeights = {};

    orderedTables.forEach((table) => {
      let gridIndex = placed.length;
      let placedOk = false;
      let finalX = 0;
      let finalY = 0;
      const tHeight = this.estimateTableHeight(table);

      while (!placedOk) {
        const col = gridIndex % colCount;
        const row = Math.floor(gridIndex / colCount);

        const candidateX = this.PADDING_LEFT + col * (this.TABLE_WIDTH + this.GAP_X);

        let candidateY = this.PADDING_TOP;
        for (let r = 0; r < row; r++) {
          const rHeight = rowHeights[r] || 0;
          candidateY += rHeight + this.GAP_Y;
        }

        // Validate collision/overlap
        let hasOverlap = false;
        for (const p of placed) {
          const isOverlap = (
            candidateX < p.x + p.width &&
            candidateX + this.TABLE_WIDTH > p.x &&
            candidateY < p.y + p.height &&
            candidateY + tHeight > p.y
          );
          if (isOverlap) {
            hasOverlap = true;
            break;
          }
        }

        if (!hasOverlap) {
          finalX = candidateX;
          finalY = candidateY;
          placedOk = true;

          placed.push({
            id: table.id,
            name: table.name,
            x: finalX,
            y: finalY,
            width: this.TABLE_WIDTH,
            height: tHeight,
            row: row,
            col: col
          });

          rowHeights[row] = Math.max(rowHeights[row] || 0, tHeight);
        } else {
          gridIndex++;
        }
      }
    });

    const maxX = Math.max(...placed.map(t => t.x + t.width));
    const maxY = Math.max(...placed.map(t => t.y + t.height));

    const groupWidth = maxX + this.PADDING_RIGHT;
    const groupHeight = maxY + this.PADDING_BOTTOM;

    // Return the tables relative positioning
    let relativeTables = placed.map(t => ({
      id: t.id,
      name: t.name,
      x: t.x,
      y: t.y,
      width: t.width,
      height: t.height
    }));

    relativeTables = this.minimizeCrossings(relativeTables, relationships);

    const optimizedMaxX = relativeTables.length > 0
      ? Math.max(...relativeTables.map(t => t.x + t.width))
      : maxX;
    const optimizedMaxY = relativeTables.length > 0
      ? Math.max(...relativeTables.map(t => t.y + t.height))
      : maxY;

    return {
      tables: relativeTables,
      groupWidth: optimizedMaxX + this.PADDING_RIGHT,
      groupHeight: optimizedMaxY + this.PADDING_BOTTOM
    };
  }

  /**
    * Counts edge crossings for a set of positioned tables.
    * Uses the orthogonal channel model: two edges cross if their
    * horizontal exit/entry ordering is inverted relative to each other.
    * @param {Array} tables Array of {id, x, y}
    * @param {Array} relationships Array of {fromTable, fromField, toTable, toField}
    * @returns {number} Number of crossings
    */
  static countCrossings(tables, relationships) {
    const posMap = new Map();
    tables.forEach(t => posMap.set(t.id, { x: t.x, y: t.y }));

    let crossings = 0;
    for (let i = 0; i < relationships.length; i++) {
      for (let j = i + 1; j < relationships.length; j++) {
        const a = relationships[i];
        const b = relationships[j];

        const aFrom = posMap.get(a.fromTable);
        const aTo = posMap.get(a.toTable);
        const bFrom = posMap.get(b.fromTable);
        const bTo = posMap.get(b.toTable);

        if (!aFrom || !aTo || !bFrom || !bTo) continue;

        const aMidX = (aFrom.x + aTo.x) / 2;
        const bMidX = (bFrom.x + bTo.x) / 2;

        const aFromSide = aFrom.x < aTo.x ? 'right' : 'left';
        const aToSide = aTo.x < aFrom.x ? 'right' : 'left';
        const bFromSide = bFrom.x < bTo.x ? 'right' : 'left';
        const bToSide = bTo.x < bFrom.x ? 'right' : 'left';

        if (a.fromTable === b.fromTable || a.toTable === b.toTable ||
            a.fromTable === b.toTable || a.toTable === b.fromTable) continue;

        const aDx = aTo.x - aFrom.x;
        const bDx = bTo.x - bFrom.x;
        const aDy = aTo.y - aFrom.y;
        const bDy = bTo.y - bFrom.y;

        const aSlope = aDx !== 0 ? aDy / aDx : Infinity;
        const bSlope = bDx !== 0 ? bDy / bDx : Infinity;

        const aMinX = Math.min(aFrom.x, aTo.x);
        const aMaxX = Math.max(aFrom.x, aTo.x);
        const bMinX = Math.min(bFrom.x, bTo.x);
        const bMaxX = Math.max(bFrom.x, bTo.x);

        const aMinY = Math.min(aFrom.y, aTo.y);
        const aMaxY = Math.max(aFrom.y, aTo.y);
        const bMinY = Math.min(bFrom.y, bTo.y);
        const bMaxY = Math.max(bFrom.y, bTo.y);

        const overlapX = aMinX < bMaxX && aMaxX > bMinX;
        const overlapY = aMinY < bMaxY && aMaxY > bMinY;

        if (overlapX && overlapY && aSlope !== bSlope) {
          crossings++;
        }
      }
    }
    return crossings;
  }

  /**
    * Optimizes table positions within a group to minimize edge crossings.
    * Uses iterative pairwise swapping within grid rows.
    * @param {Array} tables Array of {id, x, y, width, height} from layoutGroupGrid
    * @param {Array} relationships Array of relationships
    * @returns {Array} Optimized tables with updated x,y positions
    */
  static minimizeCrossings(tables, relationships) {
    if (tables.length <= 2) return tables;

    const TABLE_WIDTH = this.TABLE_WIDTH;
    const GAP_X = this.GAP_X;
    const PADDING_LEFT = this.PADDING_LEFT;

    let best = tables.map(t => ({ ...t }));
    let bestCrossings = this.countCrossings(best, relationships);

    const MAX_ITERATIONS = 10;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      let improved = false;

      const rows = new Map();
      best.forEach(t => {
        const rowKey = Math.round(t.y);
        if (!rows.has(rowKey)) rows.set(rowKey, []);
        rows.get(rowKey).push(t);
      });

      for (const [rowKey, rowTables] of rows) {
        rowTables.sort((a, b) => a.x - b.x);

        for (let i = 0; i < rowTables.length - 1; i++) {
          const a = rowTables[i];
          const b = rowTables[i + 1];

          const oldAx = a.x;
          const oldBx = b.x;

          a.x = oldBx;
          b.x = oldAx;

          const newCrossings = this.countCrossings(best, relationships);

          if (newCrossings < bestCrossings) {
            bestCrossings = newCrossings;
            improved = true;
          } else {
            a.x = oldAx;
            b.x = oldBx;
          }
        }
      }

      if (!improved) break;
    }

    return best;
  }

  /**
    * Stage 3: Shelf-packs groups on the canvas deterministically and places ungrouped tables.
   * @param {Array} groups Array of group objects (must have id, name, color, width, height)
   * @param {Array} ungroupedTables Array of table objects not in any group
   * @param {Array} relationships Array of relationships in the canvas
   * @param {Object} relativeTablesMap Map of groupId -> array of relative positioned tables from Stage 2
   * @returns {Object} { tables: [{id, x, y}], groups: [{id, x, y, width, height}] }
   */
  static shelfPackGroups(groups, ungroupedTables, relationships, relativeTablesMap) {
    const finalTables = [];
    const finalGroups = [];

    const spacingGroupsX = 100;
    const spacingGroupsY = 100;

    // 1. Position grouped tables & groups
    if (groups.length > 0) {
      // Sort groups by height descending (standard shelf packing)
      const sortedGroups = [...groups].sort((a, b) => b.height - a.height);

      // Calculate target columns for a balanced grid layout
      const numGroups = sortedGroups.length;
      const targetCols = Math.max(2, Math.ceil(Math.sqrt(numGroups)));
      
      // Calculate max row width based on target columns and average group width
      const avgGroupWidth = sortedGroups.reduce((sum, g) => sum + g.width, 0) / numGroups;
      const maxRowWidth = (avgGroupWidth * targetCols) + (spacingGroupsX * (targetCols - 1)) + 200;

      const shelves = [];

      sortedGroups.forEach(group => {
        let placed = false;
        
        // Try to fit in existing shelves
        for (const shelf of shelves) {
          const currentCols = shelf.groups.length;
          if (currentCols < targetCols && shelf.width + spacingGroupsX + group.width <= maxRowWidth) {
            group.x = 100 + shelf.width + spacingGroupsX;
            group.y = shelf.y;
            shelf.width += spacingGroupsX + group.width;
            shelf.height = Math.max(shelf.height, group.height);
            shelf.groups.push(group);
            placed = true;
            break;
          }
        }

        if (!placed) {
          // Create a new shelf
          let newShelfY = 100;
          if (shelves.length > 0) {
            const prevShelf = shelves[shelves.length - 1];
            newShelfY = prevShelf.y + prevShelf.height + spacingGroupsY;
          }
          group.x = 100;
          group.y = newShelfY;

          shelves.push({
            y: newShelfY,
            height: group.height,
            width: group.width,
            groups: [group]
          });
        }

        finalGroups.push({
          id: group.id,
          name: group.name,
          color: group.color,
          x: group.x,
          y: group.y,
          width: group.width,
          height: group.height
        });

        // Shift relative table positions of this group to absolute coordinates
        const relTables = relativeTablesMap[group.id] || [];
        relTables.forEach(t => {
          finalTables.push({
            id: t.id,
            name: t.name,
            x: group.x + t.x,
            y: group.y + t.y,
            groupId: group.id
          });
        });
      });
    }

    // 2. Position ungrouped tables as a virtual group shelf at the end
    if (ungroupedTables.length > 0) {
      let virtualGroupY = 100;
      
      // Calculate where the last shelf ended
      if (groups.length > 0) {
        // Find maximum y + height among all positioned groups
        const maxGroupY = Math.max(...finalGroups.map(g => g.y + g.height));
        virtualGroupY = maxGroupY + spacingGroupsY;
      }

      // Lay out ungrouped tables relative to (0, 0)
      const { tables: relUngrouped } = this.layoutGroupGrid(ungroupedTables, relationships);

      // Translate to absolute coordinates
      const virtualGroupX = 100;
      relUngrouped.forEach(t => {
        finalTables.push({
          id: t.id,
          name: t.name,
          x: virtualGroupX + t.x,
          y: virtualGroupY + t.y,
          groupId: null
        });
      });
    }

    return {
      tables: finalTables,
      groups: finalGroups
    };
  }
}
