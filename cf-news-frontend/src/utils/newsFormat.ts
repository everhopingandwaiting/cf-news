export function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

export function estimateReadingTime(html: string): number {
    const text = stripHtml(html);
    const zhChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const enWords = (text.match(/\b[a-z]+\b/gi) || []).length;
    return Math.max(1, Math.ceil(zhChars / 300 + enWords / 200));
}

const EVIL_ATTR_RE = /on\w+\s*=\s*["'][^"']*["']/gi;
export function sanitizeHtml(html: string): string {
  let safe = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?\/?>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<link[\s\S]*?\/?>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<input[\s\S]*?\/?>/gi, '')
    .replace(/<textarea[\s\S]*?<\/textarea>/gi, '')
    .replace(EVIL_ATTR_RE, '');
  safe = safe.replace(/<img\s/gi, '<img referrerpolicy="no-referrer" ');
  safe = safe.replace(/<img\s[^>]*src="(https?:\/\/[^"]+)"[^>]*>/gi, (match, src) => {
    if (src.startsWith(window.location.origin)) return match;
    return match.replace(src, `/api/image?url=${encodeURIComponent(src)}`);
  });
  return safe;
}

export function formatTime(dateStr: string): string {
  if (!dateStr) return '';
  const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + '+08:00';
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return dateStr.substring(0, 16);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
