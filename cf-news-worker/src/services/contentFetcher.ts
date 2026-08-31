function extractText(html: string, title: string): string {
    let text = html;

    // Remove scripts and styles
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
    text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
    text = text.replace(/<header[\s\S]*?<\/header>/gi, '');

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, ' ');

    // Decode entities
    text = text.replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/');

    // Collapse whitespace
    text = text.replace(/\s+/g, ' ').trim();

    // Remove the title from the content (it's already stored separately)
    const titleIdx = text.indexOf(title);
    if (titleIdx >= 0 && titleIdx < 200) {
        text = text.substring(titleIdx + title.length);
    }

    // Find the first substantial paragraph - skip navigation/menus
    const lines = text.split(/(?<=[.!?])\s+/);
    let content = '';
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 40 && !trimmed.match(/^(home|about|contact|sign in|login|subscribe|advertisement|cookie)/i)) {
            content += trimmed + ' ';
        }
        if (content.length > 1500) break;
    }

    if (content.length < 100) {
        content = text;
    }

    return content.substring(0, 2000).trim();
}

export async function fetchArticleContent(url: string, title: string): Promise<string | null> {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; CFNewsReader/1.0)',
                'Accept': 'text/html',
            },
        });

        if (!response.ok) return null;

        const html = await response.text();
        const text = extractText(html, title);

        return text.length > 80 ? text : null;
    } catch (e) {
        console.error('Error fetching article content:', url, e);
        return null;
    }
}

// Fetch full article HTML content (preserves images, links, paragraphs)
export async function fetchRichArticleContent(url: string): Promise<{ html: string; text: string } | null> {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                'Accept': 'text/html',
            },
            // 源站挂起（接受连接但不返回）会无限阻塞 await fetch / response.text()，
            // 从而拖垮整个 summary cron invocation（曾导致 08-29 摘要彻底停摆，全天仅 5 次 AI 调用）。
            // 加 10s 超时：超时即 reject，由外层 catch 返回 null，绝不让单个源站卡死主流程。
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return null;
        const html = await response.text();

        // Remove scripts, styles, nav, footer, header
        let clean = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[\s\S]*?<\/header>/gi, '')
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
            .replace(/<svg[\s\S]*?<\/svg>/gi, '')
            .replace(/<form[\s\S]*?<\/form>/gi, '');

        // Try to find article element
        let articleHtml = '';
        const articleMatch = clean.match(/<article[\s\S]*?<\/article>/i);
        if (articleMatch) {
            articleHtml = articleMatch[0];
        } else {
            // Fallback: look for common content containers
            const contentSelectors = [
                /class="[^"]*article-body[^"]*"[\s\S]*?(?=<\/(?:div|section)>)/gi,
                /class="[^"]*post-content[^"]*"[\s\S]*?(?=<\/(?:div|section)>)/gi,
                /class="[^"]*entry-content[^"]*"[\s\S]*?(?=<\/(?:div|section)>)/gi,
                /class="[^"]*article-content[^"]*"[\s\S]*?(?=<\/(?:div|section)>)/gi,
                /id="[^"]*article[^"]*"[\s\S]*?(?=<\/(?:div|section)>)/gi,
            ];
            for (const sel of contentSelectors) {
                const m = clean.match(sel);
                if (m) { articleHtml = m[0]; break; }
            }
            if (!articleHtml) {
                // Just take body content
                const bodyMatch = clean.match(/<body[\s\S]*?<\/body>/i);
                articleHtml = bodyMatch ? bodyMatch[0] : clean;
            }
        }

        // Limit HTML size
        const finalHtml = articleHtml.length > 10000 ? articleHtml.substring(0, 10000) : articleHtml;

        // Plain text extract for description
        const text = articleHtml
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ').trim()
            .substring(0, 2000);

        return { html: finalHtml, text };
    } catch (e) {
        console.error('Error fetching rich content:', url, e);
        return null;
    }
}
