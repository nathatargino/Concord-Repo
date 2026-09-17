import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import styles from './ProfileModal.module.css';
import { 
  supabase, 
  savePrefsToElectron, 
  leaveServerFromSupabase, 
  removeMyServer,
  updateServerNameInSupabase,
  updateServerLogoInSupabase
} from '../lib/supabase';
import { useAppStore } from '../stores/useAppStore';
import { useAudioStore } from '../stores/useAudioStore';
import toast from 'react-hot-toast';

interface Props {
  onClose: () => void;
  onUpdate: (newName: string, newAvatar?: string) => void;
  onUpdateServer?: (serverId: string, newName?: string, newIconUrl?: string) => void;
  initialTab?: 'server' | 'profile' | 'audio';
}

export const ProfileModal: React.FC<Props> = ({ onClose, onUpdate, onUpdateServer, initialTab }) => {
  const navigate = useNavigate();
  const { 
    room, 
    isServer, 
    serverName, 
    setServerName, 
    serverIconUrl, 
    setServerIconUrl, 
    serverMembers,
    myId,
    myName, 
    myAvatarUrl 
  } = useAppStore();

  const myMember = serverMembers.find(m => m.username?.toLowerCase() === (myName || '').toLowerCase());
  const isOwner = (room?.adminIds?.includes(myId) && !room?.subOwnerIds?.includes(myId)) || myMember?.role === 'owner' || room?.ownerId === myId;
  const isSubOwner = room?.subOwnerIds?.includes(myId) || myMember?.role === 'sub_owner';
  const canEditServer = isOwner || isSubOwner;

  const [serverEditName, setServerEditName] = useState(room?.name || serverName || '');
  const [serverEditLogo, setServerEditLogo] = useState(serverIconUrl || room?.iconUrl || '');
  const [savingServer, setSavingServer] = useState(false);
  const serverLogoInputRef = useRef<HTMLInputElement>(null);

  const initialName = myName || localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1') || '';
  const initialAvatar = myAvatarUrl || localStorage.getItem('concord_avatar_url') || '';

  const [activeTab, setActiveTab] = useState<'server' | 'profile' | 'audio'>(initialTab || (room ? 'server' : 'profile'));
  const [username, setUsername] = useState(initialName);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatar);
  const [saving, setSaving] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Áudio & Dispositivos ──
  const {
    selectedAudioInputId,
    selectedAudioOutputId,
    setSelectedAudioInputId,
    setSelectedAudioOutputId,
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
      if (!devs.some(d => d.label)) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(t => t.stop());
          devs = await navigator.mediaDevices.enumerateDevices();
        } catch {
          // Permissão não concedida
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

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      setIsTestingMic(true);

      const updateMeter = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const normalized = Math.min(100, Math.round((avg / 128) * 100));
        setMicLevel(normalized);
        animFrameRef.current = requestAnimationFrame(updateMeter);
      };

      updateMeter();
    } catch (err) {
      console.error('Erro ao testar microfone:', err);
      toast.error('Não foi possível acessar o microfone.');
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
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.12);

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

  // Carregar dados
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase
            .from('profiles')
            .select('username, avatar_url')
            .eq('id', user.id)
            .single();

          if (data) {
            if (data.username) setUsername(data.username);
            if (data.avatar_url) setAvatarUrl(data.avatar_url);
          }
        }
      } catch (err) {
        console.warn('Erro ao carregar perfil:', err);
      }
    };
    fetchUser();
  }, []);

  // ── AÇÕES DO SERVIDOR (PROTÓTIPO) ──
  const handleCopyInvite = () => {
    if (!room) return;
    const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
    const baseUrl = isElectron ? 'https://concord-olive.vercel.app' : window.location.origin;
    const inviteMessage = `Você foi convidado para ${(room.isServer || isServer) ? 'um servidor' : 'uma sala'} no Concord! Acesse o link abaixo para entrar:\n${baseUrl}\nCódigo de convite: ${room.code}`;

    if ((window as any).electron?.copyToClipboard) {
      (window as any).electron.copyToClipboard(inviteMessage);
      toast.success('Link de convite copiado!');
    } else {
      navigator.clipboard.writeText(inviteMessage).then(() => {
        toast.success('Link de convite copiado!');
      }).catch(() => {
        toast.error('Erro ao copiar link');
      });
    }
  };

  const handleCopyCode = () => {
    if (!room?.code) return;
    if ((window as any).electron?.copyToClipboard) {
      (window as any).electron.copyToClipboard(room.code);
      toast.success('Código copiado!');
    } else {
      navigator.clipboard.writeText(room.code).then(() => {
        toast.success('Código copiado!');
      });
    }
  };

  const handleBackToMenu = () => {
    handleClose();
    useAppStore.getState().setRoom(null);
    navigate('/');
    toast.success('Voltando ao Menu Principal...');
  };

  const handleLeaveServer = async () => {
    if (!room) return;
    if (!window.confirm(room.isServer || isServer ? 'Tem certeza de que deseja sair deste servidor?' : 'Tem certeza de que deseja sair desta sala?')) {
      return;
    }
    setIsLeaving(true);
    try {
      if (room.isServer || isServer) {
        await leaveServerFromSupabase(room.id, myName);
        removeMyServer(room.id);
        removeMyServer(room.code);
        toast.success('Você saiu do servidor.');
      } else {
        toast.success('Você saiu da sala.');
      }
    } catch (err) {
      console.warn('Erro ao sair do servidor:', err);
    } finally {
      setIsLeaving(false);
      handleClose();
      useAppStore.getState().setRoom(null);
      navigate('/');
    }
  };

  // ── SALVAR PERFIL ──
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
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = username.trim();
    if (!cleanName || cleanName.length < 2) {
      toast.error('O apelido deve ter pelo menos 2 caracteres.');
      return;
    }

    setSaving(true);
    try {
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

  return createPortal(
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Modal Header matching prototype */}
        <div className={styles.modalHeader}>
          <div className={styles.modalHeaderLeft}>
            <div className={styles.modalHeaderIcon}>
              <i className="fa-solid fa-gear"></i>
            </div>
            <div className={styles.modalHeaderTitles}>
              <h3 className={styles.modalTitle}>Configurações</h3>
              <p className={styles.modalSubtitle}>Opções do servidor e conta</p>
            </div>
          </div>
          <button type="button" className={styles.closeBtn} onClick={handleClose}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {/* Tab Selector */}
        <div className={styles.tabContainer}>
          {room && (
            <button
              type="button"
              className={`${styles.tabBtn} ${activeTab === 'server' ? styles.tabBtnActive : ''}`}
              onClick={() => {
                stopMicTest();
                setActiveTab('server');
              }}
            >
              <i className="fa-solid fa-server"></i>
              <span>Servidor</span>
            </button>
          )}
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'profile' ? styles.tabBtnActive : ''}`}
            onClick={() => {
              stopMicTest();
              setActiveTab('profile');
            }}
          >
            <i className="fa-solid fa-user"></i>
            <span>Meu Perfil</span>
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'audio' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('audio')}
          >
            <i className="fa-solid fa-headphones"></i>
            <span>Voz e Áudio</span>
          </button>
        </div>

        {/* ══ ABA 1: SERVIDOR (PROTÓTIPO EXATO) ══ */}
        {activeTab === 'server' && room && (
          <div className={styles.serverSection}>
            {/* Server Info Box */}
            <div className={styles.serverInfoBox}>
              <div>
                <p className={styles.serverInfoLabel}>Identificador do Servidor</p>
                <p className={styles.serverInfoCode} onClick={handleCopyCode} title="Clique para copiar">
                  <span>{room.code}</span>
                  <i className="fa-solid fa-copy" style={{ fontSize: '11px', color: '#9ca3af' }}></i>
                </p>
              </div>
              <span className={styles.serverBadge}>
                {room.name || serverName || 'Concord'}
              </span>
            </div>

            {/* Personalização do Servidor (Nome e Foto) */}
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!room?.id) return;
              const cleanName = serverEditName.trim();
              if (isOwner && (!cleanName || cleanName.length < 2)) {
                toast.error('O nome do servidor deve ter pelo menos 2 caracteres.');
                return;
              }
              setSavingServer(true);
              try {
                if (isOwner && cleanName && cleanName !== (room.name || serverName)) {
                  await updateServerNameInSupabase(room.id, cleanName);
                  setServerName(cleanName);
                }
                if (serverEditLogo && serverEditLogo !== (room.iconUrl || serverIconUrl)) {
                  await updateServerLogoInSupabase(room.id, serverEditLogo);
                  setServerIconUrl(serverEditLogo);
                }
                if (onUpdateServer) {
                  onUpdateServer(room.id, cleanName || undefined, serverEditLogo || undefined);
                }
                toast.success('Servidor atualizado com sucesso!');
              } catch (err) {
                console.error('Update server error:', err);
                toast.error('Erro ao atualizar servidor.');
              } finally {
                setSavingServer(false);
              }
            }} className={styles.serverCustomizationBox}>
              <p className={styles.serverInfoLabel}>Personalização do Servidor</p>
              <div className={styles.serverLogoRow}>
                <input 
                  type="file" 
                  ref={serverLogoInputRef} 
                  style={{ display: 'none' }} 
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => {
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
                          if (w > maxDim) { h = Math.round((h * maxDim) / w); w = maxDim; }
                        } else {
                          if (h > maxDim) { w = Math.round((w * maxDim) / h); h = maxDim; }
                        }
                        canvas.width = w;
                        canvas.height = h;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                          ctx.drawImage(img, 0, 0, w, h);
                          setServerEditLogo(canvas.toDataURL('image/jpeg', 0.88));
                        } else {
                          setServerEditLogo(src);
                        }
                        toast.success('Imagem da logo selecionada! Clique em "Salvar Alterações" para confirmar.');
                      };
                      img.src = src;
                    };
                    reader.readAsDataURL(file);
                  }}
                  disabled={!canEditServer}
                />
                <div 
                  className={styles.serverLogoCircle}
                  onClick={() => canEditServer && serverLogoInputRef.current?.click()}
                  title={canEditServer ? "Clique para alterar a foto do servidor" : "Apenas Donos ou Sub Donos podem alterar a foto"}
                  style={{ cursor: canEditServer ? 'pointer' : 'default' }}
                >
                  {serverEditLogo ? (
                    <img src={serverEditLogo} alt="Logo" className={styles.serverLogoImg} />
                  ) : (
                    <span className={styles.serverLogoFallback}>
                      {(serverEditName || room.name || 'S').charAt(0).toUpperCase()}
                    </span>
                  )}
                  {canEditServer && (
                    <div className={styles.avatarHoverOverlay}>
                      <i className="fa-solid fa-camera" style={{ fontSize: '16px' }} />
                    </div>
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <input
                    type="text"
                    className={styles.serverNameInput}
                    value={serverEditName}
                    onChange={(e) => setServerEditName(e.target.value)}
                    maxLength={40}
                    disabled={!isOwner}
                    placeholder={isOwner ? "Nome do Servidor" : "Nome do Servidor (Apenas Dono)"}
                    title={isOwner ? "Nome do Servidor" : "Apenas o Dono pode alterar o nome do servidor"}
                  />
                </div>
              </div>

              {canEditServer && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                  <button 
                    type="submit" 
                    className={styles.serverSaveBtn}
                    disabled={savingServer || (!serverEditName.trim())}
                  >
                    {savingServer ? 'Salvando...' : 'Salvar Alterações'}
                  </button>
                </div>
              )}
            </form>

            {/* Actions List */}
            <div className={styles.actionsGroup}>
              <p className={styles.actionsTitle}>Ações do Servidor</p>

              {/* Convidar Amigos */}
              <button
                type="button"
                onClick={handleCopyInvite}
                className={styles.actionBtn}
              >
                <span className={styles.actionBtnContent}>
                  <i className="fa-solid fa-link" style={{ color: '#7c5cff' }}></i>
                  <span>Convidar Amigos</span>
                </span>
                <i className="fa-solid fa-chevron-right" style={{ fontSize: '11px', color: '#6b7280' }}></i>
              </button>

              {/* Voltar ao Menu */}
              <button
                type="button"
                onClick={handleBackToMenu}
                className={styles.actionBtn}
              >
                <span className={styles.actionBtnContent}>
                  <i className="fa-solid fa-house" style={{ color: '#9ca3af' }}></i>
                  <span>Voltar ao Menu</span>
                </span>
                <i className="fa-solid fa-chevron-right" style={{ fontSize: '11px', color: '#6b7280' }}></i>
              </button>

              {/* Sair do Servidor */}
              <button
                type="button"
                onClick={handleLeaveServer}
                className={styles.actionBtnDanger}
                disabled={isLeaving}
              >
                <span className={styles.actionBtnContent}>
                  <i className="fa-solid fa-arrow-right-from-bracket"></i>
                  <span>{isLeaving ? 'Saindo...' : (room.isServer || isServer ? 'Sair do Servidor' : 'Sair da Sala')}</span>
                </span>
                <i className="fa-solid fa-chevron-right" style={{ fontSize: '11px', opacity: 0.7 }}></i>
              </button>
            </div>
          </div>
        )}

        {/* ══ ABA 2: MEU PERFIL ══ */}
        {activeTab === 'profile' && (
          <form onSubmit={handleSaveProfile} className={styles.form}>
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
                  <i className="fa-solid fa-camera" style={{ fontSize: '18px', marginBottom: '4px' }}></i>
                  <span>Alterar</span>
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
        )}

        {/* ══ ABA 3: VOZ E ÁUDIO ══ */}
        {activeTab === 'audio' && (
          <div className={styles.audioSection}>
            <div className={styles.inputGroup}>
              <label className={styles.label}>Dispositivo de Microfone</label>
              <select
                className={styles.deviceSelect}
                value={selectedAudioInputId}
                onChange={(e) => handleMicChange(e.target.value)}
              >
                <option value="default">Padrão do Sistema</option>
                {inputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.inputGroup}>
              <label className={styles.label}>Teste de Microfone</label>
              <div className={styles.micMeterContainer}>
                <div className={styles.micMeterFill} style={{ width: `${micLevel}%` }} />
              </div>
              <button
                type="button"
                className={styles.audioActionBtn}
                onClick={isTestingMic ? stopMicTest : startMicTest}
              >
                <i className={`fa-solid ${isTestingMic ? 'fa-stop' : 'fa-microphone'}`}></i>
                <span>{isTestingMic ? 'Parar Teste' : 'Iniciar Teste de Microfone'}</span>
              </button>
            </div>

            <div className={styles.inputGroup}>
              <label className={styles.label}>Dispositivo de Saída (Headset / Alto-falante)</label>
              <select
                className={styles.deviceSelect}
                value={selectedAudioOutputId}
                onChange={(e) => handleHeadsetChange(e.target.value)}
              >
                <option value="default">Padrão do Sistema</option>
                {outputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.audioActionBtn}
                onClick={testHeadset}
                style={{ marginTop: '4px' }}
              >
                <i className="fa-solid fa-volume-high"></i>
                <span>Testar Saída de Som</span>
              </button>
            </div>

            <div className={styles.inputGroup} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: '6px' }}>
              <label className={styles.label} style={{ margin: 0 }}>Supressão de Ruído</label>
              <input
                type="checkbox"
                checked={noiseSuppression}
                onChange={(e) => setNoiseSuppression(e.target.checked)}
                style={{ width: '18px', height: '18px', accentColor: '#7c5cff', cursor: 'pointer' }}
              />
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
