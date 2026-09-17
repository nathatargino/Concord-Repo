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
  <svg width="12" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path d="M5.398 1.5V24c1.873-.225 2.81-.312 4.715-.398V14.83L5.398 1.5z" fill="#B81D24" />
    <path d="M13.887 0v9.172l4.715 13.33V0h-4.715z" fill="#B81D24" />
    <path d="m5.398 0 8.348 23.602c2.346.059 4.856.398 4.856.398L10.113 0H5.398z" fill="#E50914" />
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
    setStreamingSession,
    setShowVideoPlayer,
  } = useAppStore();

  const selectedPlatform = activeMediaTab;
  const setSelectedPlatform = (p: Platform) => {
    setActiveMediaTab(p);
    const electron = (window as any).electron;
    if (electron?.setActiveMediaTab) {
      electron.setActiveMediaTab(p);
    }
  };

  const isElectron = !!(window as any).electron;

  const handleOpenStreaming = async (service: 'netflix' | 'prime', targetUrl?: string) => {
    setIsOpeningStreaming(true);
    try {
      setActiveStreaming({ service, url: targetUrl });
      setActiveMediaTab(service);
      setStreamingSession(service, true);
      setShowVideoPlayer(true);
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
        setShowVideoPlayer(false);
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

  const isStreamingPlatform = selectedPlatform === 'netflix' || selectedPlatform === 'prime';
  const platformName = selectedPlatform === 'netflix' ? 'Netflix' : 'Prime Video';

  return (
    <div className={styles.panel}>
      {/* Header matching prototype */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <i className={`fa-solid fa-compact-disc ${styles.spinDisc}`}></i>
          <span>Mídia em Grupo</span>
        </div>
        {isPlaying || activeStreaming ? (
          <span className={styles.mediaStatusBadge}>
            <span className={styles.pulseDot} />
            <span>Tocando</span>
          </span>
        ) : (
          <span className={styles.mediaStatusBadgePaused}>
            <span>Pausada</span>
          </span>
        )}
      </div>

      {/* Platform Tabs matching prototype */}
      <div className={styles.platformTabs}>
        <button
          type="button"
          className={`${styles.platformTab} ${selectedPlatform === 'youtube' ? styles.platformTabActive : ''}`}
          onClick={() => setSelectedPlatform('youtube')}
        >
          <i className="fa-brands fa-youtube" style={{ color: '#ef4444' }}></i>
          <span>YouTube</span>
        </button>
        <button
          type="button"
          className={`${styles.platformTab} ${selectedPlatform === 'netflix' ? styles.platformTabActive : ''}`}
          onClick={() => setSelectedPlatform('netflix')}
        >
          <svg width="11" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
            <path d="M5.398 1.5V24c1.873-.225 2.81-.312 4.715-.398V14.83L5.398 1.5z" fill="#B81D24" />
            <path d="M13.887 0v9.172l4.715 13.33V0h-4.715z" fill="#B81D24" />
            <path d="m5.398 0 8.348 23.602c2.346.059 4.856.398 4.856.398L10.113 0H5.398z" fill="#E50914" />
          </svg>
          <span>Netflix</span>
        </button>
        <button
          type="button"
          className={`${styles.platformTab} ${selectedPlatform === 'prime' ? styles.platformTabActive : ''}`}
          onClick={() => setSelectedPlatform('prime')}
        >
          <i className="fa-solid fa-play" style={{ color: '#22d3ee', fontSize: '10px' }}></i>
          <span>Prime</span>
        </button>
      </div>

      <div className={styles.content}>
        {/* YouTube Section */}
        {selectedPlatform === 'youtube' && (
          <>
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
                </div>
              </div>
            )}

            <button
              type="button"
              id="btnBuscarYouTube"
              className={styles.searchModalBtn}
              onClick={() => setIsSearchModalOpen(true)}
              disabled={!inVoice}
              title={!inVoice ? 'Entre na call para buscar e adicionar músicas' : 'Buscar músicas no YouTube'}
            >
              <i className="fa-solid fa-magnifying-glass"></i>
              <span>Buscar no YouTube</span>
            </button>

            <form onSubmit={handleAdd} className={styles.mediaInputWrapper}>
              <input
                id="musicUrl"
                type="url"
                className={styles.mediaInput}
                placeholder="Cole a URL do YouTube..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={!inVoice}
              />
            </form>

            <button
              id="btnTransmitir"
              type="button"
              onClick={handleAdd}
              className={styles.actionButtonYoutube}
              disabled={!inVoice || !url.trim()}
              title={!inVoice ? 'Entre na call para adicionar músicas' : 'Adicionar à fila'}
            >
              <i className="fa-solid fa-plus"></i>
              <span>Adicionar à Fila</span>
            </button>

            {musicQueue.length > 0 && (
              <div className={styles.queue}>
                <div className={styles.queueHeader}>
                  Fila ({musicQueue.length})
                </div>
                <div className={styles.queueList}>
                  {musicQueue.map((item, i) => (
                    <div
                      key={item.token}
                      className={styles.queueItem}
                      draggable
                      onDragStart={(e) => handleDragStart(e, i)}
                      onDragOver={(e) => handleDragOver(e, i)}
                      onDragLeave={() => setDragOverIndex(null)}
                      onDrop={(e) => handleDrop(e, i)}
                      onDragEnd={handleDragEnd}
                    >
                      <img
                        src={`https://img.youtube.com/vi/${item.videoId}/default.jpg`}
                        alt=""
                        className={styles.queueThumb}
                      />
                      <span className={styles.queueTitle} title={item.title || item.videoId}>
                        {item.title || item.videoId}
                      </span>
                      <button
                        type="button"
                        className={styles.removeQueueBtn}
                        onClick={() => onRemoveFromQueue(item.token)}
                        title="Remover"
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

        {/* Netflix / Prime Video Section */}
        {isStreamingPlatform && (
          <>
            {!isElectron ? (
              <div className={styles.desktopBanner}>
                <div className={styles.desktopTitle}>
                  {platformName} no App Desktop
                </div>
                <div className={styles.desktopDesc}>
                  Para assistir {platformName} sincronizado com a sala, use o aplicativo desktop do Concord.
                </div>
                <a
                  href={DESKTOP_DOWNLOAD_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.downloadBtn}
                >
                  <i className="fa-solid fa-download"></i>
                  <span>Baixar App Desktop</span>
                </a>
              </div>
            ) : (
              <>
                <div className={styles.mediaInputWrapper}>
                  <input
                    type="url"
                    className={styles.mediaInput}
                    placeholder="Cole a URL do filme/série (opcional)..."
                    value={streamingUrl}
                    onChange={(e) => setStreamingUrl(e.target.value)}
                  />
                </div>

                {(streamingSessions[selectedPlatform as 'netflix' | 'prime'] || activeStreaming?.service === selectedPlatform) ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button
                      type="button"
                      className={selectedPlatform === 'netflix' ? styles.actionButtonNetflix : styles.actionButtonPrime}
                      onClick={() => setShowVideoPlayer(true)}
                    >
                      <i className="fa-solid fa-tv"></i>
                      <span>Assistir {selectedPlatform === 'netflix' ? 'NETFLIX' : 'PRIME'}</span>
                    </button>
                    <button
                      type="button"
                      className={styles.closeStreamingBtn}
                      onClick={handleCloseStreaming}
                    >
                      <i className="fa-solid fa-xmark"></i>
                      <span>Fechar {platformName}</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={selectedPlatform === 'netflix' ? styles.actionButtonNetflix : styles.actionButtonPrime}
                    onClick={() => handleOpenStreaming(selectedPlatform, streamingUrl.trim() || undefined)}
                    disabled={isOpeningStreaming}
                  >
                    <i className="fa-solid fa-arrow-up-right-from-square"></i>
                    <span>{isOpeningStreaming ? 'Iniciando...' : (selectedPlatform === 'netflix' ? 'Abrir NETFLIX' : 'Abrir PRIME')}</span>
                  </button>
                )}
              </>
            )}

            <div className={styles.infoNotice}>
              <i className="fa-solid fa-shield-halved"></i>
              <span>Sessão e cookies sincronizados com segurança no Concord.</span>
            </div>
          </>
        )}
      </div>

      <YouTubeSearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
        onSelectVideo={handleSelectSearchVideo}
        isCurrentlyPlaying={isPlaying}
      />
    </div>
  );
};
