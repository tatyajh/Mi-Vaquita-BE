import GroupsModel from "../database/groups.model.js";
import { NotFoundException, ConflictException, validateGroup } from "../validations/groups.validations.js";

const MAX_GROUP_MEMBERS = 20;

const GroupService = () => {
  const groupModel = GroupsModel();

  const create = async (newGroup) => {
    const { error } = validateGroup(newGroup);
    if (error) {
    throw new Error(error.details[0].message);
    }
    if (!newGroup.ownerUserId) {
      newGroup.ownerUserId = 1; // Valor temporal hasta que se implemente la gestión de usuarios
    }
    return groupModel.createGroupsModel(newGroup);
  };

  const getAll = async () => {
    return groupModel.getAllGroupsModel();
  };

  const getById = async (id) => {
    const group = await groupModel.getByIdGroupsModel(id);
    if (!group) {
      throw new NotFoundException(`Group with id ${id} does not exist`);
    }
    return group;
  };

  const editById = async (id, groupData) => {
    const { error } = validateGroup(groupData);
    if (error) {
      throw new Error(error.details[0].message);
    }

    const existingGroup = await groupModel.getByIdGroupsModel(id);
    if (!existingGroup) {
      throw new NotFoundException(`Group with id ${id} does not exist`);
    }

    return groupModel.updateGroupsModel(id, groupData);
  };

  const removeById = async (id) => {
    const deleted = await groupModel.deleteGroupsModel(id);
    if (!deleted) {
      throw new NotFoundException(`Group with id ${id} does not exist`);
    }
    return deleted;
  };

  const addParticipants = async (groupId, participantIds) => {
    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      throw new Error('Debe indicar al menos un participante');
    }

    const [group, existingParticipants] = await Promise.all([
      groupModel.getByIdGroupsModel(groupId),
      groupModel.getParticipants(groupId),
    ]);
    if (!group) {
      throw new NotFoundException(`Group with id ${groupId} does not exist`);
    }

    const existingIds = new Set(existingParticipants.map(p => p.id));
    existingIds.add(group.owneruserid ?? group.ownerUserId);
    const newIds = [...new Set(participantIds)].filter(id => !existingIds.has(id));
    const totalMembers = existingIds.size + newIds.length;

    if (totalMembers > MAX_GROUP_MEMBERS) {
      throw new ConflictException(
        `Un grupo puede tener como máximo ${MAX_GROUP_MEMBERS} integrantes (actualmente tendría ${totalMembers})`
      );
    }

    return groupModel.addParticipants(groupId, participantIds);
  };

  const getParticipants = async (groupId) => {
    return groupModel.getParticipants(groupId);
  };

  return {
    getAll,
    getById,
    create,
    editById,
    removeById,
    addParticipants,
    getParticipants,
  };
};

export default GroupService;
