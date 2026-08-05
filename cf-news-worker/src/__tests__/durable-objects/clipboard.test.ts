import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ClipboardRoom } from '../../durable-objects/clipboard';
import { setupWsPair, emit, patchResponseFor101, unpatchResponse, MockWsServer } from './ws-mock';

/** In-memory DurableObjectStorage mock (put/get/list/delete/setAlarm). */
class MockStorage {
  private data = new Map<string, string>();
  alarms: number[] = [];

  async put(key: string, value: string) { this.data.set(key, value); }
  async get<T>(key: string): Promise<T | null> { return (this.data.get(key) as T) ?? null; }
  async list(opts?: { prefix?: string }): Promise<{ keys: () => string[] }> {
    const prefix = opts?.prefix ?? '';
    const keys = Array.from(this.data.keys()).filter(k => k.startsWith(prefix));
    return { keys: () => keys };
  }
  async delete(key: string) { this.data.delete(key); }
  async setAlarm(ms: number) { this.alarms.push(ms); }
}

let storage: MockStorage;

function makeRoom(): ClipboardRoom {
  return new ClipboardRoom({ storage } as any, {} as any);
}

async function connect(room: ClipboardRoom, deviceId: string, userId = 1): Promise<MockWsServer> {
  const { server } = setupWsPair();
  await room.fetch(new Request(`http://localhost/api/clipboard/ws?uid=${userId}&device_id=${deviceId}&device_name=dev-${deviceId}`));
  return server;
}

function jsonSent(server: MockWsServer): any[] {
  return server.sent.filter((s): s is string => typeof s === 'string').map(s => JSON.parse(s));
}

function sentTypes(server: MockWsServer): string[] {
  return jsonSent(server).map(m => m.type);
}

describe('ClipboardRoom', () => {
  beforeAll(() => { patchResponseFor101(); });
  afterAll(() => { unpatchResponse(); });

  beforeEach(() => {
    storage = new MockStorage();
  });

  it('returns 401 when uid is missing', async () => {
    const room = makeRoom();
    const res = await room.fetch(new Request('http://localhost/api/clipboard/ws'));
    expect(res.status).toBe(401);
  });

  it('sends presence_update on connect', async () => {
    const room = makeRoom();
    const a = await connect(room, 'A');
    expect(sentTypes(a)).toContain('presence_update');
    const presence = jsonSent(a).find(m => m.type === 'presence_update');
    expect(presence.devices).toHaveLength(1);
    expect(presence.devices[0].deviceId).toBe('A');
  });

  it('broadcasts text from device A to device B', async () => {
    const room = makeRoom();
    const a = await connect(room, 'A');
    const b = await connect(room, 'B');
    emit(a, 'message', JSON.stringify({ type: 'text', content: 'hello' }));
    const bText = jsonSent(b).find(m => m.type === 'text');
    expect(bText).toBeTruthy();
    expect(bText!.content).toBe('hello');
  });

  it('does not echo text back to the sender', async () => {
    const room = makeRoom();
    const a = await connect(room, 'A');
    const b = await connect(room, 'B');
    emit(a, 'message', JSON.stringify({ type: 'text', content: 'no-echo' }));
    expect(jsonSent(a).filter(m => m.type === 'text')).toHaveLength(0);
  });

  it('does not broadcast between devices with the same deviceId', async () => {
    const room = makeRoom();
    const a1 = await connect(room, 'X');
    const a2 = await connect(room, 'X'); // same deviceId, two tabs
    emit(a1, 'message', JSON.stringify({ type: 'text', content: 'same-device' }));
    expect(jsonSent(a2).filter(m => m.type === 'text')).toHaveLength(0);
  });

  it('persists sync_clipboard to storage', async () => {
    const room = makeRoom();
    const a = await connect(room, 'A');
    const syncMsg = JSON.stringify({ type: 'sync_clipboard', content: 'push-me' });
    emit(a, 'message', syncMsg);
    await new Promise(r => setTimeout(r, 20));
    const stored = await storage.get<string>('sync:1');
    expect(stored).toBe(syncMsg);
    expect(storage.alarms.length).toBeGreaterThan(0);
  });

  it('replays pending sync to a newly connected device', async () => {
    const room = makeRoom();
    const a = await connect(room, 'A');
    emit(a, 'message', JSON.stringify({ type: 'sync_clipboard', content: 'replay-me' }));
    await new Promise(r => setTimeout(r, 20));

    const b = await connect(room, 'B');
    const replayed = jsonSent(b).find(m => m.type === 'sync_clipboard');
    expect(replayed).toBeTruthy();
    expect(replayed!.content).toBe('replay-me');
  });

  it('cleans sync keys when the alarm fires', async () => {
    const room = makeRoom();
    const a = await connect(room, 'A');
    emit(a, 'message', JSON.stringify({ type: 'sync_clipboard', content: 'old' }));
    await new Promise(r => setTimeout(r, 20));
    await room.alarm();
    const stored = await storage.get<string>('sync:1');
    expect(stored).toBeNull();
  });

  it('answers heartbeat with heartbeat_ack', async () => {
    const room = makeRoom();
    const a = await connect(room, 'A');
    emit(a, 'message', JSON.stringify({ type: 'heartbeat' }));
    expect(a.sent).toContain('{"type":"heartbeat_ack"}');
  });

  it('rejects oversized text messages', async () => {
    const room = makeRoom();
    const a = await connect(room, 'A');
    const b = await connect(room, 'B');
    emit(a, 'message', JSON.stringify({ type: 'text', content: 'x'.repeat(200_001) }));
    await new Promise(r => setTimeout(r, 20));
    expect(jsonSent(b).filter(m => m.type === 'text')).toHaveLength(0);
  });

  it('routes file_accept back to the sender only', async () => {
    const room = makeRoom();
    const sender = await connect(room, 'S');
    const receiver = await connect(room, 'R');
    emit(sender, 'message', JSON.stringify({
      type: 'file_offer', transferId: 't1', fileName: 'f.txt', fileSize: 10,
      totalChunks: 1, transport: 'wss',
    }));
    await new Promise(r => setTimeout(r, 20));

    emit(receiver, 'message', JSON.stringify({ type: 'file_accept', transferId: 't1' }));
    await new Promise(r => setTimeout(r, 20));

    const acceptOnSender = jsonSent(sender).find(m => m.type === 'file_accept');
    expect(acceptOnSender).toBeTruthy();
    expect(acceptOnSender!.acceptedBy).toBe('R');
    // receiver must NOT get its own accept echoed
    expect(jsonSent(receiver).filter(m => m.type === 'file_accept')).toHaveLength(0);
  });

  it('rejects a second device trying to accept the same transfer', async () => {
    const room = makeRoom();
    const sender = await connect(room, 'S');
    const r1 = await connect(room, 'R1');
    const r2 = await connect(room, 'R2');
    emit(sender, 'message', JSON.stringify({
      type: 'file_offer', transferId: 't2', fileName: 'f.txt', fileSize: 10,
      totalChunks: 1, transport: 'wss',
    }));
    await new Promise(r => setTimeout(r, 20));

    emit(r1, 'message', JSON.stringify({ type: 'file_accept', transferId: 't2' }));
    await new Promise(r => setTimeout(r, 20));
    emit(r2, 'message', JSON.stringify({ type: 'file_accept', transferId: 't2' }));
    await new Promise(r => setTimeout(r, 20));

    const rejectOnR2 = jsonSent(r2).find(m => m.type === 'file_reject');
    expect(rejectOnR2).toBeTruthy();
  });

  it('relays binary frames to the other device', async () => {
    const room = makeRoom();
    const a = await connect(room, 'A');
    const b = await connect(room, 'B');
    // Reconstruct a small binary frame the way sendFileWss does
    const header = JSON.stringify({ t: 'fc', i: 't3', c: 0, tc: 1 });
    const headerBytes = new TextEncoder().encode(header);
    const frame = new ArrayBuffer(4 + headerBytes.byteLength + 4);
    const view = new DataView(frame);
    view.setUint32(0, headerBytes.byteLength, false);
    new Uint8Array(frame, 4, headerBytes.byteLength).set(headerBytes);
    new Uint8Array(frame, 4 + headerBytes.byteLength).set(new Uint8Array([1, 2, 3, 4]));

    emit(a, 'message', frame);
    expect(b.sent.length).toBeGreaterThan(0);
    const binary = b.sent[b.sent.length - 1];
    expect(typeof binary).toBe('object'); // ArrayBuffer-like passthrough
  });
});
