import { Bindings } from '../types';
import { getConfig, getConfigInt, getModels, getProviderInfo, getProviderOrder, markFailed, AIOptions } from './aiProvider';

async function doOpenAICompatStream(
    env: Bindings, provider: string, baseUrl: string, apiKey: string,
    model: string, messages: { role: string; content: string }[],
    options?: { max_tokens?: number; temperature?: number }
): Promise<ReadableStream | null> {
    const maxTokens = options?.max_tokens ?? (await getConfigInt(env, 'summary_max_tokens', 300));
    const temp = options?.temperature ?? parseFloat(await getConfig(env, 'summary_temperature') || '0.3');
    try {
        const url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: temp, stream: true }),
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok || !res.body) {
            const errText = await res.text().catch(() => '');
            console.error(`${provider}/${model} stream error ${res.status}: ${errText}`);
            await markFailed(env, model, provider);
            return null;
        }
        const reader = res.body.getReader();
        const encoder = new TextEncoder();
        return new ReadableStream({
            async pull(controller) {
                try {
                    const { done, value } = await reader.read();
                    if (done) { controller.close(); return; }
                    controller.enqueue(value);
                } catch (e) {
                    console.error(`${provider}/${model} stream read error:`, e);
                    controller.close();
                }
            },
            cancel() { reader.cancel().catch(() => {}); },
        });
    } catch (e: any) {
        console.error(`${provider}/${model} stream exception:`, e);
        await markFailed(env, model, provider);
        return null;
    }
}

async function doCFStream(
    env: Bindings, model: string, messages: { role: string; content: string }[],
    options?: { max_tokens?: number; temperature?: number }
): Promise<ReadableStream | null> {
    const maxTokens = options?.max_tokens ?? (await getConfigInt(env, 'summary_max_tokens', 300));
    const temp = options?.temperature ?? parseFloat(await getConfig(env, 'summary_temperature') || '0.3');
    try {
        const stream = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature: temp, stream: true }) as ReadableStream;
        if (!stream) return null;
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        return new ReadableStream({
            async start(controller) {
                const reader = stream.getReader();
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const text = decoder.decode(value, { stream: true });
                        try {
                            const json = JSON.parse(text);
                            const content = json.response || '';
                            if (content) {
                                const sse = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
                                controller.enqueue(encoder.encode(sse));
                            }
                        } catch { /* skip malformed chunks */ }
                    }
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                } finally {
                    reader.releaseLock();
                }
                controller.close();
            }
        });
    } catch (e: any) {
        console.error(`cloudflare/${model} stream exception:`, e);
        await markFailed(env, model, 'cloudflare');
        return null;
    }
}

export async function callAIStream(
    env: Bindings, prompt: string, options?: AIOptions
): Promise<ReadableStream | null> {
    const messages = options?.system_prompt
        ? [{ role: 'system', content: options.system_prompt }, { role: 'user', content: prompt }]
        : [{ role: 'user', content: prompt }];

    const order = await getProviderOrder(env);

    for (const provider of order) {
        if (provider === 'cloudflare') {
            const models = await getModels(env, 'cloudflare');
            for (const model of models) {
                const result = await doCFStream(env, model, messages, options);
                if (result) return result;
            }
        } else {
            const info = await getProviderInfo(env, provider);
            if (!info) continue;
            const models = await getModels(env, provider);
            for (const model of models) {
                const result = await doOpenAICompatStream(env, provider, info.base_url, info.api_key, model, messages, options);
                if (result) return result;
            }
        }
    }
    return null;
}
