import React, { useEffect, useRef, useState } from 'react';
import styles from './PiPPlayer.module.css';

export const PiPPlayer: React.FC = () => {
  const [videoId, setVideoId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [title, setTitle] = useState('');
  
  const [isDraggingSeek, setIsDraggingSeek] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const playerRef = useRef<any>(null);

  useEffect(() => {
    const electron = (window as any).electron;
    if (electron && electron.onPipSync) {
      const unsubscribe = electron.onPipSync((state: any) => {
        if (!state) return;
        if (state.videoId !== undefined) setVideoId(state.videoId);
        if (state.isPlaying !== undefined) setIsPlaying(state.isPlaying);
        if (state.duration !== undefined) setDuration(state.duration);
        if (state.title !== undefined) setTitle(state.title);
        
        if (state.currentTime !== undefined && !isDraggingSeek) {
          setCurrentTime(state.currentTime);
          if (playerRef.current?.seekTo && Math.abs(state.currentTime - (playerRef.current?.getCurrentTime() || 0)) > 2) {
            playerRef.current.seekTo(state.currentTime, true);
          }
        }
      });
      return unsubscribe;
    }
  }, [isDraggingSeek]);

  // Sincronizar o estado interno do YouTube quando isPlaying muda via prop
  useEffect(() => {
    if (playerRef.current?.playVideo && playerRef.current?.pauseVideo) {
      try {
        if (isPlaying) playerRef.current.playVideo();
        else playerRef.current.pauseVideo();
      } catch (e) {
        console.debug('Player toggle error in PiP:', e);
      }
    }
  }, [isPlaying]);

  const sendAction = (action: string, payload?: any) => {
    const electron = (window as any).electron;
    if (electron && electron.sendPipAction) {
      electron.sendPipAction(action, payload);
    }
  };

  const handleClose = () => {
    const electron = (window as any).electron;
    if (electron?.closePipWindow) {
      electron.closePipWindow();
    } else {
      window.close();
    }
  };

  // Movimentação dinâmica da janela através do mouse
  const handleDragMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, a')) return;
    
    let startX = e.screenX;
    let startY = e.screenY;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.screenX - startX;
      const deltaY = moveEvent.screenY - startY;
      startX = moveEvent.screenX;
      startY = moveEvent.screenY;
      if (deltaX !== 0 || deltaY !== 0) {
        (window as any).electron?.movePipWindow?.(deltaX, deltaY);
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // YouTube IFrame API Load
  useEffect(() => {
    if (!videoId) return;
    
    const loadPlayer = () => {
      if (playerRef.current) {
        try {
          playerRef.current.loadVideoById(videoId, currentTime);
          return;
        } catch {
          playerRef.current = null;
        }
      }

      try {
        playerRef.current = new (window as any).YT.Player('pip-yt-player', {
          videoId,
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            showinfo: 0,
            iv_load_policy: 3,
            origin: window.location.origin
          },
          events: {
            onReady: (e: any) => {
              if (isPlaying) e.target.playVideo();
              if (currentTime > 0) e.target.seekTo(currentTime);
            },
            onStateChange: (e: any) => {
              if (e.data === (window as any).YT.PlayerState.PLAYING && !isPlaying) {
                sendAction('play');
              } else if (e.data === (window as any).YT.PlayerState.PAUSED && isPlaying) {
                sendAction('pause');
              }
            }
          }
        });
      } catch (err) {
        console.error('Error creating YT player in PiP:', err);
      }
    };

    if (!(window as any).YT || !(window as any).YT.Player) {
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
      (window as any).onYouTubeIframeAPIReady = loadPlayer;
    } else {
      loadPlayer();
    }
  }, [videoId]);

  return (
    <div className={styles.pipContainer}>
      {/* Barra superior de arraste */}
      <div className={styles.dragHeader} onMouseDown={handleDragMouseDown} title="Clique e arraste para mover o PiP">
        <div className={styles.dragHeaderLeft}>
          <span className={styles.gripIcon}>⠿</span>
          <span className={styles.dragTitle}>{title || 'Concord PiP'}</span>
        </div>
        <button className={styles.closeBtn} onClick={handleClose} title="Fechar PiP">
          ✕
        </button>
      </div>

      {/* Área do vídeo */}
      <div className={styles.videoWrapper}>
        {videoId ? (
          <>
            <div className={styles.youtubeContainer}>
              <div id="pip-yt-player" style={{ width: '100%', height: '100%' }} />
            </div>

            {/* Barra de progresso visível ao passar o mouse sobre o vídeo */}
            <div className={styles.videoOverlay}>
              <div className={styles.bottomSeekRow}>
                <span className={styles.timeLabel}>
                  {formatTime(isDraggingSeek ? seekValue : currentTime)}
                </span>
                <div className={styles.seekContainer}>
                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    step={0.1}
                    value={isDraggingSeek ? seekValue : currentTime}
                    className={styles.seekBar}
                    onMouseDown={() => {
                      setIsDraggingSeek(true);
                      setSeekValue(currentTime);
                    }}
                    onChange={(e) => setSeekValue(parseFloat(e.target.value))}
                    onMouseUp={(e) => {
                      setIsDraggingSeek(false);
                      const targetTime = parseFloat((e.target as HTMLInputElement).value);
                      sendAction('seek', targetTime);
                    }}
                  />
                </div>
                <span className={styles.timeLabel}>{formatTime(duration)}</span>
              </div>
            </div>
          </>
        ) : (
          <div className={styles.emptyState}>
            <span>Nenhum vídeo em reprodução</span>
          </div>
        )}
      </div>

      {/* Comandos de Controle fixos no bloco do PiP */}
      <div className={styles.commandsBar} onMouseDown={handleDragMouseDown}>
        <p className={styles.commandsLabel}>⎯⎯ COMANDOS DE CONTROLE ⎯⎯</p>
        <div className={styles.commandsGrid}>
          <button
            className={`${styles.cmdBtn} ${styles.btnPlay}`}
            onClick={() => sendAction('play')}
            title="Retomar música"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span>/play</span>
          </button>

          <button
            className={`${styles.cmdBtn} ${styles.btnPause}`}
            onClick={() => sendAction('pause')}
            title="Pausar música"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
            <span>/pause</span>
          </button>

          <button
            className={`${styles.cmdBtn} ${styles.btnSkip}`}
            onClick={() => sendAction('skip')}
            title="Pular música"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 4 15 12 5 20 5 4" />
              <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>/skip</span>
          </button>

          <button
            className={`${styles.cmdBtn} ${styles.btnClear}`}
            onClick={() => sendAction('clear')}
            title="Limpar fila"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4h6v2" />
            </svg>
            <span>/clear</span>
          </button>
        </div>
      </div>
    </div>
  );
};
