import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { searchYouTube, type YouTubeSearchResult } from '../services/youtubeSearch';
import styles from './YouTubeSearchModal.module.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectVideo: (videoId: string, title?: string) => void;
  isCurrentlyPlaying: boolean;
}

export const YouTubeSearchModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onSelectVideo,
  isCurrentlyPlaying
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  
  const searchTimeoutRef = useRef<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Focus search input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setResults([]);
      setHasSearched(false);
    }
  }, [isOpen]);

  // Handle ESC key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const executeSearch = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q) {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      setResults([]);
      setIsLoading(false);
      setHasSearched(false);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setHasSearched(true);
    try {
      const items = await searchYouTube(q, undefined, controller.signal);
      setResults(items);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('[YouTube Search Modal] Search error:', err);
        setResults([]);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        setIsLoading(false);
      }
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!val.trim()) {
      setResults([]);
      setIsLoading(false);
      setHasSearched(false);
      return;
    }

    // Debounce search by 450ms to provide smooth typing without lagging
    searchTimeoutRef.current = setTimeout(() => {
      executeSearch(val);
    }, 450);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    executeSearch(query);
  };



  const handlePickResult = (item: YouTubeSearchResult) => {
    onSelectVideo(item.videoId, item.title);
    onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.titleArea}>
            <span className={styles.ytLogoIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58 2.78 2.78 0 0 0 1.95 1.96C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.96-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/>
                <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill="white"/>
              </svg>
            </span>
            <h3 className={styles.headerTitle}>Buscar no YouTube</h3>
          </div>

          <div className={styles.headerActions}>
            <button className={styles.closeBtn} onClick={onClose} title="Fechar">
              ✕
            </button>
          </div>
        </div>



        {/* Search Bar */}
        <div className={styles.searchBarWrapper}>
          <form onSubmit={handleFormSubmit} className={styles.searchBar}>
            <span className={styles.searchIcon}>🔍</span>
            <input
              ref={inputRef}
              type="text"
              className={styles.searchInput}
              placeholder="Digite o nome da música, artista ou cole o link..."
              value={query}
              onChange={handleInputChange}
            />
            {query && (
              <button
                type="button"
                className={styles.clearBtn}
                onClick={() => {
                  setQuery('');
                  setResults([]);
                  setHasSearched(false);
                  inputRef.current?.focus();
                }}
                title="Limpar"
              >
                ✕
              </button>
            )}
          </form>
        </div>

        {/* Results / Feedback List */}
        <div className={styles.resultsContainer}>
          {isLoading ? (
            <div className={styles.stateMessage}>
              <div className={styles.spinner} />
              <span className={styles.stateText}>Pesquisando no YouTube...</span>
            </div>
          ) : results.length > 0 ? (
            results.map((item) => (
              <div
                key={item.videoId}
                className={styles.resultCard}
                onClick={() => handlePickResult(item)}
                title={isCurrentlyPlaying ? 'Adicionar à fila' : 'Tocar agora'}
              >
                <div className={styles.thumbWrapper}>
                  <img
                    src={item.thumbnailUrl}
                    alt={item.title}
                    className={styles.thumbnail}
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      e.currentTarget.src = `https://img.youtube.com/vi/${item.videoId}/hqdefault.jpg`;
                    }}
                  />
                  {item.duration && <span className={styles.durationBadge}>{item.duration}</span>}
                </div>

                <div className={styles.videoDetails}>
                  <span className={styles.videoTitle}>{item.title}</span>
                  <div className={styles.videoMetaRow}>
                    <span className={styles.channelName}>{item.channelTitle}</span>
                    {item.viewCount && (
                      <>
                        <span className={styles.metaDot}>•</span>
                        <span className={styles.metaText}>{item.viewCount}</span>
                      </>
                    )}
                    {item.publishedTime && (
                      <>
                        <span className={styles.metaDot}>•</span>
                        <span className={styles.metaText}>{item.publishedTime}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className={styles.playActionBtn}>
                  {isCurrentlyPlaying ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      <span>Fila</span>
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      <span>Tocar</span>
                    </>
                  )}
                </div>
              </div>
            ))
          ) : hasSearched ? (
            <div className={styles.stateMessage}>
              <span className={styles.stateIcon}>🔎</span>
              <span className={styles.stateText}>
                Nenhum resultado encontrado para &quot;{query}&quot;. Tente outros termos ou cole a URL direta do vídeo.
              </span>
            </div>
          ) : (
            <div className={styles.stateMessage}>
              <span className={styles.stateIcon}>🎧</span>
              <span className={styles.stateText}>
                Pesquise por músicas, álbuns ou artistas para adicionar diretamente à sala.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
