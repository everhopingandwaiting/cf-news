import { describe, it, expect, beforeAll, vi } from 'vitest';
import { handleImageProxy } from '../../routes/image';
import { MOCK_ENV } from '../helpers';

describe('Image proxy handler', () => {
  it('returns null when no url param', async () => {
    const req = new Request('http://localhost/api/image');
    const res = await handleImageProxy(req, MOCK_ENV as any);
    expect(res).toBeNull();
  });

  it('proxies external image successfully', async () => {
    vi.stubGlobal('fetch', async () => new Response('image-data', {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }));
    const req = new Request('http://localhost/api/image?url=https://example.com/img.png');
    const res = await handleImageProxy(req, MOCK_ENV as any);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get('Content-Type')).toBe('image/png');
    expect(res!.headers.get('Cache-Control')).toContain('max-age=86400');
  });

  it('returns 502 on fetch failure', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('network error'); });
    const req = new Request('http://localhost/api/image?url=https://example.com/bad.png');
    const res = await handleImageProxy(req, MOCK_ENV as any);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(502);
  });
});
