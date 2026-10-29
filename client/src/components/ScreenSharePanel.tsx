import React, { useEffect, useRef, useState } from 'react';
import Draggable from 'react-draggable';
import { useAppStore } from '../stores/useAppStore';
import { useAudioStore } from '../stores/useAudioStore';
import styles from './ScreenSharePanel.module.css';

interface Props {
  onClose: () => void;
  screenStream?: MediaStream | null;
  onStartWatching?: (broadcasterId: string) => void;
  onStopWatching?: (broadcasterId: string) => void;
}

export const ScreenSharePanel: React.FC<Props> = ({ 
  onClose, 
  screenStream,
  onStartWatching,
  onStopWatching
}) => {
  const { screenShareUserId, screenShareUserName, myId, users, setScreenShare } = useAppStore();
  const { screenShareVol, setScreenShareVol } = useAudioStore();
  const prevScreenVolRef = useRef<number>(screenShareVol > 0 ? screenShareVol : 50);

  const otherBroadcasters = users.filter((u) => u.screenSharing && u.id !== myId);

  // Sincronizar e fixar o volume nos elementos de áudio da transmissão (evita reset para 100%)
  useEffect(() => {
    const fraction = Math.min(1, Math.max(0, screenShareVol / 100));
    const isMuted = screenShareVol === 0;

    const audioEl = document.getElementById(`remote-screen-audio-${screenShareUserId}`) as HTMLAudioElement | null;
    if (audioEl) {
      audioEl.volume = fraction;
      audioEl.muted = isMuted;
    }

    document.querySelectorAll<HTMLAudioElement>('audio[id^="remote-screen-audio-"]').forEach((a) => {
      a.volume = fraction;
      a.muted = isMuted;
    });
  }, [screenShareUserId, screenShareVol]);

  const handleToggleScreenMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (screenShareVol > 0) {
      prevScreenVolRef.current = screenShareVol;
      setScreenShareVol(0);
    } else {
      const restored = prevScreenVolRef.current > 0 ? prevScreenVolRef.current : 50;
      setScreenShareVol(restored);
    }
  };
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const onStartWatchingRef = useRef(onStartWatching);
  const onStopWatchingRef = useRef(onStopWatching);

  useEffect(() => {
    onStartWatchingRef.current = onStartWatching;
    onStopWatchingRef.current = onStopWatching;
  });

  // Notificar entrada/saída como espectador e ocultar WebContentsView de streaming para não sobrepor o painel
  useEffect(() => {
    if (screenShareUserId && screenShareUserId !== myId) {
      const electron = typeof window !== 'undefined' ? (window as any).electron : null;
      electron?.setModalActive?.(true);
      onStartWatchingRef.current?.(screenShareUserId);
      return () => {
        electron?.setModalActive?.(false);
        onStopWatchingRef.current?.(screenShareUserId);
      };
    }
  }, [screenShareUserId, myId]);

  // Bind screenStream to the video element whenever stream changes
  useEffect(() => {
    const videoEl = videoRef.current;
    if (videoEl) {
      if (screenStream) {
        if (videoEl.srcObject !== screenStream) {
          videoEl.srcObject = screenStream;
        }
        videoEl.play().catch((err) => {
          console.debug('[ScreenSharePanel] video play error:', err);
        });
      } else {
        videoEl.srcObject = null;
      }
    }
  }, [screenStream]);

  // Escutar 'addtrack' e 'unmute' nas tracks do screenStream para forçar play imediato (elimina tela preta)
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !screenStream) return;

    const playVideo = () => {
      if (videoEl.paused) {
        videoEl.play().catch(() => {});
      }
    };

    screenStream.addEventListener('addtrack', playVideo);
    const tracks = screenStream.getTracks();
    tracks.forEach((track) => {
      track.addEventListener('unmute', playVideo);
    });

    return () => {
      screenStream.removeEventListener('addtrack', playVideo);
      tracks.forEach((track) => {
        track.removeEventListener('unmute', playVideo);
      });
    };
  }, [screenStream]);

  // Recarregar Vídeo e Desbloquear Áudio manualmente
  const handleReloadVideo = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const videoEl = videoRef.current;
    if (videoEl && screenStream) {
      videoEl.srcObject = screenStream;
      videoEl.play().catch((err) => {
        console.debug('[ScreenSharePanel] video reload play error:', err);
      });
    }
    document.querySelectorAll<HTMLAudioElement>('audio[id^="remote-screen-audio-"]').forEach((a) => {
      if (a.paused) {
        a.play().catch(() => {});
      }
    });
  };

  // Toggle fullscreen mode
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => { });
    } else {
      document.exitFullscreen().catch(() => { });
    }
  };

  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.error('PiP failed', err);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // If not watching someone or if trying to watch myself, do not render floating viewer panel
  if (!screenShareUserId || screenShareUserId === myId) return null;

  // Calculate default position (top right with 16px margin)
  const defaultPosition = { x: typeof window !== 'undefined' ? window.innerWidth - 496 : 0, y: 16 };

  // Unblock any paused audio element if blocked by browser autoplay
  const handlePanelClick = () => {
    document.querySelectorAll<HTMLAudioElement>('audio[id^="remote-screen-audio-"]').forEach((a) => {
      if (a.paused) {
        a.play().catch(() => {});
      }
    });
  };

  return (
    <div className={styles.overlay} onClick={handlePanelClick}>
      <Draggable nodeRef={containerRef as any} handle=".drag-handle" bounds="parent" defaultPosition={defaultPosition}>
        <div
          ref={containerRef}
          className={`${styles.panel} ${isFullscreen ? styles.fullscreen : ''}`}
          onClick={handlePanelClick}
        >
          <div className={`${styles.header} drag-handle`}>
            <div className={styles.titleArea}>
              <span className={styles.icon}>🖥️</span>
              <span className={styles.title} title={`Tela de ${screenShareUserName}`}>
                Tela de {screenShareUserName}
              </span>
              <span className={styles.liveBadge}>AO VIVO</span>
            </div>
            <div 
              className={styles.actions}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={styles.actionBtn}
                onClick={handleReloadVideo}
                title="Recarregar Vídeo e Desbloquear Áudio (resolve tela preta)"
              >
                🔄
              </button>
              <div 
                className={styles.volControl} 
                title="Volume da Transmissão"
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <span 
                  className={styles.volIcon}
                  onClick={handleToggleScreenMute}
                  title={screenShareVol === 0 ? "Desmutar transmissão" : "Mutar transmissão"}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  {screenShareVol === 0 ? '🔇' : '🔊'}
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.min(100, Math.max(0, screenShareVol))}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (val > 0) prevScreenVolRef.current = val;
                    setScreenShareVol(val);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={styles.volSlider}
                />
                <span className={styles.volText}>{Math.min(100, Math.max(0, screenShareVol))}%</span>
              </div>
              <button className={styles.actionBtn} onClick={togglePiP} title="Picture-in-Picture">
                📌
              </button>
              <button className={styles.actionBtn} onClick={toggleFullscreen} title="Tela Cheia">
                {isFullscreen ? '↙️' : '↗️'}
              </button>
              <button className={styles.closeBtn} onClick={onClose} title="Fechar visualização">
                ✕
              </button>
            </div>
          </div>

          {/* Barra dedicada para alternar transmissões sem poluir o cabeçalho nem sobrepor o botão de Tela Cheia */}
          {otherBroadcasters.length > 1 && (
            <div 
              className={styles.multiStreamSwitcherBar}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span className={styles.switcherLabel}>Transmissões:</span>
              <div className={styles.switcherPills}>
                {otherBroadcasters.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className={`${styles.streamPillBtn} ${u.id === screenShareUserId ? styles.streamPillBtnActive : ''}`}
                    onClick={() => setScreenShare(u.id, u.name)}
                    title={`Assistir transmissão de ${u.name}`}
                  >
                    <span className={styles.pillIcon}>📺</span>
                    <span className={styles.pillName}>{u.name}</span>
                    {u.id === screenShareUserId && <span className={styles.pillDot} />}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={styles.videoContainer} onDoubleClick={toggleFullscreen} title="Dois cliques para alternar Tela Cheia">
            <video
              id="screen-share-video"
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={() => videoRef.current?.play().catch(() => {})}
              className={styles.video}
            />
          </div>
        </div>
      </Draggable>
    </div>
  );
};
