import { Bindings } from '../types';

interface DeviceInfo {
    device_type: string;
    browser: string;
    os: string;
}

function parseUserAgent(ua: string): DeviceInfo {
    let device_type = 'desktop';
    let browser = 'Unknown';
    let os = 'Unknown';

    if (/Mobile|Android|iPhone|iPad/.test(ua)) device_type = 'mobile';
    else if (/Tablet|iPad/.test(ua)) device_type = 'tablet';

    if (/Chrome/.test(ua) && !/Edg/.test(ua)) browser = 'Chrome';
    else if (/Safari/.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
    else if (/Firefox/.test(ua)) browser = 'Firefox';
    else if (/Edg/.test(ua)) browser = 'Edge';

    if (/Windows/.test(ua)) os = 'Windows';
    else if (/Mac OS/.test(ua)) os = 'macOS';
    else if (/Linux/.test(ua)) os = 'Linux';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/iPhone|iPad/.test(ua)) os = 'iOS';

    return { device_type, browser, os };
}

export async function logVisitor(
    env: Bindings,
    request: Request,
    path: string,
    responseStatus: number,
    responseTimeMs: number,
    userId?: number
): Promise<void> {
    try {
        const ip = request.headers.get('cf-connecting-ip') ||
                   request.headers.get('x-real-ip') ||
                   request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                   'unknown';
        const userAgent = request.headers.get('user-agent') || '';
        const referer = request.headers.get('referer') || '';
        const country = request.headers.get('cf-ipcountry') || '';
        const { device_type, browser, os } = parseUserAgent(userAgent);

        await env.DB.prepare(
            `INSERT INTO visitor_logs (ip, path, method, user_agent, referer, country, device_type, browser, os, user_id, response_status, response_time_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            ip,
            path,
            request.method,
            userAgent.substring(0, 500),
            referer.substring(0, 500),
            country,
            device_type,
            browser,
            os,
            userId || null,
            responseStatus,
            responseTimeMs
        ).run();
    } catch (e) {
        console.error('Analytics log error:', e);
    }
}
