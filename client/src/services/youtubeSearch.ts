export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  channelTitle: string;
  duration?: string;
  publishedTime?: string;
  viewCount?: string;
}

const API_KEY_STORAGE_KEY = 'concord_yt_api_key';

// In-memory cache with 10-minute TTL to preserve quota
interface CacheEntry {
  results: YouTubeSearchResult[];
  timestamp: number;
}
const searchCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? 'https://concord-repo.onrender.com' : 'http://localhost:3001');

export function getStoredYouTubeApiKey(): string {
  try {
    const fromStorage = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (fromStorage?.trim()) return fromStorage.trim();
  } catch {}
  return (import.meta as any).env?.VITE_YOUTUBE_API_KEY || '';
}

export function setStoredYouTubeApiKey(key: string): void {
  try {
    if (key.trim()) {
      localStorage.setItem(API_KEY_STORAGE_KEY, key.trim());
    } else {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
  } catch {}
}

function decodeHtmlEntities(text: string): string {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  return doc.documentElement.textContent || text;
}

/**
 * Searches YouTube for videos matching the query.
 * Prioritizes YouTube Data API v3 when an API key is available,
 * and falls back to resilient public endpoints if no key is set or on quota error.
 */
export async function searchYouTube(
  query: string,
  customApiKey?: string,
  signal?: AbortSignal
): Promise<YouTubeSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  // Check in-memory cache first
  const cacheKey = q.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.results;
  }

  // If user pasted a direct YouTube URL or raw 11-char videoId, return single preview
  const directId = extractDirectVideoId(q);
  if (directId) {
    try {
      const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${directId}`, { signal });
      const data = await res.json();
      const directResult: YouTubeSearchResult = {
        videoId: directId,
        title: data.title || 'Vídeo do YouTube',
        thumbnailUrl: `https://i.ytimg.com/vi/${directId}/mqdefault.jpg`,
        channelTitle: data.author_name || 'YouTube'
      };
      return [directResult];
    } catch {
      return [{
        videoId: directId,
        title: 'Vídeo do YouTube',
        thumbnailUrl: `https://i.ytimg.com/vi/${directId}/mqdefault.jpg`,
        channelTitle: 'YouTube'
      }];
    }
  }

  const apiKey = customApiKey?.trim() || getStoredYouTubeApiKey();

  // Try official YouTube Data API v3 if API key exists
  if (apiKey) {
    try {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=15&q=${encodeURIComponent(q)}&key=${apiKey}&regionCode=BR&relevanceLanguage=pt`;
      const response = await fetch(url, { signal });
      
      if (response.ok) {
        const data = await response.json();
        const items: YouTubeSearchResult[] = (data.items || []).map((item: any) => ({
          videoId: item.id?.videoId,
          title: decodeHtmlEntities(item.snippet?.title || ''),
          thumbnailUrl: `https://i.ytimg.com/vi/${item.id?.videoId}/mqdefault.jpg`,
          channelTitle: decodeHtmlEntities(item.snippet?.channelTitle || 'YouTube')
        })).filter((item: YouTubeSearchResult) => !!item.videoId);

        searchCache.set(cacheKey, { results: items, timestamp: Date.now() });
        return items;
      }
      
      console.warn(`[YouTube Search] Data API returned status ${response.status}. Trying backend search...`);
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      console.warn('[YouTube Search] Official API request failed, switching to backend search:', err);
    }
  }

  // 1st Priority: Concord Backend InnerTube Endpoint (fast, official PT-BR results, direct YouTube CDN thumbnails)
  try {
    const backendRes = await fetch(`${SERVER_URL}/api/youtube/search?q=${encodeURIComponent(q)}`, { signal });
    if (backendRes.ok) {
      const items: YouTubeSearchResult[] = await backendRes.json();
      if (Array.isArray(items) && items.length > 0) {
        // Ensure thumbnail URLs are direct i.ytimg.com CDN
        const cleaned = items.map(it => ({
          ...it,
          thumbnailUrl: `https://i.ytimg.com/vi/${it.videoId}/mqdefault.jpg`
        }));
        searchCache.set(cacheKey, { results: cleaned, timestamp: Date.now() });
        return cleaned;
      }
    }
  } catch (err: any) {
    if (err.name === 'AbortError') throw err;
    console.warn('[YouTube Search] Backend search failed, switching to public fallback:', err);
  }

  // Fallback: Public Invidious / Piped search instances with region=BR
  return await searchViaFallback(q, cacheKey, signal);
}

function extractDirectVideoId(input: string): string | null {
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  const patterns = [
    /(?:v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const match = input.match(p);
    if (match) return match[1];
  }
  return null;
}

async function searchViaFallback(q: string, cacheKey: string, signal?: AbortSignal): Promise<YouTubeSearchResult[]> {
  const fallbackEndpoints = [
    `https://api.piped.private.coffee/search?q=${encodeURIComponent(q)}&filter=videos&region=BR`,
    `https://inv.tux.pizza/api/v1/search?q=${encodeURIComponent(q)}&type=video&region=BR&hl=pt-BR`,
    `https://invidious.jing.rocks/api/v1/search?q=${encodeURIComponent(q)}&type=video&region=BR&hl=pt-BR`
  ];

  for (const endpoint of fallbackEndpoints) {
    try {
      const res = await fetch(endpoint, { signal });
      if (!res.ok) continue;
      const data = await res.json();

      let items: YouTubeSearchResult[] = [];

      // Piped format
      if (Array.isArray(data.items)) {
        items = data.items.map((it: any) => {
          const vId = it.url ? it.url.replace('/watch?v=', '') : it.id;
          return {
            videoId: vId,
            title: decodeHtmlEntities(it.title || ''),
            thumbnailUrl: `https://i.ytimg.com/vi/${vId}/mqdefault.jpg`,
            channelTitle: decodeHtmlEntities(it.uploaderName || 'YouTube'),
            duration: it.duration ? formatDurationSeconds(it.duration) : undefined
          };
        }).filter((it: YouTubeSearchResult) => it.videoId && it.videoId.length === 11);
      } 
      // Invidious format
      else if (Array.isArray(data)) {
        items = data.map((it: any) => ({
          videoId: it.videoId,
          title: decodeHtmlEntities(it.title || ''),
          thumbnailUrl: `https://i.ytimg.com/vi/${it.videoId}/mqdefault.jpg`,
          channelTitle: decodeHtmlEntities(it.author || 'YouTube'),
          duration: it.lengthSeconds ? formatDurationSeconds(it.lengthSeconds) : undefined
        })).filter((it: YouTubeSearchResult) => it.videoId && it.videoId.length === 11);
      }

      if (items.length > 0) {
        searchCache.set(cacheKey, { results: items, timestamp: Date.now() });
        return items;
      }
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      // Try next endpoint
    }
  }

  return [];
}

function formatDurationSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
