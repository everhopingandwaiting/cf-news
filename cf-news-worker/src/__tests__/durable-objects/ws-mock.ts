/**
 * Shared WebSocket + Response stubs for Durable Object tests.
 *
 * Durable Objects use `new WebSocketPair()` and return `Response(null, { status: 101 })`
 * for WS upgrades — neither exists in the vitest node runtime. This helper provides:
 *   - WebSocketPair: captures the server-side WS (records sends, exposes listeners)
 *   - Response 101 patch: node's Response rejects 101, so we intercept and return a
 *     plain object with a status property when 101 is requested.
 */

export interface MockWsServer {
  sent: (string | ArrayBuffer)[];
  listeners: Record<string, ((event: { data?: string | ArrayBuffer }) => void)[]>;
  accept: () => void;
  send: (data: string | ArrayBuffer) => void;
  addEventListener: (type: string, cb: (event: { data?: string | ArrayBuffer }) => void) => void;
  close: () => void;
  readyState: number;
}

const ORIGINAL_RESPONSE = globalThis.Response;

export function setupWsPair(): { server: MockWsServer } {
  const server: MockWsServer = {
    sent: [],
    listeners: {},
    readyState: 1,
    accept: () => {},
    send: (data: string | ArrayBuffer) => { server.sent.push(data); },
    addEventListener: (type, cb) => {
      (server.listeners[type] ??= []).push(cb);
    },
    close: () => {},
  };
  const client: any = {
    addEventListener: () => {},
    close: () => {},
  };
  (globalThis as any).WebSocketPair = class { constructor() { return { 0: client, 1: server }; } };
  return { server };
}

export function emit(server: MockWsServer, type: string, data?: string | ArrayBuffer) {
  for (const cb of server.listeners[type] ?? []) cb({ data });
}

/** Patch Response so DO WS upgrades (status 101) don't throw in the node runtime. */
export function patchResponseFor101() {
  class PatchedResponse extends ORIGINAL_RESPONSE {
    constructor(body?: BodyInit | null, init?: ResponseInit) {
      // node's Response rejects 101 as an invalid status; the DO code only uses
      // this Response for the WS upgrade handshake and ignores its status, so we
      // substitute 200. Tests assert on the captured server WS, not this status.
      super(body, init?.status === 101 ? { ...init, status: 200 } : init);
    }
  }
  (globalThis as any).Response = PatchedResponse;
}

export function unpatchResponse() {
  (globalThis as any).Response = ORIGINAL_RESPONSE;
}
