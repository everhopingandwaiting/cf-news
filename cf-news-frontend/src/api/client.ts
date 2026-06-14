import axios from 'axios';
import type { NewsItem, NewsSource, NewsComment, Pagination, User, TimelineEvent, NewsRegion, CredibilityReport, RadarAlert, PerspectiveReport } from '../types';

const API_BASE = '';

const api = axios.create({ baseURL: API_BASE, timeout: 15000 });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export async function getNews(params: {
  page?: number;
  limit?: number;
  category?: string;
  source_id?: number;
  lang?: string;
  search?: string;
  has_summary?: string;
}): Promise<{ news: NewsItem[]; pagination: Pagination }> {
  const { data } = await api.get('/api/news', { params });
  return data;
}

export async function getNewsItem(id: number): Promise<NewsItem> {
  const { data } = await api.get(`/api/news/${id}`);
  return data.news;
}

export async function getSources(): Promise<NewsSource[]> {
  const { data } = await api.get('/api/news/sources/list');
  return data.sources;
}

export async function getComments(newsId: number): Promise<NewsComment[]> {
  const { data } = await api.get(`/api/comments/${newsId}`);
  return data.comments;
}

export async function postComment(newsId: number, content: string): Promise<void> {
  await api.post(`/api/comments/${newsId}`, { content });
}

export async function deleteComment(commentId: number): Promise<void> {
  await api.delete(`/api/comments/${commentId}`);
}

export async function login(email: string, password: string, turnstileToken?: string): Promise<{ token: string; user: User }> {
  const { data } = await api.post('/api/auth/login', { email, password, turnstileToken });
  return data;
}

export async function register(username: string, email: string, password: string, turnstileToken?: string): Promise<void> {
  await api.post('/api/auth/register', { username, email, password, turnstileToken });
}

export async function getMe(): Promise<User> {
  const { data } = await api.get('/api/auth/me');
  return data.user;
}

export async function addFavorite(newsId: number): Promise<void> {
  await api.post(`/api/user/favorites/${newsId}`);
}

export async function removeFavorite(newsId: number): Promise<void> {
  await api.delete(`/api/user/favorites/${newsId}`);
}

export async function getFavorites(): Promise<NewsItem[]> {
  const { data } = await api.get('/api/user/favorites');
  return data.favorites;
}

export async function addHistory(newsId: number): Promise<void> {
  await api.post(`/api/user/history/${newsId}`);
}

export async function triggerFetch(): Promise<void> {
  await api.post('/api/fetch');
}

export async function triggerSummarize(ids?: number[]): Promise<{ generated: number }> {
  const { data } = await api.post('/api/summarize', ids ? { ids } : {});
  return data;
}

export async function triggerSummarizeOne(newsId: number): Promise<{ generated: number }> {
  const { data } = await api.post(`/api/summarize/${newsId}`);
  return data;
}

export async function triggerTake(newsId: number): Promise<{ take: string | null }> {
  const { data } = await api.post(`/api/take/${newsId}`);
  return data;
}

export async function triggerIllustration(newsId: number): Promise<{ image_url: string }> {
  const { data } = await api.post(`/api/illustrate/${newsId}`);
  return data;
}

export async function translateText(text: string, lang: string): Promise<string | null> {
  try {
    const { data } = await api.post('/api/translate', { text, lang });
    return data.translated || null;
  } catch {
    return null;
  }
}

export async function askQuestion(question: string): Promise<{ answer: string; chunks?: any[] }> {
  const { data } = await api.post('/api/ai/ask', { question, stream: false });
  return data;
}

export async function askQuestionStream(question: string): Promise<Response> {
  return fetch('/api/ai/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
    body: JSON.stringify({ question, stream: true }),
  });
}

export async function getDailyDigest(date?: string): Promise<{ digest: import('../types').DailyDigest | null }> {
  const { data } = await api.get('/api/ai/digest', { params: date ? { date } : {} });
  return data;
}

export async function getDigestDates(): Promise<string[]> {
  const { data } = await api.get('/api/ai/digest/dates');
  return data.dates || [];
}

export async function getRelatedArticles(newsId: number): Promise<{ related: import('../types').RelatedArticle[] }> {
  const { data } = await api.get(`/api/ai/related/${newsId}`);
  return data;
}

export async function getTimeline(keyword?: string, hours = 168): Promise<{ keyword: string | null; events: TimelineEvent[] }> {
  const { data } = await api.get('/api/news/timeline', { params: { keyword, hours } });
  return data;
}

export async function getNewsMap(hours = 24): Promise<{ regions: NewsRegion[] }> {
  const { data } = await api.get('/api/news/map', { params: { hours } });
  return data;
}

export async function getFreshView(exclude?: string[], limit = 6): Promise<{ recommendations: NewsItem[] }> {
  const { data } = await api.get('/api/news/fresh-view', { params: { exclude: exclude?.join(','), limit } });
  return data;
}

export async function getCredibility(newsId: number): Promise<CredibilityReport> {
  const { data } = await api.get(`/api/news/${newsId}/credibility`);
  return data;
}

export async function getPerspectives(newsId: number): Promise<PerspectiveReport> {
  const { data } = await api.get(`/api/news/${newsId}/perspectives`);
  return data;
}

export async function getReadLater(): Promise<NewsItem[]> {
  const { data } = await api.get('/api/user/read-later');
  return data.items || [];
}

export async function addReadLater(newsId: number): Promise<void> {
  await api.post(`/api/user/read-later/${newsId}`);
}

export async function removeReadLater(newsId: number): Promise<void> {
  await api.delete(`/api/user/read-later/${newsId}`);
}

export async function getRadar(hours = 24): Promise<{ keywords: { id: number; keyword: string; created_at: string }[]; alerts: RadarAlert[] }> {
  const { data } = await api.get('/api/user/radar', { params: { hours } });
  return data;
}

export async function addRadarKeyword(keyword: string): Promise<void> {
  await api.post('/api/user/radar', { keyword });
}

export async function removeRadarKeyword(keyword: string): Promise<void> {
  await api.delete(`/api/user/radar/${encodeURIComponent(keyword)}`);
}

export default api;
