export interface NewsItem {
  id: number;
  source_id: number;
  title: string;
  url: string;
  description?: string;
  content?: string;
  image_url?: string;
  category: string;
  published_at?: string;
  created_at: string;
  source_name?: string;
  source_lang?: string;
  comments_count?: number;
  favorited?: boolean;
  favorites_count?: number;
  ai_summary?: string;
  ai_take?: string;
}

export interface NewsSource {
  id: number;
  name: string;
  url: string;
  feed_url: string;
  category: string;
  language: string;
  enabled: number;
  sort_order?: number;
  last_fetched_at?: string;
  last_fetched_count?: number;
  today_count?: number;
}

export interface NewsComment {
  id: number;
  news_id: number;
  user_id: number;
  username: string;
  content: string;
  created_at: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface User {
  id: number;
  email: string;
  username: string;
}

export interface DailyDigest {
  id: number;
  date: string;
  content: string;
  news_ids: number[];
  created_at: string;
}

export interface RelatedArticle {
  id: string;
  text: string;
  score: number;
  item?: { metadata?: { description?: string; image_url?: string } };
}
