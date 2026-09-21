import GroupService from "../services/groups.service.js";
import { StatusCodes } from 'http-status-codes';
import { NotFoundException, ConflictException, ProRequiredException, ForbiddenException } from '../validations/groups.validations.js';

const groupService = GroupService();

export const getAllGroupsController = async (req, res) => {
  const userId = req.userId;
  try {
    const groups = await groupService.getAll(userId);
    res.status(StatusCodes.OK).json(groups);
  } catch (error) {
    console.error('Failed to get groups:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const getByIdGroupsController = async (req, res) => {
  try {
    const group = await groupService.getById(req.params.id, req.userId);
    res.status(StatusCodes.OK).json(group);
  } catch (error) {
    if (error instanceof NotFoundException) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: error.message });
    }
    console.error(`Failed to get group with id ${req.params.id}:`, error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const createGroupsController = async (req, res) => {
  const { name, color, tripType, photoData = null } = req.body;
  const ownerUserId = req.userId;
  try {
    const newGroup = await groupService.create({ ownerUserId, name, color, tripType, photoData });
    res.status(StatusCodes.CREATED).json(newGroup);
  } catch (error) {
    if (error instanceof ProRequiredException) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    console.error('Failed to create group:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: error.message || "Internal server error" });
  }
};

export const editByIdGroupsController = async (req, res) => {
  const { id } = req.params;
  try {
    const updatedGroup = await groupService.editById(id, req.body, req.userId);
    res.status(StatusCodes.OK).json(updatedGroup);
  } catch (error) {
    if (error instanceof NotFoundException) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: error.message });
    }
    if (error instanceof ProRequiredException || error instanceof ForbiddenException) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    console.error(`Failed to update group with id ${id}:`, error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const removeByIdGroupsController = async (req, res) => {
  const { id } = req.params;
  try {
    await groupService.removeById(id, req.userId);
    res.status(StatusCodes.OK).json({ message: 'Group deleted successfully' });
  } catch (error) {
    if (error instanceof NotFoundException) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: error.message });
    }
    if (error instanceof ForbiddenException) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error(`Failed to remove group with id ${id}:`, error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const addGroupParticipantsController = async (req, res) => {
  const { groupId, participantIds } = req.body;
  try {
    await groupService.addParticipants(groupId, participantIds, req.userId);
    res.status(StatusCodes.CREATED).json({ message: 'Participants added successfully' });
  } catch (error) {
    if (error instanceof ConflictException || error instanceof NotFoundException || error instanceof ForbiddenException) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('Error adding participants:', error);
    res.status(StatusCodes.BAD_REQUEST).json({ message: error.message || 'Internal server error' });
  }
};

export const getGroupParticipantsController = async (req, res) => {
  const { groupId } = req.params;
  try {
    const participants = await groupService.getParticipants(groupId, req.userId);
    res.status(StatusCodes.OK).json(participants);
  } catch (error) {
    if (error instanceof NotFoundException) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: error.message });
    }
    console.error('Error getting participants:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: 'Internal server error' });
  }
};
