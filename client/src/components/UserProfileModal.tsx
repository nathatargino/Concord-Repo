import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './UserProfileModal.module.css';
import { supabase, sendFriendRequestToSupabase, cancelFriendRequestInSupabase, fetchFriendsFromSupabase, blockUserInSupabase, unblockUserInSupabase } from '../lib/supabase';
import { useAppStore, type UserProfileData } from '../stores/useAppStore';
import toast from 'react-hot-toast';

interface Props {
  user: UserProfileData;
  onClose: () => void;
}

export const UserProfileModal: React.FC<Props> = ({ user, onClose }) => {
  const { myAvatarUrl, myName, friends, setFriends } = useAppStore();
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [memberSince, setMemberSince] = useState<string | null>(null);
  const [fetchedAvatar, setFetchedAvatar] = useState<string | null>(null);
  const [customTag, setCustomTag] = useState<string | null>(null);
  const [isSendingRequest, setIsSendingRequest] = useState(false);
  // isFetching: true enquanto busca; isAnonymous: true se nenhum perfil Supabase foi encontrado
  const [isFetching, setIsFetching] = useState(true);
  const [isAnonymous, setIsAnonymous] = useState(false);

  // Resolver avatar efetivo
  const effectiveAvatar =
    fetchedAvatar ||
    user.avatarUrl ||
    (user.isMe ? (myAvatarUrl || localStorage.getItem('concord_avatar_url')) : null) ||
    null;

  // Carregar detalhes adicionais do usuário (Data de criação e avatar recente)
  useEffect(() => {
    let isMounted = true;
    setIsFetching(true);
    setIsAnonymous(false);
    setMemberSince(null);

    const fetchDetails = async () => {
      try {
        // 1. Buscar perfil no Supabase pelo id (usuários autenticados)
        if (user.id && user.id.length >= 8) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('created_at, avatar_url, custom_tag')
            .eq('id', user.id)
            .maybeSingle();

          if (profile && isMounted) {
            if (profile.avatar_url) setFetchedAvatar(profile.avatar_url);
            if (profile.custom_tag) setCustomTag(profile.custom_tag);
            if (profile.created_at) {
              const d = new Date(profile.created_at);
              if (!isNaN(d.getTime())) {
                const formatted = new Intl.DateTimeFormat('pt-BR', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric'
                }).format(d);
                if (isMounted) {
                  setMemberSince(formatted);
                  setIsFetching(false);
                }
                return;
              }
            }
          }
        }

        // 2. Fallback: buscar na tabela server_members pelo nome de usuário
        if (user.name) {
          const { data: member } = await supabase
            .from('server_members')
            .select('joined_at, created_at, avatar_url')
            .ilike('username', user.name.trim())
            .maybeSingle();

          if (member && isMounted) {
            if (member.avatar_url && !fetchedAvatar) setFetchedAvatar(member.avatar_url);
            const dateVal = member.joined_at || member.created_at;
            if (dateVal) {
              const d = new Date(dateVal);
              if (!isNaN(d.getTime())) {
                const formatted = new Intl.DateTimeFormat('pt-BR', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric'
                }).format(d);
                if (isMounted) {
                  setMemberSince(formatted);
                  setIsFetching(false);
                }
                return;
              }
            }
          }
        }

        // 3. Nenhum perfil encontrado — usuário anônimo/visitante
        if (isMounted) {
          setIsAnonymous(true);
          setIsFetching(false);
        }
      } catch (err) {
        console.debug('[UserProfileModal] Erro ao buscar dados de criação:', err);
        if (isMounted) {
          setIsAnonymous(true);
          setIsFetching(false);
        }
      }
    };

    fetchDetails();
    return () => {
      isMounted = false;
    };
  }, [user.id, user.name, fetchedAvatar]);

  // Tecla ESC para fechar modal ou lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isLightboxOpen) {
          setIsLightboxOpen(false);
          return;
        }
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isLightboxOpen, onClose]);

  const [copied, setCopied] = useState(false);

  const initials = user.name ? user.name.slice(0, 2).toUpperCase() : '??';

  const isMe = Boolean(user.isMe) || (Boolean(myName) && Boolean(user.name) && user.name.trim().toLowerCase() === myName.trim().toLowerCase());
  const myCurrentTag = (useAppStore.getState().myTag || localStorage.getItem('concord_user_tag') || '7236').replace('#', '');
  const effectiveTag = isMe 
    ? myCurrentTag 
    : (customTag || (user.tag ? user.tag.replace('#', '') : (user.id ? user.id.slice(0, 4).toUpperCase() : '0000'))).replace('#', '');
  const displayTag = `#${effectiveTag}`;

  const handleCopyIdentifier = (e: React.MouseEvent) => {
    e.stopPropagation();
    const userFullIdentifier = `${user.name || 'Usuário'}#${effectiveTag}`;
    if ((window as any).electron?.copyToClipboard) {
      (window as any).electron.copyToClipboard(userFullIdentifier);
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(userFullIdentifier);
    }
    setCopied(true);
    toast.success(`Usuário Copiado: ${userFullIdentifier}`, { id: 'modal-user-copied' });
    setTimeout(() => setCopied(false), 2500);
  };

  const friendRelation = friends.find(f => 
    (user.id && (f.friendId === user.id || f.userId === user.id)) || 
    (f.friendName && user.name && f.friendName.trim().toLowerCase() === user.name.trim().toLowerCase()) ||
    ((f as any).userName && user.name && (f as any).userName.trim().toLowerCase() === user.name.trim().toLowerCase())
  );
  const isFriend = friendRelation?.status === 'accepted';
  const isPending = friendRelation?.status === 'pending';
  const isBlocked = friendRelation?.status === 'blocked';

  const handleSendFriendRequest = async () => {
    if (isMe) return;
    if (isFriend) {
      toast('Vocês já são amigos!', { icon: '🤝' });
      return;
    }
    if (isPending) {
      toast('Solicitação de amizade já pendente.', { icon: '⏳' });
      return;
    }
    setIsSendingRequest(true);
    try {
      const tagClean = customTag || (user.tag ? user.tag.replace('#', '') : '');
      const identifier = tagClean ? `${user.name}#${tagClean}` : (user.name || '');
      const res = await sendFriendRequestToSupabase(identifier, user.id);
      if (res.success) {
        toast.success(res.message);
        const updated = await fetchFriendsFromSupabase();
        setFriends(updated);
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao enviar solicitação.');
    } finally {
      setIsSendingRequest(false);
    }
  };

  const handleCancelFriendRequest = async () => {
    if (isMe) return;
    setIsSendingRequest(true);
    try {
      const targetId = friendRelation?.id || user.id;
      const ok = await cancelFriendRequestInSupabase(targetId);
      if (ok) {
        toast.success('Solicitação de amizade cancelada.');
        const updated = await fetchFriendsFromSupabase();
        setFriends(updated);
      } else {
        toast.error('Erro ao cancelar solicitação.');
      }
    } catch {
      toast.error('Erro ao cancelar solicitação.');
    } finally {
      setIsSendingRequest(false);
    }
  };

  const handleToggleBlock = async () => {
    if (isMe) return;
    try {
      if (isBlocked) {
        await unblockUserInSupabase(friendRelation?.id || user.id);
        toast.success(`${user.name || 'Usuário'} foi desbloqueado.`);
      } else {
        if (!window.confirm(`Tem certeza que deseja bloquear ${user.name || 'este usuário'}?`)) return;
        await blockUserInSupabase(user.id, user.name);
        toast.success(`${user.name || 'Usuário'} foi bloqueado.`);
      }
      const updated = await fetchFriendsFromSupabase();
      setFriends(updated);
    } catch {
      toast.error('Erro ao processar bloqueio.');
    }
  };

  return createPortal(
    <>
      <div 
        className={styles.overlay} 
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
      >
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          {/* Banner com botão de fechar */}
          <div className={styles.banner}>
            <button
              type="button"
              className={styles.bannerCloseBtn}
              onClick={onClose}
              title="Fechar perfil (Esc)"
              aria-label="Fechar"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>

          {/* Área do Avatar e Cargo */}
          <div className={styles.avatarSection}>
            <div
              className={styles.avatarWrapper}
              onClick={() => {
                if (effectiveAvatar) {
                  setIsLightboxOpen(true);
                }
              }}
              title={effectiveAvatar ? "Clique para expandir a foto de perfil" : user.name}
            >
              {effectiveAvatar ? (
                <>
                  <img src={effectiveAvatar} alt={user.name} className={styles.avatarImg} />
                  <div className={styles.avatarHoverOverlay}>
                    <i className="fa-solid fa-magnifying-glass-plus" style={{ fontSize: '13px' }} />
                    <span>Expandir</span>
                  </div>
                </>
              ) : (
                <div className={styles.avatarFallback}>{initials}</div>
              )}
            </div>

            {/* Badge de Cargo */}
            <div className={styles.roleBadgeContainer}>
              {user.role === 'owner' ? (
                <span className={`${styles.roleBadge} ${styles.roleBadgeOwner}`}>
                  <i className="fa-solid fa-crown" style={{ fontSize: '10px' }} />
                  <span>Dono</span>
                </span>
              ) : user.role === 'sub_owner' ? (
                <span className={`${styles.roleBadge} ${styles.roleBadgeSubOwner}`}>
                  <i className="fa-solid fa-shield" style={{ fontSize: '10px' }} />
                  <span>Sub Dono</span>
                </span>
              ) : (
                <span className={`${styles.roleBadge} ${styles.roleBadgeMember}`}>
                  <i className="fa-solid fa-user" style={{ fontSize: '10px' }} />
                  <span>Membro</span>
                </span>
              )}

              {user.customRole && (
                <span 
                  className={styles.roleBadge}
                  style={{
                    borderColor: user.customRole.color || '#7c5cff',
                    color: user.customRole.color || '#c4b5fd',
                    background: `${user.customRole.color || '#7c5cff'}22`,
                  }}
                  title={`Cargo Personalizado: ${user.customRole.name}`}
                >
                  <span style={{ fontSize: '12px' }}>{user.customRole.emoji}</span>
                  <span>{user.customRole.name}</span>
                </span>
              )}
            </div>
          </div>

          {/* Área de Conteúdo */}
          <div className={styles.contentArea}>
            {/* Identidade do Usuário (Clicável para copiar) */}
            <div 
              className={styles.identityCard}
              onClick={handleCopyIdentifier}
              title={`Clique para copiar seu usuário (${user.name || 'Usuário'}#${effectiveTag})`}
            >
              <div className={styles.userNameRow}>
                <h3 className={styles.userName}>{user.name || 'Usuário'}</h3>
                {isMe && <span className={styles.youTag}>VOCÊ</span>}
                {copied && (
                  <span className={styles.copiedBadge}>
                    <i className="fa-solid fa-check" /> Copiado!
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <span className={styles.userTag}>{displayTag}</span>
                {!copied && (
                  <span className={styles.copyHint}>
                    <i className="fa-regular fa-copy" /> Clique para copiar
                  </span>
                )}
              </div>
            </div>

            {/* Detalhes da Conta */}
            <div className={styles.infoBox}>
              <div className={styles.infoItem}>
                <i className={`fa-regular fa-calendar-days ${styles.infoIcon}`} />
                <span className={styles.infoLabel}>Usuário desde:</span>
                <span className={styles.infoValue}>
                  {isFetching
                    ? 'Carregando...'
                    : isAnonymous
                    ? 'Usuário não logado'
                    : memberSince || 'Data não disponível'}
                </span>
              </div>
            </div>

            {/* Botão de Pedido de Amizade */}
            {!isMe && !isBlocked && (
              <>
                {isFriend ? (
                  <button
                    type="button"
                    className={`${styles.friendRequestBtn} ${styles.friendRequestBtnAccepted}`}
                    disabled
                    title="Vocês já são amigos no Concord"
                  >
                    <span className={styles.friendRequestLeft}>
                      <i className="fa-solid fa-user-check" />
                      <span>Amigos no Concord</span>
                    </span>
                    <span className={styles.acceptedBadge}>
                      <i className="fa-solid fa-check" />
                    </span>
                  </button>
                ) : isPending ? (
                  <button
                    type="button"
                    className={`${styles.friendRequestBtn} ${styles.friendRequestBtnCancel}`}
                    onClick={handleCancelFriendRequest}
                    disabled={isSendingRequest}
                    title="Clique para cancelar esta solicitação de amizade"
                  >
                    <span className={styles.friendRequestLeft}>
                      <i className={`fa-solid ${isSendingRequest ? 'fa-spinner fa-spin' : 'fa-user-xmark'}`} />
                      <span>
                        {isSendingRequest
                          ? 'Cancelando...'
                          : 'Cancelar Solicitação de amizade'}
                      </span>
                    </span>
                    <span className={styles.cancelBadge}>
                      <i className="fa-solid fa-xmark" />
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.friendRequestBtn}
                    onClick={handleSendFriendRequest}
                    disabled={isSendingRequest}
                    title="Enviar pedido de amizade"
                  >
                    <span className={styles.friendRequestLeft}>
                      <i className={`fa-solid ${isSendingRequest ? 'fa-spinner fa-spin' : 'fa-user-plus'}`} />
                      <span>
                        {isSendingRequest
                          ? 'Enviando...'
                          : 'Enviar pedido de amizade'}
                      </span>
                    </span>
                    <span className={styles.addBadge}>
                      <i className="fa-solid fa-plus" />
                    </span>
                  </button>
                )}
              </>
            )}

            {/* Botão de Bloquear / Desbloquear Usuário */}
            {!isMe && (
              <button
                type="button"
                className={isBlocked ? styles.unblockUserBtn : styles.blockUserBtn}
                onClick={handleToggleBlock}
                title={isBlocked ? "Desbloquear este usuário" : "Bloquear este usuário"}
              >
                <i className={`fa-solid ${isBlocked ? 'fa-lock-open' : 'fa-ban'}`} />
                <span>{isBlocked ? 'Desbloquear Usuário' : 'Bloquear Usuário'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox para expandir a foto de perfil */}
      {isLightboxOpen && effectiveAvatar && (
        <div 
          className={styles.lightboxOverlay} 
          onClick={() => setIsLightboxOpen(false)}
          title="Clique fora para fechar"
        >
          <div className={styles.lightboxContainer} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={styles.lightboxCloseBtn}
              onClick={() => setIsLightboxOpen(false)}
              title="Fechar (Esc)"
            >
              <i className="fa-solid fa-xmark" />
            </button>
            <img src={effectiveAvatar} alt={`Foto de ${user.name}`} className={styles.lightboxImg} />
          </div>
        </div>
      )}
    </>,
    document.body
  );
};
