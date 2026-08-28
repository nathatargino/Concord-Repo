/// <reference types="youtube" />
import { useCallback, useRef } from 'react';
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
  return new Promise((resolve, reject) => {
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

export function useYouTube(
  onMusicEnded: (token: number) => void
) {
  const playerRef = useRef<YT.Player | null>(null);
  const currentTokenRef = useRef<number | null>(null);
  const suppressEndedRef = useRef(false);
  const unlockedRef = useRef(false);
  const volumeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ensurePlayer = useCallback((): Promise<YT.Player> => {
    return new Promise(async (resolve, reject) => {
      console.log('[YT] ensurePlayer called');
      await loadYTApi();
      console.log('[YT] API ready, playerRef.current =', !!playerRef.current);

      if (playerRef.current) return resolve(playerRef.current);

      const container = document.getElementById('yt-host');
      if (!container) {
        console.error('[YT] #yt-host not found in DOM!');
        return;
      }

      const div = document.createElement('div');
      div.id = 'yt-player-inner';
      container.appendChild(div);

      const isElectron = !!(window as any).electron || /electron/i.test(navigator.userAgent);

      // CRITICAL: In Electron the app runs at http://127.0.0.1:PORT.
      // If we pass origin:'https://concord-olive.vercel.app', YouTube sends postMessages
      // targeted at that origin. Since our actual origin is 127.0.0.1:PORT, the browser
      // SILENTLY DROPS every postMessage — including onReady/onStateChange.
      // Fix: never pass origin in Electron so YouTube uses '*' as postMessage target.
      // The Referer spoof in main.ts handles the server-side embed authorization.
      const ytOrigin = isElectron
        ? undefined  // No origin in Electron → YouTube uses '*' for postMessage
        : (window.location.protocol !== 'file:' ? window.location.origin : undefined);

      console.log('[YT] Creating player, isElectron=', isElectron, 'origin=', ytOrigin);

      playerRef.current = new window.YT.Player('yt-player-inner', {
        height: '200',
        width: '200',
        playerVars: { 
          autoplay: 1, 
          controls: 0, 
          modestbranding: 1,
          enablejsapi: 1,
          ...(ytOrigin ? { origin: ytOrigin } : {})
        },
        events: {
          onReady: (event: any) => {
             console.log('[YT] onReady fired! player=', !!event.target);
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
                const targetVol = callMuted ? 0 : ytVol;
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
      const targetVol = callMuted ? 0 : ytVol;
      player.setVolume(targetVol);
      if (targetVol > 0) player.unMute();
      
      useAppStore.getState().setCurrentVideoId(videoId);
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
    const targetVol = callMuted ? 0 : ytVol;
    playerRef.current.setVolume(targetVol);
    
    if (targetVol > 0) {
      playerRef.current.unMute();
    } else {
      playerRef.current.mute();
    }
  }, []);

  const unlock = useCallback(async () => {
    const { ytVol, callMuted } = useAudioStore.getState();
    const targetVol = callMuted ? 0 : ytVol;

    if (playerRef.current) {
      if (targetVol > 0) {
        playerRef.current.unMute();
        playerRef.current.setVolume(targetVol);
      }
      if (typeof (window as any).electron?.forceUnmute === 'function') {
        (window as any).electron.forceUnmute();
      }
    }

    if (unlockedRef.current) return;
    unlockedRef.current = true;

    if (!useAppStore.getState().isPlaying) {
      try {
        const player = await ensurePlayer();
        player.mute();
        player.playVideo();
        setTimeout(() => {
          if (useAppStore.getState().isPlaying) return;
          player.stopVideo();
          if (targetVol > 0) player.unMute();
        }, 500);
      } catch {
        // ignore
      }
    }
  }, [ensurePlayer]);

  return { playYouTube, stopYouTube, pauseYouTube, resumeYouTube, applyYTVolume, unlock };
}
