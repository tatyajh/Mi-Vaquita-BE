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

export const sendPasswordResetEmail = async (toEmail, resetUrl) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

  if (!apiKey) {
    console.warn(
      `RESEND_API_KEY no está configurada — no se envió el correo de recuperación. Link para ${toEmail}: ${resetUrl}`
    );
    return { sent: false };
  }

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Mi Vaquita <${from}>`,
      to: [toEmail],
      subject: 'Recupera tu contraseña de Mi Vaquita 🐄',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #ED1651;">Recupera tu contraseña</h2>
          <p>Alguien (esperamos que hayas sido tú) pidió restablecer la contraseña de tu cuenta en Mi Vaquita.</p>
          <p>
            <a href="${resetUrl}" style="background: #ED1651; color: #fff; padding: 12px 24px; border-radius: 999px; text-decoration: none; display: inline-block; font-weight: bold;">
              Elegir una nueva contraseña
            </a>
          </p>
          <p>Este enlace vence en 1 hora. Si no fuiste tú, puedes ignorar este correo.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Resend respondió ${response.status}: ${body}`);
  }

  return { sent: true };
};

export default { sendPasswordResetEmail };
