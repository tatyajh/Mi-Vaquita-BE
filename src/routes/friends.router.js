import Router from 'express-promise-router';
import { getFriendsController, addFriendController, deleteFriendController } from '../controllers/friends.controller.js';

const router = Router();

router.get('/', getFriendsController);
router.post('/addFriend', addFriendController);
router.delete('/deleteFriend/:friendId', deleteFriendController);

export default router;
