import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import styles from './LobbyPage.module.css';
import { 
  createRoomInSupabase, 
  findRoomInSupabase, 
  checkServerNameAvailable, 
  createServerInSupabase 
} from '../lib/supabase';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? 'https://concord-repo.onrender.com' : 'http://localhost:3001');

type Tab = 'home' | 'rooms-menu' | 'servers-menu' | 'create-room' | 'join-room' | 'create-server' | 'join-server';

export const LobbyPage: React.FC = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('home');
  const [code, setCode] = useState('');
  const [serverName, setServerName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setTimeout(() => setVisible(true), 50);

    // Pre-warm backend server silently on page load to eliminate cold-start delay
    fetch(`${SERVER_URL}/health`).catch(() => {});

    // Auto-detect invite link: ?room=CODE or ?server=CODE or #CODE in URL
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get('room') || params.get('server');
    if (roomCode) {
      setCode(roomCode.toUpperCase());
      setTab('join-room');
    }
  }, []);

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
      // 1. Try querying Supabase room table first
      const supabaseRoom = await findRoomInSupabase(trimmed);

      // 2. Fallback check on server API
      let serverRoom = null;
      try {
        const res = await fetch(`${SERVER_URL}/api/rooms/${trimmed}`);
        if (res.ok) {
          serverRoom = await res.json();
        }
      } catch (err) {
        console.warn('Server room lookup fallback:', err);
      }

      if (supabaseRoom || serverRoom) {
        const roomId = serverRoom?.id || supabaseRoom?.id || crypto.randomUUID();
        const roomCode = serverRoom?.code || supabaseRoom?.code || trimmed;
        const isServerParam = supabaseRoom?.is_server || serverRoom?.isServer ? '&server=1' : '';
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
    const trimmedName = serverName.trim();
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
      // 1. Verificar no Supabase se o nome já existe
      const checkResult = await checkServerNameAvailable(trimmedName);
      if (!checkResult.available) {
        setError(checkResult.message || 'Um servidor com este nome já existe. Por favor, escolha outro nome para o seu servidor.');
        setLoading(false);
        return;
      }

      let persistentId = localStorage.getItem('concord_pid');
      if (!persistentId) {
        persistentId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
        localStorage.setItem('concord_pid', persistentId);
      }

      // Generate unique code & id for server
      const generatedCode = 'SRV-' + Math.random().toString(36).substring(2, 7).toUpperCase();
      const serverId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);

      // Create in Supabase (creates server + default #geral channel + owner member)
      const createdServer = await createServerInSupabase(trimmedName, generatedCode);

      // Register server in backend memory (with isServer: true)
      fetch(`${SERVER_URL}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persistentId,
          code: generatedCode,
          id: createdServer?.id || serverId,
          isServer: true,
          name: trimmedName,
        })
      }).catch((err) => console.warn('Server registration ping:', err));

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
        toast.success('Servidor criado e link permanente copiado!');
      } catch (err) {
        console.warn('Clipboard write failed:', err);
      }

      navigate(`/room/${createdServer?.id || serverId}?code=${generatedCode}&server=1`);
    } catch (e: any) {
      setError('Erro ao criar o servidor: ' + (e.message || 'Tente novamente.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`${styles.page} ${visible ? styles.visible : ''}`}>
      {/* Background blobs */}
      <div className={styles.blob1} />
      <div className={styles.blob2} />
      <div className={styles.blob3} />

      <div className={styles.card}>
        {/* Logo */}
        <div className={styles.logoArea}>
          <img src="/logo.png" alt="Concord Logo" className={styles.logoImage} />
          <h1 className={styles.logoText}>Concord</h1>
          <p className={styles.tagline}>Música e voz em tempo real</p>
        </div>

        {/* ── 1. HOME: Escolha entre Servidores ou Salas ── */}
        {tab === 'home' && (
          <div className={styles.homeActions}>
            <button className={styles.primaryBtn} onClick={() => { setTab('servers-menu'); setError(''); }}>
              <span className={styles.btnIcon}>🏠</span>
              <div className={styles.btnContent}>
                <span className={styles.btnTitle}>Servidores</span>
                <span className={styles.btnSub}>Espaço permanente com canais e histórico</span>
              </div>
              <span className={styles.btnArrow}>→</span>
            </button>

            <button className={styles.secondaryBtn} onClick={() => { setTab('rooms-menu'); setError(''); }}>
              <span className={styles.btnIcon}>⚡</span>
              <div className={styles.btnContent}>
                <span className={styles.btnTitle}>Salas Temporárias</span>
                <span className={styles.btnSub}>Chamada rápida com duração de 14h</span>
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
                Salas rápidas e diretas para conversas temporárias com até 14 horas de duração.
              </p>
            </div>
            
            <div className={styles.homeActions}>
              <button className={styles.primaryBtn} onClick={() => { setTab('create-room'); setError(''); }}>
                <span className={styles.btnIcon}>✨</span>
                <div className={styles.btnContent}>
                  <span className={styles.btnTitle}>Criar Nova Sala</span>
                  <span className={styles.btnSub}>Gera um código temporário de 14h</span>
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

        {/* ── 5. MENU DE SERVIDORES ── */}
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
              <button className={styles.primaryBtn} onClick={() => { setTab('create-server'); setError(''); setServerName(''); }}>
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
            </div>
          </div>
        )}

        {/* ── 6. CRIAR SERVIDOR PERMANENTE ── */}
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
                  value={serverName}
                  maxLength={40}
                  minLength={2}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    setServerName(e.target.value);
                    setError('');
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateServer(); }}
                  autoFocus
                />
              </div>
              <span className={styles.inputHint}>{serverName.length}/40 caracteres</span>
            </div>

            {error && <div className={styles.errorBox}>{error}</div>}

            <button
              className={styles.actionBtn}
              onClick={handleCreateServer}
              disabled={loading || !serverName.trim()}
            >
              {loading ? <span className={styles.spinner} /> : '🛡️ Criar Servidor Permanente'}
            </button>
          </div>
        )}

        {/* ── 7. ENTRAR EM SERVIDOR ── */}
        {tab === 'join-server' && (
          <div className={styles.actionPanel}>
            <button className={styles.backBtn} onClick={() => { setTab('servers-menu'); setError(''); setCode(''); }}>
              ← Voltar
            </button>
            <div className={styles.panelHeader}>
              <div className={styles.panelIconLarge}>🌐</div>
              <h2 className={styles.panelTitle}>Entrar em um Servidor</h2>
              <p className={styles.panelDesc}>
                Digite o código do servidor (ex: SRV-AB3X7) ou código compartilhado.
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

        <p className={styles.footer}>
          Concord • Comunicação Descentralizada & Sem Fronteiras
        </p>
      </div>
    </div>
  );
};
