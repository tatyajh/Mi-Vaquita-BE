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

  const deleteGroupsModel = async (id) => {
    const client = await pool.connect();
    try {
      // Borrar primero lo que depende del grupo por foreign key
      // (Expenses, GroupParticipants) — si no, el DELETE de Groups
      // viola la constraint apenas el grupo tiene un gasto o un
      // participante (que ahora siempre incluye al menos al dueño).
      // Deletes secuenciales sin BEGIN/COMMIT explícito a propósito:
      // envolverlos en una transacción manual con este pool compartido
      // (serverless) dejó una conexión "colgada" a medio-transacción si
      // el ROLLBACK fallaba al liberar el client, tumbando CUALQUIER
      // query posterior que reusara esa misma conexión del pool con un
      // 500 genérico — bug real que se vio en vivo. Cada DELETE por su
      // cuenta ya es atómico por sí mismo en Postgres (autocommit).
      await client.query('DELETE FROM ActivityExclusions WHERE activity_id IN (SELECT id FROM Activities WHERE group_id=$1)', [id]);
      await client.query('DELETE FROM ActivityWinners WHERE activity_id IN (SELECT id FROM Activities WHERE group_id=$1)', [id]);
      await client.query('DELETE FROM ActivityMembers WHERE activity_id IN (SELECT id FROM Activities WHERE group_id=$1)', [id]);
      await client.query('DELETE FROM Activities WHERE group_id=$1', [id]);
      await client.query('DELETE FROM Expenses WHERE group_id = $1', [id]);
      await client.query('DELETE FROM GroupParticipants WHERE group_id = $1', [id]);
      const result = await client.query('DELETE FROM Groups WHERE id = $1', [id]);
      return result.rowCount >= 1;
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
        await client.query(
          `INSERT INTO GroupParticipants (group_id, user_id)
           SELECT $1, user_id FROM unnest($2::int[]) AS user_id
           ON CONFLICT DO NOTHING`,
          [groupId, newParticipantIds]
        );
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
