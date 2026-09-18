import React, { useState } from 'react';
import { notifyInChat } from '../utils/systemMessage';
import { useAppStore } from '../stores/useAppStore';
import { YouTubeSearchModal } from './YouTubeSearchModal';
import styles from './MusicPanel.module.css';

const DESKTOP_DOWNLOAD_URL = 'https://github.com/nathatargino/Concord-Repo/releases/latest/download/Concord-Setup.exe';

type Platform = 'youtube' | 'netflix' | 'prime';

// Netflix "N" icon (uses currentColor to match active/inactive tab color)
export const NetflixIcon = () => (
  <svg width="13" height="15" viewBox="0 0 111 190" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path d="M0 0h30.4l40.3 117.4V0H111v190H81.4L40.3 71.5V190H0z" />
  </svg>
);

// Prime Video icon (simplified play screen inside box)
export const PrimeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M10 8l5 3-5 3V8z" fill="currentColor" stroke="none" />
    <path d="M7 21h10" />
    <path d="M12 17v4" />
  </svg>
);

// YouTube icon
export const YouTubeIcon = ({ active }: { active?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={active ? '#FF5252' : '#9ca3af'} aria-hidden="true" style={{ flexShrink: 0 }}>
    <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58 2.78 2.78 0 0 0 1.95 1.96C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.96-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/>
    <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill="white"/>
  </svg>
);

export const PLATFORMS: { id: Platform; label: string }[] = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'netflix', label: 'Netflix' },
  { id: 'prime',   label: 'Prime' },
];

interface Props {
  onRequestMusic: (url: string, title?: string, playNow?: boolean) => void;
  onRemoveFromQueue: (token: number) => void;
  onReorderQueue: (oldIndex: number, newIndex: number) => void;
  inVoice: boolean;
}

export const MusicPanel: React.FC<Props> = ({ onRequestMusic, onRemoveFromQueue, onReorderQueue, inVoice }) => {
  const [url, setUrl] = useState('');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [trackTitle, setTrackTitle] = useState<string | null>(null);

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
    isYouTubeSearchOpen,
    setIsYouTubeSearchOpen,
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
    if (!inVoice) {
      notifyInChat(`Você precisa estar em uma call de voz para assistir ${service === 'netflix' ? 'a Netflix' : 'o Prime Video'}.`);
      return;
    }
    setIsOpeningStreaming(true);
    try {
      setActiveStreaming({ service, url: targetUrl });
      setActiveMediaTab(service);
      setStreamingSession(service, true);
      setShowVideoPlayer(true);
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
    if (!inVoice) {
      notifyInChat('Você precisa estar em uma call de voz para adicionar vídeos.');
      return;
    }
    if (!url.trim()) return;
    onRequestMusic(url.trim(), undefined, false);
    setSelectedPlatform('youtube');
    setUrl('');
  };

  const handleSelectSearchVideo = (videoId: string, title?: string) => {
    if (!inVoice) {
      notifyInChat('Você precisa estar em uma call de voz para reproduzir vídeos.');
      return;
    }
    onRequestMusic(`https://www.youtube.com/watch?v=${videoId}`, title, false);
    setSelectedPlatform('youtube');
    setIsSearchModalOpen(false);
    setIsYouTubeSearchOpen(false);
  };

  const activeVideoId = currentVideoId || (isPlaying && musicQueue[0]?.videoId ? musicQueue[0].videoId : null);
  const activeTitle = trackTitle || (activeVideoId ? musicQueue.find(m => m.videoId === activeVideoId)?.title : null);

  const isStreamingPlatform = selectedPlatform === 'netflix' || selectedPlatform === 'prime';
  const platformName = selectedPlatform === 'netflix' ? 'Netflix' : 'Prime Video';

  return (
    <div className={styles.panel}>
      {/* Header matching original layout */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <i className={`fa-solid fa-compact-disc ${styles.spinDisc}`}></i>
          <span>Mídia em Grupo</span>
        </div>
        {isPlaying || activeStreaming ? (
          <span className={styles.mediaStatusBadge}>
            <span className={styles.pulseDot} />
            <span>{activeStreaming ? 'Assistindo' : 'Tocando'}</span>
          </span>
        ) : (
          <span className={styles.mediaStatusBadgePaused}>
            <span>Pausada</span>
          </span>
        )}
      </div>

      {/* Platform Tabs matching 1st image dimensions with 2nd image brand colors */}
      <div className={styles.platformTabs} role="tablist" aria-label="Selecionar plataforma">
        {PLATFORMS.map((p) => {
          const isActive = selectedPlatform === p.id;
          return (
            <button
              key={p.id}
              id={`platform-tab-${p.id}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`${styles.platformTab} ${styles[`platformTab_${p.id}`]} ${isActive ? styles[`platformTabActive_${p.id}`] : ''}`}
              onClick={() => setSelectedPlatform(p.id)}
              title={p.label}
            >
              <span className={styles.platformTabIcon}>
                {p.id === 'youtube' ? (
                  <YouTubeIcon active={isActive} />
                ) : p.id === 'netflix' ? (
                  <NetflixIcon />
                ) : (
                  <PrimeIcon />
                )}
              </span>
              <span className={styles.platformTabLabel}>{p.label}</span>
            </button>
          );
        })}
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

            {/* 1. Área "Buscar no YouTube" com cores da 2ª imagem e tamanho da 1ª imagem */}
            <button
              type="button"
              id="btnBuscarYouTube"
              className={styles.searchModalBtn}
              onClick={() => {
                if (!inVoice) {
                  notifyInChat('Você precisa estar em uma call de voz para buscar no YouTube.');
                  return;
                }
                setIsSearchModalOpen(true);
              }}
              disabled={!inVoice}
              title={inVoice ? "Buscar músicas no YouTube" : "Entre na call de voz para buscar no YouTube"}
            >
              <i className="fa-solid fa-magnifying-glass"></i>
              <span>Buscar no YouTube</span>
            </button>

            {/* 2. Input para colar a URL */}
            <form onSubmit={handleAdd} className={styles.mediaInputWrapper}>
              <input
                id="musicUrl"
                type="url"
                className={styles.mediaInput}
                placeholder={inVoice ? "Cole a URL do YouTube..." : "Entre na call para colar links..."}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={!inVoice}
              />
            </form>

            {/* 3. Botão "Adicionar à fila" mantendo o padrão da 1ª imagem */}
            <button
              id="btnTransmitir"
              type="button"
              onClick={handleAdd}
              className={styles.actionButtonYoutube}
              disabled={!inVoice || !url.trim()}
              title={inVoice ? 'Adicionar à fila' : 'Entre na call para adicionar músicas'}
            >
              <i className="fa-solid fa-plus"></i>
              <span>Adicionar à Fila</span>
            </button>

            {/* Fila com feedback visual de arrastar */}
            {musicQueue.length > 0 && (
              <div className={styles.queue}>
                <div className={styles.queueHeader}>
                  Fila ({musicQueue.length})
                </div>
                <div className={styles.queueList}>
                  {musicQueue.map((item, i) => (
                    <div
                      key={item.token}
                      className={`${styles.queueItem} ${draggedIndex === i ? styles.queueItemDragging : ''} ${dragOverIndex === i && draggedIndex !== i ? styles.queueItemDragOver : ''}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, i)}
                      onDragOver={(e) => handleDragOver(e, i)}
                      onDragLeave={() => setDragOverIndex(null)}
                      onDrop={(e) => handleDrop(e, i)}
                      onDragEnd={handleDragEnd}
                    >
                      <span className={styles.dragHandle}>⋮⋮</span>
                      <img
                        src={`https://img.youtube.com/vi/${item.videoId}/default.jpg`}
                        alt=""
                        className={styles.queueThumb}
                      />
                      <div className={styles.queueInfo}>
                        <span className={styles.queueTitle} title={item.title || item.videoId}>
                          {item.title || item.videoId}
                        </span>
                        {item.requestedBy && (
                          <span className={styles.queueBy}>por {item.requestedBy}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className={styles.removeQueueBtn}
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

        {/* Netflix / Prime Video Section */}
        {isStreamingPlatform && (
          <div className={styles.streamingSection}>
            {!isElectron ? (
              /* Web: desktop-only warning banner exactly matching Image 1 */
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
            ) : (
              /* Desktop: Player Controls */
              <div className={styles.streamingControls}>
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
                      <span>Fechar Player da {platformName}</span>
                    </button>
                  </div>
                ) : (
                  <button
                    id={`btn-open-${selectedPlatform}`}
                    type="button"
                    className={selectedPlatform === 'netflix' ? styles.actionButtonNetflix : styles.actionButtonPrime}
                    onClick={() => handleOpenStreaming(selectedPlatform)}
                    disabled={isOpeningStreaming || !inVoice}
                    title={inVoice ? undefined : "Entre na call de voz para abrir streaming"}
                  >
                    <i className={isOpeningStreaming ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-play'}></i>
                    <span>{isOpeningStreaming ? 'Iniciando...' : (selectedPlatform === 'netflix' ? 'Abrir Netflix' : 'Abrir Prime')}</span>
                  </button>
                )}

                <div className={styles.infoNotice}>
                  <i className="fa-solid fa-shield-halved"></i>
                  <span>Sessão e cookies sincronizados com segurança no Concord.</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <YouTubeSearchModal
        isOpen={isSearchModalOpen || isYouTubeSearchOpen}
        onClose={() => {
          setIsSearchModalOpen(false);
          setIsYouTubeSearchOpen(false);
        }}
        onSelectVideo={handleSelectSearchVideo}
        isCurrentlyPlaying={isPlaying}
      />
    </div>
  );
};
