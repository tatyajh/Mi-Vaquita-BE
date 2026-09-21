-- Mi Vaquita — diagnóstico de integridad. Solo lectura: no modifica datos.
SELECT LOWER(TRIM(email)) normalized_email, COUNT(*) records, ARRAY_AGG(id ORDER BY id) user_ids
FROM users WHERE deleted_at IS NULL GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1;

SELECT LEAST(user_id,friend_user_id) user_a,GREATEST(user_id,friend_user_id) user_b,
       COUNT(*) records,ARRAY_AGG(id ORDER BY id) friendship_ids
FROM friends WHERE user_id IS NOT NULL AND friend_user_id IS NOT NULL
GROUP BY 1,2 HAVING COUNT(*) > 1;

SELECT f.id,f.user_id,f.friend_user_id FROM friends f
LEFT JOIN users u ON u.id=f.user_id LEFT JOIN users friend ON friend.id=f.friend_user_id
WHERE u.id IS NULL OR friend.id IS NULL OR f.user_id=f.friend_user_id;

SELECT gp.id,gp.group_id,gp.user_id FROM groupparticipants gp
LEFT JOIN groups g ON g.id=gp.group_id LEFT JOIN users u ON u.id=gp.user_id
WHERE g.id IS NULL OR u.id IS NULL;

SELECT ap.id,ap.activity_id,ap.user_id,ap.guest_id FROM activityparticipants ap
LEFT JOIN activities a ON a.id=ap.activity_id LEFT JOIN users u ON u.id=ap.user_id LEFT JOIN guests g ON g.id=ap.guest_id
WHERE a.id IS NULL OR (ap.user_id IS NOT NULL AND u.id IS NULL) OR (ap.guest_id IS NOT NULL AND g.id IS NULL)
   OR ((ap.user_id IS NOT NULL)::int + (ap.guest_id IS NOT NULL)::int <> 1);

SELECT a.id,a.name,a.group_id,a.owner_id FROM activities a
LEFT JOIN groups g ON g.id=a.group_id
WHERE a.owner_id IS NULL AND g.id IS NULL;

SELECT n.id,n.name,n.status,COUNT(DISTINCT nm.user_id) legacy_members,COUNT(DISTINCT np.id) extended_members
FROM natilleras n LEFT JOIN natilleramembers nm ON nm.natillera_id=n.id
LEFT JOIN natilleraparticipants np ON np.natillera_id=n.id
GROUP BY n.id,n.name,n.status ORDER BY n.id;
