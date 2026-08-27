import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import styles from './LobbyPage.module.css';
import { 
  createRoomInSupabase, 
  findRoomInSupabase, 
  checkServerNameAvailable, 
  createServerInSupabase,
  getMyServers,
  removeMyServer,
  SavedServer
} from '../lib/supabase';
import { useAppStore } from '../stores/useAppStore';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? 'https://concord-repo.onrender.com' : 'http://localhost:3001');

type Tab = 'home' | 'rooms-menu' | 'servers-menu' | 'create-room' | 'join-room' | 'create-server' | 'join-server' | 'my-servers';

export const LobbyPage: React.FC = () => {
  const navigate = useNavigate();
  const { resetRoomState, setIsServer, setServerName } = useAppStore();

  const [tab, setTab] = useState<Tab>('home');
  const [code, setCode] = useState('');
  const [localServerName, setLocalServerName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);
  const [savedServers, setSavedServers] = useState<SavedServer[]>([]);

  const loadSavedServers = useCallback(async () => {
    try {
      const list = await getMyServers();
      setSavedServers(list);
    } catch {
      setSavedServers([]);
    }
  }, []);

  useEffect(() => {
    // Reset any leftover room state when arriving at Lobby
    resetRoomState();

    setTimeout(() => setVisible(true), 50);

    // Pre-warm backend server silently on page load to eliminate cold-start delay
    fetch(`${SERVER_URL}/health`).catch(() => {});

    loadSavedServers();

    // Auto-detect invite link: ?room=CODE or ?server=CODE or #CODE in URL
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get('room') || params.get('server');
    if (roomCode) {
      setCode(roomCode.toUpperCase());
      setTab('join-room');
    }
  }, [loadSavedServers, resetRoomState]);

  // ─── CRIAR SALA TEMPORÁRIA (14 Horas) ───────────────────────────
  const handleCreateRoom = async () => {
    setLoading(true);
    setError('');
    try {
      let persistentId = localStorage.getItem('concord_pid');
      if (!persistentId) {
        persistentId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
        localStorage.setItem('concord_pid', persistentId);
      }

      // Generate room ID & code INSTANTLY on client
      const generatedCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      const roomId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);

      // Fire server room creation and Supabase persistence in background without blocking navigation
      fetch(`${SERVER_URL}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persistentId, code: generatedCode, id: roomId, isServer: false, name: 'Sala Concord' })
      }).catch((err) => console.warn('Server room creation background ping:', err));

      createRoomInSupabase('Sala Concord', generatedCode).catch((err) =>
        console.warn('Supabase room creation background:', err)
      );

      const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
      const baseUrl = isElectron 
        ? 'https://concord-olive.vercel.app' 
        : window.location.origin;
      const inviteUrl = `${baseUrl}/#/room/${roomId}?code=${generatedCode}`;
      
      try {
        if ((window as any).electron?.copyToClipboard) {
          (window as any).electron.copyToClipboard(inviteUrl);
        } else {
          await navigator.clipboard.writeText(inviteUrl);
        }
        toast.success('Link de convite copiado!');
      } catch (err) {
        console.warn('Clipboard write failed:', err);
      }
      setIsServer(false);
      navigate(`/room/${roomId}?code=${generatedCode}`);
    } catch (e) {
      setError('Não foi possível criar a sala. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // ─── ENTRAR EM SALA ──────────────────────────────────────────────
  const handleJoinRoom = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError('Digite o código da sala ou servidor');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const supabaseRoom = await findRoomInSupabase(trimmed);
      let serverRoom: any = null;
      try {
        const res = await fetch(`${SERVER_URL}/api/rooms/${trimmed}`);
        if (res.ok) serverRoom = await res.json();
      } catch {}

      if (supabaseRoom || serverRoom || trimmed.length >= 4) {
        const roomId = serverRoom?.id || supabaseRoom?.id || crypto.randomUUID();
        const roomCode = serverRoom?.code || supabaseRoom?.code || trimmed;
        const isServerParam = supabaseRoom?.is_server || serverRoom?.isServer ? '&server=1' : '';
        if (supabaseRoom?.is_server || serverRoom?.isServer) {
          setIsServer(true);
          if (supabaseRoom?.name) setServerName(supabaseRoom.name);
        }
        navigate(`/room/${roomId}?code=${roomCode}${isServerParam}`);
      } else {
        setError('Sala ou servidor não encontrado. Verifique o código.');
      }
    } catch (e) {
      setError('Erro ao verificar a sala. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // ─── CRIAR SERVIDOR PERMANENTE (Sem expiração) ────────────────────
  const handleCreateServer = async () => {
    const trimmedName = localServerName.trim();
    if (!trimmedName) {
      setError('Digite um nome para o servidor.');
      return;
    }

    if (trimmedName.length < 2 || trimmedName.length > 40) {
      setError('O nome do servidor deve ter entre 2 e 40 caracteres.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 1. Checar unicidade do nome no banco de dados Supabase
      const check = await checkServerNameAvailable(trimmedName);
      if (!check.available) {
        setError(check.message || 'Um servidor com este nome já existe.');
        setLoading(false);
        return;
      }

      let persistentId = localStorage.getItem('concord_pid');
      if (!persistentId) {
        persistentId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
        localStorage.setItem('concord_pid', persistentId);
      }

      const generatedCode = 'SRV-' + Math.random().toString(36).substring(2, 7).toUpperCase();
      const serverId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);

      // 2. Salvar servidor no Supabase
      const createdServer = await createServerInSupabase(trimmedName, generatedCode);

      // 3. Registrar servidor no backend Node.js
      fetch(`${SERVER_URL}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          persistentId, 
          code: generatedCode, 
          id: createdServer?.id || serverId, 
          isServer: true, 
          name: trimmedName 
        })
      }).catch((err) => console.warn('Server room creation background ping:', err));

      const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
      const baseUrl = isElectron 
        ? 'https://concord-olive.vercel.app' 
        : window.location.origin;
      const inviteUrl = `${baseUrl}/#/room/${createdServer?.id || serverId}?code=${generatedCode}&server=1`;
      
      try {
        if ((window as any).electron?.copyToClipboard) {
          (window as any).electron.copyToClipboard(inviteUrl);
        } else {
          await navigator.clipboard.writeText(inviteUrl);
        }
        toast.success('Link permanente do servidor copiado!');
      } catch (err) {
        console.warn('Clipboard write failed:', err);
      }

      setIsServer(true);
      setServerName(trimmedName);
      navigate(`/room/${createdServer?.id || serverId}?code=${generatedCode}&server=1`);
    } catch (e) {
      setError('Não foi possível criar o servidor. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSavedServer = (server: SavedServer) => {
    setIsServer(true);
    setServerName(server.name);
    navigate(`/room/${server.id}?code=${server.code}&server=1`);
  };

  const handleRemoveSavedServer = (e: React.MouseEvent, serverId: string) => {
    e.stopPropagation();
    removeMyServer(serverId);
    setSavedServers(prev => prev.filter(s => s.id !== serverId));
    toast.success('Servidor removido da sua lista');
  };

  return (
    <div className={`${styles.page} ${visible ? styles.visible : ''}`}>
      {/* Background ambient blobs */}
      <div className={styles.blob1} />
      <div className={styles.blob2} />
      <div className={styles.blob3} />

      <div className={styles.card}>
        {/* Logo area */}
        <div className={styles.logoArea}>
          <img src="/logo.png" alt="Concord Logo" className={styles.logoImage} />
          <h1 className={styles.logoText}>CONCORD</h1>
          <p className={styles.tagline}>Comunicação em tempo real, sem limites</p>
        </div>

        {/* ── 1. HOME: ESCOLHA ENTRE SERVIDORES OU SALAS ── */}
        {tab === 'home' && (
          <div className={styles.homeActions}>
            <button className={styles.primaryBtn} onClick={() => { setTab('servers-menu'); setError(''); }}>
              <span className={styles.btnIcon}>🏠</span>
              <div className={styles.btnContent}>
                <span className={styles.btnTitle}>Servidores</span>
                <span className={styles.btnSub}>Links permanentes, múltiplos canais e membros</span>
              </div>
              <span className={styles.btnArrow}>→</span>
            </button>

            <button className={styles.secondaryBtn} onClick={() => { setTab('rooms-menu'); setError(''); }}>
              <span className={styles.btnIcon}>⚡</span>
              <div className={styles.btnContent}>
                <span className={styles.btnTitle}>Salas Temporárias</span>
                <span className={styles.btnSub}>Chamada rápida com validade de 14 horas</span>
              </div>
              <span className={styles.btnArrow}>→</span>
            </button>
          </div>
        )}

        {/* ── 2. MENU DE SALAS TEMPORÁRIAS ── */}
        {tab === 'rooms-menu' && (
          <div className={styles.actionPanel}>
            <button className={styles.backBtn} onClick={() => { setTab('home'); setError(''); }}>
              ← Voltar ao início
            </button>
            <div className={styles.panelHeader}>
              <div className={styles.panelIconLarge}>⚡</div>
              <h2 className={styles.panelTitle}>Salas Temporárias</h2>
              <p className={styles.panelDesc}>
                Crie ou entre em uma chamada rápida e segura com duração de 14h.
              </p>
            </div>
            
            <div className={styles.homeActions}>
              <button className={styles.primaryBtn} onClick={() => { setTab('create-room'); setError(''); }}>
                <span className={styles.btnIcon}>✨</span>
                <div className={styles.btnContent}>
                  <span className={styles.btnTitle}>Criar Nova Sala</span>
                  <span className={styles.btnSub}>Gera link instantâneo de 14 horas</span>
                </div>
                <span className={styles.btnArrow}>→</span>
              </button>

              <button className={styles.secondaryBtn} onClick={() => { setTab('join-room'); setError(''); setCode(''); }}>
                <span className={styles.btnIcon}>🚀</span>
                <div className={styles.btnContent}>
                  <span className={styles.btnTitle}>Entrar em uma Sala</span>
                  <span className={styles.btnSub}>Use um código de convite de 6 dígitos</span>
                </div>
                <span className={styles.btnArrow}>→</span>
              </button>
            </div>
          </div>
        )}

        {/* ── 3. CRIAR SALA TEMPORÁRIA ── */}
        {tab === 'create-room' && (
          <div className={styles.actionPanel}>
            <button className={styles.backBtn} onClick={() => { setTab('rooms-menu'); setError(''); }}>
              ← Voltar
            </button>
            <div className={styles.panelHeader}>
              <div className={styles.panelIconLarge}>✨</div>
              <h2 className={styles.panelTitle}>Criar Sala Temporária</h2>
              <p className={styles.panelDesc}>
                Uma sala de 14 horas será gerada. Você poderá convidar amigos compartilhando o código.
              </p>
            </div>
            {error && <div className={styles.errorBox}>{error}</div>}
            <button
              className={styles.actionBtn}
              onClick={handleCreateRoom}
              disabled={loading}
            >
              {loading ? <span className={styles.spinner} /> : '✨ Criar Sala Agora'}
            </button>
          </div>
        )}

        {/* ── 4. ENTRAR EM SALA TEMPORÁRIA ── */}
        {tab === 'join-room' && (
          <div className={styles.actionPanel}>
            <button className={styles.backBtn} onClick={() => { setTab('rooms-menu'); setError(''); setCode(''); }}>
              ← Voltar
            </button>
            <div className={styles.panelHeader}>
              <div className={styles.panelIconLarge}>🚀</div>
              <h2 className={styles.panelTitle}>Entrar em uma Sala</h2>
              <p className={styles.panelDesc}>
                Digite o código compartilhado pelo criador da sala.
              </p>
            </div>

            <div className={styles.codeInputWrapper}>
              <input
                className={styles.codeInput}
                type="text"
                placeholder="Ex: AB3CX7"
                value={code}
                maxLength={12}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setError('');
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleJoinRoom(); }}
                autoFocus
              />
            </div>

            {error && <div className={styles.errorBox}>{error}</div>}

            <button
              className={styles.actionBtn}
              onClick={handleJoinRoom}
              disabled={loading || !code.trim()}
            >
              {loading ? <span className={styles.spinner} /> : '🚀 Entrar na Sala'}
            </button>
          </div>
        )}

        {/* ── 5. MENU DE SERVIDORES (3 OPÇÕES) ── */}
        {tab === 'servers-menu' && (
          <div className={styles.actionPanel}>
            <button className={styles.backBtn} onClick={() => { setTab('home'); setError(''); }}>
              ← Voltar ao início
            </button>
            <div className={styles.panelHeader}>
              <div className={styles.panelIconLarge}>🏠</div>
              <h2 className={styles.panelTitle}>Servidores</h2>
              <p className={styles.panelDesc}>
                Espaços permanentes com múltiplos canais de chat, histórico salvo e membros.
              </p>
            </div>
            
            <div className={styles.homeActions}>
              <button className={styles.primaryBtn} onClick={() => { setTab('create-server'); setError(''); setLocalServerName(''); }}>
                <span className={styles.btnIcon}>🛡️</span>
                <div className={styles.btnContent}>
                  <span className={styles.btnTitle}>Criar Servidor</span>
                  <span className={styles.btnSub}>Gera link único que nunca expira</span>
                </div>
                <span className={styles.btnArrow}>→</span>
              </button>

              <button className={styles.secondaryBtn} onClick={() => { setTab('join-server'); setError(''); setCode(''); }}>
                <span className={styles.btnIcon}>🌐</span>
                <div className={styles.btnContent}>
                  <span className={styles.btnTitle}>Entrar em um Servidor</span>
                  <span className={styles.btnSub}>Digite o código ou link permanente</span>
                </div>
                <span className={styles.btnArrow}>→</span>
              </button>

              <button className={styles.tertiaryBtn} onClick={() => { setTab('my-servers'); setError(''); loadSavedServers(); }}>
                <span className={styles.btnIcon}>📜</span>
                <div className={styles.btnContent}>
                  <span className={styles.btnTitle}>Meus Servidores</span>
                  <span className={styles.btnSub}>Servidores que você criou ou participa ({savedServers.length})</span>
                </div>
                <span className={styles.btnArrow}>→</span>
              </button>
            </div>
          </div>
        )}

        {/* ── 6. MEUS SERVIDORES ── */}
        {tab === 'my-servers' && (
          <div className={styles.actionPanel}>
            <button className={styles.backBtn} onClick={() => { setTab('servers-menu'); setError(''); }}>
              ← Voltar
            </button>
            <div className={styles.panelHeader}>
              <div className={styles.panelIconLarge}>📜</div>
              <h2 className={styles.panelTitle}>Meus Servidores</h2>
              <p className={styles.panelDesc}>
                Seus servidores permanentes salvos. Clique em um para entrar.
              </p>
            </div>

            {savedServers.length === 0 ? (
              <div className={styles.emptyState}>
                Você ainda não participa de nenhum servidor.<br />
                Crie um novo servidor ou entre com um código de convite!
              </div>
            ) : (
              <div className={styles.serverList}>
                {savedServers.map((s) => (
                  <div 
                    key={s.id} 
                    className={styles.serverCard} 
                    onClick={() => handleSelectSavedServer(s)}
                    title={`Entrar em ${s.name}`}
                  >
                    <div className={styles.serverCardLogo}>
                      {s.icon_url ? (
                        <img src={s.icon_url} alt={s.name} />
                      ) : (
                        <span>{s.name ? s.name.charAt(0).toUpperCase() : 'S'}</span>
                      )}
                    </div>
                    <div className={styles.serverCardInfo}>
                      <div className={styles.serverCardName}>{s.name}</div>
                      <div className={styles.serverCardCode}>Código: {s.code}</div>
                    </div>
                    <span className={`${styles.serverRoleBadge} ${s.role === 'owner' ? styles.ownerBadge : styles.memberBadge}`}>
                      {s.role === 'owner' ? '👑 Dono' : '👤 Membro'}
                    </span>
                    <button 
                      className={styles.serverDeleteBtn} 
                      onClick={(e) => handleRemoveSavedServer(e, s.id)}
                      title="Remover da lista"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 7. CRIAR SERVIDOR PERMANENTE ── */}
        {tab === 'create-server' && (
          <div className={styles.actionPanel}>
            <button className={styles.backBtn} onClick={() => { setTab('servers-menu'); setError(''); }}>
              ← Voltar
            </button>
            <div className={styles.panelHeader}>
              <div className={styles.panelIconLarge}>🛡️</div>
              <h2 className={styles.panelTitle}>Criar Novo Servidor</h2>
              <p className={styles.panelDesc}>
                Dê um nome exclusivo para o seu servidor permanente. Ele sempre estará ativo e disponível.
              </p>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.inputLabel}>Nome do Servidor (máx. 40 caracteres)</label>
              <div className={styles.codeInputWrapper}>
                <input
                  className={styles.codeInput}
                  type="text"
                  placeholder="Ex: Servidor dos Amigos"
                  value={localServerName}
                  maxLength={40}
                  minLength={2}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    setLocalServerName(e.target.value);
                    setError('');
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateServer(); }}
                  autoFocus
                />
              </div>
              <span className={styles.inputHint}>{localServerName.length}/40 caracteres</span>
            </div>

            {error && <div className={styles.errorBox}>{error}</div>}

            <button
              className={styles.actionBtn}
              onClick={handleCreateServer}
              disabled={loading || !localServerName.trim()}
            >
              {loading ? <span className={styles.spinner} /> : '🛡️ Criar Servidor Permanente'}
            </button>
          </div>
        )}

        {/* ── 8. ENTRAR EM UM SERVIDOR PERMANENTE ── */}
        {tab === 'join-server' && (
          <div className={styles.actionPanel}>
            <button className={styles.backBtn} onClick={() => { setTab('servers-menu'); setError(''); setCode(''); }}>
              ← Voltar
            </button>
            <div className={styles.panelHeader}>
              <div className={styles.panelIconLarge}>🌐</div>
              <h2 className={styles.panelTitle}>Entrar em um Servidor</h2>
              <p className={styles.panelDesc}>
                Digite o código ou link permanente do servidor compartilhado com você.
              </p>
            </div>

            <div className={styles.codeInputWrapper}>
              <input
                className={styles.codeInput}
                type="text"
                placeholder="Ex: SRV-AB3X7"
                value={code}
                maxLength={20}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setError('');
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleJoinRoom(); }}
                autoFocus
              />
            </div>

            {error && <div className={styles.errorBox}>{error}</div>}

            <button
              className={styles.actionBtn}
              onClick={handleJoinRoom}
              disabled={loading || !code.trim()}
            >
              {loading ? <span className={styles.spinner} /> : '🌐 Entrar no Servidor'}
            </button>
          </div>
        )}

        {/* Footer info */}
        <p className={styles.footer}>
          Concord WebRTC • Criptografado de ponta a ponta
        </p>
      </div>
    </div>
  );
};
