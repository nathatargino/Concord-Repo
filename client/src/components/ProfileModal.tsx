import React, { useState, useEffect } from 'react';
import styles from './ProfileModal.module.css';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

interface Props {
  onClose: () => void;
  onUpdate: (newName: string) => void;
}

export const ProfileModal: React.FC<Props> = ({ onClose, onUpdate }) => {
  const [username, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

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
            setUsername(profile.username || '');
            setAvatarUrl(profile.avatar_url || '');
          }
        }
      } catch (err) {
        console.error('Error fetching profile:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      toast.error('O apelido não pode ser vazio!');
      return;
    }
    if (!userId) return;

    setSaving(true);
    try {
      const updates = {
        username: username.trim(),
        avatar_url: avatarUrl.trim() || null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId);

      if (error) throw error;
      
      localStorage.setItem('concord_username', username.trim());
      localStorage.setItem('concord_username_v1', username.trim());
      onUpdate(username.trim());
      toast.success('Perfil atualizado com sucesso!');
      onClose();
    } catch (err) {
      console.error('Save profile error:', err);
      toast.error('Não foi possível salvar o perfil.');
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
            <div className={styles.avatarCircle}>
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className={styles.avatarImg} />
              ) : (
                <span className={styles.avatarInitial}>{username.charAt(0).toUpperCase() || '?'}</span>
              )}
            </div>
          </div>

          <div className={styles.inputGroup}>
            <label className={styles.label}>Seu Apelido</label>
            <input
              type="text"
              className={styles.input}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Digite seu nome..."
              maxLength={32}
            />
          </div>

          <div className={styles.inputGroup}>
            <label className={styles.label}>Link da Foto (Avatar URL)</label>
            <input
              type="text"
              className={styles.input}
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://exemplo.com/foto.png"
            />
          </div>

          <button type="submit" className={styles.saveBtn} disabled={saving || !username.trim()}>
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </form>
      </div>
    </div>
  );
};
