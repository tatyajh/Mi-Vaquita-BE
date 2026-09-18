import pool from "../lib/connection.js";

const GroupsModel = () => {

  const getAllGroupsModel = async () => {
    const client = await pool.connect();
    const result = await client.query("SELECT * FROM Groups");
    client.release();
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
    const client = await pool.connect();
    const result = await client.query("SELECT * FROM Groups WHERE ID = $1", [id]);
    client.release();
    return result.rows[0];
  };

  const createGroupsModel = async (data) => {
    const client = await pool.connect();
    try {
      const result = await client.query(
        "INSERT INTO Groups (owneruserid, name, color, trip_type, CREATEDAT) VALUES ($1, $2, $3, $4, NOW()) RETURNING *",
        [data.ownerUserId, data.name, data.color, data.tripType || null]
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
    const client = await pool.connect();
    const result = await client.query(
      "UPDATE Groups set name = $1, color = $2, trip_type = $3 WHERE id = $4 RETURNING *",
      [data.name, data.color, data.tripType || null, id]
    );
    client.release();
    return result.rows[0];
  };

  const deleteGroupsModel = async (id) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Borrar primero lo que depende del grupo por foreign key
      // (Expenses, GroupParticipants) — si no, el DELETE de Groups
      // viola la constraint apenas el grupo tiene un gasto o un
      // participante (que ahora siempre incluye al menos al dueño).
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

  const addParticipants = async (groupId, participantIds) => {
    const client = await pool.connect();
    try {
      const existingParticipantsQuery = `SELECT user_id FROM GroupParticipants WHERE group_id = $1 AND user_id = ANY($2::int[])`;
      const existingParticipantsResult = await client.query(existingParticipantsQuery, [groupId, participantIds]);
  
      const existingParticipantIds = existingParticipantsResult.rows.map(row => row.user_id);
      const newParticipantIds = participantIds.filter(id => !existingParticipantIds.includes(id));
  
      if (newParticipantIds.length > 0) {
        const insertValues = newParticipantIds.map(userId => `(${groupId}, ${userId})`).join(',');
        const query = `INSERT INTO GroupParticipants (group_id, user_id) VALUES ${insertValues}`;
        await client.query(query);
      }
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
    createGroupsModel,
    updateGroupsModel,
    deleteGroupsModel,
    addParticipants,
    getParticipants,
  };
};

export default GroupsModel;
