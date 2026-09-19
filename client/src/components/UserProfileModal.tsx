import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './UserProfileModal.module.css';
import { supabase } from '../lib/supabase';
import { useAppStore, type UserProfileData } from '../stores/useAppStore';

interface Props {
  user: UserProfileData;
  onClose: () => void;
}

export const UserProfileModal: React.FC<Props> = ({ user, onClose }) => {
  const { myAvatarUrl } = useAppStore();
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [memberSince, setMemberSince] = useState<string | null>(null);
  const [fetchedAvatar, setFetchedAvatar] = useState<string | null>(null);
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
            .select('created_at, avatar_url')
            .eq('id', user.id)
            .maybeSingle();

          if (profile && isMounted) {
            if (profile.avatar_url) setFetchedAvatar(profile.avatar_url);
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

  const initials = user.name ? user.name.slice(0, 2).toUpperCase() : '??';
  const displayTag = user.id ? `#${user.id.slice(0, 4).toUpperCase()}` : '#9921';

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
            </div>
          </div>

          {/* Área de Conteúdo */}
          <div className={styles.contentArea}>
            {/* Identidade do Usuário */}
            <div className={styles.identityCard}>
              <div className={styles.userNameRow}>
                <h3 className={styles.userName}>{user.name || 'Usuário'}</h3>
                {user.isMe && <span className={styles.youTag}>VOCÊ</span>}
              </div>
              <span className={styles.userTag}>{displayTag}</span>
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

            {/* Botão de Pedido de Amizade (Desabilitado) */}
            <button
              type="button"
              className={styles.friendRequestBtn}
              disabled
              title="O sistema de amigos será disponibilizado em breve"
            >
              <span className={styles.friendRequestLeft}>
                <i className="fa-solid fa-user-plus" />
                <span>Enviar pedido de amizade</span>
              </span>
              <span className={styles.soonBadge}>Em breve</span>
            </button>
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
