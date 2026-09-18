import Joi from "joi";
import { StatusCodes } from "http-status-codes";

class NotFoundException extends Error {
  constructor(message) {
    super(message);
    this.statusCode = StatusCodes.NOT_FOUND;
  }
}

class ConflictException extends Error {
  constructor(message) {
    super(message);
    this.statusCode = StatusCodes.CONFLICT;
  }
}

const validateGroup = (groupData) => {
  const schema = Joi.object({
    ownerUserId: Joi.number().integer().positive(), 
    name: Joi.string().trim().min(1).max(30).required(),
    color: Joi.string()
      .trim()
      .min(4)
      .max(7)
      .pattern(new RegExp("^#?([a-fA-F0-9]{6}|[a-fA-F0-9]{3})$"))
      .required(),
    tripType: Joi.string().trim().max(30).allow(null, ''),
  });

  return schema.validate(groupData);
};

export { NotFoundException, ConflictException, validateGroup };
