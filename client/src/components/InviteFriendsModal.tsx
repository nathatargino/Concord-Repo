import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { useAppStore } from '../stores/useAppStore';
import { 
  fetchFriendsFromSupabase, 
  getOrCreateDirectChatInSupabase, 
  sendDirectMessageToSupabase, 
  type Friend, 
  type SavedServer 
} from '../lib/supabase';
import styles from './InviteFriendsModal.module.css';

interface InviteFriendsModalProps {
  isOpen: boolean;
  onClose: () => void;
  server: SavedServer | null;
}

export const InviteFriendsModal: React.FC<InviteFriendsModalProps> = ({
  isOpen,
  onClose,
  server,
}) => {
  const { friends, setFriends } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sentFriendIds, setSentFriendIds] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [loadingFriends, setLoadingFriends] = useState(false);

  // Carrega ou atualiza lista de amigos ao abrir
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setCopied(false);
      setLoadingFriends(true);
      fetchFriendsFromSupabase()
        .then((list) => {
          if (Array.isArray(list)) {
            setFriends(list);
          }
        })
        .catch((err) => {
          console.warn('[InviteFriendsModal] Erro ao carregar amigos:', err);
        })
        .finally(() => {
          setLoadingFriends(false);
        });
    }
  }, [isOpen, setFriends]);

  // Fechar com Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const acceptedFriends = useMemo(() => {
    return (friends || []).filter((f) => f.status === 'accepted');
  }, [friends]);

  const filteredFriends = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return acceptedFriends;
    return acceptedFriends.filter((f) => {
      const name = (f.friendName || '').toLowerCase();
      const tag = (f.friendTag || '').toLowerCase();
      return name.includes(q) || tag.includes(q);
    });
  }, [acceptedFriends, searchQuery]);

  if (!isOpen || !server) return null;

  const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
  const baseUrl = isElectron ? 'https://concord-repo.pages.dev' : window.location.origin;
  const inviteUrl = `${baseUrl}/#/room/${server.id}?code=${server.code}&server=1`;

  const handleSendInvite = async (friend: Friend) => {
    const targetId = friend.friendId || friend.userId;
    if (!targetId || sentFriendIds.has(targetId)) return;

    setSendingId(targetId);
    try {
      const chat = await getOrCreateDirectChatInSupabase(targetId);
      if (!chat) {
        toast.error(`Não foi possível abrir chat privado com ${friend.friendName}.`);
        return;
      }

      const inviteMessage = `Ei! Te convidei para participar do servidor **${server.name}** no Concord! 🎉\n\nLink direto:\n${inviteUrl}\n\nCódigo do servidor: \`${server.code}\``;

      const sentMsg = await sendDirectMessageToSupabase(chat.id, inviteMessage, 'text', undefined, undefined, chat.partnerId, chat.partnerName || friend.friendName);
      if (sentMsg) {
        setSentFriendIds((prev) => new Set(prev).add(targetId));
        toast.success(`Convite enviado para ${friend.friendName}!`);
      } else {
        toast.error('Não foi possível entregar o convite.');
      }
    } catch (err) {
      console.error('Erro ao enviar convite:', err);
      toast.error('Erro ao enviar convite na DM.');
    } finally {
      setSendingId(null);
    }
  };

  const handleCopyLink = () => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(inviteUrl).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
        toast.success('Link de convite copiado!');
      }).catch(() => {
        toast.success(`Código: ${server.code}`);
      });
    } else {
      toast.success(`Código: ${server.code}`);
    }
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            {server.icon_url ? (
              <img src={server.icon_url} alt={server.name} className={styles.serverIconMini} />
            ) : (
              <div className={styles.serverIconFallback}>
                {server.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className={styles.headerTitleCol}>
              <h3 className={styles.title}>Convidar amigos para {server.name}</h3>
              <span className={styles.subtitle}>Envie um convite diretamente na DM de um amigo</span>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="Fechar">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {/* Search Input */}
        <div className={styles.searchWrap}>
          <i className={`fa-solid fa-magnifying-glass ${styles.searchIcon}`} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Procurar amigos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>

        {/* Friends List */}
        <div className={styles.friendsList}>
          {loadingFriends && acceptedFriends.length === 0 ? (
            <div className={styles.emptyState}>
              <i className={`fa-solid fa-spinner fa-spin ${styles.emptyIcon}`} />
              <p className={styles.emptyText}>Carregando sua lista de amigos...</p>
            </div>
          ) : filteredFriends.length === 0 ? (
            <div className={styles.emptyState}>
              <i className={`fa-solid fa-user-group ${styles.emptyIcon}`} />
              <p className={styles.emptyText}>
                {searchQuery
                  ? 'Nenhum amigo encontrado com esse nome.'
                  : 'Nenhum amigo encontrado. Adicione amigos na aba Amigos do Hub Concord!'}
              </p>
            </div>
          ) : (
            filteredFriends.map((friend) => {
              const targetId = friend.friendId || friend.userId;
              const isSent = sentFriendIds.has(targetId);
              const isSending = sendingId === targetId;

              return (
                <div key={friend.id || targetId} className={styles.friendRow}>
                  <div className={styles.friendLeft}>
                    <div className={styles.avatarWrapper}>
                      {friend.friendAvatarUrl ? (
                        <img
                          src={friend.friendAvatarUrl}
                          alt={friend.friendName}
                          className={styles.avatar}
                        />
                      ) : (
                        <div className={styles.avatarFallback}>
                          {(friend.friendName || 'U').charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span
                        className={`${styles.statusDot} ${
                          friend.onlineStatus === 'online' ? styles.statusOnline : styles.statusOffline
                        }`}
                        title={friend.onlineStatus === 'online' ? 'Online' : 'Offline'}
                      />
                    </div>
                    <div className={styles.friendInfo}>
                      <span className={styles.friendName}>{friend.friendName}</span>
                      <span className={styles.friendTag}>#{friend.friendTag || '0000'}</span>
                    </div>
                  </div>

                  {isSent ? (
                    <button type="button" className={styles.inviteBtnSent} disabled>
                      <i className="fa-solid fa-check" />
                      <span>Enviado</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.inviteBtn}
                      onClick={() => handleSendInvite(friend)}
                      disabled={isSending}
                    >
                      {isSending ? (
                        <>
                          <i className="fa-solid fa-spinner fa-spin" />
                          <span>Enviando...</span>
                        </>
                      ) : (
                        <>
                          <i className="fa-solid fa-paper-plane" />
                          <span>Convidar</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer: Copy Link */}
        <div className={styles.footer}>
          <span className={styles.footerLabel}>
            Ou envie um link de convite do servidor para um amigo
          </span>
          <div className={styles.linkBox}>
            <input
              type="text"
              readOnly
              value={inviteUrl}
              className={styles.linkInput}
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              className={`${styles.copyBtn} ${copied ? styles.copyBtnCopied : ''}`}
              onClick={handleCopyLink}
            >
              {copied ? (
                <>
                  <i className="fa-solid fa-check" style={{ marginRight: 6 }} />
                  Copiado!
                </>
              ) : (
                'Copiar'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
