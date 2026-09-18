import jwt from 'jsonwebtoken';

// Middleware liviano que valida el JWT emitido en /api/auth/login y
// expone el id del usuario autenticado en req.userId. Reutiliza el
// mismo secreto/formato de token que auth.controller.js (jwt.sign({
// id: user.id }, JWT_SECRET)) en vez de traer passport de nuevo, ya
// que passport.config.js nunca llegó a conectarse a ninguna ruta.
export const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Token de autenticación requerido' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.id;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token de autenticación inválido o expirado' });
  }
};

export default authenticateJWT;
