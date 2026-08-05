import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PipingRoom } from '../../durable-objects/piping';

function makeRoom(): PipingRoom {
  return new PipingRoom();
}

describe('PipingRoom', () => {
  let room: PipingRoom;

  beforeEach(() => {
    vi.restoreAllMocks();
    room = makeRoom();
  });

  it('rejects 405 for unsupported methods', async () => {
    const res = await room.fetch(new Request('http://localhost/api/piping/x', { method: 'POST' }));
    expect(res.status).toBe(405);
  });

  it('returns 400 for PUT without a body', async () => {
    const res = await room.fetch(new Request('http://localhost/api/piping/x', { method: 'PUT' }));
    expect(res.status).toBe(400);
  });

  it('pairs PUT body through to a GET download', async () => {
    const body = new TextEncoder().encode('file-content-123');
    const putPromise = room.fetch(new Request('http://localhost/api/piping/x', {
      method: 'PUT',
      body,
    }));

    const getRes = await room.fetch(new Request('http://localhost/api/piping/x', { method: 'GET' }));
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(getRes.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const downloaded = await getRes.arrayBuffer();
    expect(new TextDecoder().decode(downloaded)).toBe('file-content-123');

    const putRes = await putPromise;
    expect(putRes.status).toBe(200);
  });

  it('GET arriving first waits for the PUT to pair', async () => {
    const getPromise = room.fetch(new Request('http://localhost/api/piping/x', { method: 'GET' }));
    // Give the GET a tick to register its pending resolve before the PUT lands
    await new Promise(r => setTimeout(r, 20));

    const body = new TextEncoder().encode('late-upload');
    const putPromise = room.fetch(new Request('http://localhost/api/piping/x', {
      method: 'PUT',
      body,
    }));

    const getRes = await getPromise;
    expect(getRes.status).toBe(200);
    const downloaded = await getRes.arrayBuffer();
    expect(new TextDecoder().decode(downloaded)).toBe('late-upload');
    await putPromise;
  });

  it('rejects the upload when it exceeds the byte budget', async () => {
    // Override the private cap so the test doesn't need 100MB of data.
    (room as any).maxUploadBytes = 10;

    const bigBody = new TextEncoder().encode('this-is-more-than-ten-bytes');
    const putRes = await room.fetch(new Request('http://localhost/api/piping/x', {
      method: 'PUT',
      body: bigBody,
    }));
    expect(putRes.status).toBe(413);
  });

  it('cleans stale stream state after a failed upload so a later GET gets 504', async () => {
    vi.useFakeTimers();
    (room as any).maxUploadBytes = 5;
    const badBody = new TextEncoder().encode('oversized-bytes');
    const putRes = await room.fetch(new Request('http://localhost/api/piping/x', {
      method: 'PUT',
      body: badBody,
    }));
    expect(putRes.status).toBe(413);

    // After the failed PUT, the DO's readable should be nulled; a GET without a
    // partner must time out to 504 instead of receiving an errored stream.
    const getPromise = room.fetch(new Request('http://localhost/api/piping/x', { method: 'GET' }));
    await vi.advanceTimersByTimeAsync(60_001);
    const getRes = await getPromise;
    expect(getRes.status).toBe(504);
    vi.useRealTimers();
  });

  it('times out a GET with no pairing partner after the 60s window', async () => {
    vi.useFakeTimers();
    const getPromise = room.fetch(new Request('http://localhost/api/piping/x', { method: 'GET' }));
    await vi.advanceTimersByTimeAsync(60_001);
    const res = await getPromise;
    expect(res.status).toBe(504);
    vi.useRealTimers();
  });
});
