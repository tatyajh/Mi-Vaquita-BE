import Router from 'express-promise-router';
import { getFriendsController, addFriendController, deleteFriendController } from '../controllers/friends.controller.js';
import { authenticateJWT } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authenticateJWT);

router.get('/', getFriendsController);
router.post('/addFriend', addFriendController);
router.delete('/deleteFriend/:friendId', deleteFriendController);

export default router;
