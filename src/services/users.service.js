import UsersModel from '../database/users.model.js';
import bcrypt from 'bcrypt';
import { ConflictException, NotFoundException, validateUser } from '../validations/users.validations.js';

const UserService = () => {
  const userModel = UsersModel();

  const getAll = async () => {
    return userModel.getAllUsersModel();
  };

  const create = async (newUser) => {
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
    const user = await userModel.getByUsersEmailModel(email);
    if (!user) {
      throw new NotFoundException(`User with email ${email} does not exist`);
    }
    return user;
  };

  return {
    create,
    getById,
    getByEmail,
    search,
    getAll,
  };
};

export default UserService;
