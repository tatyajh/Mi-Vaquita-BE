-- Mi Vaquita — reinicio total de la base de datos
--
-- Este archivo NO se ejecuta automáticamente en ningún momento (no lo
-- importa app.js ni migrations.js). Es solo para pegar a mano en el
-- editor SQL de Supabase cuando quieras volver a probar desde cero.
--
-- Cómo usarlo:
--   1. Entra a tu proyecto en https://supabase.com/dashboard
--   2. Ve a "SQL Editor" en el menú lateral
--   3. Pega este bloque completo y dale "Run"
--
-- Qué hace:
--   - Borra TODOS los usuarios, grupos, participantes, amistades,
--     gastos, natilleras, aportes, préstamos, cierres y actividades.
--   - CASCADE se encarga de las llaves foráneas sin importar el orden.
--   - RESTART IDENTITY reinicia los contadores de id a 1, para que el
--     próximo usuario/grupo que crees vuelva a empezar en el id 1.
--
-- Después de correrlo no queda ningún usuario: tendrás que registrar
-- una cuenta nueva desde /register para volver a entrar.

BEGIN;

TRUNCATE TABLE
  activitywinners,
  activityexclusions,
  activitymembers,
  activities,
  natilleraclosures,
  natilleraloanpayments,
  natilleraloans,
  natilleracontributionaudit,
  natilleracontributions,
  natilleramembers,
  natilleras,
  expenses,
  groupparticipants,
  friends,
  groups,
  users
RESTART IDENTITY CASCADE;

COMMIT;

-- Verificación: todas estas cantidades deben quedar en 0.
SELECT
  (SELECT COUNT(*) FROM users) AS users,
  (SELECT COUNT(*) FROM friends) AS friends,
  (SELECT COUNT(*) FROM groups) AS groups,
  (SELECT COUNT(*) FROM natilleras) AS natilleras,
  (SELECT COUNT(*) FROM activities) AS activities;
