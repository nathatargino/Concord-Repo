import React from 'react';
import { useAudioStore } from '../stores/useAudioStore';
import { useAppStore } from '../stores/useAppStore';
import styles from './AudioControls.module.css';

interface Props {
  onUnlockAudio: () => void;
}

export const AudioControls: React.FC<Props> = ({ onUnlockAudio }) => {
  const {
    ytVol,
    micVol,
    remoteVol,
    screenShareVol,
    micMuted,
    callMuted,
    setYtVol,
    setMicVol,
    setRemoteVol,
    setScreenShareVol,
    toggleMicMute,
    toggleCallMute,
    resetAll,
  } = useAudioStore();

  const { isPlaying, currentVideoId, screenShareUserId, amSharing } = useAppStore();

  const isMusicActive = isPlaying || currentVideoId !== null;
  const isScreenShareActive = screenShareUserId !== null && !amSharing;

  const handlePointerDown = () => {
    onUnlockAudio();
  };

  return (
    <div className={styles.panel} onPointerDown={handlePointerDown}>
      <div className={styles.header}>
        <span className={styles.headerIcon}>🎧</span>
        <h2 className={styles.headerTitle}>Áudio</h2>
        <button className={styles.resetBtn} onClick={resetAll} title="Resetar configurações">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
      </div>

      <div className={styles.content}>
        {/* Call Mute & Mic Mute Toggles */}
        <div className={styles.toggles}>
          <button
            className={`${styles.toggleBtn} ${micMuted ? styles.toggleMuted : ''}`}
            onClick={toggleMicMute}
            title={micMuted ? 'Desmutar Microfone' : 'Mutar Microfone'}
          >
            {micMuted ? '🔇 Mic Mute' : '🎙️ Mic On'}
          </button>
          <button
            className={`${styles.toggleBtn} ${callMuted ? styles.toggleMuted : ''}`}
            onClick={toggleCallMute}
            title={callMuted ? 'Desmutar Chamada' : 'Mutar Chamada (Ouvir nada)'}
          >
            {callMuted ? '🔇 Call Mute' : '🔊 Call On'}
          </button>
        </div>

        {/* Volume Sliders */}
        <div className={styles.sliders}>
          <div className={styles.sliderGroup}>
            <div className={styles.sliderHeader}>
              <span className={styles.sliderLabel}>Microfone</span>
              <span className={styles.sliderValue}>{micVol}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="200"
              value={micVol}
              onChange={(e) => setMicVol(Number(e.target.value))}
              className={styles.range}
              disabled={micMuted}
            />
          </div>

          <div className={styles.sliderGroup}>
            <div className={styles.sliderHeader}>
              <span className={styles.sliderLabel}>Voz dos Usuários</span>
              <span className={styles.sliderValue}>{remoteVol}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="200"
              value={remoteVol}
              onChange={(e) => setRemoteVol(Number(e.target.value))}
              className={styles.range}
              disabled={callMuted}
            />
          </div>

          {isMusicActive && (
            <div className={styles.sliderGroup}>
              <div className={styles.sliderHeader}>
                <span className={styles.sliderLabel}>YouTube</span>
                <span className={styles.sliderValue}>{ytVol}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={ytVol}
                onChange={(e) => setYtVol(Number(e.target.value))}
                className={styles.range}
                disabled={callMuted}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

