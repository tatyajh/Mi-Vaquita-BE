import Joi from 'joi';
import { StatusCodes } from 'http-status-codes';

class ConflictException extends Error {
  constructor(message) {
    super(message);
    this.statusCode = StatusCodes.CONFLICT;
  }
}

class NotFoundException extends Error {
  constructor(message) {
    super(message);
    this.statusCode = StatusCodes.NOT_FOUND;
  }
}

const PASSWORD_PATTERN = new RegExp('^(?=.*[a-z])(?=.*[0-9])');

const validateUser = (user) => {
  const schema = Joi.object({
    name: Joi.string().min(3).max(100).required(),
    email: Joi.string().email().required(),
    phone: Joi.string().pattern(/^\+?[1-9]\d{7,14}$/).required().messages({
      'string.pattern.base': 'El WhatsApp debe incluir indicativo de país, por ejemplo +573001234567',
    }),
    password: Joi.string().pattern(PASSWORD_PATTERN).required(),
  });

  return schema.validate(user);
};

// Misma regla de contraseña que validateUser, reutilizada para
// recuperar/cambiar contraseña (no repite la regex a mano).
const validatePassword = (password) => {
  const schema = Joi.string().pattern(PASSWORD_PATTERN).required().messages({
    'string.pattern.base': 'La contraseña debe tener al menos una letra minúscula y un número',
  });

  return schema.validate(password);
};


export { ConflictException, NotFoundException, validateUser, validatePassword };
