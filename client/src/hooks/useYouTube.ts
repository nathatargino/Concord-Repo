/// <reference types="youtube" />
import { useCallback, useRef, useMemo, useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { useAudioStore } from '../stores/useAudioStore';

declare global {
  interface Window {
    YT: typeof YT;
    onYouTubeIframeAPIReady: () => void;
  }
}

let ytApiLoaded = false;
let ytApiReady = false;
const ytReadyCallbacks: (() => void)[] = [];

function loadYTApi(): Promise<void> {
  return new Promise((resolve) => {
    if (ytApiReady) return resolve();
    ytReadyCallbacks.push(resolve);
    if (ytApiLoaded) return;
    ytApiLoaded = true;

    console.log('[YT] Loading YouTube IFrame API...');

    window.onYouTubeIframeAPIReady = () => {
      console.log('[YT] onYouTubeIframeAPIReady fired!');
      ytApiReady = true;
      ytReadyCallbacks.forEach((cb) => cb());
      ytReadyCallbacks.length = 0;
    };

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = (e) => {
      console.error('[YT] Failed to load iframe_api script:', e);
    };
    document.head.appendChild(tag);
  });
}

function loadYTApiForWindow(win: Window, doc: Document): Promise<any> {
  return new Promise((resolve) => {
    const target = win as any;
    if (target.YT && target.YT.Player) {
      return resolve(target.YT);
    }
    
    target.onYouTubeIframeAPIReady = () => {
      console.log('[YT PiP] onYouTubeIframeAPIReady fired!');
      resolve(target.YT);
    };

    const tag = doc.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = (e) => {
      console.error('[YT PiP] Failed to load iframe_api script:', e);
    };
    doc.head.appendChild(tag);
  });
}

export function useYouTube(
  onMusicEnded: (token: number) => void
) {
  const pipWindow = useAppStore(state => state.pipWindow);
  const playerRef = useRef<YT.Player | null>(null);
  const currentTokenRef = useRef<number | null>(null);
  const suppressEndedRef = useRef(false);
  const unlockedRef = useRef(false);
  const volumeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ensurePlayer = useCallback((): Promise<YT.Player> => {
    return new Promise(async (resolve) => {
      console.log('[YT] ensurePlayer called');
      const { pipWindow } = useAppStore.getState();
      const doc = pipWindow ? pipWindow.document : document;
      
      const YTAPI = pipWindow 
        ? await loadYTApiForWindow(pipWindow, pipWindow.document)
        : (await loadYTApi(), window.YT);

      console.log('[YT] API ready, playerRef.current =', !!playerRef.current);

      if (playerRef.current) return resolve(playerRef.current);

      const container = doc.getElementById('yt-host');
      if (!container) {
        console.error('[YT] #yt-host not found in DOM! pipWindow=', !!pipWindow);
        return;
      }
      
      container.innerHTML = ''; // Clear zombie iframes

      const div = doc.createElement('div');
      div.id = 'yt-player-inner';
      container.appendChild(div);

      const isElectron = !!(window as any).electron || /electron/i.test(navigator.userAgent);

      // Always pass the current window's origin to YouTube so it knows where to send postMessages.
      const ytOrigin = window.location.protocol !== 'file:' ? window.location.origin : undefined;

      console.log('[YT] Creating player, isElectron=', isElectron, 'origin=', ytOrigin);

      playerRef.current = new YTAPI.Player(div, {
        height: '200',
        width: '200',
        videoId: 'jNQXAC9IVRw', // Provide a valid placeholder ID to prevent Error 2 on init
        playerVars: {
          autoplay: 0,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          showinfo: 0,
          iv_load_policy: 3,
          disablekb: 1,
          enablejsapi: 1,
          playsinline: 1,
          cc_load_policy: 0 as any, // Cast to any to bypass strict ClosedCaptionsLoadPolicy type
          ...(ytOrigin ? { origin: ytOrigin } : {})
        },
        events: {
          onReady: (event: any) => {
             console.log('[YT] onReady fired! player=', !!event.target);
             // Grant the cross-origin YouTube iframe permission to autoplay
             // with sound once the tab has a user gesture (web only).
             try {
               const iframe = playerRef.current?.getIframe?.();
               if (iframe && !/autoplay/.test(iframe.getAttribute('allow') || '')) {
                 iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
               }
             } catch {
               // ignore
             }
             // Force CC off immediately
             try {
               const p = playerRef.current as any;
               if (p?.unloadModule) {
                 p.unloadModule('captions');
                 p.unloadModule('cc');
               }
             } catch {}
             const { ytVol, callMuted } = useAudioStore.getState();
             const targetVol = callMuted ? 0 : ytVol;
             // Force-unmute at the Electron audio pipeline level immediately on ready
             if (typeof (window as any).electron?.forceUnmute === 'function') {
               (window as any).electron.forceUnmute();
             }
             if (targetVol > 0) {
               playerRef.current?.unMute();
               playerRef.current?.setVolume(targetVol);
             }
             resolve(playerRef.current!);
          },
          onError: (event: any) => {
            console.error('[YT] Player error:', event.data);
          },
          onStateChange: (event: any) => {
            console.log('[YT] State changed:', event.data);
            
            if (event.data === window.YT.PlayerState.BUFFERING || event.data === window.YT.PlayerState.UNSTARTED || event.data === window.YT.PlayerState.CUED) {
              useAppStore.getState().setIsBuffering(true);
            } else if (event.data === window.YT.PlayerState.PLAYING || event.data === window.YT.PlayerState.PAUSED) {
              useAppStore.getState().setIsBuffering(false);
            }

            if (event.data === window.YT.PlayerState.PLAYING) {
              // Force volume repeatedly for 3 seconds to beat YouTube's auto-mute
              if (volumeIntervalRef.current) clearInterval(volumeIntervalRef.current);
              
              let attempts = 0;
              volumeIntervalRef.current = setInterval(() => {
                attempts++;
                if (attempts > 10) {
                  if (volumeIntervalRef.current) clearInterval(volumeIntervalRef.current);
                  return;
                }
                
                if (typeof (window as any).electron?.forceUnmute === 'function') {
                  (window as any).electron.forceUnmute();
                }
                
                const { ytVol, callMuted } = useAudioStore.getState();
                const { isPiPActive } = useAppStore.getState();
                const targetVol = (callMuted || isPiPActive) ? 0 : ytVol;
                if (targetVol > 0) {
                  playerRef.current?.unMute();
                  playerRef.current?.setVolume(targetVol);
                } else {
                  playerRef.current?.mute();
                }
              }, 300);
            }
            
            if (event.data === window.YT.PlayerState.ENDED) {
              if (volumeIntervalRef.current) clearInterval(volumeIntervalRef.current);
              if (!suppressEndedRef.current && currentTokenRef.current !== null) {
                onMusicEnded(currentTokenRef.current);
              }
              useAppStore.getState().setIsPlaying(false);
            }
            if (event.data === window.YT.PlayerState.PAUSED) {
               if (volumeIntervalRef.current) clearInterval(volumeIntervalRef.current);
            }
          },
        },
      });
    });
  }, [onMusicEnded]);

  const playYouTube = useCallback(
    async (videoId: string, startSeconds: number, token: number) => {
      currentTokenRef.current = token;
      suppressEndedRef.current = false;

      // Force-unmute Electron audio pipeline before loading so audio isn't blocked
      if (typeof (window as any).electron?.forceUnmute === 'function') {
        (window as any).electron.forceUnmute();
      }

      const player = await ensurePlayer();
      player.loadVideoById(videoId, Math.floor(startSeconds));

      const { ytVol, callMuted } = useAudioStore.getState();
      const { isPiPActive } = useAppStore.getState();
      const targetVol = (callMuted || isPiPActive) ? 0 : ytVol;
      player.setVolume(targetVol);
      if (targetVol > 0) player.unMute();
      
      useAppStore.getState().setCurrentVideoId(videoId);
      useAppStore.getState().setMusicStartTime(Date.now() - (startSeconds * 1000));
      useAppStore.getState().setIsPlaying(true);
    },
    [ensurePlayer]
  );

  const stopYouTube = useCallback(async () => {
    suppressEndedRef.current = true;
    playerRef.current?.stopVideo();
    useAppStore.getState().setCurrentVideoId(null);
    useAppStore.getState().setIsPlaying(false);
  }, []);

  const pauseYouTube = useCallback(() => {
    playerRef.current?.pauseVideo();
    useAppStore.getState().setIsPlaying(false);
  }, []);

  const resumeYouTube = useCallback(() => {
    playerRef.current?.playVideo();
    useAppStore.getState().setIsPlaying(true);
  }, []);

  const applyYTVolume = useCallback(() => {
    if (!playerRef.current) return;
    const { ytVol, callMuted } = useAudioStore.getState();
    const { isPiPActive } = useAppStore.getState();
    const targetVol = (callMuted || isPiPActive) ? 0 : ytVol;
    playerRef.current.setVolume(targetVol);
    
    // The global player always provides the audio. The local Plyr instance is always muted.
    if (targetVol > 0) {
      playerRef.current.unMute();
    } else {
      playerRef.current.mute();
    }
  }, []);

  const seekTo = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds, true);
  }, []);

  const getCurrentTime = useCallback(() => {
    return playerRef.current?.getCurrentTime?.() || 0;
  }, []);

  const getDuration = useCallback(() => {
    return playerRef.current?.getDuration?.() || 0;
  }, []);

  const unlock = useCallback(async () => {
    if (unlockedRef.current) return;
    unlockedRef.current = true;

    if (!useAppStore.getState().isPlaying) {
      try {
        const player = await ensurePlayer();
        if (typeof player.mute !== 'function') return;
        
        player.mute();
        player.playVideo();
        setTimeout(() => {
          if (useAppStore.getState().isPlaying) return;
          if (typeof player.stopVideo === 'function') player.stopVideo();
          const targetVol = useAudioStore.getState().callMuted ? 0 : useAudioStore.getState().ytVol;
          if (targetVol > 0 && typeof player.unMute === 'function') {
            player.unMute();
          }
        }, 500);
      } catch {
        // ignore
      }
    }
  }, [ensurePlayer]);

  const prewarm = useCallback(() => {
    ensurePlayer().catch(() => {});
  }, [ensurePlayer]);

  const setCC = useCallback((enabled: boolean) => {
    if (!playerRef.current) return;
    try {
      const p = playerRef.current as any;
      if (enabled) {
        p.loadModule?.('captions');
        p.loadModule?.('cc');
      } else {
        p.unloadModule?.('captions');
        p.unloadModule?.('cc');
      }
    } catch (e) {
      console.warn('[YT] Failed to toggle CC:', e);
    }
  }, []);

  useEffect(() => {
    // When pipWindow changes, re-init the player after React has portaled the #yt-host div
    const timer = setTimeout(() => {
      playerRef.current = null;
      const state = useAppStore.getState();
      if (state.currentVideoId && state.isPlaying) {
         const elapsed = Math.max(0, (Date.now() - (state.musicStartTime || Date.now())) / 1000);
         playYouTube(state.currentVideoId, elapsed, currentTokenRef.current || 0).catch(console.error);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [pipWindow, playYouTube]);

  return useMemo(() => ({ 
    playYouTube, stopYouTube, pauseYouTube, resumeYouTube, applyYTVolume, seekTo, unlock, prewarm, getCurrentTime, getDuration, setCC
  }), [playYouTube, stopYouTube, pauseYouTube, resumeYouTube, applyYTVolume, seekTo, unlock, prewarm, getCurrentTime, getDuration, setCC]);
}

