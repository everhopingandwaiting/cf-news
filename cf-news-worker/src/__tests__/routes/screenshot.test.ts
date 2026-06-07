import { describe, it, expect } from 'vitest';
import { handleScreenshot } from '../../routes/screenshot';
import { MOCK_ENV } from '../helpers';

describe('Screenshot handler', () => {
  it('returns null when no url param', async () => {
    const req = new Request('http://localhost/api/screenshot');
    const res = await handleScreenshot(req, MOCK_ENV as any);
    expect(res).toBeNull();
  });

  it('calls Browser Rendering and returns image', async () => {
    const env = {
      ...MOCK_ENV,
      BROWSER: {
        fetch: async () => new Response('screenshot-data', { status: 200, headers: { 'Content-Type': 'image/png' } }),
      },
    };
    const req = new Request('http://localhost/api/screenshot?url=https://example.com');
    const res = await handleScreenshot(req, env as any);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get('Content-Type')).toBe('image/png');
  });

  it('returns 502 when Browser Rendering fails', async () => {
    const env = {
      ...MOCK_ENV,
      BROWSER: {
        fetch: async () => new Response('error', { status: 500 }),
      },
    };
    const req = new Request('http://localhost/api/screenshot?url=https://example.com');
    const res = await handleScreenshot(req, env as any);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(502);
  });
});
