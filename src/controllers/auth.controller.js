import UserService from "../services/users.service.js";
import { StatusCodes } from "http-status-codes";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { NotFoundException } from "../validations/users.validations.js";

const userService = UserService();

export const loginController = async (req, res) => {
  const { email, password } = req.body;

  try {
    // getByEmail ya excluye cuentas dadas de baja (deleted_at), así
    // que una cuenta desactivada llega aquí como "no existe" y cae en
    // el mismo mensaje genérico de abajo.
    //
    // OJO: getByEmail LANZA NotFoundException cuando no encuentra el
    // correo, nunca devuelve null/undefined — el chequeo `if (!user)`
    // que había acá antes era código muerto, así que cualquier correo
    // no registrado (o dado de baja) terminaba en el catch genérico
    // de abajo con un 500 "Internal server error" en vez del mensaje
    // correcto. Se atrapa la excepción explícitamente en su lugar.
    let user;
    try {
      user = await userService.getByEmail(email);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return res
          .status(StatusCodes.UNAUTHORIZED)
          .json({ message: "Correo o contraseña incorrectos" });
      }
      throw error;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res
        .status(StatusCodes.UNAUTHORIZED)
        .json({ message: "Correo o contraseña incorrectos" });
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    // Nunca se manda el hash de la contraseña ni los campos de
    // recuperación de contraseña al cliente — `user` sale de un
    // `SELECT *`, así que hay que filtrarlos a mano.
    const safeUser = { id: user.id, name: user.name, email: user.email, createdat: user.createdat };
    res.status(StatusCodes.OK).json({ token, user: safeUser });
  } catch (error) {
    console.error("Error al iniciar sesión:", error);
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal server error" });
  }
};

// getByEmail lanza NotFoundException si el correo no existe (o está
// dado de baja); acá se trata igual que "sí existe" para no filtrar
// esa información — ambos casos responden el mismo mensaje genérico.
export const forgotPasswordController = async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(StatusCodes.BAD_REQUEST).json({ message: 'El correo es requerido' });
  }
  const genericMessage = 'Si ese correo está registrado, te enviamos un enlace para restablecer tu contraseña.';
  try {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    await userService.requestPasswordReset(email, frontendUrl);
  } catch (error) {
    console.error('Error al solicitar recuperación de contraseña:', error);
    // No se filtra el error al cliente: el mensaje sigue siendo el
    // genérico incluso si el envío del correo falló internamente.
  }
  res.status(StatusCodes.OK).json({ message: genericMessage });
};

export const resetPasswordController = async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Token y nueva contraseña son requeridos' });
  }
  try {
    await userService.resetPassword(token, password);
    res.status(StatusCodes.OK).json({ message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  } catch (error) {
    if (error instanceof NotFoundException) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: error.message });
    }
    console.error('Error al restablecer contraseña:', error);
    res.status(StatusCodes.BAD_REQUEST).json({ message: error.message || 'No se pudo restablecer la contraseña.' });
  }
};
