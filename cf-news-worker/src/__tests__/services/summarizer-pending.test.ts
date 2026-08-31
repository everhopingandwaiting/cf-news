import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockD1 } from '../mock-d1';
import { resetDb } from '../../db';
import { generatePendingSummaries } from '../../services/summarizer';
import type { Bindings } from '../../types';

// Mock the two external boundaries so the cron path runs fully offline:
//  - fetchRichArticleContent: short-article enrichment (real fetch would hit network)
//  - callAI: batch summary generation (real AI provider would hit network)
const fetchRichMock = vi.hoisted(() => vi.fn());
const callAIMock = vi.hoisted(() => vi.fn());

vi.mock('../../services/contentFetcher', () => ({
  fetchRichArticleContent: fetchRichMock,
}));
vi.mock('../../services/aiProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/aiProvider')>();
  return { ...actual, callAI: callAIMock };
});

import { callAI } from '../../services/aiProvider';

let db: MockD1;

function makeEnv(overrides: Record<string, any> = {}): Bindings {
  return {
    DB: db,
    AI: { run: async () => ({ response: 'mock ai' }) },
    ...overrides,
  } as unknown as Bindings;
}

async function seedNewsItem(overrides: Record<string, any>) {
  await db.seed('news_items', [{
    source_id: 1,
    title: 't',
    url: 'https://example.com/short',
    content: null,
    description: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }]);
}

describe('generatePendingSummaries filtering', () => {
  beforeEach(() => {
    resetDb();
    db = new MockD1();
    fetchRichMock.mockReset();
    callAIMock.mockReset();
    // default callAI returns a valid batch result for any article count
    callAIMock.mockImplementation(async (_env: any, _prompt: string, _opts?: any) => {
      return JSON.stringify([{ summary: '摘要' }]);
    });
    // default enrichment returns nothing (source not enriched)
    fetchRichMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('enriches only short articles (<300 chars each) and keeps them out of the batch', async () => {
    // short article needing enrichment
    await seedNewsItem({ title: 'short', url: 'https://example.com/short', content: 'x'.repeat(50), description: null });
    fetchRichMock.mockResolvedValue({ html: '<p>full</p>', text: 'full content '.repeat(40) });

    await generatePendingSummaries(makeEnv());

    // Only one short item was enriched via fetch
    expect(fetchRichMock).toHaveBeenCalledTimes(1);

    // The enriched item should have its content updated in the DB
    // (content holds rich.html; description holds rich.text — see summarizer enrichment)
    const { results: rows } = await db.prepare('SELECT id, content, description FROM news_items').all();
    expect(rows.length).toBe(1);
    expect(rows[0].content).toContain('<p>full</p>');
    expect(rows[0].description).toContain('full content');

    // callAI (batch path) must NOT be called for the short article — after enrichment
    // it is no longer "pending" (no summary row) but still <300 was the point: it was handled by enrichment.
    // With only a short article present, there are no >=300 items, so no batch call.
    expect(callAI).not.toHaveBeenCalled();
  });

  it('passes only >=300-char articles into the batch path', async () => {
    // short article (enrichment target, enriches to >=300 as well — but it's separate)
    await seedNewsItem({ title: 'short', url: 'https://example.com/short', content: 'x'.repeat(50), description: null });
    // long article that qualifies for batch
    await seedNewsItem({ title: 'long', url: 'https://example.com/long', content: 'y'.repeat(400), description: null });

    fetchRichMock.mockResolvedValue(null); // enrichment does not enrich

    await generatePendingSummaries(makeEnv());

    // The long article should go through callAI (batch), the short one only through enrichment attempt.
    expect(fetchRichMock).toHaveBeenCalledTimes(1);
    expect(callAI).toHaveBeenCalled();
  });
});
