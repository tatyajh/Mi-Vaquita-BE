import { jest } from '@jest/globals';

// Cubre la regla nueva más delicada de groups.service.js: un color
// fuera de los 8 gratuitos solo se permite si el dueño del grupo es
// Pro — validado en el servicio (no solo en el picker del frontend)
// para que no baste con pegarle a la API directo.
const createGroupsModel = jest.fn(async (data) => ({ id: 1, ...data }));
const getByIdGroupsModel = jest.fn();
const updateGroupsModel = jest.fn(async (id, data) => ({ id, ...data }));
const isUserPro = jest.fn();

jest.unstable_mockModule('../../database/groups.model.js', () => ({
  default: () => ({
    getAllGroupsModel: jest.fn(),
    getGroupsForUserModel: jest.fn(),
    getByIdGroupsModel,
    createGroupsModel,
    updateGroupsModel,
    deleteGroupsModel: jest.fn(),
    addParticipants: jest.fn(),
    getParticipants: jest.fn(),
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
    getByIdGroupsModel.mockResolvedValue({ id: 1, owneruserid: 1 });
    isUserPro.mockResolvedValue(false);
    await expect(groupService.editById(1, validGroup({ color: '#123ABC' }), 1))
      .rejects.toMatchObject({ statusCode: 403, code: 'PRO_REQUIRED' });
  });
});
