import bcrypt from "bcrypt";
import pool from "../lib/connection.js";
import { encryptDeliveryUrl } from './private-url.crypto.js';

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
  // Limpia relaciones duplicadas creadas por versiones anteriores y
  // hace que Postgres, no solo la aplicación, impida repetirlas.
  `DELETE FROM Friends a USING Friends b WHERE a.id > b.id AND a.user_id = b.user_id AND a.friend_user_id = b.friend_user_id;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS friends_user_friend_unique ON Friends(user_id, friend_user_id) WHERE user_id IS NOT NULL AND friend_user_id IS NOT NULL;`,
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
  // Medio de pago: solo informativo (efectivo/transferencia/tarjeta),
  // no procesa pagos reales.
  `ALTER TABLE Expenses ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20);`,
  // Categoría manual del gasto (comida, transporte, hospedaje, etc.).
  `ALTER TABLE Expenses ADD COLUMN IF NOT EXISTS category VARCHAR(30);`,
  // Tipo de paseo del grupo (playa, montaña, ciudad...), usado para
  // filtrar los consejos de ahorro contextuales.
  `ALTER TABLE Groups ADD COLUMN IF NOT EXISTS trip_type VARCHAR(30);`,
  `ALTER TABLE Groups ADD COLUMN IF NOT EXISTS photo_data TEXT;`,
  // Recuperar contraseña por correo: token de un solo uso + su
  // expiración. Se guarda hasheado (igual que la contraseña) para que
  // una fuga de la base de datos no permita resetear cuentas ajenas.
  `ALTER TABLE Users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(128);`,
  `ALTER TABLE Users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP;`,
  // Baja de cuenta: borrado lógico. No se borra la fila para no
  // romper el historial de gastos/saldos de otros usuarios que
  // compartieron un grupo con esta cuenta.
  `ALTER TABLE Users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;`,
  `ALTER TABLE Users ALTER COLUMN email TYPE VARCHAR(254);`,
  `ALTER TABLE Users ADD COLUMN IF NOT EXISTS phone VARCHAR(30);`,
  `CREATE TABLE IF NOT EXISTS Natilleras (id SERIAL PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES Users(id), name VARCHAR(100) NOT NULL, starts_on DATE NOT NULL, ends_on DATE NOT NULL, frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly')), contribution NUMERIC(12,2) NOT NULL CHECK (contribution > 0), status VARCHAR(20) NOT NULL DEFAULT 'active', closed_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT NOW(), CHECK (ends_on >= starts_on));`,
  `CREATE TABLE IF NOT EXISTS NatilleraMembers (natillera_id INTEGER NOT NULL REFERENCES Natilleras(id), user_id INTEGER NOT NULL REFERENCES Users(id), joined_at TIMESTAMP NOT NULL DEFAULT NOW(), PRIMARY KEY (natillera_id,user_id));`,
  `CREATE TABLE IF NOT EXISTS NatilleraContributions (id SERIAL PRIMARY KEY, natillera_id INTEGER NOT NULL REFERENCES Natilleras(id), user_id INTEGER NOT NULL REFERENCES Users(id), due_on DATE NOT NULL, amount NUMERIC(12,2) NOT NULL CHECK (amount > 0), recorded_by INTEGER NOT NULL REFERENCES Users(id), created_at TIMESTAMP NOT NULL DEFAULT NOW(), corrected_at TIMESTAMP);`,
  `CREATE TABLE IF NOT EXISTS NatilleraContributionAudit (id SERIAL PRIMARY KEY, contribution_id INTEGER NOT NULL REFERENCES NatilleraContributions(id), old_amount NUMERIC(12,2), new_amount NUMERIC(12,2) NOT NULL, changed_by INTEGER NOT NULL REFERENCES Users(id), changed_at TIMESTAMP NOT NULL DEFAULT NOW());`,
  `CREATE TABLE IF NOT EXISTS NatilleraLoans (id SERIAL PRIMARY KEY, natillera_id INTEGER NOT NULL REFERENCES Natilleras(id), user_id INTEGER NOT NULL REFERENCES Users(id), principal NUMERIC(12,2) NOT NULL CHECK (principal > 0), annual_rate NUMERIC(7,4) NOT NULL CHECK (annual_rate >= 0), term_months INTEGER NOT NULL CHECK (term_months > 0), interest NUMERIC(12,2) NOT NULL CHECK (interest >= 0), issued_on DATE NOT NULL DEFAULT CURRENT_DATE, created_by INTEGER NOT NULL REFERENCES Users(id));`,
  `CREATE TABLE IF NOT EXISTS NatilleraLoanPayments (id SERIAL PRIMARY KEY, loan_id INTEGER NOT NULL REFERENCES NatilleraLoans(id), amount NUMERIC(12,2) NOT NULL CHECK (amount > 0), recorded_by INTEGER NOT NULL REFERENCES Users(id), created_at TIMESTAMP NOT NULL DEFAULT NOW());`,
  `CREATE TABLE IF NOT EXISTS NatilleraClosures (natillera_id INTEGER PRIMARY KEY REFERENCES Natilleras(id), summary JSONB NOT NULL, confirmed_by INTEGER NOT NULL REFERENCES Users(id), confirmed_at TIMESTAMP NOT NULL DEFAULT NOW());`,
  `CREATE TABLE IF NOT EXISTS Activities (id SERIAL PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES Groups(id), type VARCHAR(20) NOT NULL CHECK (type IN ('secret_santa','raffle')), name VARCHAR(100) NOT NULL, event_on DATE NOT NULL, budget NUMERIC(12,2), status VARCHAR(20) NOT NULL DEFAULT 'draft', created_by INTEGER NOT NULL REFERENCES Users(id), created_at TIMESTAMP NOT NULL DEFAULT NOW());`,
  `CREATE TABLE IF NOT EXISTS ActivityMembers (activity_id INTEGER NOT NULL REFERENCES Activities(id), user_id INTEGER NOT NULL REFERENCES Users(id), number INTEGER, recipient_id INTEGER REFERENCES Users(id), PRIMARY KEY (activity_id,user_id), UNIQUE (activity_id,number));`,
  `CREATE TABLE IF NOT EXISTS ActivityExclusions (activity_id INTEGER NOT NULL REFERENCES Activities(id), user_id INTEGER NOT NULL REFERENCES Users(id), excluded_user_id INTEGER NOT NULL REFERENCES Users(id), PRIMARY KEY (activity_id,user_id,excluded_user_id));`,
  `CREATE TABLE IF NOT EXISTS ActivityWinners (activity_id INTEGER PRIMARY KEY REFERENCES Activities(id), user_id INTEGER NOT NULL REFERENCES Users(id), number INTEGER NOT NULL, drawn_at TIMESTAMP NOT NULL DEFAULT NOW());`,
  // Modelo ampliado: participantes independientes (cuenta o invitado),
  // recaudos, inventario y notificaciones. Las tablas anteriores se
  // conservan para que grupos y actividades existentes sigan funcionando.
  `CREATE INDEX IF NOT EXISTS users_email_normalized_idx ON Users (LOWER(TRIM(email))) WHERE deleted_at IS NULL;`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT LOWER(TRIM(email)) FROM Users WHERE deleted_at IS NULL GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1) THEN CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_unique ON Users (LOWER(TRIM(email))) WHERE deleted_at IS NULL; END IF; END $$;`,
  `ALTER TABLE Natilleras ADD COLUMN IF NOT EXISTS purpose VARCHAR(240);`,
  `ALTER TABLE Natilleras ADD COLUMN IF NOT EXISTS profit_distribution VARCHAR(20) NOT NULL DEFAULT 'proportional';`,
  `ALTER TABLE Natilleras ADD COLUMN IF NOT EXISTS late_fee NUMERIC(12,2) NOT NULL DEFAULT 0;`,
  `ALTER TABLE Natilleras ADD COLUMN IF NOT EXISTS rules_locked_at TIMESTAMP;`,
  `ALTER TABLE Natilleras DROP CONSTRAINT IF EXISTS natilleras_profit_distribution_check;`,
  `ALTER TABLE Natilleras ADD CONSTRAINT natilleras_profit_distribution_check CHECK (profit_distribution IN ('proportional','equal'));`,
  `CREATE TABLE IF NOT EXISTS Guests (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(254), phone VARCHAR(30), claimed_user_id INTEGER REFERENCES Users(id), created_by INTEGER NOT NULL REFERENCES Users(id), created_at TIMESTAMP NOT NULL DEFAULT NOW(), CHECK (email IS NOT NULL OR phone IS NOT NULL));`,
  `CREATE UNIQUE INDEX IF NOT EXISTS guests_creator_email_unique ON Guests(created_by, LOWER(TRIM(email))) WHERE email IS NOT NULL AND claimed_user_id IS NULL;`,
  `CREATE TABLE IF NOT EXISTS NatilleraParticipants (id SERIAL PRIMARY KEY, natillera_id INTEGER NOT NULL REFERENCES Natilleras(id) ON DELETE CASCADE, user_id INTEGER REFERENCES Users(id), guest_id INTEGER REFERENCES Guests(id), role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin','treasurer','member','viewer')), joined_at TIMESTAMP NOT NULL DEFAULT NOW(), CHECK ((user_id IS NOT NULL)::int + (guest_id IS NOT NULL)::int = 1));`,
  `CREATE UNIQUE INDEX IF NOT EXISTS natillera_participant_user_unique ON NatilleraParticipants(natillera_id,user_id) WHERE user_id IS NOT NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS natillera_participant_guest_unique ON NatilleraParticipants(natillera_id,guest_id) WHERE guest_id IS NOT NULL;`,
  `CREATE TABLE IF NOT EXISTS NatilleraQuotas (id SERIAL PRIMARY KEY, natillera_id INTEGER NOT NULL REFERENCES Natilleras(id) ON DELETE CASCADE, kind VARCHAR(20) NOT NULL CHECK(kind IN ('ordinary','extraordinary','late_fee')), name VARCHAR(120) NOT NULL, due_on DATE NOT NULL, amount NUMERIC(12,2) NOT NULL CHECK(amount >= 0), created_by INTEGER NOT NULL REFERENCES Users(id), created_at TIMESTAMP NOT NULL DEFAULT NOW());`,
  `ALTER TABLE NatilleraQuotas ADD COLUMN IF NOT EXISTS audience VARCHAR(20) NOT NULL DEFAULT 'all';`,
  `ALTER TABLE NatilleraQuotas DROP CONSTRAINT IF EXISTS natilleraquotas_audience_check;`,
  `ALTER TABLE NatilleraQuotas ADD CONSTRAINT natilleraquotas_audience_check CHECK(audience IN ('all','guests'));`,
  `CREATE TABLE IF NOT EXISTS NatilleraParticipantContributions (id SERIAL PRIMARY KEY, natillera_id INTEGER NOT NULL REFERENCES Natilleras(id) ON DELETE CASCADE, participant_id INTEGER NOT NULL REFERENCES NatilleraParticipants(id), quota_id INTEGER REFERENCES NatilleraQuotas(id), amount NUMERIC(12,2) NOT NULL CHECK(amount <> 0), kind VARCHAR(20) NOT NULL DEFAULT 'payment' CHECK(kind IN ('payment','adjustment','reversal')), note VARCHAR(240), adjustment_of INTEGER REFERENCES NatilleraParticipantContributions(id), recorded_by INTEGER NOT NULL REFERENCES Users(id), created_at TIMESTAMP NOT NULL DEFAULT NOW());`,
  `ALTER TABLE Activities ALTER COLUMN group_id DROP NOT NULL;`,
  `ALTER TABLE Activities ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES Users(id);`,
  `ALTER TABLE Activities ADD COLUMN IF NOT EXISTS natillera_id INTEGER REFERENCES Natilleras(id);`,
  `ALTER TABLE Activities ADD COLUMN IF NOT EXISTS description VARCHAR(500);`,
  `ALTER TABLE Activities ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMP;`,
  `UPDATE Activities a SET owner_id=g.owneruserid FROM Groups g WHERE a.group_id=g.id AND a.owner_id IS NULL;`,
  `ALTER TABLE Activities DROP CONSTRAINT IF EXISTS activities_type_check;`,
  `ALTER TABLE Activities ADD CONSTRAINT activities_type_check CHECK (type IN ('secret_santa','raffle','sale','bazaar','bingo','game','food','other'));`,
  `CREATE TABLE IF NOT EXISTS ActivityParticipants (id SERIAL PRIMARY KEY, activity_id INTEGER NOT NULL REFERENCES Activities(id) ON DELETE CASCADE, user_id INTEGER REFERENCES Users(id), guest_id INTEGER REFERENCES Guests(id), role VARCHAR(20) NOT NULL DEFAULT 'participant' CHECK (role IN ('admin','responsible','participant','viewer')), number INTEGER, recipient_participant_id INTEGER REFERENCES ActivityParticipants(id), created_at TIMESTAMP NOT NULL DEFAULT NOW(), CHECK ((user_id IS NOT NULL)::int + (guest_id IS NOT NULL)::int = 1), UNIQUE(activity_id,number));`,
  `CREATE UNIQUE INDEX IF NOT EXISTS activity_participant_user_unique ON ActivityParticipants(activity_id,user_id) WHERE user_id IS NOT NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS activity_participant_guest_unique ON ActivityParticipants(activity_id,guest_id) WHERE guest_id IS NOT NULL;`,
  `CREATE TABLE IF NOT EXISTS ActivityParticipantExclusions (activity_id INTEGER NOT NULL REFERENCES Activities(id) ON DELETE CASCADE, participant_id INTEGER NOT NULL REFERENCES ActivityParticipants(id) ON DELETE CASCADE, excluded_participant_id INTEGER NOT NULL REFERENCES ActivityParticipants(id) ON DELETE CASCADE, PRIMARY KEY(activity_id,participant_id,excluded_participant_id), CHECK(participant_id <> excluded_participant_id));`,
  `CREATE TABLE IF NOT EXISTS ActivityParticipantWinners (activity_id INTEGER PRIMARY KEY REFERENCES Activities(id) ON DELETE CASCADE, participant_id INTEGER NOT NULL REFERENCES ActivityParticipants(id), number INTEGER NOT NULL, drawn_at TIMESTAMP NOT NULL DEFAULT NOW());`,
  `CREATE TABLE IF NOT EXISTS Invitations (id SERIAL PRIMARY KEY, scope_type VARCHAR(20) NOT NULL CHECK(scope_type IN ('activity','natillera')), scope_id INTEGER NOT NULL, guest_id INTEGER NOT NULL REFERENCES Guests(id), token_hash VARCHAR(64) NOT NULL UNIQUE, pin_hash VARCHAR(100), expires_at TIMESTAMP NOT NULL, claimed_at TIMESTAMP, revoked_at TIMESTAMP, created_by INTEGER NOT NULL REFERENCES Users(id), created_at TIMESTAMP NOT NULL DEFAULT NOW());`,
  `CREATE TABLE IF NOT EXISTS Notifications (id SERIAL PRIMARY KEY, activity_id INTEGER REFERENCES Activities(id) ON DELETE CASCADE, participant_id INTEGER REFERENCES ActivityParticipants(id) ON DELETE CASCADE, kind VARCHAR(30) NOT NULL, channel VARCHAR(20) NOT NULL CHECK(channel IN ('email','whatsapp')), status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')), idempotency_key VARCHAR(160) NOT NULL UNIQUE, attempts INTEGER NOT NULL DEFAULT 0, last_error VARCHAR(500), sent_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT NOW());`,
  `ALTER TABLE Notifications ADD COLUMN IF NOT EXISTS delivery_url VARCHAR(800);`,
  `ALTER TABLE Notifications DROP CONSTRAINT IF EXISTS notifications_status_check;`,
  `ALTER TABLE Notifications ADD CONSTRAINT notifications_status_check CHECK(status IN ('pending','prepared','sent','failed'));`,
  `CREATE TABLE IF NOT EXISTS FundraisingTransactions (id SERIAL PRIMARY KEY, activity_id INTEGER NOT NULL REFERENCES Activities(id) ON DELETE CASCADE, kind VARCHAR(20) NOT NULL CHECK(kind IN ('income','cost','expense','adjustment')), description VARCHAR(240) NOT NULL, amount NUMERIC(12,2) NOT NULL CHECK(amount > 0), receipt_url VARCHAR(500), recorded_by INTEGER NOT NULL REFERENCES Users(id), occurred_at TIMESTAMP NOT NULL DEFAULT NOW(), reversed_transaction_id INTEGER REFERENCES FundraisingTransactions(id), created_at TIMESTAMP NOT NULL DEFAULT NOW());`,
  `CREATE TABLE IF NOT EXISTS InventoryProducts (id SERIAL PRIMARY KEY, activity_id INTEGER NOT NULL REFERENCES Activities(id) ON DELETE CASCADE, name VARCHAR(120) NOT NULL, unit VARCHAR(30) NOT NULL DEFAULT 'unidad', cost_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(cost_price >= 0), sale_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(sale_price >= 0), created_at TIMESTAMP NOT NULL DEFAULT NOW());`,
  `CREATE TABLE IF NOT EXISTS InventoryMovements (id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES InventoryProducts(id) ON DELETE CASCADE, kind VARCHAR(20) NOT NULL CHECK(kind IN ('initial','entry','sale','loss','adjustment')), quantity NUMERIC(12,3) NOT NULL CHECK(quantity <> 0), unit_price NUMERIC(12,2), note VARCHAR(240), recorded_by INTEGER NOT NULL REFERENCES Users(id), created_at TIMESTAMP NOT NULL DEFAULT NOW());`,
  `CREATE TABLE IF NOT EXISTS NatilleraLedger (id SERIAL PRIMARY KEY, natillera_id INTEGER NOT NULL REFERENCES Natilleras(id) ON DELETE CASCADE, activity_id INTEGER REFERENCES Activities(id), kind VARCHAR(30) NOT NULL CHECK(kind IN ('activity_profit','general_expense','late_fee','adjustment')), amount NUMERIC(12,2) NOT NULL CHECK(amount <> 0), description VARCHAR(240) NOT NULL, recorded_by INTEGER NOT NULL REFERENCES Users(id), created_at TIMESTAMP NOT NULL DEFAULT NOW());`,
  `CREATE TABLE IF NOT EXISTS AuditLog (id BIGSERIAL PRIMARY KEY, actor_user_id INTEGER REFERENCES Users(id), actor_guest_id INTEGER REFERENCES Guests(id), scope_type VARCHAR(30) NOT NULL, scope_id INTEGER NOT NULL, action VARCHAR(60) NOT NULL, before_data JSONB, after_data JSONB, created_at TIMESTAMP NOT NULL DEFAULT NOW());`,
  // Suscripción Pro (Stripe Checkout). Una fila por usuario; se
  // actualiza vía webhook de Stripe, nunca directamente desde el
  // frontend. status refleja el estado que reporta Stripe
  // (active/trialing cuentan como Pro vigente; el resto no).
  `CREATE TABLE IF NOT EXISTS Subscriptions (
    user_id INTEGER PRIMARY KEY REFERENCES Users(id),
    stripe_customer_id VARCHAR(64) NOT NULL,
    stripe_subscription_id VARCHAR(64),
    status VARCHAR(20) NOT NULL DEFAULT 'incomplete',
    current_period_end TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_customer_unique ON Subscriptions(stripe_customer_id);`,
  `CREATE TABLE IF NOT EXISTS ReminderPreferences (
    user_id INTEGER PRIMARY KEY REFERENCES Users(id) ON DELETE CASCADE,
    in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    days_before INTEGER[] NOT NULL DEFAULT ARRAY[7,1],
    overdue_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );`,
  `CREATE TABLE IF NOT EXISTS CalendarReminders (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
    event_key VARCHAR(160) NOT NULL,
    event_type VARCHAR(30) NOT NULL,
    event_date DATE NOT NULL,
    timing VARCHAR(20) NOT NULL CHECK(timing IN ('7_days','1_day','overdue')),
    title VARCHAR(180) NOT NULL,
    link VARCHAR(240) NOT NULL,
    amount NUMERIC(12,2),
    email_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(email_status IN ('pending','sent','failed','skipped')),
    email_attempts INTEGER NOT NULL DEFAULT 0,
    last_error VARCHAR(500),
    read_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id,event_key,timing)
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
  try {
    // Evita que dos instancias serverless intenten alterar el esquema a la vez.
    await client.query('SELECT pg_advisory_lock($1)', [20260920]);
    for (let query of queries) await client.query(query);
    const legacyPrivateUrls=(await client.query("SELECT id,delivery_url FROM Notifications WHERE delivery_url LIKE '%token=%' AND delivery_url NOT LIKE 'enc:v1:%' FOR UPDATE")).rows;
    for(const row of legacyPrivateUrls)await client.query('UPDATE Notifications SET delivery_url=$1 WHERE id=$2',[encryptDeliveryUrl(row.delivery_url),row.id]);

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
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [20260920]).catch(() => {});
    client.release();
  }
  // No cerrar el pool acá: este archivo ahora se importa desde
  // app.js al arrancar el servidor (antes era un script standalone,
  // por eso cerraba el pool al final). Si se cierra, cualquier
  // request que use el pool compartido de connection.js después de
  // este boot falla con "Cannot use a pool after calling end on the
  // pool" — el pool debe vivir mientras viva el servidor.
}

export const migrationsReady = runMigrations();
