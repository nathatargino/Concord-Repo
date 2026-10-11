import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import type { CustomRole } from '../types';
import styles from './ManageRolesModal.module.css';

interface ManageRolesModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverId: string;
  targetUserId: string;
  targetUsername: string;
  targetAvatarUrl?: string | null;
  currentCustomRole?: CustomRole | null;
  socketEmit?: (event: string, ...args: any[]) => void;
  onRoleSaved?: (role: CustomRole | null) => void;
}

const POPULAR_EMOJIS = [
  '🛡️', '👑', '⭐', '🎮', '💎', '🔥', '🚀', '🤖',
  '🎨', '🎵', '⚡', '🏆', '☕', '🌟', '🍕', '🎩',
  '🎯', '💡', '💜', '🐺', '🦊', '🐉', '⚔️', '👾'
];

const ROLE_COLORS = [
  { name: 'Roxo Real', hex: '#7c5cff' },
  { name: 'Dourado', hex: '#f59e0b' },
  { name: 'Esmeralda', hex: '#10b981' },
  { name: 'Ciano', hex: '#06b6d4' },
  { name: 'Azul', hex: '#3b82f6' },
  { name: 'Rosa Neon', hex: '#ec4899' },
  { name: 'Carmesim', hex: '#ef4444' },
  { name: 'Índigo', hex: '#6366f1' },
];

export const ManageRolesModal: React.FC<ManageRolesModalProps> = ({
  isOpen,
  onClose,
  serverId,
  targetUserId,
  targetUsername,
  targetAvatarUrl,
  currentCustomRole,
  socketEmit,
  onRoleSaved,
}) => {
  const [roleName, setRoleName] = useState(currentCustomRole?.name || '');
  const [roleEmoji, setRoleEmoji] = useState(currentCustomRole?.emoji || '🛡️');
  const [roleColor, setRoleColor] = useState(currentCustomRole?.color || '#7c5cff');
  const [isAdmin, setIsAdmin] = useState(Boolean(currentCustomRole?.isAdmin));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setRoleName(currentCustomRole?.name || '');
      setRoleEmoji(currentCustomRole?.emoji || '🛡️');
      setRoleColor(currentCustomRole?.color || '#7c5cff');
      setIsAdmin(Boolean(currentCustomRole?.isAdmin));
    }
  }, [isOpen, currentCustomRole]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = roleName.trim();
    if (!cleanName) {
      toast.error('Digite um nome para o cargo.');
      return;
    }

    const cleanEmoji = roleEmoji.trim() || '🛡️';
    const newRole: CustomRole = {
      name: cleanName,
      emoji: cleanEmoji,
      color: roleColor,
      isAdmin,
    };

    setIsSaving(true);
    try {
      // 1. Emitir evento de socket em tempo real para sincronização com todos no servidor
      if (socketEmit) {
        socketEmit('set_member_custom_role', {
          roomId: serverId,
          targetUserId,
          targetUsername,
          customRole: newRole,
        });
      }

      // 2. Persistir localmente no cache do servidor
      try {
        const cacheKey = `concord_custom_roles_${serverId}`;
        const raw = localStorage.getItem(cacheKey);
        const rolesMap = raw ? JSON.parse(raw) : {};
        rolesMap[targetUsername.toLowerCase()] = newRole;
        rolesMap[targetUserId] = newRole;
        localStorage.setItem(cacheKey, JSON.stringify(rolesMap));
      } catch {}

      // 3. Atualizar no Supabase (server_members)
      try {
        await supabase
          .from('server_members')
          .update({
            custom_role_name: newRole.name,
            custom_role_emoji: newRole.emoji,
            custom_role_color: newRole.color,
            role: isAdmin ? 'sub_owner' : 'member',
          })
          .eq('server_id', serverId)
          .ilike('username', targetUsername);
      } catch (sbErr) {
        console.warn('[ManageRolesModal] Supabase update warning:', sbErr);
      }

      toast.success(`Cargo "${cleanEmoji} ${cleanName}" definido para ${targetUsername}!`);
      onRoleSaved?.(newRole);
      onClose();
    } catch (err: any) {
      toast.error('Erro ao salvar cargo: ' + (err?.message || 'Tente novamente'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveRole = async () => {
    setIsSaving(true);
    try {
      // 1. Emitir via socket
      if (socketEmit) {
        socketEmit('set_member_custom_role', {
          roomId: serverId,
          targetUserId,
          targetUsername,
          customRole: null,
        });
      }

      // 2. Remover do cache local
      try {
        const cacheKey = `concord_custom_roles_${serverId}`;
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const rolesMap = JSON.parse(raw);
          delete rolesMap[targetUsername.toLowerCase()];
          delete rolesMap[targetUserId];
          localStorage.setItem(cacheKey, JSON.stringify(rolesMap));
        }
      } catch {}

      // 3. Remover no Supabase
      try {
        await supabase
          .from('server_members')
          .update({
            custom_role_name: null,
            custom_role_emoji: null,
            custom_role_color: null,
          })
          .eq('server_id', serverId)
          .ilike('username', targetUsername);
      } catch {}

      toast.success(`Cargo removido de ${targetUsername}.`);
      onRoleSaved?.(null);
      onClose();
    } catch {
      toast.error('Erro ao remover cargo.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <h3 className={styles.title}>
              <i className={`fa-solid fa-tags ${styles.titleIcon}`} />
              Gerenciar Cargos
            </h3>
            <p className={styles.subtitle}>Defina um cargo personalizado para {targetUsername}</p>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="Fechar">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className={styles.body}>
          {/* User info & Live Preview */}
          <div className={styles.previewBox}>
            <div className={styles.userInfo}>
              {targetAvatarUrl ? (
                <img src={targetAvatarUrl} alt={targetUsername} className={styles.avatar} />
              ) : (
                <div className={styles.avatarFallback}>{targetUsername.charAt(0).toUpperCase()}</div>
              )}
              <div className={styles.userNameDetails}>
                <span className={styles.targetName}>{targetUsername}</span>
                <span className={styles.targetLabel}>Membro do Servidor</span>
              </div>
            </div>

            {/* Live Role Badge Preview */}
            {roleName.trim() ? (
              <span
                className={styles.roleBadge}
                style={{
                  borderColor: roleColor,
                  color: roleColor,
                  background: `${roleColor}22`,
                }}
              >
                <span className={styles.roleEmoji}>{roleEmoji}</span>
                <span>{roleName.trim()}</span>
              </span>
            ) : (
              <span className={styles.noRoleText}>Sem cargo definido</span>
            )}
          </div>

          {/* Nome do Cargo */}
          <div className={styles.formGroup}>
            <label className={styles.label}>Nome do Cargo</label>
            <input
              type="text"
              className={styles.input}
              placeholder="Ex: Moderador, VIP, Gamer, Mago..."
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              maxLength={28}
              autoFocus
            />
          </div>

          {/* Emoji do Cargo */}
          <div className={styles.formGroup}>
            <label className={styles.label}>Emoji do Cargo (Clique para selecionar)</label>
            <div className={styles.emojiGrid}>
              {POPULAR_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={`${styles.emojiBtn} ${roleEmoji === emoji ? styles.emojiBtnSelected : ''}`}
                  onClick={() => setRoleEmoji(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <input
              type="text"
              className={styles.input}
              style={{ marginTop: 6 }}
              placeholder="Ou digite qualquer outro emoji aqui..."
              value={roleEmoji}
              onChange={(e) => setRoleEmoji(e.target.value)}
              maxLength={4}
            />
          </div>

          {/* Cor do Cargo */}
          <div className={styles.formGroup}>
            <label className={styles.label}>Cor de Destaque</label>
            <div className={styles.colorPalette}>
              {ROLE_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  className={`${styles.colorSwatch} ${roleColor === c.hex ? styles.colorSwatchActive : ''}`}
                  style={{ backgroundColor: c.hex }}
                  onClick={() => setRoleColor(c.hex)}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          {/* Permissões do Cargo (Administrador) */}
          <div className={styles.permissionSection}>
            <label className={styles.label}>Permissões</label>
            <div
              className={`${styles.checkboxCard} ${isAdmin ? styles.checkboxCardActive : ''}`}
              onClick={() => setIsAdmin(!isAdmin)}
            >
              <div className={styles.checkboxInfo}>
                <div className={styles.checkboxTitleRow}>
                  <i className={`fa-solid fa-shield-halved ${styles.adminIcon}`} />
                  <span className={styles.checkboxTitle}>Permissão de Administrador</span>
                </div>
                <span className={styles.checkboxDescription}>
                  Membros com este cargo têm permissão administrativa completa (gerenciar canais, cargos e moderação).
                </span>
              </div>
              <div className={`${styles.switch} ${isAdmin ? styles.switchOn : ''}`}>
                <div className={styles.switchHandle} />
              </div>
            </div>
          </div>
        </form>

        {/* Footer Actions */}
        <div className={styles.footer}>
          {currentCustomRole ? (
            <button
              type="button"
              className={styles.removeRoleBtn}
              onClick={handleRemoveRole}
              disabled={isSaving}
            >
              <i className="fa-solid fa-trash" />
              Remover Cargo
            </button>
          ) : (
            <div />
          )}

          <div className={styles.footerRight}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className={styles.saveBtn}
              onClick={handleSave}
              disabled={isSaving || !roleName.trim()}
            >
              <i className="fa-solid fa-check" />
              {isSaving ? 'Salvando...' : 'Salvar Cargo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
