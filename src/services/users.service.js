import UsersModel from '../database/users.model.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { ConflictException, NotFoundException, validateUser, validatePassword } from '../validations/users.validations.js';
import { sendPasswordResetEmail } from './email.service.js';

// El token que recibe el usuario por correo NUNCA se guarda tal cual
// en la base de datos — se guarda su hash SHA-256, igual que se hace
// con contraseñas (bcrypt) pero más liviano, ya que este token es
// aleatorio y de un solo uso, no algo que el usuario deba recordar.
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const UserService = () => {
  const userModel = UsersModel();

  const getAll = async () => {
    return userModel.getAllUsersModel();
  };

  const create = async (newUser) => {
    newUser = {
      ...newUser,
      email: String(newUser.email || '').trim().toLowerCase(),
      phone: String(newUser.phone || '').replace(/[\s()-]/g, ''),
    };
    const { error } = validateUser(newUser);
    if (error) {
      throw new Error(error.details[0].message);
    }
    const existingUser = await userModel.getByUsersEmailModel(newUser.email);
    if (existingUser) {
      throw new ConflictException('Este correo ya existe');
    }
    newUser.password = await bcrypt.hash(newUser.password, 10);
    newUser.createdAt = new Date().toISOString().slice(0, 10);
    return userModel.createUsersModel(newUser);
  };

  const getById = async (id) => {
    const user = await userModel.getByIdUsersModel(id);
    if (!user) {
      throw new NotFoundException(`User with id ${id} does not exist`);
    }
    return user;
  };

  const search = async (query, excludeUserId) => {
    if (!query || !query.trim()) {
      return [];
    }
    return userModel.searchUsersModel(query.trim(), excludeUserId);
  };

  const getByEmail = async (email) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const user = await userModel.getByUsersEmailModel(normalizedEmail);
    if (!user) {
      throw new NotFoundException(`User with email ${email} does not exist`);
    }
    return user;
  };

  // Siempre se comporta igual exista o no el correo (no lanza si no
  // lo encuentra): así la respuesta al cliente nunca revela si un
  // email está registrado o no en Mi Vaquita.
  const requestPasswordReset = async (email, frontendUrl) => {
    const user = await userModel.getByUsersEmailModel(String(email || '').trim().toLowerCase());
    if (!user) {
      return;
    }
    const rawToken = crypto.randomBytes(32).toString('hex');
    await userModel.setResetTokenModel(user.id, hashToken(rawToken));
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;
    await sendPasswordResetEmail(user.email, resetUrl);
  };

  const resetPassword = async (token, newPassword) => {
    const { error } = validatePassword(newPassword);
    if (error) {
      throw new Error(error.details[0].message);
    }
    const user = await userModel.getByResetTokenHashModel(hashToken(token));
    if (!user) {
      throw new NotFoundException('El enlace no es válido o ya venció. Solicita uno nuevo.');
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    await userModel.updatePasswordModel(user.id, hashed);
  };

  const changePassword = async (userId, currentPassword, newPassword) => {
    const { error } = validatePassword(newPassword);
    if (error) {
      throw new Error(error.details[0].message);
    }
    const user = await userModel.getByIdUsersModel(userId);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    const isCurrentValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentValid) {
      throw new Error('La contraseña actual no es correcta');
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    await userModel.updatePasswordModel(userId, hashed);
  };

  const deactivate = async (userId) => {
    await userModel.softDeleteUserModel(userId);
  };

  return {
    create,
    getById,
    getByEmail,
    search,
    getAll,
    requestPasswordReset,
    resetPassword,
    changePassword,
    deactivate,
  };
};

export default UserService;
