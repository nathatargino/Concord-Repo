import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAppStore } from '../stores/useAppStore';
import { leaveServerFromSupabase, removeMyServer, markServerAsLeft, type SavedServer } from '../lib/supabase';
import { getStoredTheme, toggleTheme, type ThemeMode } from '../utils/theme';
import { InviteFriendsModal } from './InviteFriendsModal';
import styles from './ServerRail.module.css';

interface ServerRailProps {
  onOpenProfile?: () => void;
}

export const ServerRail: React.FC<ServerRailProps> = ({ onOpenProfile }) => {
  const navigate = useNavigate();
  const {
    activeRailContext,
    setActiveRailContext,
    setHomeTab,
    openActionModal,
    myName,
    myAvatarUrl,
    myId,
    myTag,
    openUserProfile,
    room,
    servers,
    setServers,
    refreshServers,
    recordRecentServer,
  } = useAppStore();

  const [theme, setTheme] = useState<ThemeMode>(getStoredTheme);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    server: SavedServer;
  } | null>(null);
  const [muteSubmenuOpen, setMuteSubmenuOpen] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  // Estado do Modal de Convidar Pessoas para o Servidor
  const [inviteServer, setInviteServer] = useState<SavedServer | null>(null);

  // Estado do Popup de Confirmação para Sair do Servidor
  const [serverToLeave, setServerToLeave] = useState<SavedServer | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);

  // Fechar popup com a tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && serverToLeave && !isLeaving) {
        setServerToLeave(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [serverToLeave, isLeaving]);

  useEffect(() => {
    refreshServers();
    const interval = setInterval(refreshServers, 15000);
    const handleServersUpdated = (e: any) => {
      if (e.detail?.servers) {
        setServers(e.detail.servers);
      } else {
        refreshServers();
      }
    };
    window.addEventListener('concord:servers-updated', handleServersUpdated);
    return () => {
      clearInterval(interval);
      window.removeEventListener('concord:servers-updated', handleServersUpdated);
    };
  }, [refreshServers, setServers]);

  useEffect(() => {
    const handleThemeChange = (e: any) => {
      if (e.detail?.theme) setTheme(e.detail.theme);
    };
    window.addEventListener('concord:theme-changed', handleThemeChange);
    return () => window.removeEventListener('concord:theme-changed', handleThemeChange);
  }, []);

  // Fechar menu de contexto ao clicar fora ou pressionar Escape
  useEffect(() => {
    if (!contextMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && contextMenuRef.current.contains(e.target as Node)) {
        return;
      }
      setContextMenu(null);
      setMuteSubmenuOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setMuteSubmenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const handleHomeClick = () => {
    setActiveRailContext('home');
    setHomeTab('hub');
    useAppStore.getState().setRoom(null);
    navigate('/');
  };

  const handleServerClick = (server: SavedServer) => {
    recordRecentServer(server);
    setActiveRailContext(server.id);
    navigate(`/room/${server.id}?code=${server.code}&server=1`);
  };

  const handleServerContextMenu = (e: React.MouseEvent, server: SavedServer) => {
    e.preventDefault();
    e.stopPropagation();
    setMuteSubmenuOpen(false);
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      server,
    });
  };

  const handleMarkAsRead = (server: SavedServer) => {
    toast.success(`Servidor "${server.name}" marcado como lido.`);
    setContextMenu(null);
  };

  const handleMuteServer = (server: SavedServer, durationLabel: string) => {
    toast.success(`Servidor "${server.name}" silenciado (${durationLabel}).`);
    setContextMenu(null);
    setMuteSubmenuOpen(false);
  };

  const handleOpenServerSettings = (server: SavedServer) => {
    setContextMenu(null);
    const isCurrentServer =
      activeRailContext === server.id ||
      room?.id === server.id ||
      (server.code && room?.code?.toUpperCase() === server.code.toUpperCase());

    if (isCurrentServer) {
      window.dispatchEvent(new CustomEvent('concord:open-server-settings'));
    } else {
      setActiveRailContext(server.id);
      navigate(`/room/${server.id}?code=${server.code}&server=1`);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('concord:open-server-settings'));
      }, 150);
    }
  };

  const handleInvitePeople = (server: SavedServer) => {
    setContextMenu(null);
    setInviteServer(server);
  };

  // Saída Confirmada com Otimismo Instantâneo e Persistência Blindada
  const confirmLeaveServer = async () => {
    if (!serverToLeave) return;
    const target = serverToLeave;
    setIsLeaving(true);

    try {
      // 1. Imediatamente remove da lista visual da Server Rail
      setServers((prev) => prev.filter((s) => s.id !== target.id && s.code !== target.code));

      // 2. Remove dos caches locais e bloqueia permanentemente o reaparecimento
      removeMyServer(target.id);
      if (target.code) removeMyServer(target.code);
      markServerAsLeft(target.id, target.code);

      // 3. Se estiver visualizando o servidor agora, redireciona para a Home
      const isCurrentServer =
        activeRailContext === target.id ||
        room?.id === target.id ||
        (target.code && room?.code?.toUpperCase() === target.code.toUpperCase());

      if (isCurrentServer) {
        setActiveRailContext('home');
        useAppStore.getState().setRoom(null);
        navigate('/');
      }

      toast.success(`Você saiu do servidor "${target.name}".`);

      // 4. Executa a limpeza remota (Supabase) em segundo plano
      leaveServerFromSupabase(target.id, myName, myId, target.code).catch((err) => {
        console.warn('Erro ao sair do servidor em segundo plano:', err);
      });
    } finally {
      setIsLeaving(false);
      setServerToLeave(null);
    }
  };

  const handleThemeToggle = () => {
    const next = toggleTheme();
    setTheme(next);
  };

  const handleAvatarClick = () => {
    if (onOpenProfile) {
      onOpenProfile();
    } else {
      openUserProfile({
        id: myId || 'me',
        name: myName || 'Você',
        avatarUrl: myAvatarUrl,
        isMe: true,
        tag: (myTag || localStorage.getItem('concord_user_tag') || '7236').replace('#', ''),
      });
    }
  };

  const initials = (name: string) => {
    const clean = (name || '').trim();
    if (!clean) return 'SR';
    const words = clean.split(/\s+/);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
  };

  const userInitials = (myName || 'U').slice(0, 2).toUpperCase();

  const isHomeActive = activeRailContext === 'home' || (!activeRailContext && !room?.id);

  // Ajuste de coordenadas para o menu de contexto não sair da tela
  const menuX = contextMenu ? Math.min(contextMenu.x + 8, window.innerWidth - 240) : 0;
  const menuY = contextMenu ? Math.min(contextMenu.y - 10, window.innerHeight - 280) : 0;

  return (
    <>
      <aside className={styles.railContainer} aria-label="Navegação de Servidores">
        {/* ── 1. BOTÃO INÍCIO / HUB ── */}
        <div className={`${styles.railItem} ${isHomeActive ? styles.active : ''}`}>
          <div className={styles.pillIndicator} />
          <div
            className={`${styles.iconWrapper} ${styles.homeIconWrapper} ${isHomeActive ? styles.active : ''}`}
            onClick={handleHomeClick}
            role="button"
            tabIndex={0}
            title="Início"
          >
            <img src="/logo.png" alt="Concord" className={styles.homeLogoImg} />
          </div>
          <span className={styles.tooltip}>Início & Salas Rápidas</span>
        </div>

        {/* ── DIVISOR VISUAL ── */}
        <div className={styles.divider} />

        {/* ── 2. LISTA DE SERVIDORES SALVOS ── */}
        <div className={styles.serverList}>
          {servers.map((server) => {
            const isServerActive =
              !isHomeActive &&
              (activeRailContext === server.id ||
                (!activeRailContext && (room?.id === server.id || (server.code && room?.code?.toUpperCase() === server.code.toUpperCase()))));

            return (
              <div
                key={server.id}
                className={`${styles.railItem} ${isServerActive ? styles.active : ''}`}
                onContextMenu={(e) => handleServerContextMenu(e, server)}
              >
                <div className={styles.pillIndicator} />
                <div
                  className={`${styles.iconWrapper} ${!server.icon_url ? styles.fallbackWrapper : ''} ${isServerActive ? styles.active : ''}`}
                  onClick={() => handleServerClick(server)}
                  role="button"
                  tabIndex={0}
                >
                  {server.icon_url ? (
                    <img src={server.icon_url} alt={server.name} className={styles.serverIconImg} />
                  ) : (
                    <span className={styles.serverFallbackText}>{initials(server.name)}</span>
                  )}
                </div>
                <span className={styles.tooltip}>{server.name}</span>
              </div>
            );
          })}

          {/* ── 3. BOTÃO AÇÃO RÁPIDA (+) ── */}
          <div className={styles.railItem}>
            <div className={styles.pillIndicator} />
            <div
              className={styles.addServerBtn}
              onClick={() => openActionModal('create-server')}
              role="button"
              tabIndex={0}
              title="Adicionar Servidor ou Sala"
            >
              <i className="fa-solid fa-plus" />
            </div>
            <span className={styles.tooltip}>Criar ou Entrar em Servidor</span>
          </div>
        </div>

        {/* ── 4. RODAPÉ DO RAIL: TEMA E PERFIL ── */}
        <div className={styles.railFooter}>
          <button
            className={styles.themeBtn}
            onClick={handleThemeToggle}
            title={theme === 'dark' ? 'Mudar para Tema Claro' : 'Mudar para Tema Escuro'}
            aria-label="Alternar Tema"
          >
            <i className={theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon'} />
          </button>

          <div
            className={styles.userAvatarWrapper}
            onClick={handleAvatarClick}
            role="button"
            tabIndex={0}
            title={`Perfil (${myName || 'Você'})`}
          >
            {myAvatarUrl ? (
              <img src={myAvatarUrl} alt={myName} className={styles.userAvatarImg} />
            ) : (
              <div className={styles.userAvatarFallback}>{userInitials}</div>
            )}
            <span className={styles.statusDot} />
          </div>
        </div>
      </aside>

      {/* ── 5. MENU DE CONTEXTO DO SERVIDOR (PORTAL FLUTUANTE) ── */}
      {contextMenu && createPortal(
        <div
          ref={contextMenuRef}
          className={styles.contextMenuPortal}
          style={{ top: `${menuY}px`, left: `${menuX}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Marcar como lido */}
          <button
            type="button"
            className={styles.contextItem}
            onClick={() => handleMarkAsRead(contextMenu.server)}
          >
            <div className={styles.contextItemLeft}>
              <i className={`fa-solid fa-check-double ${styles.contextItemIcon}`} />
              <span>Marcar como lido</span>
            </div>
          </button>

          {/* Silenciar Servidor */}
          <div
            className={styles.submenuWrapper}
            onMouseEnter={() => setMuteSubmenuOpen(true)}
            onMouseLeave={() => setMuteSubmenuOpen(false)}
          >
            <button
              type="button"
              className={styles.contextItem}
              onClick={() => setMuteSubmenuOpen((v) => !v)}
            >
              <div className={styles.contextItemLeft}>
                <i className={`fa-solid fa-bell-slash ${styles.contextItemIcon}`} />
                <span>Silenciar Servidor</span>
              </div>
              <i className="fa-solid fa-chevron-right" style={{ fontSize: '10px', color: '#9ca3af' }} />
            </button>

            {muteSubmenuOpen && (
              <div className={styles.submenuPortal}>
                <button
                  type="button"
                  className={styles.contextItem}
                  onClick={() => handleMuteServer(contextMenu.server, 'por 15 minutos')}
                >
                  <span>Por 15 minutos</span>
                </button>
                <button
                  type="button"
                  className={styles.contextItem}
                  onClick={() => handleMuteServer(contextMenu.server, 'por 1 hora')}
                >
                  <span>Por 1 hora</span>
                </button>
                <button
                  type="button"
                  className={styles.contextItem}
                  onClick={() => handleMuteServer(contextMenu.server, 'por 8 horas')}
                >
                  <span>Por 8 horas</span>
                </button>
                <button
                  type="button"
                  className={styles.contextItem}
                  onClick={() => handleMuteServer(contextMenu.server, 'por 24 horas')}
                >
                  <span>Por 24 horas</span>
                </button>
                <button
                  type="button"
                  className={styles.contextItem}
                  onClick={() => handleMuteServer(contextMenu.server, 'até reativar')}
                >
                  <span>Até reativar</span>
                </button>
              </div>
            )}
          </div>

          {/* Configurações do Servidor */}
          <button
            type="button"
            className={styles.contextItem}
            onClick={() => handleOpenServerSettings(contextMenu.server)}
          >
            <div className={styles.contextItemLeft}>
              <i className={`fa-solid fa-gear ${styles.contextItemIcon}`} />
              <span>Configurações do Servidor</span>
            </div>
          </button>

          {/* Convidar Pessoas */}
          <button
            type="button"
            className={styles.contextItem}
            onClick={() => handleInvitePeople(contextMenu.server)}
          >
            <div className={styles.contextItemLeft}>
              <i className={`fa-solid fa-user-plus ${styles.contextItemIcon}`} />
              <span>Convidar Pessoas</span>
            </div>
          </button>

          {/* Separador Visual */}
          <div className={styles.contextDivider} />

          {/* Sair do Servidor (Danger / Vermelho com Popup de Confirmação) */}
          <button
            type="button"
            className={`${styles.contextItem} ${styles.contextItemDanger}`}
            onClick={() => {
              setServerToLeave(contextMenu.server);
              setContextMenu(null);
            }}
          >
            <div className={styles.contextItemLeft}>
              <i className={`fa-solid fa-arrow-right-from-bracket ${styles.contextItemIcon}`} />
              <span>Sair do Servidor</span>
            </div>
          </button>
        </div>,
        document.body
      )}

      {/* Modal de Confirmação: Sair do Servidor */}
      {serverToLeave && createPortal(
        <div
          className={styles.leaveModalOverlay}
          onClick={() => {
            if (!isLeaving) setServerToLeave(null);
          }}
        >
          <div className={styles.leaveModalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.leaveModalHeader}>
              <div className={styles.leaveModalWarningIconWrap}>
                <i className={`fa-solid fa-triangle-exclamation ${styles.leaveModalWarningIcon}`} />
              </div>
              <div className={styles.leaveModalTitleWrap}>
                <h3 className={styles.leaveModalTitle}>Sair de "{serverToLeave.name}"?</h3>
                <span className={styles.leaveModalSubtitle}>Confirmação de saída do servidor</span>
              </div>
            </div>
            <p className={styles.leaveModalDescription}>
              Tem certeza de que deseja sair de <strong>{serverToLeave.name}</strong>? Você deixará de ser membro e precisará de um código ou link de convite para entrar novamente.
            </p>
            <div className={styles.leaveModalActions}>
              <button
                type="button"
                className={styles.leaveModalCancelBtn}
                onClick={() => setServerToLeave(null)}
                disabled={isLeaving}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={styles.leaveModalConfirmBtn}
                onClick={confirmLeaveServer}
                disabled={isLeaving}
              >
                {isLeaving ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin" />
                    <span>Saindo...</span>
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-arrow-right-from-bracket" />
                    <span>Sair do Servidor</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal de Convidar Amigos para o Servidor */}
      {inviteServer && (
        <InviteFriendsModal
          isOpen={Boolean(inviteServer)}
          server={inviteServer}
          onClose={() => setInviteServer(null)}
        />
      )}
    </>
  );
};
