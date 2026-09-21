# Arquitectura de 3 Capas para APIs

## Configuración obligatoria

En producción configura `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`,
`RESEND_API_KEY` y `RESEND_FROM_EMAIL`. El remitente debe pertenecer a un
dominio verificado en Resend. Si falta una variable de correo, la API conserva
la respuesta genérica de recuperación para no revelar cuentas, pero registra
un error interno y no simula un envío exitoso.

El piloto debe ejecutarse con `BILLING_ENABLED=false`. Así se conserva la
integración histórica de Wompi, pero el servidor bloquea nuevos checkouts.
Las sesiones usan un token de acceso de 15 minutos y una cookie de renovación
HttpOnly de 30 días; cambiar la contraseña o dar de baja la cuenta revoca las
sesiones renovables existentes.

Las rutas ampliadas están bajo `/api/community`: actividades independientes,
participantes registrados o invitados, invitaciones con PIN, recaudos,
inventario, sorteos privados y consulta limitada para invitados. Las rutas
anteriores de grupos y actividades se conservan por compatibilidad.

En esta versión los préstamos se registran únicamente a usuarios con cuenta;
los invitados pueden participar, recibir invitaciones, aportar y aparecer en
el cierre, pero deben vincular su invitación a una cuenta antes de pedir un
préstamo.

El límite de intentos incorporado es local a cada proceso. En producción debe
complementarse con rate limiting del proveedor o gateway para cubrir varias
instancias serverless.

Los scripts en `scripts/` son manuales: `diagnose_database.sql` solo consulta,
`reset_database.sql` limpia datos conservando el esquema y
`recreate_database.sql` elimina las tablas para que el siguiente arranque las
recree. Ninguno se ejecuta durante el inicio normal.

Este proyecto sigue una arquitectura de 3 capas, que es una forma de estructurar una aplicación donde se separa la lógica de negocio en tres capas distintas: presentación, lógica de negocio y acceso a datos. En este caso, la presentación se maneja a través de la capa de rutas y controladores, la lógica de negocio se encuentra en los servicios, y el acceso a datos se realiza a través de los servicios.

## Estructura de archivos

- **app.js**: Configura y ejecuta la aplicación.
- **routes/groups.router.js**: Define los endpoints y los asocia a las funciones del controlador.
- **controllers/groups.controller.js**: Contiene la lógica de control de las peticiones HTTP relacionadas con grupos.
- **service/groups.service.js**: Contiene la lógica de negocio y las operaciones de datos.

## Métodos comunes en Express.js

### Métodos de req (Request)

- **req.body**: Contiene los datos enviados en el cuerpo de la solicitud POST o PUT.
- **req.params**: Un objeto que contiene propiedades mapeadas a los parámetros nombrados en la ruta.
- **req.query**: Un objeto que contiene la cadena de consulta de la solicitud.
- **req.method**: Una cadena que contiene el método HTTP de la solicitud.
- **req.url** o **req.path**: Contiene la URL o el camino de la solicitud.
- **req.headers**: Un objeto que contiene los encabezados de la solicitud.

### Métodos de res (Response)

- **res.send(body)**: Envía una respuesta HTTP con el cuerpo especificado.
- **res.json(json)**: Envía una respuesta JSON.
- **res.status(code)**: Establece el código de estado HTTP de la respuesta.
- **res.end()**: Finaliza el proceso de respuesta sin enviar ningún dato.
- **res.sendFile(path)**: Envía el archivo ubicado en path al cliente.
- **res.render(view, locals)**: Renderiza una vista con el motor de plantillas configurado.
- **res.redirect(path)**: Redirige al cliente a la URL especificada.
- **res.header(field, value)**: Establece un encabezado de respuesta.
