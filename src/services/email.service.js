// Envío de correo transaccional vía la API HTTP de Resend
// (https://resend.com/docs/api-reference/emails/send-email). Se usa
// `fetch` directo en vez del SDK de Resend para no agregar una
// dependencia nueva solo por esto.
//
// Variables de entorno requeridas:
//   RESEND_API_KEY   — API key de tu cuenta de Resend.
//   RESEND_FROM_EMAIL — remitente. Si no tienes un dominio propio
//                        verificado en Resend, puedes usar
//                        "onboarding@resend.dev" para pruebas.
//   FRONTEND_URL      — origen del frontend, para armar el link del
//                        correo (ej. https://mi-vaquita-fe.vercel.app).
//
// Si RESEND_API_KEY no está configurada, se registra el link en la
// consola en vez de fallar — así el resto del flujo (crear el token,
// responder al cliente) sigue funcionando en desarrollo local sin
// necesidad de tener credenciales de correo a mano.

const RESEND_API_URL = 'https://api.resend.com/emails';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

export const sendTransactionalEmail = async ({ to, subject, html }) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    const error = new Error('El correo no está configurado: faltan RESEND_API_KEY o RESEND_FROM_EMAIL');
    error.code = 'EMAIL_NOT_CONFIGURED';
    throw error;
  }
  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `Mi Vaquita <${from}>`, to: [String(to).trim().toLowerCase()], subject, html }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Resend respondió ${response.status}: ${body.slice(0, 300)}`);
  }
  return { sent: true };
};

export const sendPasswordResetEmail = async (toEmail, resetUrl) => {
  return sendTransactionalEmail({
      to: toEmail,
      subject: 'Recupera tu contraseña de Mi Vaquita 🐄', html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #ED1651;">Recupera tu contraseña</h2>
          <p>Alguien (esperamos que hayas sido tú) pidió restablecer la contraseña de tu cuenta en Mi Vaquita.</p>
          <p>
            <a href="${escapeHtml(resetUrl)}" style="background: #ED1651; color: #fff; padding: 12px 24px; border-radius: 999px; text-decoration: none; display: inline-block; font-weight: bold;">
              Elegir una nueva contraseña
            </a>
          </p>
          <p>Este enlace vence en 1 hora. Si no fuiste tú, puedes ignorar este correo.</p>
        </div>
      `,
  });
};

export const sendInvitationEmail = (to, { activityName, claimUrl }) => sendTransactionalEmail({
  to, subject: `Invitación a ${activityName} en Mi Vaquita`,
  html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto"><h2 style="color:#65a930">Te invitaron a ${escapeHtml(activityName)}</h2><p>Entra al enlace y crea tu PIN privado.</p><p><a href="${escapeHtml(claimUrl)}" style="background:#ed1651;color:white;padding:12px 20px;border-radius:999px;text-decoration:none">Aceptar invitación</a></p><p>El enlace vence y solo se puede usar una vez.</p></div>`,
});

export const sendSecretSantaEmail = (to, { activityName, recipientName, eventOn, budget, privateUrl }) => sendTransactionalEmail({
  to, subject: `Tu amigo secreto en ${activityName}`,
  html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto"><h2 style="color:#65a930">Tu amigo secreto</h2><p>Te tocó <strong>${escapeHtml(recipientName)}</strong>.</p><p>Fecha: ${escapeHtml(eventOn)}${budget != null ? ` · Presupuesto orientativo: $${escapeHtml(budget)}` : ''}</p><p><a href="${escapeHtml(privateUrl)}">Ver mi asignación privada</a></p></div>`,
});

export const sendReminderEmail = (to, reminder) => sendTransactionalEmail({
  to,
  subject: `${reminder.timing==='overdue'?'Compromiso vencido':'Próximo compromiso'}: ${reminder.title}`,
  html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto"><h2 style="color:#65a930">${reminder.timing==='overdue'?'Tienes un compromiso vencido':'Recuerda esta fecha'}</h2><p><strong>${escapeHtml(reminder.title)}</strong></p><p>Fecha: ${escapeHtml(reminder.event_date)}</p><p><a href="${escapeHtml(`${String(process.env.FRONTEND_URL||'').replace(/\/$/,'')}${reminder.link}`)}" style="background:#ed1651;color:white;padding:12px 20px;border-radius:999px;text-decoration:none">Ver en Mi Vaquita</a></p></div>`,
});

export default { sendPasswordResetEmail, sendInvitationEmail, sendSecretSantaEmail, sendReminderEmail, sendTransactionalEmail };
