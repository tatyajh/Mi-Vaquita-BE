import { jest } from '@jest/globals';

const createGroupsModel = jest.fn(async (data) => ({ id: 1, ...data }));
const getByIdGroupsModel = jest.fn();
const updateGroupsModel = jest.fn(async (id, data) => ({ id, ...data }));
const deleteGroupsModel = jest.fn(async () => true);
const getMembershipModel = jest.fn();
const getParticipants = jest.fn(async () => []);
const addParticipantsModel = jest.fn();
const isUserPro = jest.fn();

jest.unstable_mockModule('../../database/groups.model.js', () => ({
  default: () => ({
    getAllGroupsModel: jest.fn(),
    getGroupsForUserModel: jest.fn(),
    getByIdGroupsModel,
    getMembershipModel,
    createGroupsModel,
    updateGroupsModel,
    deleteGroupsModel,
    addParticipants: addParticipantsModel,
    getParticipants,
  }),
}));

jest.unstable_mockModule('../billing.service.js', () => ({
  default: { isUserPro },
}));

const { default: GroupService } = await import('../groups.service.js');
const groupService = GroupService();

const validGroup = (overrides = {}) => ({
  ownerUserId: 1,
  name: 'Paseo',
  color: '#ED1651', // uno de los 8 gratuitos
  ...overrides,
});

describe('groups.service color gating', () => {
  beforeEach(() => {
    isUserPro.mockReset();
    createGroupsModel.mockClear();
    getMembershipModel.mockReset();
    getMembershipModel.mockResolvedValue({ isMember: true, isOwner: true });
    getByIdGroupsModel.mockResolvedValue({ id: 1, owneruserid: 1 });
  });

  it('allows a free-palette color regardless of Pro status', async () => {
    isUserPro.mockResolvedValue(false);
    await expect(groupService.create(validGroup())).resolves.toBeDefined();
    expect(isUserPro).not.toHaveBeenCalled();
  });

  it('rejects a custom color for a free user', async () => {
    isUserPro.mockResolvedValue(false);
    await expect(groupService.create(validGroup({ color: '#123ABC' })))
      .rejects.toMatchObject({ statusCode: 403, code: 'PRO_REQUIRED' });
  });

  it('allows a custom color for a Pro user', async () => {
    isUserPro.mockResolvedValue(true);
    await expect(groupService.create(validGroup({ color: '#123ABC' }))).resolves.toBeDefined();
  });

  it('applies the same rule on edit', async () => {
    isUserPro.mockResolvedValue(false);
    await expect(groupService.editById(1, validGroup({ color: '#123ABC' }), 1))
      .rejects.toMatchObject({ statusCode: 403, code: 'PRO_REQUIRED' });
  });
});

// Antes de este audit, ninguna de estas funciones verificaba que quien
// pregunta sea dueño o participante del grupo: cualquier usuario
// logueado podía leer/editar/borrar el grupo de cualquier otro con
// solo saber (o adivinar) el id.
describe('groups.service authorization', () => {
  beforeEach(() => {
    getMembershipModel.mockReset();
    getByIdGroupsModel.mockReset();
    getByIdGroupsModel.mockResolvedValue({ id: 1, owneruserid: 1 });
    isUserPro.mockResolvedValue(false);
  });

  it('getById hides the group from a non-member as "not found", not "forbidden"', async () => {
    getMembershipModel.mockResolvedValue({ isMember: false, isOwner: false });
    await expect(groupService.getById(1, 999)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('getById returns the group for a member', async () => {
    getMembershipModel.mockResolvedValue({ isMember: true, isOwner: false });
    await expect(groupService.getById(1, 2)).resolves.toMatchObject({ id: 1 });
  });

  it('editById rejects a member who is not the owner', async () => {
    getMembershipModel.mockResolvedValue({ isMember: true, isOwner: false });
    await expect(groupService.editById(1, validGroup(), 2)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('editById allows the owner', async () => {
    getMembershipModel.mockResolvedValue({ isMember: true, isOwner: true });
    await expect(groupService.editById(1, validGroup(), 1)).resolves.toBeDefined();
  });

  it('removeById rejects a non-owner member', async () => {
    getMembershipModel.mockResolvedValue({ isMember: true, isOwner: false });
    await expect(groupService.removeById(1, 2)).rejects.toMatchObject({ statusCode: 403 });
    expect(deleteGroupsModel).not.toHaveBeenCalled();
  });

  it('getParticipants rejects a non-member', async () => {
    getMembershipModel.mockResolvedValue({ isMember: false, isOwner: false });
    await expect(groupService.getParticipants(1, 999)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('addParticipants rejects a non-owner member', async () => {
    getMembershipModel.mockResolvedValue({ isMember: true, isOwner: false });
    await expect(groupService.addParticipants(1, [3], 2)).rejects.toMatchObject({ statusCode: 403 });
  });
});
