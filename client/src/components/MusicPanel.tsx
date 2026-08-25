import React, { useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import styles from './MusicPanel.module.css';

interface Props {
  onRequestMusic: (url: string) => void;
  onRemoveFromQueue: (token: number) => void;
  onReorderQueue: (oldIndex: number, newIndex: number) => void;
  inVoice: boolean;
}

export const MusicPanel: React.FC<Props> = ({ onRequestMusic, onRemoveFromQueue, onReorderQueue, inVoice }) => {
  const [url, setUrl] = useState('');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const { musicQueue, currentVideoId, isPlaying } = useAppStore();

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

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerIcon}>🎵</span>
        <h2 className={styles.headerTitle}>Música</h2>
        {isPlaying && (
          <div className={styles.nowPlayingBadge}>
            <span className={styles.eqBar} />
            <span className={styles.eqBar} />
            <span className={styles.eqBar} />
            <span>Tocando</span>
          </div>
        )}
      </div>

      <div className={styles.content}>
        {/* Current playing */}
        {currentVideoId && (
          <div className={styles.currentTrack}>
            <img
              src={`https://img.youtube.com/vi/${currentVideoId}/mqdefault.jpg`}
              alt="Thumbnail"
              className={styles.thumbnail}
            />
            <div className={styles.trackInfo}>
              <span className={styles.trackLabel}>Tocando agora</span>
              <a
                href={`https://youtube.com/watch?v=${currentVideoId}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.trackLink}
              >
                ver no YouTube →
              </a>
            </div>
          </div>
        )}

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
      </div>

      {/* Hidden YT player host */}
      <div id="yt-host" style={{ position: 'absolute', width: '1px', height: '1px', opacity: 0.1, pointerEvents: 'none' }} />
    </div>
  );
};
