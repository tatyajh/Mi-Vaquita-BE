import FriendsService from '../services/friends.service.js';
import { StatusCodes } from 'http-status-codes';
import { validateFriend, ConflictException } from '../validations/friends.validations.js';

const friendsService = FriendsService();

export const getFriendsController = async (req, res) => {
  try {
    const friends = await friendsService.getFriends(req.userId);
    res.status(StatusCodes.OK).json(friends);
  } catch (error) {
    console.error('Error getting friends:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Ocurrió un error. Intenta de nuevo.' });
  }
};

export const addFriendController = async (req, res) => {
  // El userId siempre sale del JWT, nunca del body: si se confiara en
  // req.body.userId cualquiera podía agregar amigos a nombre de otro
  // usuario con solo cambiar ese campo en la petición.
  const userId = req.userId;
  const { friendUserId } = req.body;
  const { error } = validateFriend({ userId, friendUserId });
  if (error) {
    return res.status(StatusCodes.BAD_REQUEST).json({ message: error.details[0].message });
  }
  if (Number(friendUserId) === Number(userId)) {
    return res.status(StatusCodes.BAD_REQUEST).json({ message: 'No puedes agregarte a ti mismo como amigo.' });
  }
  try {
    const newFriend = await friendsService.addFriend(userId, friendUserId);
    res.status(StatusCodes.CREATED).json(newFriend);
  } catch (error) {
    if (error instanceof ConflictException) {
      return res.status(StatusCodes.CONFLICT).json({ message: 'Ya son amigos' });
    }
    console.error('Error adding friend:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Ocurrió un error. Intenta de nuevo.' });
  }
};

export const deleteFriendController = async (req, res) => {
  const { friendId } = req.params;
  try {
    // Se exige que la fila de "friends" pertenezca al usuario
    // autenticado (req.userId): sin esto, cualquiera con sesión podía
    // borrar la relación de amistad de cualquier otra persona con solo
    // adivinar/incrementar el id.
    const deleted = await friendsService.deleteFriend(friendId, req.userId);
    if (!deleted) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: 'Friend not found' });
    }
    res.status(StatusCodes.NO_CONTENT).send();
  } catch (error) {
    console.error('Error deleting friend:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Ocurrió un error. Intenta de nuevo.' });
  }
};
