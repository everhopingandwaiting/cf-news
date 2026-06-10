import { useState, useEffect } from 'react';
import type { RelatedArticle as RelatedArticleType } from '../types';
import { getRelatedArticles } from '../api/client';

interface Props {
  newsId: number;
  title: string;
  onSelect?: (newsId: number) => void;
}

export default function RelatedArticles({ newsId, onSelect }: Props) {
  const [articles, setArticles] = useState<RelatedArticleType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getRelatedArticles(newsId)
      .then(data => setArticles(data.related || []))
      .catch(() => setArticles([]))
      .finally(() => setLoading(false));
  }, [newsId]);

  if (loading) {
    return (
      <div className="mt-5 pt-4 border-t border-gray-200">
        <div className="h-4 w-24 bg-gray-200 rounded animate-pulse mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (articles.length === 0) return null;

  return (
    <div className="mt-5 pt-4 border-t border-gray-200">
      <div className="font-semibold text-[13px] text-gray-500 mb-3">相关推荐</div>
      <div className="space-y-1.5">
        {articles.map((article, i) => (
          <button
            key={article.id || i}
            className="w-full text-left px-4 py-2.5 rounded-lg text-sm text-gray-700 hover:bg-gray-50 hover:text-indigo-600 transition border border-transparent hover:border-gray-200 flex items-start gap-2"
            onClick={() => {
              if (onSelect) {
                const id = parseInt(article.id);
                if (!isNaN(id)) onSelect(id);
              }
            }}
          >
            <span className="text-gray-300 mt-0.5 shrink-0">·</span>
            <span className="flex-1 leading-snug line-clamp-2">{article.text}</span>
            {article.score > 0 && (
              <span className="text-[11px] text-gray-300 shrink-0 mt-0.5">
                {Math.round(article.score * 100)}%
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
