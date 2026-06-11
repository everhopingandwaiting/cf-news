import { Hono } from 'hono';

const tts = new Hono();

tts.get('/tts', async (c) => {
    const text = c.req.query('text');
    if (!text || text.trim().length === 0) {
        return c.json({ error: 'text is required' }, 400);
    }
    if (text.length > 500) {
        return c.json({ error: 'text too long, max 500 chars' }, 400);
    }

    const lang = /[\u4e00-\u9fa5]/.test(text) ? 'zh-CN' : 'en';
    const encodedText = encodeURIComponent(text);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=${lang}&client=tw-ob`;

    try {
        const resp = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://translate.google.com/',
            },
        });

        if (!resp.ok) {
            return c.json({ error: 'TTS request failed' }, 502);
        }

        const audioBuffer = await resp.arrayBuffer();
        return new Response(audioBuffer, {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Cache-Control': 'public, max-age=3600',
            },
        });
    } catch (e) {
        console.error('TTS error:', e);
        return c.json({ error: 'TTS generation failed' }, 500);
    }
});

export default tts;
