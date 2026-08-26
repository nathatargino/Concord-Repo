import React, { useEffect, useRef, useState } from 'react';
import Draggable from 'react-draggable';
import { useAppStore } from '../stores/useAppStore';
import { useAudioStore } from '../stores/useAudioStore';
import styles from './ScreenSharePanel.module.css';

interface Props {
  onClose: () => void;
  screenStream?: MediaStream | null;
}

export const ScreenSharePanel: React.FC<Props> = ({ onClose, screenStream }) => {
  const { screenShareUserId, screenShareUserName, amSharing } = useAppStore();
  const { screenShareVol, setScreenShareVol } = useAudioStore();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

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

  // If not watching someone or if I am the one sharing, do not render floating viewer panel
  if (!screenShareUserId || amSharing) return null;

  // Calculate default position (top right with 16px margin)
  const defaultPosition = { x: typeof window !== 'undefined' ? window.innerWidth - 496 : 0, y: 16 };

  return (
    <div className={styles.overlay}>
      <Draggable nodeRef={containerRef} handle=".drag-handle" bounds="parent" defaultPosition={defaultPosition}>
        <div
          ref={containerRef}
          className={`${styles.panel} ${isFullscreen ? styles.fullscreen : ''}`}
        >
          <div className={`${styles.header} drag-handle`}>
            <div className={styles.titleArea}>
              <span className={styles.icon}>🖥️</span>
              <span className={styles.title}>
                Tela de {screenShareUserName}
              </span>
              <span className={styles.liveBadge}>AO VIVO</span>
            </div>
            <div className={styles.actions}>
              <div className={styles.volControl} title="Volume da Transmissão">
                <span className={styles.volIcon}>🔊</span>
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={screenShareVol}
                  onChange={(e) => setScreenShareVol(Number(e.target.value))}
                  className={styles.volSlider}
                />
                <span className={styles.volText}>{screenShareVol}%</span>
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

          <div className={styles.videoContainer}>
            <video
              id="screen-share-video"
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={styles.video}
            />
          </div>
        </div>
      </Draggable>
    </div>
  );
};
