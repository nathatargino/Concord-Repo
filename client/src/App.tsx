import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import { useSocket } from './hooks/useSocket';
import { useWebRTC } from './hooks/useWebRTC';
import { useAudio, monitorSpeaking, stopSpeaking, playChimeSound } from './hooks/useAudio';
import { useYouTube } from './hooks/useYouTube';
import { useScreenShare } from './hooks/useScreenShare';
import { useAppStore } from './stores/useAppStore';
import { useAudioStore } from './stores/useAudioStore';
import { supabase, saveMyServer, findRoomInSupabase } from './lib/supabase';
import type { UserInfo } from './types';

import { LoginModal } from './components/LoginModal';
import { Sidebar } from './components/Sidebar';
import { ChatPanel } from './components/ChatPanel';

import { MusicPanel } from './components/MusicPanel';
import { AudioControls } from './components/AudioControls';
import { BroadcasterScreenPanel } from './components/BroadcasterScreenPanel';
import { ScreenSharePanel } from './components/ScreenSharePanel';
import { StatusBar } from './components/StatusBar';

import styles from './App.module.css';

export default function App() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const store = useAppStore();
  const [showLogin, setShowLogin] = useState(true);
  const [loginError, setLoginError] = useState('');
  const rawMicStreamRef = useRef<MediaStream | null>(null);

  // ─── AUDIO SYSTEM ────────────────────────────────────────────────
  const audio = useAudio();

  // ─── YOUTUBE SYSTEM ──────────────────────────────────────────────
  const yt = useYouTube(
    useCallback((token) => {
      socket.emit('music_ended', token);
    }, [])
  );

  // Auto-unlock audio on any user interaction anywhere on screen
  useEffect(() => {
    const handleGlobalInteraction = () => {
      yt.unlock();
    };
    window.addEventListener('pointerdown', handleGlobalInteraction);
    window.addEventListener('click', handleGlobalInteraction);
    window.addEventListener('keydown', handleGlobalInteraction);
    return () => {
      window.removeEventListener('pointerdown', handleGlobalInteraction);
      window.removeEventListener('click', handleGlobalInteraction);
      window.removeEventListener('keydown', handleGlobalInteraction);
    };
  }, [yt]);

  // ─── DEEP LINKING (Electron) ─────────────────────────────────────
  useEffect(() => {
    if (window.electron && window.electron.onDeepLink) {
      const unsubscribe = window.electron.onDeepLink((url) => {
        try {
          const parsed = new URL(url);
          if (parsed.hostname === 'auth') {
            const access_token = parsed.searchParams.get('access_token');
            const refresh_token = parsed.searchParams.get('refresh_token');
            if (access_token && refresh_token) {
              supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
                if (!error) {
                  toast.success('Login sincronizado com a Web!');
                  setTimeout(() => window.location.reload(), 1000);
                }
              });
            }
          } else if (parsed.hostname === 'join') {
            const code = parsed.searchParams.get('code');
            if (code) {
              navigate(`/room/${code}?server=1`);
              window.location.reload();
            }
          }
        } catch (err) {
          console.error("Deep link parsing error", err);
        }
      });
      return unsubscribe;
    }
  }, [navigate]);

  // Sync audio volumes when store changes
  useEffect(() => {
    const unsub = useAudioStore.subscribe(() => {
      audio.applyMicSettings();
      audio.applyRemoteSettings();
      audio.applyNoiseSuppressionSettings();
      yt.applyYTVolume();
    });
    return unsub;
  }, [audio, yt]);

  // ─── WEBRTC SYSTEM ───────────────────────────────────────────────
  const rtc = useWebRTC(
    (event, ...args) => socket.emit(event as any, ...args),
    audio.attachRemoteStream,
    audio.attachRemoteScreenAudio
  );

  let handleLeaveVoice = () => {};

  // ─── SOCKET CONNECTION ───────────────────────────────────────────
  const socket = useSocket({
    onExistingVoiceUsers: rtc.onExistingVoiceUsers,
    onUserJoinedVoice: rtc.onUserJoinedVoice,
    onUserLeftVoice: (userId) => {
      rtc.onUserLeftVoice(userId);
      audio.removeRemoteGain(userId);
    },
    onReceiveOffer: rtc.onReceiveOffer,
    onReceiveAnswer: rtc.onReceiveAnswer,
    onReceiveIce: rtc.onReceiveIce,
    onPlayYouTube: (videoId, startSeconds, token) => {
      if (useAppStore.getState().inVoice) {
        yt.playYouTube(videoId, startSeconds, token);
      }
    },
    onStopYouTube: yt.stopYouTube,
    onPauseYouTube: () => {
      if (useAppStore.getState().inVoice) yt.pauseYouTube();
    },
    onResumeYouTube: () => {
      if (useAppStore.getState().inVoice) yt.resumeYouTube();
    },
    onRoomJoined: (roomInfo) => {
      store.setRoom(roomInfo);
      if (roomInfo.isServer) {
        store.setIsServer(true);
        if (roomInfo.name) store.setServerName(roomInfo.name);
        if (roomInfo.iconUrl) store.setServerIconUrl(roomInfo.iconUrl);
      }
    },
    onScreenViewerJoined: (viewer) => {
      playChimeSound();
      toast(`👁️ ${viewer.name} começou a assistir sua transmissão!`, { icon: '📺' });
    },
    onRoomError: (msg) => {
      console.warn('[Room] Error:', msg);
      store.setRoom(null);
      navigate('/');
    },
    onKickedFromVoice: () => handleLeaveVoice(),
    onKickedFromRoom: () => {
      store.setRoom(null);
      navigate('/');
    }
  });

  // ─── SCREEN SHARE SYSTEM ─────────────────────────────────────────
  const screenShare = useScreenShare(
    (event, ...args) => socket.emit(event as any, ...args),
    rtc.addScreenShareTrack,
    rtc.removeScreenShareTrack
  );

  // ─── JOIN ROOM on mount ───────────────────────────────────────────
  useEffect(() => {
    if (!roomId) {
      navigate('/');
      return;
    }

    const tryJoin = async () => {
      let persistentId = localStorage.getItem('concord_pid');
      if (!persistentId) {
        persistentId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
        localStorage.setItem('concord_pid', persistentId);
      }
      
      const searchParams = new URLSearchParams(window.location.search);
      const hashParams = window.location.hash.includes('?') 
        ? new URLSearchParams(window.location.hash.substring(window.location.hash.indexOf('?')))
        : new URLSearchParams();

      const codeParam = searchParams.get('code') || hashParams.get('code') || (roomId.startsWith('SRV-') ? roomId : '');
      const isServerParam = searchParams.get('server') === '1' || hashParams.get('server') === '1' || codeParam.startsWith('SRV-') || roomId.startsWith('SRV-');
      
      // Consultar metadados reais do Supabase para obter ID canônico, nome, logo e autor
      const dbRoom = await findRoomInSupabase(roomId || codeParam);
      const targetRoomId = dbRoom?.id || roomId;
      const targetCode = dbRoom?.code || codeParam || (roomId.length <= 8 ? roomId.toUpperCase() : 'CONCORD');
      const targetName = dbRoom?.name || (isServerParam ? (store.serverName || 'Servidor Concord') : 'Sala Concord');
      const targetIconUrl = dbRoom?.icon_url || null;
      const isServer = dbRoom?.is_server ?? isServerParam;

      if (isServer) {
        store.setIsServer(true);
        if (targetName) store.setServerName(targetName);
        if (targetIconUrl) store.setServerIconUrl(targetIconUrl);
      }

      // Validar autoria real no Supabase
      let isOwner = false;
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user && isServer) {
          if (dbRoom?.created_by && user.id === dbRoom.created_by) {
            isOwner = true;
          } else if (dbRoom?.id) {
            const { data: mem } = await supabase
              .from('server_members')
              .select('role')
              .eq('server_id', dbRoom.id)
              .eq('user_id', user.id)
              .maybeSingle();
            if (mem?.role === 'owner') isOwner = true;
          }
        }
      } catch (err) {
        console.warn('Erro ao checar permissões de autor no Supabase:', err);
      }

      // Pre-initialize room object em memória no store com permissões validadas
      if (!store.room || store.room.id !== targetRoomId) {
        store.setRoom({
          id: targetRoomId,
          code: targetCode,
          name: targetName,
          iconUrl: targetIconUrl || undefined,
          isServer,
          createdAt: Date.now(),
          expiresAt: isServer ? Infinity : Date.now() + 14 * 60 * 60 * 1000,
          userCount: 1,
          adminIds: isServer ? (isOwner ? [socket.socket?.id || 'admin'] : []) : [socket.socket?.id || 'admin'],
          channels: isServer ? [{ id: 'ch-geral', name: 'geral' }] : undefined,
        });
      }

      // Atualizar no histórico "Meus Servidores"
      if (isServer) {
        saveMyServer({
          id: targetRoomId,
          code: targetCode,
          name: targetName,
          icon_url: targetIconUrl || undefined,
          role: isOwner ? 'owner' : 'member',
        });
      }

      socket.emit('join_room', targetRoomId, persistentId, targetCode, isServer, targetName);
      const currentName = store.myName || localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1');
      if (currentName) {
        socket.emit('set_username', currentName);
      }
    };

    const timer = setTimeout(tryJoin, 100);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ─── LOGIN E NOME DE USUÁRIO ───────────────────────────────────────
  useEffect(() => {
    const syncUserProfile = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', user.id)
            .maybeSingle();

          const profileName = profile?.username || user.user_metadata?.username || user.user_metadata?.display_name || user.email?.split('@')[0];
          if (profileName && profileName.trim()) {
            const cleanName = profileName.trim();
            store.setMyName(cleanName);
            localStorage.setItem('concord_username', cleanName);
            localStorage.setItem('concord_username_v1', cleanName);
            socket.emit('set_username', cleanName);
            setShowLogin(false);
            setLoginError('');
            return;
          }
        }
      } catch (err) {
        console.warn('Supabase getUser error:', err);
      }

      const savedName = localStorage.getItem('concord_username') || localStorage.getItem('concord_username_v1');
      if (savedName && savedName.trim()) {
        store.setMyName(savedName.trim());
        setShowLogin(false);
      } else {
        setShowLogin(true);
      }
    };

    syncUserProfile();
  }, []);

  useEffect(() => {
    if (store.myName) {
      socket.emit('set_username', store.myName);
    }
  }, [store.myName]);

  // ─── VALIDAÇÃO DE NOME DUPLICADO NA SALA/SERVIDOR ─────────────────
  useEffect(() => {
    if (!store.myName || !store.users || store.users.length === 0) return;

    const currentSocketId = socket.socket?.id;
    const myPersistentId = localStorage.getItem('concord_pid');
    const lowerMyName = store.myName.trim().toLowerCase();

    const isDuplicate = store.users.some(
      (u: UserInfo) => 
        u.id !== currentSocketId && 
        (!myPersistentId || u.persistentId !== myPersistentId) &&
        u.name && 
        u.name.trim().toLowerCase() === lowerMyName
    );

    if (isDuplicate) {
      toast.error(`O nome "${store.myName}" já está em uso nesta chamada/servidor por outro usuário. Escolha outro nome.`, { duration: 5000 });
      setLoginError(`O nome "${store.myName}" já está em uso nesta chamada/servidor por outro usuário. Escolha outro nome.`);
      setShowLogin(true);
    }
  }, [store.users, store.myName, socket.socket?.id]);

  const handleLogin = (name: string) => {
    store.setMyName(name);
    localStorage.setItem('concord_username', name);
    localStorage.setItem('concord_username_v1', name);
    socket.emit('set_username', name);
    setLoginError('');
    setShowLogin(false);
  };

  // ─── ACTIONS ─────────────────────────────────────────────────────
  const handleJoinVoice = async () => {
    if (!store.myName || !store.myName.trim()) {
      setLoginError('Por favor, defina seu nome de usuário antes de entrar na chamada.');
      setShowLogin(true);
      return;
    }

    const currentSocketId = socket.socket?.id;
    const myPersistentId = localStorage.getItem('concord_pid');
    const lowerMyName = store.myName.trim().toLowerCase();
    const isDuplicate = store.users.some(
      (u: UserInfo) => 
        u.id !== currentSocketId && 
        (!myPersistentId || u.persistentId !== myPersistentId) &&
        u.name && 
        u.name.trim().toLowerCase() === lowerMyName
    );

    if (isDuplicate) {
      toast.error(`O nome "${store.myName}" já está em uso nesta chamada por outro usuário. Escolha outro nome.`, { duration: 5000 });
      setLoginError(`O nome "${store.myName}" já está em uso nesta chamada por outro usuário.`);
      setShowLogin(true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // @ts-ignore
          googNoiseSuppression: true,
          googHighpassFilter: true,
        },
      });
      rawMicStreamRef.current = stream;
      const processedStream = await audio.processMicStream(stream);
      await rtc.joinVoice(store.myId, processedStream);
      store.setInVoice(true);
      monitorSpeaking(processedStream, store.myId);
    } catch (err) {
      console.error('Mic error', err);
      alert('Erro ao acessar o microfone. Verifique as permissões.');
    }
  };

  handleLeaveVoice = () => {
    rtc.leaveVoice();
    audio.cleanup();
    store.setInVoice(false);
    if (store.amSharing) {
      screenShare.stopScreenShare();
    }
    // Apenas pausa o YouTube localmente ao sair da call.
    // NÃO para o player — assim ele retoma quando o usuário voltar à call.
    yt.pauseYouTube();
    stopSpeaking(store.myId);
    
    // Ensure the raw microphone stream is also stopped
    if (rawMicStreamRef.current) {
      rawMicStreamRef.current.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      rawMicStreamRef.current = null;
    }
  };


  return (
    <div className={styles.appContainer}>
      <Toaster position="top-right" toastOptions={{ style: { background: '#1A1A28', color: '#fff', border: '1px solid #7C3AED' } }} />

      {showLogin && <LoginModal onLogin={handleLogin} initialError={loginError} />}

      <Sidebar 
        onScreenShareClick={(id) => {
          const u = store.users.find(x => x.id === id);
          store.setScreenShare(id, u?.name);
        }}
        onJoinVoice={handleJoinVoice}
        onLeaveVoice={handleLeaveVoice}
        onStartScreenShare={screenShare.startScreenShare}
        onStopScreenShare={screenShare.stopScreenShare}
        onCreateChannel={(name) => socket.emit('create_channel', name)}
        onEditChannel={(channelId, newName) => socket.emit('edit_channel', channelId, newName)}
        onDeleteChannel={(channelId) => socket.emit('delete_channel', channelId)}
        onUpdateServer={(serverId, newName, newIconUrl) => socket.emit('update_server', serverId, newName, newIconUrl)}
        onSetUserRole={(targetId, role) => socket.emit('set_user_role', targetId, role)}
        onAdminAction={(action, targetId) => {
          if (action === 'mute') socket.emit('admin_mute_user', targetId);
          else if (action === 'unmute') socket.emit('admin_unmute_user', targetId);
          else if (action === 'kick_voice') socket.emit('admin_kick_voice', targetId);
          else if (action === 'kick_room') socket.emit('admin_kick_room', targetId);
          else if (action === 'give_admin') socket.emit('admin_transfer_role', targetId);
          else if (action === 'local_mute') useAudioStore.getState().toggleLocalMuteUser(targetId);
        }}
      />

      <main className={styles.mainContent}>
        <div className={styles.chatSection}>
          <ChatPanel 
            onSendMessage={(msg, type, url, filename, channelId) => {
              socket.emit('send_message', msg, type, url, filename, channelId || store.activeChannelId);
            }}
            onMusicAction={(action) => {
              socket.emit('music_action', action);
            }}
          />
        </div>

        <div className={styles.sidePanels}>
          <MusicPanel
            onRequestMusic={(url) => socket.emit('request_music', url)}
            onRemoveFromQueue={(token) => socket.emit('remove_from_queue', token)}
            onReorderQueue={(oldIndex, newIndex) => socket.emit('reorder_queue', oldIndex, newIndex)}
            inVoice={store.inVoice}
          />
          <AudioControls onUnlockAudio={yt.unlock} />
          <BroadcasterScreenPanel
            onStopSharing={screenShare.stopScreenShare}
            onChangeSharing={screenShare.changeScreenShare}
          />
        </div>
      </main>

      <ScreenSharePanel 
        onClose={() => store.setScreenShare(null)} 
        screenStream={store.screenShareUserId ? rtc.remoteScreenStreams.get(store.screenShareUserId) : null}
        onStartWatching={(broadcasterId) => socket.emit('start_watching_screen', broadcasterId)}
        onStopWatching={(broadcasterId) => socket.emit('stop_watching_screen', broadcasterId)}
      />
      
      <div style={{ position: 'absolute', bottom: 0, width: '100%' }}>
        <StatusBar />
      </div>
    </div>
  );
}
