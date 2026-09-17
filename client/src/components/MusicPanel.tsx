import React, { useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { YouTubeSearchModal } from './YouTubeSearchModal';
import styles from './MusicPanel.module.css';

const DESKTOP_DOWNLOAD_URL = 'https://github.com/nathatargino/Concord-Repo/releases/latest/download/Concord-Setup.exe';

type Platform = 'youtube' | 'netflix' | 'prime';

interface PlatformConfig {
  id: Platform;
  label: string;
  icon: React.ReactNode;
}

// Netflix "N" icon
export const NetflixIcon = () => (
  <svg width="14" height="14" viewBox="0 0 111 190" fill="currentColor" aria-hidden="true">
    <path d="M0 0h30.4l40.3 117.4V0H111v190H81.4L40.3 71.5V190H0z" />
  </svg>
);

// Prime Video icon (simplified play arrow inside box)
export const PrimeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M10 8l5 3-5 3V8z" fill="currentColor" stroke="none" />
    <path d="M7 21h10" />
    <path d="M12 17v4" />
  </svg>
);

// YouTube icon
export const YouTubeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58 2.78 2.78 0 0 0 1.95 1.96C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.96-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/>
    <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill="white"/>
  </svg>
);

export const PLATFORMS: PlatformConfig[] = [
  { id: 'youtube', label: 'YouTube', icon: <YouTubeIcon /> },
  { id: 'netflix', label: 'Netflix', icon: <NetflixIcon /> },
  { id: 'prime',   label: 'Prime',   icon: <PrimeIcon /> },
];

interface Props {
  onRequestMusic: (url: string, title?: string) => void;
  onRemoveFromQueue: (token: number) => void;
  onReorderQueue: (oldIndex: number, newIndex: number) => void;
  inVoice: boolean;
}

export const MusicPanel: React.FC<Props> = ({ onRequestMusic, onRemoveFromQueue, onReorderQueue, inVoice }) => {
  const [url, setUrl] = useState('');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [trackTitle, setTrackTitle] = useState<string | null>(null);
  const [streamingUrl, setStreamingUrl] = useState('');
  const [isOpeningStreaming, setIsOpeningStreaming] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const {
    musicQueue,
    currentVideoId,
    isPlaying,
    activeStreaming,
    setActiveStreaming,
    activeMediaTab,
    setActiveMediaTab,
    streamingSessions,
    setStreamingSession
  } = useAppStore();

  const selectedPlatform = activeMediaTab;
  const setSelectedPlatform = (p: Platform) => {
    setActiveMediaTab(p);
    if (p === 'netflix' || p === 'prime') {
      setActiveStreaming({ service: p });
      setStreamingSession(p, true);
    } else {
      setActiveStreaming(null);
    }
    const electron = (window as any).electron;
    if (electron?.setActiveMediaTab) {
      electron.setActiveMediaTab(p);
    }
  };

  // Detect if running inside Electron
  const isElectron = !!(window as any).electron;

  const handleOpenStreaming = async (service: 'netflix' | 'prime', targetUrl?: string) => {
    setIsOpeningStreaming(true);
    try {
      setActiveStreaming({ service, url: targetUrl });
      setActiveMediaTab(service);
      setStreamingSession(service, true);
      const electron = (window as any).electron;
      if (electron?.setActiveMediaTab) {
        electron.setActiveMediaTab(service);
      }
    } finally {
      setIsOpeningStreaming(false);
    }
  };

  const handleCloseStreaming = () => {
    const electron = (window as any).electron;
    const currentService = selectedPlatform === 'netflix' || selectedPlatform === 'prime' ? selectedPlatform : activeStreaming?.service;
    if (currentService) {
      if (electron?.closeStreamingView) {
        electron.closeStreamingView(currentService);
      }
      setStreamingSession(currentService, false);
      // If the other service is still open, switch to it; otherwise go to youtube
      const otherService: 'netflix' | 'prime' = currentService === 'netflix' ? 'prime' : 'netflix';
      if (streamingSessions[otherService]) {
        setActiveStreaming({ service: otherService });
        setActiveMediaTab(otherService);
        if (electron?.setActiveMediaTab) electron.setActiveMediaTab(otherService);
      } else {
        setActiveStreaming(null);
        setActiveMediaTab('youtube');
        if (electron?.setActiveMediaTab) electron.setActiveMediaTab('youtube');
      }
    }
  };

  React.useEffect(() => {
    if (!currentVideoId) {
      setTrackTitle(null);
      return;
    }
    const queued = musicQueue.find(m => m.videoId === currentVideoId);
    if (queued?.title) {
      setTrackTitle(queued.title);
      return;
    }
    fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${currentVideoId}`)
      .then(res => res.json())
      .then(data => {
        if (data.title) setTrackTitle(data.title);
      })
      .catch(() => {});
  }, [currentVideoId, musicQueue]);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (index !== dragOverIndex) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e: React.DragEvent, newIndex: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== newIndex) {
      onReorderQueue(draggedIndex, newIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    onRequestMusic(url.trim());
    setUrl('');
  };

  const handleSelectSearchVideo = (videoId: string, title?: string) => {
    onRequestMusic(`https://www.youtube.com/watch?v=${videoId}`, title);
  };

  const activeVideoId = currentVideoId || (isPlaying && musicQueue[0]?.videoId ? musicQueue[0].videoId : null);
  const activeTitle = trackTitle || (activeVideoId ? musicQueue.find(m => m.videoId === activeVideoId)?.title : null);

  // Whether the selected platform requires the desktop-only warning
  const isStreamingPlatform = selectedPlatform === 'netflix' || selectedPlatform === 'prime';
  const platformName = selectedPlatform === 'netflix' ? 'Netflix' : 'Prime Video';

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerIcon}>🎵</span>
        <h2 className={styles.headerTitle}>Música</h2>
        {activeVideoId && (
          isPlaying ? (
            <div className={styles.nowPlayingBadge}>
              <span className={styles.eqBar} />
              <span className={styles.eqBar} />
              <span className={styles.eqBar} />
              <span>Tocando</span>
            </div>
          ) : (
            <div className={`${styles.nowPlayingBadge} ${styles.pausedBadge}`}>
              <span className={styles.pauseIcon}>⏸</span>
              <span>Pausada</span>
            </div>
          )
        )}
      </div>

      <div className={styles.content}>

        {/* ── Platform selector ── */}
        <div className={styles.platformSelector} role="tablist" aria-label="Selecionar plataforma">
          {PLATFORMS.map(p => (
            <button
              key={p.id}
              id={`platform-tab-${p.id}`}
              role="tab"
              aria-selected={selectedPlatform === p.id}
              className={`${styles.platformTab} ${selectedPlatform === p.id ? styles.platformTabActive : ''} ${styles[`platformTab_${p.id}`]}`}
              onClick={() => setSelectedPlatform(p.id)}
              title={p.label}
            >
              <span className={styles.platformTabIcon}>{p.icon}</span>
              <span className={styles.platformTabLabel}>{p.label}</span>
            </button>
          ))}
        </div>

        {/* ── YouTube content (unchanged behavior) ── */}
        {selectedPlatform === 'youtube' && (
          <>
            {/* Current playing */}
            {activeVideoId && (
              <div className={styles.currentTrack}>
                <img
                  src={`https://img.youtube.com/vi/${activeVideoId}/mqdefault.jpg`}
                  alt="Thumbnail"
                  className={styles.thumbnail}
                />
                <div className={styles.trackInfo}>
                  <span className={styles.trackLabel}>{isPlaying ? 'Tocando agora' : 'Música Pausada'}</span>
                  <span className={styles.trackName} title={activeTitle || activeVideoId}>
                    {activeTitle || 'Música do YouTube'}
                  </span>
                  <a
                    href={`https://youtube.com/watch?v=${activeVideoId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.trackLink}
                  >
                    ver no YouTube →
                  </a>
                </div>
              </div>
            )}

            {/* Search on YouTube button */}
            <button
              type="button"
              id="btnBuscarYouTube"
              className={styles.searchTriggerBtn}
              onClick={() => setIsSearchModalOpen(true)}
              disabled={!inVoice}
              title={!inVoice ? 'Entre na call para buscar e adicionar músicas' : 'Buscar músicas e vídeos no YouTube'}
            >
              <span className={styles.searchTriggerBtnIcon}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <span>Buscar no YouTube</span>
            </button>

            <div className={styles.orDivider}>
              <span>ou cole o link</span>
            </div>

            {/* Add music form */}
            <form onSubmit={handleAdd} className={styles.form}>
              <input
                id="musicUrl"
                type="url"
                className={styles.input}
                placeholder="Cole a URL do YouTube..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={!inVoice}
              />
              <button
                id="btnTransmitir"
                type="submit"
                className={styles.addBtn}
                disabled={!inVoice || !url.trim()}
                title={!inVoice ? 'Entre na call para adicionar músicas' : 'Adicionar à fila'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Adicionar
              </button>
            </form>

            {!inVoice && (
              <p className={styles.hint}>⚡ Entre na call para adicionar músicas</p>
            )}

            {/* Queue */}
            {musicQueue.length > 0 && (
              <div className={styles.queue}>
                <div className={styles.queueLabel}>
                  Na fila — {musicQueue.length} {musicQueue.length === 1 ? 'música' : 'músicas'}
                </div>
                <div className={styles.queueList}>
                  {musicQueue.map((item, i) => (
                    <div
                      key={item.token}
                      className={`${styles.queueItem} ${draggedIndex === i ? styles.dragging : ''} ${dragOverIndex === i ? styles.dragOver : ''}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, i)}
                      onDragOver={(e) => handleDragOver(e, i)}
                      onDragLeave={() => setDragOverIndex(null)}
                      onDrop={(e) => handleDrop(e, i)}
                      onDragEnd={handleDragEnd}
                    >
                      <span className={styles.dragHandle}>⋮⋮</span>
                      <span className={styles.queueIndex}>{i + 1}</span>
                      <img
                        src={`https://img.youtube.com/vi/${item.videoId}/default.jpg`}
                        alt=""
                        className={styles.queueThumb}
                      />
                      <div className={styles.queueInfo}>
                        <span className={styles.queueVideoId}>{item.title || item.videoId}</span>
                        {item.requestedBy && (
                          <span className={styles.queueBy}>por {item.requestedBy}</span>
                        )}
                      </div>
                      <button
                        className={styles.removeBtn}
                        onClick={() => onRemoveFromQueue(item.token)}
                        title="Remover da fila"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Netflix / Prime Video content ── */}
        {isStreamingPlatform && (
          <div className={styles.streamingSection}>
            {/* Web: desktop-only warning */}
            {!isElectron && (
              <div className={styles.desktopOnlyBanner} role="alert">
                <div className={styles.desktopOnlyIcon}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <path d="M8 21h8M12 17v4" />
                  </svg>
                </div>
                <p className={styles.desktopOnlyTitle}>
                  {platformName} só funciona no App Desktop
                </p>
                <p className={styles.desktopOnlyDesc}>
                  Para assistir {platformName} junto com sua sala, você precisa do app desktop da Concord. Cada pessoa faz login com a própria conta — sem compartilhar senhas.
                </p>
                <a
                  id={`btn-download-for-${selectedPlatform}`}
                  href={DESKTOP_DOWNLOAD_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.downloadAppBtn}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Baixar App Desktop
                </a>
              </div>
            )}

            {/* Desktop: Player Controls (Phase 2) */}
            {isElectron && (
              <div className={styles.streamingControls}>
                {(streamingSessions[selectedPlatform as 'netflix' | 'prime'] || activeStreaming?.service === selectedPlatform) ? (
                  <>
                    <div className={styles.streamingActiveBadge}>
                      <span>
                        <span className={styles.streamingDot} />
                        {platformName} aberta no app
                      </span>
                      <button
                        className={styles.removeBtn}
                        onClick={handleCloseStreaming}
                        title="Fechar streaming"
                      >
                        ✕
                      </button>
                    </div>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (streamingUrl.trim()) {
                          handleOpenStreaming(selectedPlatform, streamingUrl.trim());
                        }
                      }}
                      className={styles.form}
                    >
                      <input
                        type="url"
                        className={styles.input}
                        placeholder={`Navegar para link de ${platformName}...`}
                        value={streamingUrl}
                        onChange={(e) => setStreamingUrl(e.target.value)}
                      />
                      <button
                        type="submit"
                        className={styles.addBtn}
                        disabled={!streamingUrl.trim()}
                      >
                        Ir
                      </button>
                    </form>

                    <button
                      className={styles.closeStreamingBtn}
                      onClick={handleCloseStreaming}
                    >
                      ✕ Fechar Player da {platformName}
                    </button>
                  </>
                ) : (
                  <>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleOpenStreaming(selectedPlatform, streamingUrl.trim() || undefined);
                      }}
                      className={styles.form}
                    >
                      <input
                        id={`input-url-${selectedPlatform}`}
                        type="url"
                        className={styles.input}
                        placeholder={`URL do filme/série (opcional)...`}
                        value={streamingUrl}
                        onChange={(e) => setStreamingUrl(e.target.value)}
                      />
                    </form>

                    <button
                      id={`btn-open-${selectedPlatform}`}
                      className={`${styles.openStreamingBtn} ${styles[`openStreamingBtn_${selectedPlatform}`]}`}
                      onClick={() => handleOpenStreaming(selectedPlatform, streamingUrl.trim() || undefined)}
                      disabled={isOpeningStreaming}
                    >
                      {isOpeningStreaming ? 'Iniciando...' : (
                        <>
                          <span>▶</span> Abrir {platformName} no App
                        </>
                      )}
                    </button>

                    <p className={styles.streamingHint}>
                      🔒 Faça login com sua conta da {platformName}. Sua sessão e cookies ficam salvos com segurança no Concord.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {/* YouTube Search & Enqueue Modal */}
      <YouTubeSearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
        onSelectVideo={handleSelectSearchVideo}
        isCurrentlyPlaying={isPlaying}
      />
    </div>
  );
};
