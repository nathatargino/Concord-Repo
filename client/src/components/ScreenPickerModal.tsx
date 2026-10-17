import React, { useState, useEffect, useCallback } from 'react';
import { useAudioStore } from '../stores/useAudioStore';
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
  const audioStore = useAudioStore();
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [activeTab, setActiveTab] = useState<'screens' | 'windows'>('screens');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [withAudio, setWithAudio] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);

  // Qualidade de Transmissão (Discord-style)
  const [localRes, setLocalRes] = useState<'720p' | '1080p' | '1440p'>(() => {
    try {
      return ((localStorage.getItem('concord_screenshare_res') as any) || '1080p');
    } catch {
      return '1080p';
    }
  });
  const [localFps, setLocalFps] = useState<30 | 60>(() => {
    try {
      const saved = localStorage.getItem('concord_screenshare_fps');
      return saved === '30' ? 30 : 60;
    } catch {
      return 60;
    }
  });
  const [localHint, setLocalHint] = useState<'motion' | 'detail'>(() => {
    try {
      return ((localStorage.getItem('concord_screenshare_hint') as any) || 'motion');
    } catch {
      return 'motion';
    }
  });

  const screenShareResolution: '720p' | '1080p' | '1440p' =
    (audioStore as any).screenShareResolution ?? localRes;
  const screenShareFps: 30 | 60 =
    (audioStore as any).screenShareFps ?? localFps;
  const screenShareContentHint: 'motion' | 'detail' =
    (audioStore as any).screenShareContentHint ?? localHint;

  const setResolution = (res: '720p' | '1080p' | '1440p') => {
    if (typeof (audioStore as any).setScreenShareResolution === 'function') {
      (audioStore as any).setScreenShareResolution(res);
    }
    setLocalRes(res);
    try {
      localStorage.setItem('concord_screenshare_res', res);
    } catch {}
  };

  const setFps = (fps: 30 | 60) => {
    if (typeof (audioStore as any).setScreenShareFps === 'function') {
      (audioStore as any).setScreenShareFps(fps);
    }
    setLocalFps(fps);
    try {
      localStorage.setItem('concord_screenshare_fps', String(fps));
    } catch {}
  };

  const setContentHint = (hint: 'motion' | 'detail') => {
    if (typeof (audioStore as any).setScreenShareContentHint === 'function') {
      (audioStore as any).setScreenShareContentHint(hint);
    }
    setLocalHint(hint);
    try {
      localStorage.setItem('concord_screenshare_hint', hint);
    } catch {}
  };

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
    onConfirm(finalId, withAudio);
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

        {/* Barra de Configurações de Qualidade Estilo Discord */}
        <div className={styles.qualityBar}>
          <div className={styles.qualitySection}>
            <span className={styles.qualityLabel}>RESOLUÇÃO</span>
            <div className={styles.pillGroup}>
              <button
                type="button"
                className={`${styles.pillBtn} ${screenShareResolution === '720p' ? styles.pillBtnActive : ''}`}
                onClick={() => setResolution('720p')}
              >
                720p
              </button>
              <button
                type="button"
                className={`${styles.pillBtn} ${screenShareResolution === '1080p' ? styles.pillBtnActive : ''}`}
                onClick={() => setResolution('1080p')}
              >
                1080p (Full HD)
              </button>
              <button
                type="button"
                className={`${styles.pillBtn} ${screenShareResolution === '1440p' ? styles.pillBtnActive : ''}`}
                onClick={() => setResolution('1440p')}
              >
                1440p (Fonte)
              </button>
            </div>
          </div>

          <div className={styles.qualitySection}>
            <span className={styles.qualityLabel}>TAXA DE QUADROS</span>
            <div className={styles.pillGroup}>
              <button
                type="button"
                className={`${styles.pillBtn} ${screenShareFps === 30 ? styles.pillBtnActive : ''}`}
                onClick={() => setFps(30)}
              >
                30 FPS
              </button>
              <button
                type="button"
                className={`${styles.pillBtn} ${screenShareFps === 60 ? styles.pillBtnActive : ''}`}
                onClick={() => setFps(60)}
              >
                60 FPS
              </button>
            </div>
          </div>

          <div className={styles.qualitySection}>
            <span className={styles.qualityLabel}>OTIMIZAÇÃO</span>
            <div className={styles.pillGroup}>
              <button
                type="button"
                className={`${styles.pillBtn} ${screenShareContentHint === 'motion' ? styles.pillBtnActive : ''}`}
                onClick={() => setContentHint('motion')}
                title="Fluidez para jogos, vídeos e animações rápidas"
              >
                <i className="fa-solid fa-gamepad" style={{ marginRight: '5px' }}></i>
                Fluidez (Jogos/Vídeo)
              </button>
              <button
                type="button"
                className={`${styles.pillBtn} ${screenShareContentHint === 'detail' ? styles.pillBtnActive : ''}`}
                onClick={() => setContentHint('detail')}
                title="Nitidez para textos, código e navegadores"
              >
                <i className="fa-solid fa-file-lines" style={{ marginRight: '5px' }}></i>
                Nitidez (Texto)
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <div className={styles.audioOption}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={withAudio}
                onChange={(e) => setWithAudio(e.target.checked)}
                className={styles.checkbox}
              />
              <span>Compartilhar áudio do sistema (Jogos, Vídeos e Aplicativos)</span>
            </label>
            <span className={styles.audioHint}>
              Transmite o áudio de jogos, filmes e janelas via WASAPI no Windows
            </span>
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
