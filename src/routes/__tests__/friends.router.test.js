import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// The controller (src/controllers/friends.controller.js) goes through
// FriendsService -> FriendsModel -> a real pg Pool (src/lib/connection.js),
// which needs live Supabase/Postgres credentials to do anything. We don't
// have working credentials in this environment, so we stub out the model
// layer that talks to the DB and exercise the real router + real
// controller on top of it. This still proves the actual bug fix: that a
// DELETE to /friends/deleteFriend/:friendId is routed to
// deleteFriendController and that the id arrives via req.params (not
// req.body), which is what was broken before.
jest.unstable_mockModule('../../database/friends.model.js', () => ({
  default: () => ({
    getAllFriendsModel: jest.fn(),
    getByUserIdAndFriendUserId: jest.fn(),
    createFriendsModel: jest.fn(),
    deleteFriendsModel: jest.fn(async (id) => {
      // Record what id the model layer actually received, so the test
      // can assert it came from req.params and not req.body.
      global.__lastDeletedId = id;
      return id === 'some-id-123';
    }),
  }),
}));

const { default: friendsRouter } = await import('../friends.router.js');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/friends', friendsRouter);
  return app;
};

describe('friends.router deleteFriend route', () => {
  beforeEach(() => {
    global.__lastDeletedId = undefined;
  });

  it('routes DELETE /friends/deleteFriend/:friendId to deleteFriendController with friendId in req.params', async () => {
    const app = buildApp();

    const res = await request(app).delete('/friends/deleteFriend/some-id-123');

    expect(res.status).toBe(204);
    // The controller reads `const { friendId } = req.params;` and passes
    // it straight to the (mocked) model. If the id had instead been read
    // from req.body (the old bug's mismatch), this would be undefined.
    expect(global.__lastDeletedId).toBe('some-id-123');
  });

  it('returns 404 when the friend id does not match any row', async () => {
    const app = buildApp();

    const res = await request(app).delete('/friends/deleteFriend/does-not-exist');

    expect(res.status).toBe(404);
    expect(global.__lastDeletedId).toBe('does-not-exist');
  });

  it('does NOT match the old buggy route shape (POST with no param)', async () => {
    // Before the fix, the route was:
    //   router.post('/deleteFriend', deleteFriendController)
    // which is a POST with no :friendId param at all — the frontend's
    // `apiClient.delete('/friends/deleteFriend/:friendId')` (a DELETE
    // with a path param) could never have matched it, hence the silent
    // 404. We demonstrate this here: hitting the OLD pattern's request
    // shape against the NEW (fixed) router also fails to match, because
    // the fixed router expects DELETE with a required :friendId segment.
    const app = buildApp();

    const res = await request(app).post('/friends/deleteFriend');

    expect(res.status).toBe(404);
  });

  it('still exposes DELETE only under the /:friendId path, not the bare path', async () => {
    const app = buildApp();

    const res = await request(app).delete('/friends/deleteFriend');

    // No :friendId segment supplied -> no matching route -> 404, proving
    // the param is required, mirroring how the frontend always calls it
    // with a concrete friendId.
    expect(res.status).toBe(404);
  });
});
