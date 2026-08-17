import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Layers, Loader2, Search, UserRound } from 'lucide-react';
import type { PublicDeckSearchResponse } from '../../types';

const PAGE_SIZE = 5;
const configuredApiUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const apiRoot = configuredApiUrl.replace(/\/v1\/?$/, '');

export const GlobalDeckSearch: React.FC = () => {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PublicDeckSearchResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery) {
      setData(null);
      setError('');
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      q: debouncedQuery,
      page: String(page),
      limit: String(PAGE_SIZE),
    });
    setIsLoading(true);
    setError('');

    void fetch(`${apiRoot}/decks/public/search?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || 'Search failed');
        return payload.obj?.data as PublicDeckSearchResponse;
      })
      .then(setData)
      .catch((requestError: Error) => {
        if (requestError.name !== 'AbortError') setError('Unable to search public decks.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [debouncedQuery, page]);

  const totalPages = data?.pagination.totalPages ?? 0;

  return <div className="relative w-full">
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      <input
        type="search"
        value={query}
        onFocus={() => setIsOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setPage(1); setIsOpen(true); }}
        onKeyDown={(event) => { if (event.key === 'Escape') setIsOpen(false); }}
        placeholder="Search public decks..."
        aria-label="Search public decks"
        className="w-full rounded-xl border border-slate-700 bg-slate-900/90 py-2.5 pl-9 pr-4 text-sm text-slate-100 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
      />
    </div>

    {isOpen && query.trim() && <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/40">
      {isLoading ? <div className="flex items-center justify-center gap-2 p-6 text-sm text-slate-400"><Loader2 className="h-5 w-5 animate-spin text-indigo-400" />Searching...</div>
        : error ? <p className="p-6 text-center text-sm text-red-300">{error}</p>
        : data?.decks.length === 0 ? <p className="p-6 text-center text-sm text-slate-400">No public decks found</p>
        : data && <>
          <div className="max-h-80 divide-y divide-slate-800 overflow-y-auto">{data.decks.map((deck) => <Link key={deck.id} to={`/set/${deck.id}`} onClick={() => setIsOpen(false)} className="block p-4 transition hover:bg-slate-800/80">
            <p className="truncate font-bold text-slate-100">{deck.title}</p>
            <div className="mt-1.5 flex items-center gap-4 text-xs text-slate-400"><span className="flex items-center gap-1"><Layers className="h-3.5 w-3.5 text-indigo-400" />{deck.cardCount} cards</span><span className="flex min-w-0 items-center gap-1"><UserRound className="h-3.5 w-3.5 text-violet-400" /><span className="truncate">{deck.author.name}</span></span></div>
          </Link>)}</div>
          <div className="flex items-center justify-between border-t border-slate-800 px-3 py-2 text-xs text-slate-400"><span>{data.pagination.total} result{data.pagination.total === 1 ? '' : 's'}</span><div className="flex items-center gap-2"><button type="button" aria-label="Previous results page" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="rounded-lg p-1.5 hover:bg-slate-800 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button><span>{page} / {Math.max(1, totalPages)}</span><button type="button" aria-label="Next results page" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} className="rounded-lg p-1.5 hover:bg-slate-800 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button></div></div>
        </>}
    </div>}
  </div>;
};
