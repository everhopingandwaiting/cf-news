import axios from 'axios';
import type { NewsItem, NewsSource, NewsComment, Pagination, User } from '../types';

const API_BASE = '';

const api = axios.create({ baseURL: API_BASE });

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

export async function login(email: string, password: string): Promise<{ token: string; user: User }> {
  const { data } = await api.post('/api/auth/login', { email, password });
  return data;
}

export async function register(username: string, email: string, password: string): Promise<void> {
  await api.post('/api/auth/register', { username, email, password });
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

export async function translateText(text: string, lang: string): Promise<string | null> {
  try {
    const { data } = await api.post('/api/translate', { text, lang });
    return data.translated || null;
  } catch {
    return null;
  }
}

export default api;
