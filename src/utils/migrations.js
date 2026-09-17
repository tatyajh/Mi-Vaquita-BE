import bcrypt from "bcrypt";
import pool from "../lib/connection.js";

const SEED_USERS = [
  { name: 'miguel', email: 'miguel@gmail.com', createdAt: '2023-01-02' },
  { name: 'juan camilo', email: 'juancamilo@gmail.com', createdAt: '2024-03-14' },
  { name: 'mateo', email: 'mateo@gmail.com', createdAt: '2024-04-18' },
  { name: 'carolina', email: 'carolina@gmail.com', createdAt: '2024-08-22' },
  { name: 'liliana', email: 'liliana@gmail.com', createdAt: '2024-08-22' },
  { name: 'césar', email: 'cesar@gmail.com', createdAt: '2024-09-22' },
  { name: 'hernán', email: 'hernan@gmail.com', createdAt: '2024-12-01' },
];

const queries = [
  `CREATE TABLE IF NOT EXISTS Users (
    id SERIAL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(50) NOT NULL,
    password VARCHAR(100) NOT NULL,
    createdAt DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(id)
  );`,
  `CREATE TABLE IF NOT EXISTS Groups (
    id SERIAL,
    ownerUserId INTEGER NOT NULL,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(50) NOT NULL,
    createdAt DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(id),
    CONSTRAINT fk_groups_users_id FOREIGN KEY(ownerUserId) REFERENCES Users(id)
  );`,
  `CREATE TABLE IF NOT EXISTS Friends (
    id SERIAL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(50) NOT NULL,
    createdAt DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(id)
  );`,
  `CREATE TABLE IF NOT EXISTS GroupParticipants (
    id SERIAL,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY(id),
    CONSTRAINT fk_group_participants_groups_id FOREIGN KEY(group_id) REFERENCES Groups(id),
    CONSTRAINT fk_group_participants_users_id FOREIGN KEY(user_id) REFERENCES Users(id)
  );`,
  `CREATE TABLE IF NOT EXISTS Expenses (
    id SERIAL,
    group_id INTEGER NOT NULL,
    paid_by_user_id INTEGER NOT NULL,
    description VARCHAR(200) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY(id),
    CONSTRAINT fk_expenses_group_id FOREIGN KEY(group_id) REFERENCES Groups(id),
    CONSTRAINT fk_expenses_paid_by_user_id FOREIGN KEY(paid_by_user_id) REFERENCES Users(id)
  );`,
];

// Los grupos referencian usuarios por posición (1 = miguel, 2 = juan
// camilo, ...), así que los usuarios se insertan antes y en este
// mismo orden.
const GROUP_SEED_QUERY = `INSERT INTO Groups (name, color, ownerUserId, createdAt) VALUES
  ('Los 4 babies', '#FF5733', 2, '2023-03-14'),
  ('Paseo san andrés', '#FCFF33', 1, '2023-04-14'),
  ('Salida provenza jueves', '#77FF33', 5, '2023-05-14'),
  ('Grupo # 4', '#33FFCE', 3, '2023-06-22'),
  ('Los gatos', '#33C4FF', 7, '2023-07-14'),
  ('Los del sur', '#335EFF', 6, '2023-07-14'),
  ('Grupo # 3', '#7133FF', 1, '2023-01-02'),
  ('Los chompos', '#BE33FF', 2, '2024-03-14'),
  ('Grupo # 1', '#FF33FF', 3, '2024-04-18'),
  ('Grupo # 2', '#FF338D', 4, '2024-08-22');`;

async function runMigrations() {
  const client = await pool.connect();
  for (let query of queries) {
    await client.query(query);
  }

  // Datos de ejemplo solo la primera vez — repetir la migración no
  // debe duplicar usuarios ni grupos.
  const { rows } = await client.query('SELECT COUNT(*)::int AS count FROM Users');
  if (rows[0].count === 0) {
    for (const user of SEED_USERS) {
      const password = await bcrypt.hash('password', 10);
      await client.query(
        'INSERT INTO Users (name, email, password, createdAt) VALUES ($1, $2, $3, $4)',
        [user.name, user.email, password, user.createdAt]
      );
    }
    await client.query(GROUP_SEED_QUERY);
  }

  console.log("Migrations ran successfully");
  client.release();
  await pool.end();
}

runMigrations().catch(console.error);
