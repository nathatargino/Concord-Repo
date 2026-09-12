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
  const [volume, setVolume] = useState<number>(80);
  const volumeRef = useRef<number>(80);
  const playerRef = useRef<any>(null);

  useEffect(() => {
    volumeRef.current = volume;
    if (playerRef.current?.setVolume) {
      try {
        playerRef.current.setVolume(volume);
        if (volume === 0) {
          playerRef.current.mute();
        } else {
          playerRef.current.unMute();
        }
      } catch (e) {
        console.debug('Error setting PiP volume in effect:', e);
      }
    }
  }, [volume]);

  useEffect(() => {
    const electron = (window as any).electron;
    if (electron && electron.onPipSync) {
      const unsubscribe = electron.onPipSync((state: any) => {
        if (!state) return;
        if (state.videoId !== undefined) setVideoId(state.videoId);
        if (state.isPlaying !== undefined) setIsPlaying(state.isPlaying);
        if (state.duration !== undefined) setDuration(state.duration);
        if (state.title !== undefined) setTitle(state.title);

        if (state.volume !== undefined) {
          const vol = Number(state.volume);
          setVolume(vol);
          volumeRef.current = vol;
          if (playerRef.current) {
            try {
              playerRef.current.setVolume(vol);
              if (vol === 0) {
                playerRef.current.mute();
              } else {
                playerRef.current.unMute();
              }
            } catch (e) {
              console.debug('Error setting PiP volume:', e);
            }
          }
        }
        
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
          playerRef.current.setVolume(volumeRef.current);
          if (volumeRef.current === 0) {
            playerRef.current.mute();
          } else {
            playerRef.current.unMute();
          }
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
              try {
                e.target.setVolume(volumeRef.current);
                if (volumeRef.current === 0) {
                  e.target.mute();
                } else {
                  e.target.unMute();
                }
              } catch (err) {}
              if (isPlaying) e.target.playVideo();
              if (currentTime > 0) e.target.seekTo(currentTime);
            },
            onStateChange: (e: any) => {
              if (e.data === (window as any).YT?.PlayerState?.PLAYING) {
                try {
                  e.target.setVolume(volumeRef.current);
                  if (volumeRef.current === 0) {
                    e.target.mute();
                  } else {
                    e.target.unMute();
                  }
                } catch (err) {}
                if (!isPlaying) sendAction('play');
              } else if (e.data === (window as any).YT?.PlayerState?.PAUSED && isPlaying) {
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

                {/* Controle de Volume integrado ao PiP */}
                <div className={styles.volumeWrapper}>
                  <button
                    className={styles.volumeBtn}
                    onClick={() => {
                      const newVol = volume > 0 ? 0 : 80;
                      setVolume(newVol);
                      sendAction('volume', newVol);
                    }}
                    title={volume === 0 ? "Desmutar" : "Mutar"}
                  >
                    {volume === 0 ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                      </svg>
                    )}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={(e) => {
                      const newVol = parseInt(e.target.value);
                      setVolume(newVol);
                      sendAction('volume', newVol);
                    }}
                    className={styles.volumeBar}
                    title={`Volume: ${volume}%`}
                  />
                </div>
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
