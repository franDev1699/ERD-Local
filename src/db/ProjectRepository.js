// src/db/ProjectRepository.js
const db = require('./connection');

class ProjectRepository {
  static createProject({ id, display_name, owner_id }) {
    try {
      const stmt = db.prepare(`
        INSERT INTO projects (id, display_name, owner_id)
        VALUES (?, ?, ?)
      `);
      stmt.run(id, display_name, owner_id);

      // Automatically register the owner as owner in members
      const memberStmt = db.prepare(`
        INSERT INTO project_members (project_id, user_id, role)
        VALUES (?, ?, 'owner')
      `);
      memberStmt.run(id, owner_id);

      return this.getProject(id);
    } catch (err) {
      console.error('[ProjectRepository] Error en createProject:', err.message);
      throw err;
    }
  }

  static getProject(id) {
    try {
      const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
      return stmt.get(id);
    } catch (err) {
      console.error('[ProjectRepository] Error en getProject:', err.message);
      return null;
    }
  }

  static deleteProject(id) {
    try {
      // Members will be deleted via ON DELETE CASCADE in Foreign Key, 
      // but let's run them explicitly just in case cascades aren't fully triggered.
      const deleteMembers = db.prepare('DELETE FROM project_members WHERE project_id = ?');
      deleteMembers.run(id);

      const deleteProj = db.prepare('DELETE FROM projects WHERE id = ?');
      deleteProj.run(id);
      return true;
    } catch (err) {
      console.error('[ProjectRepository] Error en deleteProject:', err.message);
      throw err;
    }
  }

  static getProjectRole(projectId, userId) {
    try {
      const stmt = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?');
      const row = stmt.get(projectId, userId);
      return row ? row.role : null;
    } catch (err) {
      console.error('[ProjectRepository] Error en getProjectRole:', err.message);
      return null;
    }
  }

  static addProjectMember({ projectId, userId, role }) {
    try {
      const stmt = db.prepare(`
        INSERT INTO project_members (project_id, user_id, role)
        VALUES (?, ?, ?)
        ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role
      `);
      stmt.run(projectId, userId, role);
      return true;
    } catch (err) {
      console.error('[ProjectRepository] Error en addProjectMember:', err.message);
      throw err;
    }
  }

  static removeProjectMember({ projectId, userId }) {
    try {
      const stmt = db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?');
      stmt.run(projectId, userId);
      return true;
    } catch (err) {
      console.error('[ProjectRepository] Error en removeProjectMember:', err.message);
      throw err;
    }
  }

  static getProjectMembers(projectId) {
    try {
      const stmt = db.prepare(`
        SELECT pm.project_id, pm.user_id, pm.role, u.username, u.display_name, u.color
        FROM project_members pm
        JOIN users u ON pm.user_id = u.id
        WHERE pm.project_id = ?
        ORDER BY u.display_name ASC
      `);
      return stmt.all(projectId);
    } catch (err) {
      console.error('[ProjectRepository] Error en getProjectMembers:', err.message);
      return [];
    }
  }

  /**
   * Lists projects a user has access to.
   * If is_admin is true, lists all projects in database.
   * If not, lists projects owned by the user or where they are a member.
   */
  static listProjectsForUser(userId, is_admin) {
    try {
      if (is_admin) {
        const stmt = db.prepare(`
          SELECT p.id, p.display_name as name, p.owner_id, p.created_at,
                 'owner' as role, u.display_name as owner_name
          FROM projects p
          JOIN users u ON p.owner_id = u.id
          ORDER BY p.created_at DESC
        `);
        return stmt.all();
      } else {
        const stmt = db.prepare(`
          SELECT p.id, p.display_name as name, p.owner_id, p.created_at,
                 pm.role, u.display_name as owner_name
          FROM projects p
          JOIN users u ON p.owner_id = u.id
          JOIN project_members pm ON p.id = pm.project_id
          WHERE pm.user_id = ?
          ORDER BY p.created_at DESC
        `);
        return stmt.all(userId);
      }
    } catch (err) {
      console.error('[ProjectRepository] Error en listProjectsForUser:', err.message);
      return [];
    }
  }

  static isProjectRegistered(id) {
    try {
      const stmt = db.prepare('SELECT 1 FROM projects WHERE id = ?');
      return !!stmt.get(id);
    } catch (err) {
      return false;
    }
  }

  static updateProjectName(id, name) {
    try {
      const stmt = db.prepare('UPDATE projects SET display_name = ? WHERE id = ?');
      stmt.run(name, id);
      return true;
    } catch (err) {
      console.error('[ProjectRepository] Error en updateProjectName:', err.message);
      return false;
    }
  }
}

module.exports = ProjectRepository;
