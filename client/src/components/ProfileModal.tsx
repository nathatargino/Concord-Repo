import React, { useState, useEffect, useRef, useCallback } from 'react';
import styles from './ProfileModal.module.css';
import { supabase, savePrefsToElectron } from '../lib/supabase';
import { useAppStore } from '../stores/useAppStore';
import { useAudioStore } from '../stores/useAudioStore';
import toast from 'react-hot-toast';

interface Props {
  onClose: () => void;
  onUpdate: (newName: string, newAvatar?: string) => void;
}

export const ProfileModal: React.FC<Props> = ({ onClose, onUpdate }) => {
  const initialName = useAppStore.getState().myName || localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1') || '';
  const initialAvatar = useAppStore.getState().myAvatarUrl || localStorage.getItem('concord_avatar_url') || '';

  const [activeTab, setActiveTab] = useState<'profile' | 'audio'>('profile');
  const [username, setUsername] = useState(initialName);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatar);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Áudio & Dispositivos ──
  const {
    selectedAudioInputId,
    selectedAudioOutputId,
    setSelectedAudioInputId,
    setSelectedAudioOutputId,
    micVol,
    setMicVol,
    remoteVol,
    setRemoteVol,
    noiseSuppression,
    setNoiseSuppression,
  } = useAudioStore();

  const [inputDevices, setInputDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [outputDevices, setOutputDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const loadDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      let devs = await navigator.mediaDevices.enumerateDevices();
      // Se não houver labels disponíveis, tenta obter permissão temporária
      if (!devs.some(d => d.label)) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(t => t.stop());
          devs = await navigator.mediaDevices.enumerateDevices();
        } catch {
          // Permissão não concedida ou cancelada
        }
      }

      const inputs = devs
        .filter(d => d.kind === 'audioinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Microfone ${i + 1}`,
        }));

      const outputs = devs
        .filter(d => d.kind === 'audiooutput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Dispositivo de Saída ${i + 1}`,
        }));

      setInputDevices(inputs);
      setOutputDevices(outputs);
    } catch (err) {
      console.warn('Erro ao enumerar dispositivos de áudio:', err);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'audio') {
      loadDevices();
    }
  }, [activeTab, loadDevices]);

  const stopMicTest = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setIsTestingMic(false);
    setMicLevel(0);
  }, []);

  const startMicTest = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: (selectedAudioInputId && selectedAudioInputId !== 'default') ? { exact: selectedAudioInputId } : undefined,
        }
      });
      micStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      setIsTestingMic(true);

      const updateMeter = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        const percentage = Math.min(100, Math.round((average / 110) * 100));
        setMicLevel(percentage);
        animFrameRef.current = requestAnimationFrame(updateMeter);
      };
      updateMeter();
    } catch (err) {
      toast.error('Não foi possível acessar o microfone para teste.');
      setIsTestingMic(false);
    }
  };

  const handleToggleMicTest = () => {
    if (isTestingMic) {
      stopMicTest();
    } else {
      startMicTest();
    }
  };

  const handleMicChange = (id: string) => {
    setSelectedAudioInputId(id);
    savePrefsToElectron({ concord_audio_input: id });
    if (isTestingMic) {
      stopMicTest();
    }
  };

  const handleHeadsetChange = (id: string) => {
    setSelectedAudioOutputId(id);
    savePrefsToElectron({ concord_audio_output: id });
  };

  const testHeadset = async () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.12); // A5

      gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.45);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (selectedAudioOutputId && selectedAudioOutputId !== 'default' && typeof (audioCtx as any).setSinkId === 'function') {
        await (audioCtx as any).setSinkId(selectedAudioOutputId);
      }

      osc.start();
      osc.stop(audioCtx.currentTime + 0.5);
      toast.success('Tocando som de teste no headset...');
    } catch (err) {
      console.warn('Erro ao testar headset:', err);
    }
  };

  const handleClose = () => {
    stopMicTest();
    onClose();
  };

  useEffect(() => {
    return () => {
      stopMicTest();
    };
  }, [stopMicTest]);

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error('A imagem deve ter no máximo 8MB!');
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const src = loadEvent.target?.result as string;
      if (!src) return;

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 256;
        let w = img.width;
        let h = img.height;
        if (w > h) {
          if (w > maxDim) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          }
        } else {
          if (h > maxDim) {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          const compressed = canvas.toDataURL('image/jpeg', 0.88);
          setAvatarUrl(compressed);
        } else {
          setAvatarUrl(src);
        }
        toast.success('Imagem selecionada! Clique em "Salvar Alterações" para confirmar.');
      };
      img.onerror = () => {
        setAvatarUrl(src);
        toast.success('Imagem selecionada! Clique em "Salvar Alterações" para confirmar.');
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setUserId(user.id);
          const { data: profile } = await supabase
            .from('profiles')
            .select('username, avatar_url')
            .eq('id', user.id)
            .maybeSingle();

          if (profile) {
            if (profile.username) setUsername(profile.username);
            if (profile.avatar_url) setAvatarUrl(profile.avatar_url);
          }
        }
      } catch (err) {
        console.error('Error fetching profile from Supabase:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();

    const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
    if (isElectron && (window as any).electron) {
      (window as any).electron.getAppVersion().then((version: string) => {
        setAppVersion(version);
      });
      const unsubscribe = (window as any).electron.onUpdateMessage((msg: string) => {
        setUpdateMessage(msg);
        setIsCheckingUpdate(false);
      });
      return () => {
        if (unsubscribe) unsubscribe();
      };
    }
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = username.trim();
    if (!cleanName) {
      toast.error('O apelido não pode ser vazio!');
      return;
    }

    setSaving(true);
    try {
      // 1. Atualizar estado global Zustand, LocalStorage e preferências do Electron
      useAppStore.getState().setMyName(cleanName);
      useAppStore.getState().setMyAvatarUrl(avatarUrl || null);

      localStorage.setItem('concord_username', cleanName);
      localStorage.setItem('concord_username_v1', cleanName);
      if (avatarUrl) {
        localStorage.setItem('concord_avatar_url', avatarUrl);
      } else {
        localStorage.removeItem('concord_avatar_url');
      }

      await savePrefsToElectron({
        concord_username: cleanName,
        concord_avatar_url: avatarUrl || '',
      });

      // 2. Atualizar no Supabase (se autenticado ou por busca de conta correspondente)
      try {
        let activeUid = userId;
        if (!activeUid) {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) activeUid = user.id;
        }

        if (activeUid) {
          const updates = {
            id: activeUid,
            username: cleanName,
            avatar_url: avatarUrl.trim() || null,
            updated_at: new Date().toISOString(),
          };

          await supabase.from('profiles').upsert(updates);

          await supabase.auth.updateUser({
            data: {
              username: cleanName,
              display_name: cleanName,
              avatar_url: avatarUrl.trim() || null,
            }
          });
        } else {
          // Atualizar perfil existente correspondente pelo nome antigo ou novo se houver no DB
          const lookupName = initialName || cleanName;
          const { data: existingProf } = await supabase
            .from('profiles')
            .select('id')
            .ilike('username', lookupName)
            .maybeSingle();

          if (existingProf?.id) {
            await supabase
              .from('profiles')
              .update({
                username: cleanName,
                avatar_url: avatarUrl.trim() || null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existingProf.id);
          }
        }
      } catch (sbErr) {
        console.warn('Supabase sync warning:', sbErr);
      }

      onUpdate(cleanName, avatarUrl);
      toast.success('Perfil atualizado com sucesso!');
      handleClose();
    } catch (err) {
      console.error('Save profile error:', err);
      toast.error('Erro ao salvar o perfil.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.overlay} onClick={handleClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <p style={{ color: '#fff' }}>Carregando perfil...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={handleClose}>×</button>
        <h2 className={styles.title}>Configurações</h2>

        {/* ── ABAS: Perfil e Áudio ── */}
        <div className={styles.tabContainer}>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'profile' ? styles.tabBtnActive : ''}`}
            onClick={() => {
              stopMicTest();
              setActiveTab('profile');
            }}
          >
            <span className={styles.tabIcon}>👤</span>
            Perfil
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'audio' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('audio')}
          >
            <span className={styles.tabIcon}>🎧</span>
            Áudio
          </button>
        </div>

        {/* ══ ABA 1: PERFIL ══ */}
        {activeTab === 'profile' && (
          <>
            <form onSubmit={handleSave} className={styles.form}>
              <div className={styles.avatarPreviewArea}>
                <div
                  className={styles.avatarCircle}
                  onClick={() => fileInputRef.current?.click()}
                  title="Clique para alterar a foto de perfil"
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Avatar" className={styles.avatarImg} />
                  ) : (
                    <span className={styles.avatarInitial}>{username.charAt(0).toUpperCase() || '?'}</span>
                  )}
                  <div className={styles.avatarHoverOverlay}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                    <span className={styles.avatarHoverText}>Alterar</span>
                  </div>
                </div>
              </div>

              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleAvatarFileChange}
              />

              <div className={styles.inputGroup}>
                <label className={styles.label}>Seu Apelido / Nome de Usuário</label>
                <input
                  type="text"
                  className={styles.input}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Digite seu nome..."
                  maxLength={32}
                />
              </div>

              <button type="submit" className={styles.saveBtn} disabled={saving || !username.trim()}>
                {saving ? 'Salvando...' : 'Salvar Alterações'}
              </button>
            </form>

            {appVersion && (
              <div className={styles.systemSection}>
                <div className={styles.systemHeader}>
                  <span className={styles.systemTitle}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                    Sistema
                  </span>
                </div>

                <div className={styles.systemCard}>
                  <div className={styles.systemInfo}>
                    <div className={styles.appNameRow}>
                      <span className={styles.appName}>Concord</span>
                      <span className={styles.versionBadge}>v{appVersion}</span>
                    </div>

                    <div className={styles.statusRow}>
                      {(() => {
                        if (isCheckingUpdate || updateMessage?.includes('Verificando')) {
                          return (
                            <span className={styles.statusChecking}>
                              <svg className={styles.spin} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                              </svg>
                              Verificando atualizações...
                            </span>
                          );
                        }
                        if (updateMessage?.includes('atualizado')) {
                          return (
                            <span className={styles.statusSuccess}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              {updateMessage}
                            </span>
                          );
                        }
                        if (updateMessage?.includes('Erro')) {
                          return (
                            <span className={styles.statusError}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                              </svg>
                              {updateMessage}
                            </span>
                          );
                        }
                        if (updateMessage) {
                          return (
                            <span className={styles.statusChecking}>
                              <span className={styles.statusIndicatorDot} />
                              {updateMessage}
                            </span>
                          );
                        }
                        return (
                          <span className={styles.statusDefault}>
                            <span className={styles.statusIndicatorDot} />
                            Versão estável mais recente
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  <button
                    type="button"
                    className={styles.updateBtn}
                    disabled={isCheckingUpdate}
                    onClick={(e) => {
                      e.preventDefault();
                      setIsCheckingUpdate(true);
                      (window as any).electron?.checkForUpdates();
                      setTimeout(() => setIsCheckingUpdate(false), 3000);
                    }}
                    title="Buscar atualizações do Concord"
                  >
                    <svg
                      className={isCheckingUpdate ? styles.spin : ''}
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21.5 2v6h-6" />
                      <path d="M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                    </svg>
                    {isCheckingUpdate ? 'Buscando...' : 'Verificar Atualizações'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ══ ABA 2: ÁUDIO ══ */}
        {activeTab === 'audio' && (
          <div className={styles.audioContainer}>
            {/* 1. Microfone */}
            <div className={styles.deviceCard}>
              <div className={styles.deviceCardHeader}>
                <span className={styles.deviceLabel}>
                  <span>🎙️</span> Microfone de Entrada
                </span>
              </div>
              <select
                className={styles.deviceSelect}
                value={selectedAudioInputId}
                onChange={(e) => handleMicChange(e.target.value)}
              >
                <option value="default">Microfone Padrão do Sistema</option>
                {inputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>

              {/* Teste do Microfone */}
              <div className={styles.micTestWrapper}>
                <button
                  type="button"
                  className={`${styles.testBtn} ${isTestingMic ? styles.testBtnActive : ''}`}
                  onClick={handleToggleMicTest}
                  title="Fale para testar a captação do microfone"
                >
                  {isTestingMic ? '⏹ Parar Teste' : '▶ Testar Microfone'}
                </button>
                <div className={styles.meterContainer} title="Nível de captação do microfone">
                  <div className={styles.meterFill} style={{ width: `${micLevel}%` }} />
                </div>
              </div>

              {/* Volume do Microfone */}
              <div className={styles.volumeRow}>
                <span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.6)' }}>Sensibilidade</span>
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={micVol}
                  onChange={(e) => setMicVol(Number(e.target.value))}
                  className={styles.volumeSlider}
                />
                <span className={styles.volumeValue}>{micVol}%</span>
              </div>
            </div>

            {/* 2. Headset / Saída */}
            <div className={styles.deviceCard}>
              <div className={styles.deviceCardHeader}>
                <span className={styles.deviceLabel}>
                  <span>🎧</span> Headset / Dispositivo de Saída
                </span>
                <button
                  type="button"
                  className={styles.testBtn}
                  onClick={testHeadset}
                  title="Reproduzir som de teste no headset"
                >
                  🔔 Testar Headset
                </button>
              </div>
              <select
                className={styles.deviceSelect}
                value={selectedAudioOutputId}
                onChange={(e) => handleHeadsetChange(e.target.value)}
              >
                <option value="default">Headset / Saída Padrão do Sistema</option>
                {outputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>

              {/* Volume de Saída */}
              <div className={styles.volumeRow}>
                <span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.6)' }}>Volume Geral</span>
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={remoteVol}
                  onChange={(e) => setRemoteVol(Number(e.target.value))}
                  className={styles.volumeSlider}
                />
                <span className={styles.volumeValue}>{remoteVol}%</span>
              </div>
            </div>

            {/* 3. Aprimoramento de Voz */}
            <div className={styles.deviceCard}>
              <div className={styles.deviceCardHeader}>
                <span className={styles.deviceLabel}>
                  <span>⚙️</span> Processamento de Voz
                </span>
              </div>
              <label className={styles.toggleRow}>
                <span className={styles.toggleLabel}>
                  🛡️ Supressão de Ruído de Fundo
                </span>
                <div className={styles.switch}>
                  <input
                    type="checkbox"
                    checked={noiseSuppression}
                    onChange={(e) => setNoiseSuppression(e.target.checked)}
                  />
                  <span className={styles.slider} />
                </div>
              </label>
              <p className={styles.helperText}>
                Filtra ruídos de teclado, ventilador e estática automaticamente durante as chamadas.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

