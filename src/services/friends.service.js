import FriendsModel from '../database/friends.model.js';
import { ConflictException } from '../validations/friends.validations.js';

const FriendsService = () => {
  const friendsModel = FriendsModel();

  const getFriends = async (userId) => {
    return friendsModel.getAllFriendsModel(userId);
  };

  const addFriend = async (userId, friendUserId) => {
    const existingFriend = await friendsModel.getByUserIdAndFriendUserId(userId, friendUserId);
    if (existingFriend) {
      throw new ConflictException('Friend already exists');
    }
    try {
      return await friendsModel.createFriendsModel({ userId, friendUserId });
    } catch (error) {
      // El índice único también protege dos solicitudes simultáneas.
      if (error?.code === '23505') {
        throw new ConflictException('Friend already exists');
      }
      throw error;
    }
  };

  const deleteFriend = async (friendId, userId) => {
    return friendsModel.deleteFriendsModel(friendId, userId);
  };

  return {
    getFriends,
    addFriend,
    deleteFriend,
  };
};

export default FriendsService;
