import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { CommentsRoom } from '../../durable-objects/comments';
import { MockD1 } from '../mock-d1';
import { resetDb } from '../../db';
import { setupWsPair, emit, patchResponseFor101, unpatchResponse, MockWsServer } from './ws-mock';

let db: MockD1;

function jsonSent(server: MockWsServer): any[] {
  return server.sent.filter((s): s is string => typeof s === 'string').map(s => JSON.parse(s));
}

describe('CommentsRoom', () => {
  beforeAll(async () => {
    resetDb();
    patchResponseFor101();
  });

  afterAll(() => {
    unpatchResponse();
  });

  beforeEach(() => {
    resetDb(); // getDb caches the first MockD1; reset so each test binds a fresh one
    db = new MockD1();
  });

  async function makeRoom(params: string): Promise<{ room: CommentsRoom; server: MockWsServer }> {
    resetDb(); // ensure getDb binds to the current `db` before the room writes
    const { server } = setupWsPair();
    const room = new CommentsRoom({} as any, { DB: db } as any);
    await room.fetch(new Request(`http://localhost/api/comments/ws?${params}`));
    return { room, server };
  }

  it('returns 401 when uid or newsId is missing', async () => {
    const room = new CommentsRoom({} as any, { DB: db } as any);
    const res = await room.fetch(new Request('http://localhost/api/comments/ws'));
    expect(res.status).toBe(401);
  });

  it('pushes initial comments on connect', async () => {
    await db.seed('users', [
      { id: 1, email: 'alice@test.com', password_hash: 'x', username: 'alice' },
    ]);
    await db.seed('news_comments', [
      { id: 1, news_id: 1, user_id: 1, content: 'First', is_deleted: 0 },
    ]);
    const { server } = await makeRoom('newsId=1&uid=1&username=alice');
    const initial = jsonSent(server)[0];
    expect(initial.type).toBe('comments');
    expect(initial.comments).toHaveLength(1);
    expect(initial.comments[0].content).toBe('First');
  });

  it('broadcasts a new_comment when a create message arrives', async () => {
    await db.seed('users', [
      { id: 1, email: 'alice@test.com', password_hash: 'x', username: 'alice' },
    ]);
    const { server } = await makeRoom('newsId=1&uid=1&username=alice');
    emit(server, 'message', JSON.stringify({ type: 'create', content: 'Hello!' }));
    // Allow the async handler to run
    await new Promise(r => setTimeout(r, 20));
    const broadcast = jsonSent(server).find(m => m.type === 'new_comment');
    expect(broadcast).toBeTruthy();
    expect(broadcast!.comment.content).toBe('Hello!');
    expect(broadcast!.comment.username).toBe('alice');
  });

  it('ignores empty create content', async () => {
    const { server } = await makeRoom('newsId=1&uid=1&username=alice');
    emit(server, 'message', JSON.stringify({ type: 'create', content: '   ' }));
    await new Promise(r => setTimeout(r, 20));
    expect(jsonSent(server).filter(m => m.type === 'new_comment')).toHaveLength(0);
  });

  it('broadcasts delete only when the deleter owns the comment', async () => {
    await db.seed('news_comments', [
      { id: 5, news_id: 1, user_id: 1, content: 'Mine', is_deleted: 0 },
      { id: 6, news_id: 1, user_id: 2, content: 'Other', is_deleted: 0 },
    ]);
    const { server } = await makeRoom('newsId=1&uid=1&username=alice');

    // uid=1 deleting comment 6 (owned by uid=2) must NOT broadcast
    emit(server, 'message', JSON.stringify({ type: 'delete', commentId: 6 }));
    await new Promise(r => setTimeout(r, 20));
    expect(jsonSent(server).filter(m => m.type === 'delete')).toHaveLength(0);

    // uid=1 deleting comment 5 (own) must broadcast
    emit(server, 'message', JSON.stringify({ type: 'delete', commentId: 5 }));
    await new Promise(r => setTimeout(r, 20));
    const del = jsonSent(server).find(m => m.type === 'delete');
    expect(del).toBeTruthy();
    expect(del!.commentId).toBe(5);
  });

  it('marks the deleted row in the database', async () => {
    await db.seed('news_comments', [
      { id: 7, news_id: 1, user_id: 1, content: 'To delete', is_deleted: 0 },
    ]);
    const { server } = await makeRoom('newsId=1&uid=1&username=alice');
    emit(server, 'message', JSON.stringify({ type: 'delete', commentId: 7 }));
    await new Promise(r => setTimeout(r, 20));
    const row = await db.prepare('SELECT is_deleted FROM news_comments WHERE id = 7').first<any>();
    expect(row?.is_deleted).toBe(1);
  });
});
