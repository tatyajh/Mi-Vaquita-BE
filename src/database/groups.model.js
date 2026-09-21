import pool from "../lib/connection.js";

const GroupsModel = () => {

  const getAllGroupsModel = async () => {
    const result = await pool.query("SELECT * FROM Groups");
    return result.rows;
  };

  // Solo los grupos que el usuario posee o de los que es participante.
  const getGroupsForUserModel = async (userId) => {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT DISTINCT g.* FROM Groups g
         LEFT JOIN GroupParticipants gp ON gp.group_id = g.id
         WHERE g.owneruserid = $1 OR gp.user_id = $1
         ORDER BY g.createdat DESC`,
        [userId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  };

  const getByIdGroupsModel = async (id) => {
    const result = await pool.query("SELECT * FROM Groups WHERE ID = $1", [id]);
    return result.rows[0];
  };

  // Base de todos los chequeos de autorización de este archivo: antes
  // de esto, cualquier usuario logueado podía leer/editar/borrar el
  // grupo o los gastos de CUALQUIER otro (bastaba con adivinar el id).
  const getMembershipModel = async (groupId, userId) => {
    const result = await pool.query(
      `SELECT (g.owneruserid = $2) AS is_owner
       FROM Groups g
       WHERE g.id = $1 AND (g.owneruserid = $2 OR EXISTS (
         SELECT 1 FROM GroupParticipants gp WHERE gp.group_id = g.id AND gp.user_id = $2
       ))`,
      [groupId, userId]
    );
    if (!result.rows[0]) return { isMember: false, isOwner: false };
    return { isMember: true, isOwner: result.rows[0].is_owner };
  };

  const createGroupsModel = async (data) => {
    const client = await pool.connect();
    try {
      const result = await client.query(
        "INSERT INTO Groups (owneruserid, name, color, trip_type, photo_data, CREATEDAT) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *",
        [data.ownerUserId, data.name, data.color, data.tripType || null, data.photoData || null]
      );
      const group = result.rows[0];
      // El dueño también es un participante del grupo desde el
      // arranque (así aparece consistentemente en GroupParticipants,
      // no solo por caso especial en las queries que lo necesitan).
      await client.query(
        "INSERT INTO GroupParticipants (group_id, user_id) VALUES ($1, $2)",
        [group.id, data.ownerUserId]
      );
      return group;
    } finally {
      client.release();
    }
  };

  const updateGroupsModel = async (id, data) => {
    const result = await pool.query(
      "UPDATE Groups set name = $1, color = $2, trip_type = $3, photo_data = $4 WHERE id = $5 RETURNING *",
      [data.name, data.color, data.tripType || null, data.photoData || null, id]
    );
    return result.rows[0];
  };

  // Antes eran 7 DELETE secuenciales SIN transacción (autocommit cada
  // uno por separado): si alguno fallaba a mitad de camino (ej. se cae
  // la conexión), quedaban hijos ya borrados con el grupo todavía en
  // pie, o viceversa — un borrado parcial real (lo confirmó una
  // auditoría externa). El comentario original decía que envolver esto
  // en una transacción había colgado una conexión antes, pero eso
  // pasaba por no liberar el client en el `catch` del ROLLBACK — el
  // patrón de abajo (BEGIN/COMMIT/ROLLBACK con `finally` para el
  // release) es el mismo que ya usan natilleras/activities/community
  // sin ese problema.
  const deleteGroupsModel = async (id) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM ActivityExclusions WHERE activity_id IN (SELECT id FROM Activities WHERE group_id=$1)', [id]);
      await client.query('DELETE FROM ActivityWinners WHERE activity_id IN (SELECT id FROM Activities WHERE group_id=$1)', [id]);
      await client.query('DELETE FROM ActivityMembers WHERE activity_id IN (SELECT id FROM Activities WHERE group_id=$1)', [id]);
      await client.query('DELETE FROM Activities WHERE group_id=$1', [id]);
      await client.query('DELETE FROM Expenses WHERE group_id = $1', [id]);
      await client.query('DELETE FROM GroupParticipants WHERE group_id = $1', [id]);
      const result = await client.query('DELETE FROM Groups WHERE id = $1', [id]);
      await client.query('COMMIT');
      return result.rowCount >= 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };

  // El cupo máximo se valida ACÁ, con la fila del grupo bloqueada
  // (FOR UPDATE) dentro de una transacción — antes se contaba a los
  // integrantes existentes en una consulta y se insertaba en otra por
  // separado, sin nada que impidiera que dos solicitudes para agregar
  // gente al mismo grupo casi al mismo tiempo pasaran el chequeo cada
  // una por su lado y sumaran más del máximo entre las dos (condición
  // de carrera real, reportada por una auditoría externa).
  const addParticipants = async (groupId, participantIds, maxMembers) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: groupRows } = await client.query('SELECT owneruserid FROM Groups WHERE id = $1 FOR UPDATE', [groupId]);
      const group = groupRows[0];
      const { rows: existingRows } = await client.query('SELECT user_id FROM GroupParticipants WHERE group_id = $1', [groupId]);
      const existingIds = new Set(existingRows.map(r => r.user_id));
      if (group) existingIds.add(group.owneruserid);

      const newParticipantIds = participantIds.filter(id => !existingIds.has(id));
      const totalMembers = existingIds.size + newParticipantIds.length;
      if (totalMembers > maxMembers) {
        const error = new Error(`Un grupo puede tener como máximo ${maxMembers} integrantes (actualmente tendría ${totalMembers})`);
        error.statusCode = 409;
        throw error;
      }

      if (newParticipantIds.length > 0) {
        await client.query(
          `INSERT INTO GroupParticipants (group_id, user_id)
           SELECT $1, user_id FROM unnest($2::int[]) AS user_id
           ON CONFLICT DO NOTHING`,
          [groupId, newParticipantIds]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  
  const getParticipants = async (groupId) => {
    const client = await pool.connect();
    try {
      const query = `SELECT u.id, u.email FROM GroupParticipants gp JOIN Users u ON gp.user_id = u.id WHERE gp.group_id = $1`;
      const result = await client.query(query, [groupId]);
      return result.rows;
    } finally {
      client.release();
    }
  };

  return {
    getAllGroupsModel,
    getGroupsForUserModel,
    getByIdGroupsModel,
    getMembershipModel,
    createGroupsModel,
    updateGroupsModel,
    deleteGroupsModel,
    addParticipants,
    getParticipants,
  };
};

export default GroupsModel;
