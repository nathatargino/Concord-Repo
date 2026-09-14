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
  const isCCEnabledRef = useRef<boolean>(false);
  const targetQualityRef = useRef<string>('auto');

  const postYTCommand = useCallback((func: string, args: any[] = []) => {
    try {
      const p = playerRef.current as any;
      const iframe = p?.getIframe?.() as HTMLIFrameElement | null;
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage(JSON.stringify({
          event: 'command',
          func: func,
          args: args
        }), '*');
        iframe.contentWindow.postMessage(JSON.stringify({
          event: 'command',
          func: func,
          args: args,
          channel: 'widget',
          id: p?.id || 1
        }), '*');
      }
    } catch (e) {
      console.warn('[YT] postMessage command error:', e);
    }
  }, []);

  const applyCCState = useCallback((enabled: boolean) => {
    if (!playerRef.current) return;
    try {
      const p = playerRef.current as any;
      if (enabled) {
        postYTCommand('loadModule', ['captions']);
        postYTCommand('loadModule', ['cc']);
        p.loadModule?.('captions');
        p.loadModule?.('cc');

        let tracklist: any[] = [];
        try {
          tracklist = p.getOption?.('captions', 'tracklist') || p.getOption?.('cc', 'tracklist') || [];
        } catch {}

        if (Array.isArray(tracklist) && tracklist.length > 0) {
          const ptTrack = tracklist.find((t: any) => t.languageCode === 'pt' || t.languageCode?.startsWith('pt')) || tracklist[0];
          postYTCommand('setOption', ['captions', 'track', ptTrack]);
          postYTCommand('setOption', ['cc', 'track', ptTrack]);
          p.setOption?.('captions', 'track', ptTrack);
          p.setOption?.('cc', 'track', ptTrack);
        } else {
          postYTCommand('setOption', ['captions', 'track', { languageCode: 'pt' }]);
          postYTCommand('setOption', ['cc', 'track', { languageCode: 'pt' }]);
          p.setOption?.('captions', 'track', { languageCode: 'pt' });
          p.setOption?.('cc', 'track', { languageCode: 'pt' });
        }
      } else {
        postYTCommand('unloadModule', ['captions']);
        postYTCommand('unloadModule', ['cc']);
        postYTCommand('setOption', ['captions', 'track', {}]);
        postYTCommand('setOption', ['cc', 'track', {}]);
        p.unloadModule?.('captions');
        p.unloadModule?.('cc');
        p.setOption?.('captions', 'track', {});
        p.setOption?.('cc', 'track', {});
      }
    } catch (e) {
      console.warn('[YT] Failed to apply CC state:', e);
    }
  }, [postYTCommand]);

  const setCC = useCallback((enabled: boolean) => {
    isCCEnabledRef.current = enabled;
    applyCCState(enabled);
  }, [applyCCState]);

  /** Force quality on the internal YouTube player — the only approach that still works
   * after YouTube deprecated setPlaybackQuality in the IFrame API. */
  const forceQualityOnPlayer = useCallback((q: string) => {
    if (!playerRef.current) return;
    const p = playerRef.current as any;
    const isDefault = q === 'default' || q === 'auto';

    // 1. [Electron only] Ask the main process to run executeJavaScript directly
    //    inside the YouTube sub-frame — bypasses all cross-origin restrictions.
    const electronSetQuality = (window as any).electron?.setYouTubeQuality;
    if (typeof electronSetQuality === 'function') {
      electronSetQuality(isDefault ? 'auto' : q).catch(() => {});
    }

    // 2. Try the internal movie_player object via renderer (works when disable-web-security is on)
    try {
      const iframe = p?.getIframe?.() as HTMLIFrameElement | null;
      const win = iframe?.contentWindow as any;
      if (win) {
        const mp = win.document?.getElementById('movie_player') ||
                   win.document?.querySelector('.html5-video-player');
        if (mp) {
          if (typeof mp.setPlaybackQualityRange === 'function') {
            if (isDefault) {
              mp.setPlaybackQualityRange('auto', 'auto');
            } else {
              mp.setPlaybackQualityRange(q, q);
            }
          }
          if (typeof mp.setPlaybackQuality === 'function') {
            mp.setPlaybackQuality(isDefault ? 'default' : q);
          }
        }
      }
    } catch {/* cross-origin: silent */}

    // 3. IFrame API instance methods (deprecated but still attempted)
    try {
      if (typeof p.setPlaybackQualityRange === 'function') p.setPlaybackQualityRange(q, q);
      if (typeof p.setPlaybackQuality === 'function') p.setPlaybackQuality(isDefault ? 'default' : q);
    } catch {}

    // 4. postMessage to iframe
    postYTCommand('setPlaybackQuality', [isDefault ? 'default' : q]);
    postYTCommand('setPlaybackQualityRange', [isDefault ? 'auto' : q, isDefault ? 'auto' : q]);
  }, [postYTCommand]);

  const setQuality = useCallback((quality: string) => {
    targetQualityRef.current = quality;
    if (!playerRef.current) return;

    const q = (quality === 'auto' || quality === 'default') ? 'default' : quality;
    console.log('[YT] Setting quality to:', q);

    // Apply immediately and then retry — YouTube's DASH ABR can override the first call
    forceQualityOnPlayer(q);
    // Retry at 300ms, 700ms, 1500ms to beat DASH adaptation
    const delays = [300, 700, 1500];
    delays.forEach(ms => {
      setTimeout(() => {
        if (targetQualityRef.current === quality) {
          forceQualityOnPlayer(q);
        }
      }, ms);
    });
  }, [forceQualityOnPlayer]);

  const getAvailableQualities = useCallback(() => {
    try {
      const p = playerRef.current as any;
      const iframe = p?.getIframe?.() as HTMLIFrameElement | null;
      const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
      if (doc) {
        const mp = (doc.getElementById('movie_player') || doc.querySelector('.html5-video-player')) as any;
        if (mp && typeof mp.getAvailableQualityData === 'function') {
          const data = mp.getAvailableQualityData();
          if (Array.isArray(data) && data.length > 0) {
            const list = data.map((d: any) => d.quality).filter(Boolean);
            if (list.length > 0) return ['auto', ...list];
          }
        }
        if (mp && typeof mp.getAvailableQualityLevels === 'function') {
          const levels = mp.getAvailableQualityLevels();
          if (Array.isArray(levels) && levels.length > 0) return ['auto', ...levels];
        }
      }
    } catch {}

    if (!playerRef.current) return ['auto', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
    try {
      const p = playerRef.current as any;
      if (typeof p.getAvailableQualityLevels === 'function') {
        const levels = p.getAvailableQualityLevels();
        if (Array.isArray(levels) && levels.length > 0) return levels;
      }
    } catch {}
    return ['auto', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
  }, []);

  const getQuality = useCallback(() => {
    return targetQualityRef.current || 'auto';
  }, []);

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
        height: '100%',
        width: '100%',
        videoId: 'jNQXAC9IVRw', // Provide a valid placeholder ID to prevent Error 2 on init
        playerVars: {
          autoplay: 0,
          controls: 0, // Hide YouTube native controls — Concord overlay handles all UI
          modestbranding: 1,
          rel: 0,
          showinfo: 0,
          iv_load_policy: 3,
          disablekb: 1,
          enablejsapi: 1,
          playsinline: 1,
          cc_load_policy: 0 as any, // Start with captions OFF by default
          cc_lang_pref: 'pt',
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
             // Apply initial CC state (off by default)
             applyCCState(isCCEnabledRef.current);
             
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
              // Ensure CC state matches preference on play start
              applyCCState(isCCEnabledRef.current);

              // Re-apply quality when playback starts — DASH ABR may have overridden it
              const tq = targetQualityRef.current;
              if (tq && tq !== 'auto') {
                const q = tq === 'default' ? 'default' : tq;
                forceQualityOnPlayer(q);
                setTimeout(() => forceQualityOnPlayer(q), 500);
                setTimeout(() => forceQualityOnPlayer(q), 1200);
              }

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
  }, [onMusicEnded, applyCCState]);

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
      applyCCState(isCCEnabledRef.current);

      // Apply quality after player has had time to initialize the stream
      const tq = targetQualityRef.current;
      if (tq && tq !== 'auto') {
        const q = tq === 'default' ? 'default' : tq;
        [350, 800, 1500, 2500].forEach(ms => {
          setTimeout(() => {
            if (targetQualityRef.current === tq) forceQualityOnPlayer(q);
          }, ms);
        });
      }

      const { ytVol, callMuted } = useAudioStore.getState();
      const { isPiPActive } = useAppStore.getState();
      const targetVol = (callMuted || isPiPActive) ? 0 : ytVol;
      player.setVolume(targetVol);
      if (targetVol > 0) player.unMute();
      
      useAppStore.getState().setCurrentVideoId(videoId);
      useAppStore.getState().setMusicStartTime(Date.now() - (startSeconds * 1000));
      useAppStore.getState().setIsPlaying(true);
    },
    [ensurePlayer, applyCCState, forceQualityOnPlayer]
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
    playYouTube, stopYouTube, pauseYouTube, resumeYouTube, applyYTVolume, seekTo, unlock, prewarm, getCurrentTime, getDuration, setCC, setQuality, getAvailableQualities, getQuality
  }), [playYouTube, stopYouTube, pauseYouTube, resumeYouTube, applyYTVolume, seekTo, unlock, prewarm, getCurrentTime, getDuration, setCC, setQuality, getAvailableQualities, getQuality]);
}

