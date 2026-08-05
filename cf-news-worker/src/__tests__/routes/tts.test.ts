import { describe, it, expect, vi } from 'vitest';
import ttsRoutes from '../../routes/tts';

async function ttsRequest(path: string) {
  const res = await ttsRoutes.fetch(new Request(`http://localhost${path}`));
  return res;
}

describe('TTS proxy', () => {
  it('returns 400 when text is missing', async () => {
    const res = await ttsRequest('/tts');
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty text', async () => {
    const res = await ttsRequest('/tts?text=%20%20');
    expect(res.status).toBe(400);
  });

  it('returns 400 for text over 500 chars', async () => {
    const res = await ttsRequest(`/tts?text=${'a'.repeat(501)}`);
    expect(res.status).toBe(400);
  });

  it('returns audio/mpeg from Google TTS', async () => {
    vi.stubGlobal('fetch', async () => new Response('audio-bytes', { status: 200 }));
    const res = await ttsRequest('/tts?text=hello');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(res.headers.get('Cache-Control')).toContain('max-age=3600');
    const body = await res.arrayBuffer();
    expect(new TextDecoder().decode(body)).toBe('audio-bytes');
  });

  it('returns 502 when upstream Google TTS fails', async () => {
    vi.stubGlobal('fetch', async () => new Response('oops', { status: 500 }));
    const res = await ttsRequest('/tts?text=hello');
    expect(res.status).toBe(502);
  });

  it('returns 500 when fetch throws', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('network error'); });
    const res = await ttsRequest('/tts?text=hello');
    expect(res.status).toBe(500);
  });

  it('selects zh-CN for Chinese text and en otherwise', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: any) => {
      calls.push(String(input));
      return new Response('audio', { status: 200 });
    });
    await ttsRequest('/tts?text=%E4%BD%A0%E5%A5%BD');
    await ttsRequest('/tts?text=hello');
    expect(calls[0]).toContain('tl=zh-CN');
    expect(calls[1]).toContain('tl=en');
  });
});
