import React, { useEffect, useRef, useState, useCallback } from 'react';
import styles from './ChatPanel.module.css';

export const PiPPlayer = () => {
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
        if (state.videoId !== undefined) setVideoId(state.videoId);
        if (state.isPlaying !== undefined) setIsPlaying(state.isPlaying);
        if (state.duration !== undefined) setDuration(state.duration);
        if (state.title !== undefined) setTitle(state.title);
        
        if (state.currentTime !== undefined && !isDraggingSeek) {
          setCurrentTime(state.currentTime);
          if (Math.abs(state.currentTime - (playerRef.current?.getCurrentTime() || 0)) > 2) {
             playerRef.current?.seekTo(state.currentTime);
          }
        }
      });
      return unsubscribe;
    }
  }, [isDraggingSeek]);

  // Sincronizar o estado interno do YouTube quando isPlaying muda via prop
  useEffect(() => {
    if (playerRef.current) {
      if (isPlaying) playerRef.current.playVideo();
      else playerRef.current.pauseVideo();
    }
  }, [isPlaying]);

  const sendAction = (action: string, payload?: any) => {
    const electron = (window as any).electron;
    if (electron && electron.sendPipAction) {
      electron.sendPipAction(action, payload);
    }
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
      if (playerRef.current) return;
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
          iv_load_policy: 3
        },
        events: {
          onReady: (e: any) => {
            if (isPlaying) e.target.playVideo();
            e.target.seekTo(currentTime);
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
    };

    if (!(window as any).YT) {
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
    <div className={styles.videoContainer} style={{ height: '100vh', width: '100vw', margin: 0, padding: 0, borderRadius: 0, border: 'none' }}>
      {videoId ? (
        <>
          <div className={styles.youtubeWrapper} style={{ pointerEvents: 'none' }}>
             <div id="pip-yt-player" style={{ width: '100%', height: '100%' }} />
          </div>

          <div className={styles.videoOverlay} style={{ padding: '8px' }}>
            <div className={styles.videoOverlayTop}>
              <span className={styles.videoTitle} style={{ fontSize: '12px' }}>{title || 'Vídeo do YouTube'}</span>
              <button className={styles.overlayControlBtn} onClick={() => {
                const electron = (window as any).electron;
                if (electron && electron.closePipWindow) electron.closePipWindow();
              }} title="Fechar PiP">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <button
              className={styles.centerPlayBtn}
              onClick={() => sendAction(isPlaying ? 'pause' : 'play')}
              style={{ width: '40px', height: '40px' }}
            >
              {isPlaying ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              )}
            </button>

            <div className={styles.videoOverlayBottom}>
              <span className={styles.timeText} style={{ fontSize: '10px' }}>{formatTime(isDraggingSeek ? seekValue : currentTime)}</span>
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
                    const targetTime = parseFloat(e.target.value);
                    sendAction('seek', targetTime);
                  }}
                />
              </div>
              <span className={styles.timeText} style={{ fontSize: '10px' }}>{formatTime(duration)}</span>

              <button className={styles.overlayControlBtn} onClick={() => sendAction('skip')} title="Pular Música">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" /></svg>
              </button>
            </div>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'white', background: '#0e0e18' }}>
          <span>Nenhum vídeo</span>
        </div>
      )}
    </div>
  );
};
