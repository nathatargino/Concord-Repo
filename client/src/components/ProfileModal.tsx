import React, { useState, useEffect, useRef } from 'react';
import styles from './ProfileModal.module.css';
import { supabase } from '../lib/supabase';
import { useAppStore } from '../stores/useAppStore';
import toast from 'react-hot-toast';

interface Props {
  onClose: () => void;
  onUpdate: (newName: string, newAvatar?: string) => void;
}

export const ProfileModal: React.FC<Props> = ({ onClose, onUpdate }) => {
  const initialName = useAppStore.getState().myName || localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1') || '';
  const initialAvatar = useAppStore.getState().myAvatarUrl || localStorage.getItem('concord_avatar_url') || '';

  const [username, setUsername] = useState(initialName);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatar);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      // 1. Atualizar estado global Zustand & LocalStorage imediatamente
      useAppStore.getState().setMyName(cleanName);
      useAppStore.getState().setMyAvatarUrl(avatarUrl || null);

      localStorage.setItem('concord_username', cleanName);
      localStorage.setItem('concord_username_v1', cleanName);
      if (avatarUrl) {
        localStorage.setItem('concord_avatar_url', avatarUrl);
      } else {
        localStorage.removeItem('concord_avatar_url');
      }

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
          // Atualizar perfil existente correspondente pelo nome de usuário se houver no DB
          const { data: existingProf } = await supabase
            .from('profiles')
            .select('id')
            .ilike('username', cleanName)
            .maybeSingle();

          if (existingProf?.id) {
            await supabase
              .from('profiles')
              .update({
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
      onClose();
    } catch (err) {
      console.error('Save profile error:', err);
      toast.error('Erro ao salvar o perfil.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <p style={{ color: '#fff' }}>Carregando perfil...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>×</button>
        <h2 className={styles.title}>Meu Perfil</h2>
        
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
                  <path d="M12 20h9"/>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
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
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                  <line x1="8" y1="21" x2="16" y2="21"/>
                  <line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
                Sistema
              </span>
            </div>

            <div className={styles.systemCard}>
              <div className={styles.systemInfo}>
                <div className={styles.appNameRow}>
                  <span className={styles.appName}>Concord Desktop</span>
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
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
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
      </div>
    </div>
  );
};
