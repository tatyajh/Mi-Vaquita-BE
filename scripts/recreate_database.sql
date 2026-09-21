-- PELIGRO: elimina toda la información de Mi Vaquita.
-- Uso manual únicamente en un entorno de prueba. Después de ejecutarlo,
-- reinicia el backend para que migrations.js recree el esquema actual.
BEGIN;
DROP TABLE IF EXISTS auditlog,natilleraledger,inventorymovements,inventoryproducts,
  fundraisingtransactions,notifications,invitations,activityparticipantexclusions,
  activityparticipantwinners,activityparticipants,natilleraparticipantcontributions,natilleraquotas,natilleraparticipants,guests,activitywinners,activityexclusions,
  activitymembers,activities,natilleraclosures,natilleraloanpayments,natilleraloans,
  natilleracontributionaudit,natilleracontributions,natilleramembers,natilleras,
  expenses,groupparticipants,friends,groups,users CASCADE;
COMMIT;
