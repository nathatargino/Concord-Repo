import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../stores/useAppStore';
import { 
  checkServerNameAvailable, 
  createServerInSupabase, 
  createRoomInSupabase,
  findRoomInSupabase,
  saveRecentRoom,
  saveMyServer,
  joinServerInSupabase,
  getOrCreatePersistentId 
} from '../lib/supabase';
import toast from 'react-hot-toast';
import styles from './ServerActionModal.module.css';
import { SERVER_URL } from '../config';

export const ServerActionModal: React.FC = () => {
  const navigate = useNavigate();
  const { 
    isActionModalOpen, 
    actionModalTab, 
    closeActionModal, 
    setActiveRailContext,
    setIsServer,
    setServerName,
    refreshRecentRooms,
    refreshServers,
    recordRecentServer,
    myName
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<'create-server' | 'join-server' | 'create-room'>(actionModalTab);
  const [serverNameInput, setServerNameInput] = useState('');
  const [serverLogoUrl, setServerLogoUrl] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [roomNameInput, setRoomNameInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync tab with store when modal opens
  React.useEffect(() => {
    setActiveTab(actionModalTab);
    setError('');
  }, [actionModalTab, isActionModalOpen]);

  if (!isActionModalOpen) return null;

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Por favor, selecione um arquivo de imagem válido.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError('A imagem do servidor deve ter no máximo 2MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setServerLogoUrl(reader.result as string);
      setError('');
    };
    reader.readAsDataURL(file);
  };

  // ─── 1. CRIAR SERVIDOR PERMANENTE ────────────────────────────────
  const handleCreateServer = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = serverNameInput.trim();
    if (!trimmed) {
      setError('Digite um nome para o servidor.');
      return;
    }
    if (trimmed.length < 2 || trimmed.length > 40) {
      setError('O nome do servidor deve ter entre 2 e 40 caracteres.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const check = await checkServerNameAvailable(trimmed);
      if (!check.available) {
        setError(check.message || 'Um servidor com este nome já existe.');
        setLoading(false);
        return;
      }

      const persistentId = getOrCreatePersistentId();
      const generatedCode = 'SRV-' + Math.random().toString(36).substring(2, 7).toUpperCase();
      const serverId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);

      const createdServer = await createServerInSupabase(trimmed, generatedCode, serverId);

      // Registrar servidor no backend Node.js
      fetch(`${SERVER_URL}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persistentId,
          code: generatedCode,
          id: createdServer?.id || serverId,
          isServer: true,
          name: trimmed,
        }),
      }).catch((err) => console.warn('Server room creation background ping:', err));

      const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
      const baseUrl = isElectron ? 'https://concord-repo.pages.dev' : window.location.origin;
      const inviteUrl = `${baseUrl}/#/room/${createdServer?.id || serverId}?code=${generatedCode}&server=1`;
      const inviteMessage = `Você foi convidado para o servidor ${trimmed} no Concord! Acesse:\n${inviteUrl}`;

      try {
        if ((window as any).electron?.copyToClipboard) {
          (window as any).electron.copyToClipboard(inviteMessage);
        } else {
          await navigator.clipboard.writeText(inviteMessage);
        }
        toast.success('Servidor criado e link copiado!');
      } catch {
        toast.success('Servidor criado com sucesso!');
      }

      const newServerData = {
        id: createdServer?.id || serverId,
        code: generatedCode,
        name: trimmed,
        icon_url: createdServer?.icon_url || null,
        role: 'owner' as const,
      };
      recordRecentServer(newServerData);
      await refreshServers();

      setIsServer(true);
      setServerName(trimmed);
      setActiveRailContext(createdServer?.id || serverId);
      closeActionModal();
      navigate(`/room/${createdServer?.id || serverId}?code=${generatedCode}&server=1`);
    } catch (err) {
      console.error('Erro ao criar servidor:', err);
      setError('Não foi possível criar o servidor. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // ─── 2. ENTRAR EM SERVIDOR / SALA ─────────────────────────────────
  const handleJoinServer = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = joinCodeInput.trim();
    if (!raw) {
      setError('Digite o código ou link de convite do servidor.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      let targetCode = raw;
      let targetId: string | null = null;

      const codeMatch = raw.match(/[?&]code=([a-zA-Z0-9_-]+)/i);
      if (codeMatch) {
        targetCode = codeMatch[1].toUpperCase();
      } else {
        const inviteLabelMatch = raw.match(/c[óo]digo(?:\s+de\s+convite)?[:\s]+([a-zA-Z0-9_-]+)/i);
        if (inviteLabelMatch) {
          targetCode = inviteLabelMatch[1].toUpperCase();
        } else if (!raw.includes('://') && !raw.includes('/')) {
          targetCode = raw.toUpperCase();
        }
      }

      const roomMatch = raw.match(/\/room\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-zA-Z0-9_-]+)/i);
      if (roomMatch) {
        targetId = roomMatch[1];
      }

      // Buscar metadados exclusivamente por código de convite ou ID válido
      const supabaseRoom = await findRoomInSupabase(targetCode) || (targetId ? await findRoomInSupabase(targetId) : null);
      if (!supabaseRoom) {
        setError('Código de convite inválido ou expirado.');
        setLoading(false);
        return;
      }

      const roomId = supabaseRoom.id;
      const roomCode = supabaseRoom.code;
      const isServerRoom = Boolean(supabaseRoom.is_server || roomCode.startsWith('SRV-') || activeTab === 'join-server');

      if (isServerRoom) {
        await joinServerInSupabase(roomId);
        const joinedServerData = {
          id: roomId,
          code: roomCode,
          name: supabaseRoom.name,
          icon_url: supabaseRoom.icon_url,
          role: 'member' as const,
        };
        saveMyServer(joinedServerData);
        recordRecentServer(joinedServerData);
        await refreshServers();
      }

      setIsServer(isServerRoom);
      if (supabaseRoom.name) setServerName(supabaseRoom.name);
      setActiveRailContext(roomId);
      closeActionModal();
      navigate(`/room/${roomId}?code=${roomCode}${isServerRoom ? '&server=1' : ''}`);
    } catch {
      setError('Código de convite inválido ou expirado.');
    } finally {
      setLoading(false);
    }
  };

  // ─── 3. CRIAR SALA RÁPIDA (14 Horas) ──────────────────────────────
  const handleCreateTempRoom = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const persistentId = getOrCreatePersistentId();
      const generatedCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      const roomId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
      const targetRoomName = roomNameInput.trim() || `Sala de ${myName || 'Concord'}`;

      fetch(`${SERVER_URL}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persistentId,
          code: generatedCode,
          id: roomId,
          isServer: false,
          name: targetRoomName,
        }),
      }).catch((err) => console.warn('Server room creation background ping:', err));

      createRoomInSupabase(targetRoomName, generatedCode, roomId).catch((err) =>
        console.warn('Supabase room creation background:', err)
      );

      // Salvar no histórico local de salas 14h
      saveRecentRoom({
        id: roomId,
        code: generatedCode,
        name: targetRoomName,
        createdAt: Date.now(),
      });
      refreshRecentRooms();

      const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
      const baseUrl = isElectron ? 'https://concord-repo.pages.dev' : window.location.origin;
      const inviteUrl = `${baseUrl}/#/room/${roomId}?code=${generatedCode}`;
      const inviteMessage = `Você foi convidado para a sala ${targetRoomName} no Concord (válida por 14h)! Acesse:\n${inviteUrl}`;

      try {
        if ((window as any).electron?.copyToClipboard) {
          (window as any).electron.copyToClipboard(inviteMessage);
        } else {
          await navigator.clipboard.writeText(inviteMessage);
        }
        toast.success('Sala criada e link copiado!');
      } catch {
        toast.success('Sala criada!');
      }

      setIsServer(false);
      setActiveRailContext(roomId);
      closeActionModal();
      navigate(`/room/${roomId}?code=${generatedCode}`);
    } catch {
      setError('Erro ao criar sala rápida. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={closeActionModal}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <i className={`fa-solid fa-layer-group ${styles.headerIcon}`} />
            <span>Adicionar ao Concord</span>
          </div>
          <button className={styles.closeBtn} onClick={closeActionModal} aria-label="Fechar">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          <button
            className={`${styles.tabBtn} ${activeTab === 'create-server' ? styles.active : ''}`}
            onClick={() => { setActiveTab('create-server'); setError(''); }}
          >
            <i className="fa-solid fa-plus-circle" />
            <span>Criar Servidor</span>
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === 'join-server' ? styles.active : ''}`}
            onClick={() => { setActiveTab('join-server'); setError(''); }}
          >
            <i className="fa-solid fa-arrow-right-to-bracket" />
            <span>Entrar em Servidor</span>
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === 'create-room' ? styles.active : ''}`}
            onClick={() => { setActiveTab('create-room'); setError(''); }}
          >
            <i className="fa-solid fa-bolt" />
            <span>Sala Rápida (14h)</span>
          </button>
        </div>

        {/* Body Content */}
        <div className={styles.body}>
          {error && (
            <div className={styles.errorBox}>
              <i className="fa-solid fa-circle-exclamation" />
              <span>{error}</span>
            </div>
          )}

          {/* TAB 1: CRIAR SERVIDOR */}
          {activeTab === 'create-server' && (
            <form onSubmit={handleCreateServer} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p className={styles.description}>
                Servidores são permanentes, com links reutilizáveis, múltiplos canais de texto e voz, e gestão de membros.
              </p>

              <div className={styles.formGroup}>
                <label className={styles.label}>Nome do Servidor</label>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Ex: Servidor dos Amigos, Trabalho, etc."
                  value={serverNameInput}
                  onChange={(e) => setServerNameInput(e.target.value)}
                  maxLength={40}
                  autoFocus
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Ícone do Servidor (Opcional)</label>
                <div className={styles.logoUploadArea}>
                  <div className={styles.logoPreview}>
                    {serverLogoUrl ? (
                      <img src={serverLogoUrl} alt="Logo" className={styles.logoImg} />
                    ) : (
                      <i className="fa-solid fa-image" />
                    )}
                  </div>
                  <div className={styles.uploadActions}>
                    <button
                      type="button"
                      className={styles.uploadBtn}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Escolher Imagem
                    </button>
                    <span className={styles.uploadHint}>PNG, JPG ou GIF até 2MB</span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleLogoUpload}
                  />
                </div>
              </div>

              <button type="submit" className={styles.primaryBtn} disabled={loading || !serverNameInput.trim()}>
                {loading ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-check" />}
                <span>{loading ? 'Criando Servidor...' : 'Criar Servidor'}</span>
              </button>
            </form>
          )}

          {/* TAB 2: ENTRAR EM SERVIDOR */}
          {activeTab === 'join-server' && (
            <form onSubmit={handleJoinServer} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p className={styles.description}>
                Insira o código de convite (ex: <code>SRV-ABC12</code>) ou cole o link completo do servidor que você recebeu.
              </p>

              <div className={styles.formGroup}>
                <label className={styles.label}>Código ou Link de Convite</label>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="https://concord-repo.pages.dev/#/room/... ou SRV-XXXXX"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value)}
                  autoFocus
                />
              </div>

              <button type="submit" className={styles.primaryBtn} disabled={loading || !joinCodeInput.trim()}>
                {loading ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-arrow-right-to-bracket" />}
                <span>{loading ? 'Entrando...' : 'Entrar no Servidor'}</span>
              </button>
            </form>
          )}

          {/* TAB 3: CRIAR SALA RÁPIDA (14h) */}
          {activeTab === 'create-room' && (
            <form onSubmit={handleCreateTempRoom} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className={styles.tempRoomCard}>
                <div className={styles.tempRoomTitle}>
                  <i className="fa-solid fa-bolt" />
                  <span>Chamada Efêmera de 14 Horas</span>
                </div>
                <p className={styles.description} style={{ color: '#e2e8f0', margin: 0 }}>
                  Perfeita para reuniões pontuais, estudos em grupo, assistir vídeos juntos e jogar com amigos sem precisar gerenciar servidores.
                </p>
                <ul className={styles.tempRoomFeatures}>
                  <li><i className="fa-solid fa-check" /> Áudio HD com cancelamento de ruído e eco</li>
                  <li><i className="fa-solid fa-check" /> Compartilhamento de tela em 60 FPS</li>
                  <li><i className="fa-solid fa-check" /> YouTube e Streaming sincronizados</li>
                  <li><i className="fa-solid fa-check" /> Expira automaticamente após 14 horas</li>
                </ul>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Nome da Sala</label>
                <input
                  type="text"
                  className={styles.input}
                  placeholder={`Sala de ${myName || 'Concord'}`}
                  value={roomNameInput}
                  onChange={(e) => setRoomNameInput(e.target.value)}
                  maxLength={40}
                />
              </div>

              <button
                type="submit"
                className={`${styles.primaryBtn} ${styles.roomBtn}`}
                disabled={loading}
              >
                {loading ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-plus" />}
                <span>{loading ? 'Gerando Sala...' : 'Criar Sala Rápida (14h)'}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
