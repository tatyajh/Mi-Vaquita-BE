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
  // Friends nunca tuvo columnas para relacionar dos usuarios entre sí
  // (solo guardaba name/email sueltos), pero friends.model.js sí
  // asume una relación user_id/friend_user_id (de ahí el error
  // "column userid does not exist" en producción). Se agregan acá de
  // forma idempotente, siguiendo la convención snake_case ya usada
  // por GroupParticipants/Expenses, para que también se apliquen en
  // bases de datos donde Friends ya existía con el esquema viejo.
  `ALTER TABLE Friends ADD COLUMN IF NOT EXISTS user_id INTEGER;`,
  `ALTER TABLE Friends ADD COLUMN IF NOT EXISTS friend_user_id INTEGER;`,
  // name/email eran NOT NULL del diseño original (guardar el contacto
  // suelto), pero createFriendsModel solo llena user_id/friend_user_id
  // y getAllFriendsModel ya trae name/email vía JOIN a users — por eso
  // el insert violaba NOT NULL y tiraba 500. Se quita la restricción
  // porque esas columnas ya no se usan para la relación.
  `ALTER TABLE Friends ALTER COLUMN name DROP NOT NULL;`,
  `ALTER TABLE Friends ALTER COLUMN email DROP NOT NULL;`,
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
  // Foto/recibo opcional adjunto a un gasto. Guardamos solo la URL
  // pública (subida a un storage externo); si no hay integración de
  // storage configurada, el gasto se guarda igual con receipt_url NULL.
  `ALTER TABLE Expenses ADD COLUMN IF NOT EXISTS receipt_url VARCHAR(500);`,
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

  // Los datos de ejemplo (usuarios y grupos demo) son SOLO para
  // desarrollo local. Nunca deben insertarse automáticamente en
  // producción ni en ningún ambiente por defecto: hay que pedirlo
  // explícitamente con SEED_DEMO_DATA=true. Esto es lo que evita que
  // vuelvan a aparecer usuarios/grupos hardcodeados (p.ej. "miguel",
  // "Los 4 babies", "Paseo san andrés", etc.) después de borrarlos.
  const shouldSeed = process.env.SEED_DEMO_DATA === 'true' && process.env.NODE_ENV !== 'production';
  if (shouldSeed) {
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
  } else {
    console.log('Seeding de datos demo omitido (SEED_DEMO_DATA no está en "true", o NODE_ENV es production).');
  }

  console.log("Migrations ran successfully");
  client.release();
  // No cerrar el pool acá: este archivo ahora se importa desde
  // app.js al arrancar el servidor (antes era un script standalone,
  // por eso cerraba el pool al final). Si se cierra, cualquier
  // request que use el pool compartido de connection.js después de
  // este boot falla con "Cannot use a pool after calling end on the
  // pool" — el pool debe vivir mientras viva el servidor.
}

runMigrations().catch(console.error);
