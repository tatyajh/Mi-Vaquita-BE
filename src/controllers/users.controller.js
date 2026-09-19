import UserService from '../services/users.service.js';
import { StatusCodes } from 'http-status-codes';
import { NotFoundException, ConflictException } from '../validations/users.validations.js';

const userService = UserService();

// Los modelos hacen `SELECT * FROM users` / `RETURNING *`, así que
// traen password (hasheado, pero igual nunca debe salir de la API),
// reset_token y reset_token_expires. Cualquier endpoint que devuelva
// un usuario completo debe pasarlo por acá primero.
const toSafeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  createdat: user.createdat,
});

export const getByIdUsersController = async (req, res) => {
  try {
    const user = await userService.getById(req.params.id);
    res.status(StatusCodes.OK).json(toSafeUser(user));
  } catch (error) {
    if (error instanceof NotFoundException) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: error.message });
    }
    console.error(`Failed to get user with id ${req.params.id}:`, error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const createUserController = async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const newUser = await userService.create({ name, email, password });
    res.status(StatusCodes.CREATED).json(toSafeUser(newUser));
  } catch (error) {
    if (error instanceof ConflictException) {
      return res.status(StatusCodes.CONFLICT).json({ message: error.message });
    }
    console.error('Failed to create user:', error);
    res.status(StatusCodes.BAD_REQUEST).json({ message: error.message });
  }
};

export const getAllUsersController = async (req, res) => {
  try {
    const users = await userService.getAll();
    res.status(StatusCodes.OK).json(users.map(toSafeUser));
  } catch (error) {
    console.error('Failed to get users:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Internal server error' });
  }
};

export const searchUsersController = async (req, res) => {
  const { q } = req.query;
  if (!q || !q.trim()) {
    return res.status(StatusCodes.OK).json([]);
  }
  try {
    const users = await userService.search(q, req.userId);
    // Solo exponemos id, name y email — nunca el password.
    res.status(StatusCodes.OK).json(
      users.map((u) => ({ id: u.id, name: u.name, email: u.email }))
    );
  } catch (error) {
    console.error(`Failed to search users with q=${q}:`, error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Internal server error' });
  }
};

export const changePasswordController = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(StatusCodes.BAD_REQUEST).json({ message: 'La contraseña actual y la nueva son requeridas' });
  }
  try {
    await userService.changePassword(req.userId, currentPassword, newPassword);
    res.status(StatusCodes.OK).json({ message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    if (error instanceof NotFoundException) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: error.message });
    }
    // Contraseña actual incorrecta o nueva contraseña inválida: ambos
    // son errores del cliente, no del servidor.
    res.status(StatusCodes.BAD_REQUEST).json({ message: error.message || 'No se pudo cambiar la contraseña.' });
  }
};

export const deactivateAccountController = async (req, res) => {
  try {
    await userService.deactivate(req.userId);
    res.status(StatusCodes.OK).json({ message: 'Tu cuenta fue dada de baja.' });
  } catch (error) {
    console.error('Error al dar de baja la cuenta:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'No se pudo dar de baja la cuenta.' });
  }
};

export const getByEmailUsersController = async (req, res) => {
  const { email } = req.query;
  if (!email) {
    return res.status(StatusCodes.BAD_REQUEST).json({ message: 'El parámetro email es requerido' });
  }
  try {
    const user = await userService.getByEmail(email);
    // Solo exponemos los campos necesarios para agregar amigos, nunca el password.
    res.status(StatusCodes.OK).json({ id: user.id, name: user.name, email: user.email });
  } catch (error) {
    if (error instanceof NotFoundException) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: error.message });
    }
    console.error(`Failed to get user with email ${email}:`, error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Internal server error' });
  }
};