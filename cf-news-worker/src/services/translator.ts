import { Bindings } from '../types';

export async function translateText(env: Bindings, text: string, targetLang: string): Promise<string | null> {
    try {
        const result: any = await env.AI.run('@cf/meta/m2m100-1.2b', {
            text,
            source_lang: 'en',
            target_lang: targetLang,
        });
        console.log('Translation result:', JSON.stringify(result));
        return result?.translated_text || result?.translations?.[0] || null;
    } catch (e) {
        console.error('Translation error:', e);
        return null;
    }
}
