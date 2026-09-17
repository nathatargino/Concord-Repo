import React, { useState, useEffect, useCallback } from 'react';
import styles from './ScreenPickerModal.module.css';

export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
  appIcon?: string;
  isScreen: boolean;
}

interface ScreenPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (sourceId: string, withAudio: boolean) => void;
}

export const ScreenPickerModal: React.FC<ScreenPickerModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [activeTab, setActiveTab] = useState<'screens' | 'windows'>('screens');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [withAudio, setWithAudio] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);

  // Fetch sources from Electron desktopCapturer
  const loadSources = useCallback(async () => {
    try {
      setLoading(true);
      if (typeof window !== 'undefined' && (window as any).electron?.getScreenSources) {
        const list: ScreenSource[] = await (window as any).electron.getScreenSources();
        setSources(list);

        // Pre-select the first screen by default if available
        const firstScreen = list.find((s) => s.isScreen);
        if (firstScreen) {
          setSelectedSourceId(firstScreen.id);
          setActiveTab('screens');
        } else if (list.length > 0) {
          setSelectedSourceId(list[0].id);
          setActiveTab(list[0].isScreen ? 'screens' : 'windows');
        }
      }
    } catch (err) {
      console.error('[ScreenPicker] Failed to load sources:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadSources();
    } else {
      setSelectedSourceId(null);
      setSources([]);
    }
  }, [isOpen, loadSources]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const screens = sources.filter((s) => s.isScreen);
  const windows = sources.filter((s) => !s.isScreen);
  const displayedSources = activeTab === 'screens' ? screens : windows;

  const handleConfirm = (idToShare?: string) => {
    const finalId = idToShare || selectedSourceId;
    if (!finalId) return;
    const isScreenSource = sources.find((s) => s.id === finalId)?.isScreen ?? (activeTab === 'screens');
    onConfirm(finalId, isScreenSource ? withAudio : false);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.titleArea}>
            <span className={styles.headerIcon}>🖥️</span>
            <h2 className={styles.headerTitle}>Compartilhar Tela</h2>
          </div>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Fechar"
            title="Fechar (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Tab Bar */}
        <div className={styles.tabBar}>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'screens' ? styles.tabBtnActive : ''}`}
            onClick={() => {
              setActiveTab('screens');
              if (screens.length > 0 && (!selectedSourceId || !screens.some((s) => s.id === selectedSourceId))) {
                setSelectedSourceId(screens[0].id);
              }
            }}
          >
            <span>Telas</span>
            <span className={styles.badge}>{screens.length}</span>
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'windows' ? styles.tabBtnActive : ''}`}
            onClick={() => {
              setActiveTab('windows');
              if (windows.length > 0 && (!selectedSourceId || !windows.some((s) => s.id === selectedSourceId))) {
                setSelectedSourceId(windows[0].id);
              }
            }}
          >
            <span>Janelas</span>
            <span className={styles.badge}>{windows.length}</span>
          </button>
        </div>

        {/* Content / Grid */}
        <div className={styles.content}>
          {loading ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>⏳</div>
              <p>Carregando telas e janelas disponíveis...</p>
            </div>
          ) : displayedSources.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>🔍</div>
              <p>Nenhuma {activeTab === 'screens' ? 'tela' : 'janela'} encontrada</p>
            </div>
          ) : (
            <div className={styles.grid}>
              {displayedSources.map((source) => {
                const isSelected = selectedSourceId === source.id;
                return (
                  <div
                    key={source.id}
                    className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`}
                    onClick={() => setSelectedSourceId(source.id)}
                    onDoubleClick={() => handleConfirm(source.id)}
                    title={`${source.name} (Duplo clique para compartilhar)`}
                  >
                    <div className={styles.thumbnailWrapper}>
                      {source.thumbnail ? (
                        <img
                          src={source.thumbnail}
                          alt={source.name}
                          className={styles.thumbnail}
                        />
                      ) : (
                        <div className={styles.noThumbnail}>
                          {source.isScreen ? '🖥️' : '🪟'}
                        </div>
                      )}
                      {isSelected && (
                        <div className={styles.selectedIndicator}>✓</div>
                      )}
                    </div>
                    <div className={styles.cardInfo}>
                      {source.appIcon ? (
                        <img
                          src={source.appIcon}
                          alt=""
                          className={styles.appIcon}
                        />
                      ) : (
                        <span>{source.isScreen ? '🖥️' : '🪟'}</span>
                      )}
                      <span className={styles.sourceName}>{source.name}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <div className={styles.audioOption}>
            {activeTab === 'screens' ? (
              <>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={withAudio}
                    onChange={(e) => setWithAudio(e.target.checked)}
                    className={styles.checkbox}
                  />
                  <span>Compartilhar áudio do sistema</span>
                </label>
                <span className={styles.audioHint}>
                  Transmite o som do computador para a chamada
                </span>
              </>
            ) : (
              <div className={styles.audioHintDisabled}>
                <span>ℹ️ Áudio do sistema disponível apenas na transmissão de tela inteira</span>
              </div>
            )}
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="button"
              className={styles.shareBtn}
              onClick={() => handleConfirm()}
              disabled={!selectedSourceId}
            >
              <span>Transmitir</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
