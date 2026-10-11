import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { notifyInChat } from './utils/systemMessage';
import { useSocket } from './hooks/useSocket';
import { useWebRTC } from './hooks/useWebRTC';
import { useAudio, monitorSpeaking, stopSpeaking, playChimeSound } from './hooks/useAudio';
import { useYouTube } from './hooks/useYouTube';
import { useScreenShare } from './hooks/useScreenShare';
import { useAppStore } from './stores/useAppStore';
import { useAudioStore } from './stores/useAudioStore';
import { supabase, saveMyServer, saveRecentRoom, findRoomInSupabase, isUuid, syncProfileAfterAuth, syncCloudUserData, getOrCreatePersistentId, getSavedUsername, saveUsername, fetchDirectChatsFromSupabase, joinServerInSupabase, ensureSupabaseSessionRestored } from './lib/supabase';
import type { UserInfo } from './types';
import toast from 'react-hot-toast';

import { LoginModal } from './components/LoginModal';
import { Sidebar } from './components/Sidebar';
import { ChatPanel } from './components/ChatPanel';
import { PiPPlayer } from './components/PiPPlayer';

import { MusicPanel } from './components/MusicPanel';
import { AudioControls } from './components/AudioControls';
import { BroadcasterScreenPanel } from './components/BroadcasterScreenPanel';
import { ScreenSharePanel } from './components/ScreenSharePanel';
import { ScreenPickerModal } from './components/ScreenPickerModal';
import { AccountModals } from './components/AccountModals';
import { UserProfileModal } from './components/UserProfileModal';
import { ServerRail } from './components/ServerRail';
import { HomeHub } from './components/HomeHub';
import { ServerActionModal } from './components/ServerActionModal';
import { FloatingCallBar } from './components/FloatingCallBar';
import { DiscordLoadingScreen } from './components/DiscordLoadingScreen';
import { ConfirmModal } from './components/ConfirmModal';

import styles from './App.module.css';

const LAST_LAUNCH_DAY_KEY = 'concord_last_launch_day_v1';

// Deduplica callbacks de OAuth entregues por múltiplos canais (janela de 60s)
const handledAuthCallbacks = new Map<string, number>();
function shouldHandleAuthCallback(key: string): boolean {
  const now = Date.now();
  handledAuthCallbacks.forEach((ts, k) => {
    if (now - ts > 60_000) handledAuthCallbacks.delete(k);
  });
  if (handledAuthCallbacks.has(key)) return false;
  handledAuthCallbacks.set(key, now);
  return true;
}

export default function App() {
  const { roomId: paramRoomId } = useParams<{ roomId?: string }>();
  const location = useLocation();
  const roomMatch = location.pathname.match(/^\/room\/([^/?#]+)/);
  const dmMatch = location.pathname.match(/^\/dm\/([^/?#]+)/);
  const roomId = paramRoomId || (roomMatch ? roomMatch[1] : undefined);
  const dmChatId = dmMatch ? dmMatch[1] : undefined;

  const navigate = useNavigate();
  const store = useAppStore();
  const isPiPActive = useAppStore(s => s.isPiPActive);
  const [showLogin, setShowLogin] = useState(true);
  const [loginError, setLoginError] = useState('');
  const rawMicStreamRef = useRef<MediaStream | null>(null);

  // Tela de loading estilo Discord na primeira vez do dia
  const [showDailyLoading, setShowDailyLoading] = useState(() => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const last = localStorage.getItem(LAST_LAUNCH_DAY_KEY);
      return last !== today;
    } catch {
      return false;
    }
  });
  const [isAppLoaded, setIsAppLoaded] = useState(false);

  const handleLoadingFinished = () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      localStorage.setItem(LAST_LAUNCH_DAY_KEY, today);
    } catch {}
    setShowDailyLoading(false);
  };

  // ─── AUDIO SYSTEM ────────────────────────────────────────────────
  const audio = useAudio();

  // ─── YOUTUBE SYSTEM ──────────────────────────────────────────────
  const yt = useYouTube(
    useCallback((token) => {
      socket.emit('music_ended', token);
    }, [])
  );

  // Auto-unlock audio on any user interaction anywhere on screen.
  // On the web, the browser's autoplay policy keeps freshly-created <audio>
  // elements (remote mics, screen-share audio) and the YouTube player paused
  // until the tab has seen a user gesture — so on the first gesture we both
  // unlock the YT player and (re)start any remote audio that got blocked.
  useEffect(() => {
    const handleGlobalInteraction = () => {
      yt.unlock();
      document.querySelectorAll<HTMLAudioElement>('audio[id^="remote-"]').forEach((el) => {
        if (el.paused && el.srcObject) {
          el.play().catch(() => { });
        }
      });
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

  // Build the hidden YouTube player eagerly (once #yt-host is mounted) so the
  // first click can start playback within the browser's user-activation window.
  useEffect(() => {
    const t = setTimeout(() => yt.prewarm(), 800);
    return () => clearTimeout(t);
  }, [yt]);

  // ─── DEEP LINKING (Electron) ─────────────────────────────────────
  useEffect(() => {
    const electron = (window as any).electron;
    if (electron && electron.onDeepLink) {
      const unsubscribe = electron.onDeepLink(async (url: string) => {
        try {
          const rawUrl = url || '';
          const normalized = rawUrl.startsWith('concord://') 
            ? rawUrl.replace('concord://', 'https://concord.internal/') 
            : rawUrl;
          const parsed = new URL(normalized);

          const isAuth = 
            parsed.hostname === 'auth' || 
            parsed.hostname === 'concord.internal' ||
            parsed.hostname === '127.0.0.1' ||
            parsed.pathname.includes('callback') ||
            rawUrl.includes('access_token=') ||
            rawUrl.includes('code=');

          if (isAuth) {
            const hashParams = new URLSearchParams(parsed.hash.startsWith('#') ? parsed.hash.substring(1) : parsed.hash);
            const searchParams = parsed.searchParams;
            const access_token = hashParams.get('access_token') || searchParams.get('access_token');
            const refresh_token = hashParams.get('refresh_token') || searchParams.get('refresh_token');
            const code = searchParams.get('code') || hashParams.get('code');
            const authError = hashParams.get('error') || searchParams.get('error');
            const authErrorDescription = hashParams.get('error_description') || searchParams.get('error_description');

            // O mesmo callback pode chegar por múltiplos canais (HTTP, POST e protocolo concord://).
            // Processa apenas uma vez para evitar toasts/erros duplicados.
            const callbackKey = authError || authErrorDescription
              ? `error:${authError || ''}:${authErrorDescription || ''}`
              : `ok:${code || access_token || ''}`;
            if (!shouldHandleAuthCallback(callbackKey)) return;

            // Cancelamento/erro do OAuth: nenhum feedback de sucesso, apenas sai do estado de carregamento
            if (authError || authErrorDescription) {
              window.dispatchEvent(new CustomEvent('concord:google-auth-cancelled'));
              if (authError === 'access_denied') {
                toast('Login com Google cancelado.', { icon: 'ℹ️', id: 'google-auth-cancelled' });
              } else {
                console.warn('[Auth] Erro no callback OAuth:', authError, authErrorDescription);
                toast.error('Não foi possível concluir o login com o Google.', { id: 'google-auth-error' });
              }
              return;
            }

            // Nada a processar (callback sem tokens/código) -> não dispara feedback algum
            if (!(access_token && refresh_token) && !code) return;

            const handleAuthenticatedUser = async (user: any) => {
              const { username: finalName, avatarUrl: finalAvatar } = await syncProfileAfterAuth(user);
              await syncCloudUserData(user.id);
              const pid = getOrCreatePersistentId();
              const tag = store.myTag || localStorage.getItem('concord_user_tag') || '0000';
              socket.emit('set_username', finalName, finalAvatar || null, tag, pid, user.id);
              setShowLogin(false);
              setLoginError('');
              toast.success(`Autenticado com sucesso como ${finalName}!`, { id: 'auth-success' });
            };

            const handleAuthFailure = (err?: { message?: string } | null) => {
              console.warn('[Auth] Falha ao concluir sessão OAuth:', err?.message);
              window.dispatchEvent(new CustomEvent('concord:google-auth-cancelled'));
              toast.error('Não foi possível concluir o login com o Google.', { id: 'google-auth-error' });
            };

            if (access_token && refresh_token) {
              const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
              if (!error && data?.user) {
                await handleAuthenticatedUser(data.user);
              } else {
                handleAuthFailure(error);
              }
            } else if (code) {
              const { data, error } = await supabase.auth.exchangeCodeForSession(code);
              if (!error && data?.user) {
                await handleAuthenticatedUser(data.user);
              } else {
                handleAuthFailure(error);
              }
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

  // Sync audio volumes and screen share audio when stores change
  useEffect(() => {
    const unsubAudio = useAudioStore.subscribe((state, prevState) => {
      audio.applyMicSettings();
      audio.applyRemoteSettings();
      audio.applyNoiseSuppressionSettings();
      yt.applyYTVolume();

      if (state.micMuted !== prevState.micMuted || state.callMuted !== prevState.callMuted) {
        socket.emit('update_media_state', state.micMuted, state.callMuted);
      }

      const electron = (window as any).electron;
      if (electron?.sendPipSync && useAppStore.getState().isPiPActive) {
        const targetVol = state.callMuted ? 0 : state.ytVol;
        electron.sendPipSync({ volume: targetVol });
      }

      if (electron?.setStreamingVolume) {
        const targetVol = state.callMuted ? 0 : state.ytVol;
        electron.setStreamingVolume(targetVol);
      }
    });

    const unsubApp = useAppStore.subscribe((state, prevState) => {
      if (state.screenShareUserId !== prevState.screenShareUserId) {
        audio.applyRemoteSettings();
      }
    });

    return () => {
      unsubAudio();
      unsubApp();
    };
  }, [audio, yt]);

  // Initial sync of streaming volume to Electron
  useEffect(() => {
    const electron = (window as any).electron;
    if (electron?.setStreamingVolume) {
      const { ytVol, callMuted } = useAudioStore.getState();
      electron.setStreamingVolume(callMuted ? 0 : ytVol);
    }
  }, []);

  // Sync YT mute when PiP toggles
  useEffect(() => {
    yt.applyYTVolume();
  }, [isPiPActive, yt]);

  // ─── WEBRTC SYSTEM ───────────────────────────────────────────────
  const rtc = useWebRTC(
    (event, ...args) => socket.emit(event as any, ...args),
    audio.attachRemoteStream,
    audio.attachRemoteScreenAudio
  );

  let handleLeaveVoice = () => { };

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
      yt.playYouTube(videoId, startSeconds, token);
    },
    onStopYouTube: yt.stopYouTube,
    onPauseYouTube: () => {
      yt.pauseYouTube();
    },
    onResumeYouTube: () => {
      yt.resumeYouTube();
    },
    onMusicSeek: (time) => {
      yt.seekTo(time);
      store.setMusicStartTime(Date.now() - (time * 1000));
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
      notifyInChat(`👁️ ${viewer.name} começou a assistir sua transmissão!`);
    },
    onScreenShareStopped: (userId) => {
      rtc.clearRemoteScreen(userId);
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
    rtc.removeScreenShareTrack,
    rtc.getRemoteAudioStreams
  );

  // ─── DIRECT CHAT ROUTE (/dm/:chatId) ──────────────────────────────
  useEffect(() => {
    if (!dmChatId) return;
    store.setActiveRailContext('home');
    store.setHomeTab('dm');
    if (store.activeDmChat?.id === dmChatId) return;

    const existing = store.directChats.find((c) => c.id === dmChatId);
    if (existing) {
      store.setActiveDmChat(existing);
    } else {
      fetchDirectChatsFromSupabase().then((chats) => {
        store.setDirectChats(chats);
        const match = chats.find((c) => c.id === dmChatId);
        if (match) store.setActiveDmChat(match);
      });
    }
  }, [dmChatId]);

  // ─── JOIN ROOM on mount ───────────────────────────────────────────
  useEffect(() => {
    if (!roomId) {
      store.setActiveRailContext('home');
      return;
    }
    store.setActiveRailContext(roomId);
    store.clearMessages();

    const persistentId = getOrCreatePersistentId();
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = window.location.hash.includes('?')
      ? new URLSearchParams(window.location.hash.substring(window.location.hash.indexOf('?')))
      : new URLSearchParams();

    const codeParam = searchParams.get('code') || hashParams.get('code') || (roomId.startsWith('SRV-') ? roomId : '');
    const isServerParam = searchParams.get('server') === '1' || hashParams.get('server') === '1' || codeParam.toUpperCase().startsWith('SRV-') || roomId.toUpperCase().startsWith('SRV-');

    // 1. Resolução instantânea via cache em memória (store.servers / local) para transição veloz (0ms)
    const cachedServer = (store.servers || []).find(
      s => s.id === roomId || (s.code && s.code.toUpperCase() === roomId.toUpperCase()) || (codeParam && s.code && s.code.toUpperCase() === codeParam.toUpperCase())
    );

    const initialRoomId = cachedServer?.id || roomId;
    const initialCode = cachedServer?.code || codeParam || (roomId.length <= 8 ? roomId.toUpperCase() : 'CONCORD');
    const initialIsServer = cachedServer ? true : isServerParam;
    const initialName = cachedServer?.name || (initialIsServer ? (store.serverName && store.serverName !== 'Sala Concord' ? store.serverName : 'Servidor Concord') : `Sala ${initialCode}`);
    const initialIconUrl = cachedServer?.icon_url || null;
    const initialIsOwner = cachedServer?.role === 'owner';

    if (initialIsServer) {
      store.setIsServer(true);
      if (initialName) store.setServerName(initialName);
      if (initialIconUrl) store.setServerIconUrl(initialIconUrl);
    } else {
      store.setIsServer(false);
    }

    // Inicializa imediatamente o estado da sala para transição sem delay visual (0ms)
    store.setRoom({
      id: initialRoomId,
      code: initialCode,
      name: initialName,
      iconUrl: initialIconUrl || undefined,
      isServer: initialIsServer,
      createdAt: Date.now(),
      expiresAt: initialIsServer ? Infinity : Date.now() + 14 * 60 * 60 * 1000,
      userCount: 1,
      adminIds: initialIsOwner ? [socket.socket?.id || 'admin'] : [],
      channels: initialIsServer ? [{ id: 'ch-geral', name: 'geral' }] : undefined,
    });

    const currentAvatar = store.myAvatarUrl || localStorage.getItem('concord_avatar_url') || null;
    socket.emit('join_room', initialRoomId, persistentId, initialCode, initialIsServer, initialName, currentAvatar);

    // 2. Consulta de enriquecimento de metadados no Supabase em segundo plano (não bloqueia a navegação)
    (async () => {
      try {
        let dbRoom = await findRoomInSupabase(roomId);
        if (!dbRoom && codeParam) {
          dbRoom = await findRoomInSupabase(codeParam);
        }

        const targetRoomId = dbRoom?.id || initialRoomId;
        const targetCode = dbRoom?.code || initialCode;
        const isServer = dbRoom?.is_server !== undefined ? dbRoom.is_server : initialIsServer;
        const targetName = dbRoom?.name || initialName;
        const targetIconUrl = dbRoom?.icon_url || initialIconUrl;

        let isOwner = initialIsOwner;
        const { data: { user } } = await supabase.auth.getUser();
        if (user && isServer) {
          if (dbRoom?.created_by && user.id === dbRoom.created_by) {
            isOwner = true;
          } else if (dbRoom?.id && isUuid(dbRoom.id)) {
            const { data: mem } = await supabase
              .from('server_members')
              .select('role')
              .eq('server_id', dbRoom.id)
              .eq('user_id', user.id)
              .maybeSingle();
            if (mem?.role === 'owner') isOwner = true;
          }
        }

        if (targetName !== initialName || targetIconUrl !== initialIconUrl) {
          if (isServer) {
            store.setServerName(targetName);
            if (targetIconUrl) store.setServerIconUrl(targetIconUrl);
          }
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

        if (isServer || targetCode.toUpperCase().startsWith('SRV-') || targetRoomId.toLowerCase().startsWith('srv-') || dbRoom?.is_server) {
          const srvData = {
            id: targetRoomId,
            code: targetCode,
            name: targetName,
            icon_url: targetIconUrl || undefined,
            role: (isOwner ? 'owner' : 'member') as ('owner' | 'member'),
          };
          saveMyServer(srvData);
          store.recordRecentServer(srvData);
          joinServerInSupabase(targetRoomId).catch(() => {});
        } else {
          saveRecentRoom({
            id: targetRoomId,
            code: targetCode,
            name: targetName,
            createdAt: dbRoom?.created_at ? new Date(dbRoom.created_at).getTime() : Date.now(),
          });
        }
      } catch (err) {
        console.warn('[Room] Enriquecimento assíncrono de sala:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ─── LOGIN E NOME DE USUÁRIO ───────────────────────────────────────
  useEffect(() => {
    const syncUserProfile = async () => {
      // Hidratar localStorage a partir de electron.loadPreferences() para persistência resiliente em novas builds e reinstalações
      const isElectron = /electron/i.test(navigator.userAgent) || !!(window as any).electron;
      if (isElectron && (window as any).electron?.loadPreferences) {
        try {
          const prefs = await (window as any).electron.loadPreferences();
          if (prefs && typeof prefs === 'object') {
            for (const [k, v] of Object.entries(prefs)) {
              if (v && typeof v === 'string') {
                const current = localStorage.getItem(k);
                // Hidrata se chave não existir ou se a chave local estiver com array vazio '[]' enquanto prefs tem dados válidos
                if (!current || (current.trim() === '[]' && v.trim() !== '[]')) {
                  localStorage.setItem(k, v);
                }
              }
            }
          }
        } catch {}
      }

      // Restaura a sessão segura do Supabase a partir do DPAPI do Electron antes de consultar getUser()
      await ensureSupabaseSessionRestored();

      // Carrega imediatamente os servidores restaurados do armazenamento local / Electron
      await store.refreshServers();

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { username: finalName, avatarUrl: finalAvatar } = await syncProfileAfterAuth(user);
          await syncCloudUserData(user.id);
          await store.refreshServers();
          if (finalName && finalName.trim()) {
            store.setMyName(finalName.trim());
            const pid = getOrCreatePersistentId();
            const tag = store.myTag || localStorage.getItem('concord_user_tag') || '0000';
            socket.emit('set_username', finalName.trim(), finalAvatar || store.myAvatarUrl || null, tag, pid, user.id);
            setShowLogin(false);
            setLoginError('');
            setIsAppLoaded(true);
            return;
          }
        }
      } catch (err) {
        console.warn('Supabase getUser error:', err);
      }

      const savedName = getSavedUsername();
      const savedAvatar = localStorage.getItem('concord_avatar_url');
      if (savedAvatar) {
        store.setMyAvatarUrl(savedAvatar);
      }
      if (savedName && savedName.trim()) {
        store.setMyName(savedName.trim());
        setShowLogin(false);
      } else {
        setShowLogin(true);
      }
      await store.refreshServers();
      setIsAppLoaded(true);
    };

    syncUserProfile();
  }, []);

  useEffect(() => {
    if (store.myName) {
      const pid = getOrCreatePersistentId();
      const tag = store.myTag || localStorage.getItem('concord_user_tag') || '0000';
      socket.emit('set_username', store.myName, store.myAvatarUrl || null, tag, pid);
    }
  }, [store.myName, store.myAvatarUrl, store.myTag]);

  // ─── VALIDAÇÃO DE NOME DUPLICADO NA SALA/SERVIDOR ─────────────────
  useEffect(() => {
    if (!store.myName || !store.users || store.users.length === 0) return;

    const currentSocketId = socket.socket?.id;
    const myPersistentId = getOrCreatePersistentId();
    const lowerMyName = store.myName.trim().toLowerCase();

    const isDuplicate = store.users.some(
      (u: UserInfo) =>
        u.id !== currentSocketId &&
        (!myPersistentId || u.persistentId !== myPersistentId) &&
        u.name &&
        u.name.trim().toLowerCase() === lowerMyName
    );

    if (isDuplicate) {
      setLoginError(`O nome "${store.myName}" já está em uso nesta chamada/servidor por outro usuário. Escolha outro nome.`);
      setShowLogin(true);
    }
  }, [store.users, store.myName, socket.socket?.id]);

  const handleLogin = (name: string) => {
    store.setMyName(name);
    saveUsername(name);
    const pid = getOrCreatePersistentId();
    const tag = store.myTag || localStorage.getItem('concord_user_tag') || '0000';
    socket.emit('set_username', name, store.myAvatarUrl || null, tag, pid);
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
      setLoginError(`O nome "${store.myName}" já está em uso nesta chamada por outro usuário.`);
      setShowLogin(true);
      return;
    }

    try {
      const inputDeviceId = useAudioStore.getState().selectedAudioInputId;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: (inputDeviceId && inputDeviceId !== 'default') ? { exact: inputDeviceId } : undefined,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            // @ts-ignore
            googNoiseSuppression: true,
            googHighpassFilter: true,
          },
        });
      } catch (micErr) {
        console.warn('Microfone não encontrado ou permissão negada, entrando como ouvinte:', micErr);
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const dest = audioCtx.createMediaStreamDestination();
        stream = dest.stream;
        useAudioStore.getState().setMicMuted(true);
      }
      rawMicStreamRef.current = stream;
      const processedStream = await audio.processMicStream(stream);
      await rtc.joinVoice(store.myId, processedStream);
      store.setInVoice(true);
      const callRoomId = store.room?.id || roomId || 'concord';
      const callRoomName = store.room?.name || store.serverName || 'Chamada Concord';
      const callRoomCode = store.room?.code || '';
      store.setActiveCallInfo({
        roomId: callRoomId,
        roomName: callRoomName,
        code: callRoomCode,
        isServer: Boolean(store.isServer),
      });

      // Gravar servidor no histórico dos últimos servidores em que esteve em call
      if (store.isServer && (callRoomId || callRoomCode)) {
        store.recordRecentCallServer({
          id: callRoomId,
          code: callRoomCode || 'CONCORD',
          name: callRoomName,
          icon_url: store.serverIconUrl || store.room?.iconUrl,
          role: 'member',
        });
      }

      socket.emit('update_media_state', useAudioStore.getState().micMuted, useAudioStore.getState().callMuted);
      monitorSpeaking(processedStream, store.myId);
    } catch (err) {
      console.error('Voice join error', err);
      alert('Erro ao entrar na chamada de voz. Verifique suas conexões e permissões.');
    }
  };

  handleLeaveVoice = () => {
    rtc.leaveVoice();
    audio.cleanup();
    store.setInVoice(false);
    store.setActiveCallInfo(null);
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


  const isPipRoute = window.location.hash.startsWith('#/pip');
  const isHome = !roomId || store.activeRailContext === 'home';

  if (isPipRoute) {
    return <PiPPlayer />;
  }

  return (
    <div className={`${styles.appContainer}`}>
      {showDailyLoading && (
        <DiscordLoadingScreen 
          isReady={isAppLoaded} 
          onFinished={handleLoadingFinished} 
        />
      )}

      {showLogin && <LoginModal onLogin={handleLogin} initialError={loginError} />}

      {/* ── 1. PRIMARY SERVER RAIL (EXTREMA ESQUERDA ~72px) ── */}
      <ServerRail />

      <div className={styles.mainLayout}>
        <Sidebar
          onScreenShareClick={(id) => {
            const u = store.users.find(x => x.id === id);
            store.setScreenShare(id, u?.name);
            setTimeout(() => {
              document.querySelectorAll<HTMLAudioElement>('audio[id^="remote-screen-audio-"]').forEach((a) => {
                a.play().catch(() => {});
              });
            }, 50);
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
          onSetCustomRole={(payload) => socket.emit('set_member_custom_role', payload)}
          onUpdateProfile={(name, avatarUrl) => {
            const pid = getOrCreatePersistentId();
            const tag = store.myTag || localStorage.getItem('concord_user_tag') || '0000';
            socket.emit('set_username', name, avatarUrl, tag, pid);
            socket.emit('update_avatar', avatarUrl);
          }}
          onAdminAction={(action, targetId) => {
            if (action === 'mute') socket.emit('admin_mute_user', targetId);
            else if (action === 'unmute') socket.emit('admin_unmute_user', targetId);
            else if (action === 'kick_voice') socket.emit('admin_kick_voice', targetId);
            else if (action === 'kick_room') socket.emit('admin_kick_room', targetId);
            else if (action === 'give_admin') socket.emit('admin_transfer_role', targetId);
            else if (action === 'local_mute') useAudioStore.getState().toggleLocalMuteUser(targetId);
          }}
        />

        {/* ── 2. VIEWPORT PRINCIPAL (HOME HUB OU CANAL/CALL) ── */}
        {isHome && store.homeTab !== 'dm' ? (
          <div className={styles.homeSection}>
            <HomeHub />
          </div>
        ) : (
          <>
            <div className={styles.chatSection}>
              <ChatPanel
                onSendMessage={(msg, type, url, filename, channelId, avatarUrl) => {
                  socket.emit('send_message', msg, type, url, filename, channelId || store.activeChannelId, avatarUrl ?? store.myAvatarUrl ?? null);
                }}
                onReaction={(messageId, emoji) => {
                  socket.emit('message_reaction' as any, messageId, emoji);
                }}
                onMusicAction={(action) => {
                  socket.emit('music_action', action);
                }}
                onMusicSeek={(time) => {
                  socket.emit('music_seek', time);
                  yt.seekTo(time);
                }}
                getYtCurrentTime={yt.getCurrentTime}
                getYtDuration={yt.getDuration}
                onSetCC={yt.setCC}
                onSetQuality={yt.setQuality}
                getYtAvailableQualities={yt.getAvailableQualities}
                getYtQuality={yt.getQuality}
                onWatchSessionStart={(data) => {
                  socket.emit('watch_session_start', data);
                }}
                onWatchSessionAction={(data) => {
                  socket.emit('watch_session_action', data);
                }}
                onWatchSessionHeartbeat={(data) => {
                  socket.emit('watch_session_heartbeat', data);
                }}
                onWatchSessionEnd={() => {
                  socket.emit('watch_session_end');
                }}
              />
            </div>

            {!isHome && (
              <div className={styles.sidePanels}>
                <MusicPanel
                  onRequestMusic={(url, title, playNow) => {
                    if (!store.inVoice) {
                      notifyInChat('Você precisa estar em uma call de voz para colocar vídeos.');
                      return;
                    }
                    socket.emit('request_music', url, title, playNow);
                  }}
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
            )}
          </>
        )}
      </div>

      <ServerActionModal />

      <ScreenSharePanel
        onClose={() => store.setScreenShare(null)}
        screenStream={store.screenShareUserId ? rtc.remoteScreenStreams.get(store.screenShareUserId) : null}
        onStartWatching={(broadcasterId) => socket.emit('start_watching_screen', broadcasterId)}
        onStopWatching={(broadcasterId) => socket.emit('stop_watching_screen', broadcasterId)}
      />

      <AccountModals />
      {store.viewingProfileUser && (
        <UserProfileModal
          user={store.viewingProfileUser}
          onClose={store.closeUserProfile}
        />
      )}

      <ScreenPickerModal
        isOpen={screenShare.isPickerOpen}
        onClose={screenShare.closePicker}
        onConfirm={screenShare.confirmPicker}
      />

      <ConfirmModal />

      {/* ── 3. FLOATING CALL OVERLAY BAR (PERSISTENTE NA NAVEGAÇÃO FORA DA SALA DA CALL) ── */}
      {store.inVoice && (isHome || store.activeRailContext === 'home' || (store.activeCallInfo && store.activeCallInfo.roomId !== roomId && store.activeCallInfo.roomId !== store.room?.id && (!store.room?.code || store.activeCallInfo.code?.toUpperCase() !== store.room.code.toUpperCase()))) && (
        <FloatingCallBar
          onLeaveVoice={handleLeaveVoice}
          onToggleMic={() => {
            const next = !useAudioStore.getState().micMuted;
            useAudioStore.getState().setMicMuted(next);
            socket.emit('update_media_state', next, useAudioStore.getState().callMuted);
          }}
          onToggleDeafen={() => {
            const next = !useAudioStore.getState().callMuted;
            useAudioStore.getState().setCallMuted(next);
            socket.emit('update_media_state', useAudioStore.getState().micMuted, next);
          }}
        />
      )}
    </div>
  );
}
