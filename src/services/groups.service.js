import GroupsModel from "../database/groups.model.js";
import { NotFoundException, ConflictException, ProRequiredException, ForbiddenException, validateGroup } from "../validations/groups.validations.js";
import { isFreeGroupColor } from "../constants/group-colors.js";
import billingService from "./billing.service.js";

const MAX_GROUP_MEMBERS = 20;

const GroupService = () => {
  const groupModel = GroupsModel();

  // Se valida acá (no solo en el picker del frontend) para que elegir
  // un color fuera de los 8 gratuitos sin ser Pro no baste con llamar
  // a la API directo.
  const assertColorAllowed = async (color, userId) => {
    if (isFreeGroupColor(color)) return;
    if (await billingService.isUserPro(userId)) return;
    throw new ProRequiredException('Los colores personalizados son una función de Mi Vaquita Pro. Elige uno de los colores gratuitos o actualiza tu plan.');
  };

  const create = async (newGroup) => {
    const { error } = validateGroup(newGroup);
    if (error) {
    throw new Error(error.details[0].message);
    }
    if (!newGroup.ownerUserId) {
      // El controller siempre debe mandar el ownerUserId real (del JWT,
      // vía el middleware de auth) — nunca inventar un dueño por
      // defecto, eso fue justo el bug que hacía que los grupos se
      // crearan a nombre de otro usuario.
      throw new Error('No se pudo determinar el usuario dueño del grupo');
    }
    await assertColorAllowed(newGroup.color, newGroup.ownerUserId);
    return groupModel.createGroupsModel(newGroup);
  };

  const getAll = async (userId) => {
    if (!userId) {
      // Sin userId no hay forma de saber qué grupos le pertenecen al
      // usuario, así que no devolvemos todos los grupos de la BD.
      throw new Error('Se requiere el id del usuario para listar sus grupos');
    }
    return groupModel.getGroupsForUserModel(userId);
  };

  // "No existe" para quien no es miembro, aunque el grupo sí exista —
  // así no se puede usar la respuesta para adivinar ids de grupos
  // ajenos. Antes esto ni se llamaba: cualquier usuario logueado podía
  // leer/editar/borrar el grupo de cualquier otro con solo saber el id.
  const assertMember = async (groupId, userId) => {
    const { isMember, isOwner } = await groupModel.getMembershipModel(groupId, userId);
    if (!isMember) {
      throw new NotFoundException(`Group with id ${groupId} does not exist`);
    }
    return { isOwner };
  };

  const assertOwner = async (groupId, userId) => {
    const { isOwner } = await assertMember(groupId, userId);
    if (!isOwner) {
      throw new ForbiddenException('Solo la persona administradora puede hacer esto');
    }
  };

  const getById = async (id, userId) => {
    const group = await groupModel.getByIdGroupsModel(id);
    if (!group) {
      throw new NotFoundException(`Group with id ${id} does not exist`);
    }
    await assertMember(id, userId);
    return group;
  };

  const editById = async (id, groupData, actorUserId) => {
    const { error } = validateGroup(groupData);
    if (error) {
      throw new Error(error.details[0].message);
    }

    const existingGroup = await groupModel.getByIdGroupsModel(id);
    if (!existingGroup) {
      throw new NotFoundException(`Group with id ${id} does not exist`);
    }
    await assertOwner(id, actorUserId);

    await assertColorAllowed(groupData.color, actorUserId);
    return groupModel.updateGroupsModel(id, groupData);
  };

  const removeById = async (id, actorUserId) => {
    const existingGroup = await groupModel.getByIdGroupsModel(id);
    if (!existingGroup) {
      throw new NotFoundException(`Group with id ${id} does not exist`);
    }
    await assertOwner(id, actorUserId);

    const deleted = await groupModel.deleteGroupsModel(id);
    if (!deleted) {
      throw new NotFoundException(`Group with id ${id} does not exist`);
    }
    return deleted;
  };

  const addParticipants = async (groupId, participantIds, actorUserId) => {
    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      throw new Error('Debe indicar al menos un participante');
    }

    const group = await groupModel.getByIdGroupsModel(groupId);
    if (!group) {
      throw new NotFoundException(`Group with id ${groupId} does not exist`);
    }
    await assertOwner(groupId, actorUserId);

    // El conteo contra el cupo máximo pasa DENTRO de
    // groupModel.addParticipants, con la fila del grupo bloqueada —
    // antes se contaba acá y se insertaba en el modelo por separado,
    // dejando una ventana para que dos altas simultáneas al mismo
    // grupo se saltaran el límite entre las dos.
    try {
      await groupModel.addParticipants(groupId, [...new Set(participantIds)], MAX_GROUP_MEMBERS);
    } catch (error) {
      if (error.statusCode === 409) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  };

  const getParticipants = async (groupId, userId) => {
    await assertMember(groupId, userId);
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
