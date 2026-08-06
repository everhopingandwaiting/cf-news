import type { NewsItem } from '../../types';

// --- Constants ---
export const KEYWORD_ARTICLES_LIMIT = 6;
export const MAX_RISING_TOPICS = 20;
export const MAX_KEYWORD_SELECTOR = 15;
export const MAX_DROPPED_DISPLAY = 10;
export const MAX_KEYWORD_SOURCES = 2;
export const MAX_COMPARE_KWS = 4;
export const SKELETON_CLASSES = [
    'h-4 w-24', 'h-6 w-20', 'h-8 w-32', 'h-10 w-28',
    'h-6 w-16', 'h-4 w-36', 'h-8 w-24', 'h-10 w-20',
    'h-4 w-28', 'h-6 w-32', 'h-8 w-18', 'h-10 w-26',
];
export const SKELETON_RISE_COUNT = 8;

// --- Interfaces ---
export interface SourceInfo {
    name: string;
    count: number;
}

export interface TrendingWord {
    word: string;
    count: number;
    sources?: SourceInfo[];
    burst?: boolean;
    burst_score?: number;
    change_pct?: number;
    is_new?: boolean;
}

export interface TopicPoint {
    date_hour: string;
    count: number;
}

export interface Topic {
    keyword: string;
    total: number;
    points: TopicPoint[];
}

export interface CategoryInfo {
    name: string;
    count: number;
    pct: number;
}

export interface CompareSeries {
    keyword: string;
    points: TopicPoint[];
}

export interface HourlySource {
    hour: string; source_id: number; source_name: string; count: number;
}
export interface HourlyCat {
    hour: string; category: string; count: number;
}

export interface TrendTheme {
    label: string;
    total: number;
    latest: number;
    previous: number;
    change_pct: number;
    status: 'rising' | 'falling' | 'steady';
    keywords: string[];
    articles: NewsItem[];
}

export interface OverviewKeyword {
    word: string;
    count: number;
}

export interface TrendingOverview {
    overview: string | null;
    keywords: OverviewKeyword[];
    generated_at: string;
}

export interface ThemePerspectiveRelated {
    id: number;
    source: string;
    title: string;
}

export interface ThemePerspective {
    keyword: string;
    perspective: string;
    related: ThemePerspectiveRelated[];
    generated_at: string;
}

// --- Reusable data ---
export const PERIODS = [
    { key: 6, label: '6h' },
    { key: 12, label: '12h' },
    { key: 24, label: '24h' },
    { key: 48, label: '2d' },
    { key: 168, label: '7d' },
];

export const PALETTE = [
    'bg-rose-100 text-rose-700 border-rose-200 hover:bg-rose-200',
    'bg-indigo-100 text-indigo-700 border-indigo-200 hover:bg-indigo-200',
    'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200',
    'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200',
    'bg-cyan-100 text-cyan-700 border-cyan-200 hover:bg-cyan-200',
    'bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-200',
    'bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-200',
    'bg-teal-100 text-teal-700 border-teal-200 hover:bg-teal-200',
];

// --- Utilities ---
export function isBigram(w: string) { return w.includes('_'); }
export function displayWord(w: string) { return w.replace(/_/g, ' '); }

export function Skeleton({ className }: { className?: string }) {
    return <div className={`animate-pulse bg-gray-200 rounded ${className || ''}`} />;
}
