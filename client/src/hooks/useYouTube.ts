/// <reference types="youtube" />
import { useCallback, useRef, useMemo, useEffect } from 'react';
import { notifyInChat } from '../utils/systemMessage';
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
    if (typeof window !== 'undefined' && (window as any).YT && (window as any).YT.Player) {
      ytApiReady = true;
      return resolve();
    }
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


const QUALITY_ORDER = [
  'auto',
  'highres',
  'hd2880',
  'hd2160',
  'hd1440',
  'hd1080',
  'hd720',
  'large',
  'medium',
  'small',
  'tiny'
];

export function sortYouTubeQualities(qualities: string[]): string[] {
  const unique = Array.from(new Set(qualities.filter(q => Boolean(q) && q !== 'default')));
  const withoutAuto = unique.filter(q => q !== 'auto');
  withoutAuto.sort((a, b) => {
    const indexA = QUALITY_ORDER.indexOf(a);
    const indexB = QUALITY_ORDER.indexOf(b);
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return 0;
  });
  return ['auto', ...withoutAuto];
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
  const availableQualitiesRef = useRef<string[]>(['auto']);
  const playerInitPromiseRef = useRef<Promise<YT.Player> | null>(null);

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

  const refreshAvailableQualities = useCallback(async () => {
    let rawQualities: string[] = [];

    // 1. Electron IPC (reads movie_player directly inside YouTube iframe)
    const electronGetQualities = (window as any).electron?.getYouTubeQualities;
    if (typeof electronGetQualities === 'function') {
      try {
        const levels = await electronGetQualities();
        if (Array.isArray(levels) && levels.length > 0) {
          rawQualities = levels;
        }
      } catch {}
    }

    // 2. YouTube IFrame API instance method
    if (rawQualities.length === 0 && playerRef.current) {
      try {
        const p = playerRef.current as any;
        if (typeof p.getAvailableQualityLevels === 'function') {
          const levels = p.getAvailableQualityLevels();
          if (Array.isArray(levels) && levels.length > 0) {
            rawQualities = levels;
          }
        }
      } catch {}
    }

    // 3. Direct frame movie_player access (when accessible)
    if (rawQualities.length === 0 && playerRef.current) {
      try {
        const iframe = (playerRef.current as any)?.getIframe?.() as HTMLIFrameElement | null;
        const win = iframe?.contentWindow as any;
        if (win) {
          const mp = win.document?.getElementById('movie_player') ||
                     win.document?.querySelector('.html5-video-player');
          if (mp && typeof mp.getAvailableQualityLevels === 'function') {
            const levels = mp.getAvailableQualityLevels();
            if (Array.isArray(levels) && levels.length > 0) {
              rawQualities = levels;
            }
          }
        }
      } catch {}
    }

    if (rawQualities.length > 0) {
      const sorted = sortYouTubeQualities(rawQualities);
      const current = useAppStore.getState().ytAvailableQualities;
      if (current.join(',') !== sorted.join(',')) {
        console.log('[YT] Native available qualities refreshed:', sorted);
        useAppStore.getState().setYtAvailableQualities(sorted);
        availableQualitiesRef.current = sorted;
      }
      return sorted;
    }

    return useAppStore.getState().ytAvailableQualities;
  }, []);

  /** Attempt to force quality on the YouTube player using all available strategies:
   * 1. Electron IPC executeJavaScript (most reliable on desktop)
   * 2. IFrame API setPlaybackQuality / setPlaybackQualityRange
   * 3. postMessage commands to the iframe
   * 4. Direct movie_player access (cross-origin guarded)
   * Quality switching in YouTube IFrame API for web is restricted but we try all paths. */
  const forceQualityOnPlayer = useCallback((q: string) => {
    if (!playerRef.current) return;
    const p = playerRef.current as any;
    const isDefault = q === 'default' || q === 'auto';
    const ytQuality = isDefault ? 'auto' : q;

    // 1. [Electron] executeJavaScript inside YT sub-frame (bypasses cross-origin restrictions)
    const electronSetQuality = (window as any).electron?.setYouTubeQuality;
    if (typeof electronSetQuality === 'function') {
      electronSetQuality(ytQuality).catch(() => {});
    }

    // 2. IFrame API instance methods (works when YouTube honours the API)
    try {
      if (typeof p.setPlaybackQualityRange === 'function') p.setPlaybackQualityRange(ytQuality, ytQuality);
      if (typeof p.setPlaybackQuality === 'function') p.setPlaybackQuality(isDefault ? 'default' : ytQuality);
      if (typeof p.setOption === 'function') p.setOption('playbackQuality', isDefault ? 'default' : ytQuality);
    } catch {}

    // 3. postMessage commands to the iframe
    postYTCommand('setPlaybackQuality', [isDefault ? 'default' : ytQuality]);
    postYTCommand('setPlaybackQualityRange', [ytQuality, ytQuality]);
    postYTCommand('setOption', ['playbackQuality', isDefault ? 'default' : ytQuality]);

    // 4. Direct movie_player access (works in Electron with --disable-web-security)
    try {
      const iframe = p?.getIframe?.() as HTMLIFrameElement | null;
      const win = iframe?.contentWindow as any;
      if (win) {
        const mp = win.document?.getElementById('movie_player') ||
                   win.document?.querySelector('.html5-video-player');
        if (mp) {
          if (typeof mp.setPlaybackQualityRange === 'function') mp.setPlaybackQualityRange(ytQuality, ytQuality);
          if (typeof mp.setPlaybackQuality === 'function') mp.setPlaybackQuality(isDefault ? 'default' : ytQuality);
          if (typeof mp.setOption === 'function') mp.setOption('playbackQuality', isDefault ? 'default' : ytQuality);
        }
      }
    } catch {/* cross-origin: silent */}

    // 5. Store in localStorage as a hint for YouTube player
    try {
      if (isDefault) {
        localStorage.removeItem('yt-player-quality');
        localStorage.removeItem('yt-player-quality-cap');
      } else {
        const resMap: Record<string, number> = {
          hd2160: 2160, hd1440: 1440, hd1080: 1080, hd720: 720,
          large: 480, medium: 360, small: 240, tiny: 144
        };
        const num = resMap[ytQuality] || 720;
        const payload = JSON.stringify({
          data: JSON.stringify({ quality: num, previousQuality: num }),
          expiration: Date.now() + 31536000000,
          creation: Date.now()
        });
        localStorage.setItem('yt-player-quality', payload);
        localStorage.setItem('yt-player-quality-cap', payload);
      }
    } catch {}
  }, [postYTCommand]);

  const setQuality = useCallback((quality: string) => {
    targetQualityRef.current = quality;
    if (!playerRef.current) return;

    const isAuto = quality === 'auto' || quality === 'default';
    const q = isAuto ? 'default' : quality;
    console.log('[YT] setQuality called with:', quality, '→ normalized:', q);

    // Apply quality directly across all available paths (no reload, smooth transition)
    forceQualityOnPlayer(q);
  }, [forceQualityOnPlayer]);

  const getAvailableQualities = useCallback(() => {
    const fromStore = useAppStore.getState().ytAvailableQualities;
    if (fromStore && fromStore.length > 0) return fromStore;
    return availableQualitiesRef.current;
  }, []);

  const getQuality = useCallback(() => {
    return targetQualityRef.current || 'auto';
  }, []);

  const ensurePlayer = useCallback((): Promise<YT.Player> => {
    if (playerInitPromiseRef.current) {
      return playerInitPromiseRef.current;
    }

    const promise = new Promise<YT.Player>(async (resolve, reject) => {
      console.log('[YT] ensurePlayer called');
      const { pipWindow } = useAppStore.getState();
      const doc = pipWindow ? pipWindow.document : document;
      
      const YTAPI = pipWindow 
        ? await loadYTApiForWindow(pipWindow, pipWindow.document)
        : (await loadYTApi(), window.YT);

      console.log('[YT] API ready, playerRef.current =', !!playerRef.current);

      if (playerRef.current) {
        try {
          const iframe = (playerRef.current as any).getIframe?.();
          if (iframe && iframe.isConnected && doc.contains(iframe)) {
            playerInitPromiseRef.current = null;
            return resolve(playerRef.current);
          } else {
            console.warn('[YT] playerRef iframe is disconnected from DOM, recreating player...');
            playerRef.current = null;
          }
        } catch {
          playerRef.current = null;
        }
      }

      let container = doc.getElementById('yt-host');
      if (!container) {
        // Wait up to 2 seconds for DOM to mount
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 100));
          container = doc.getElementById('yt-host');
          if (container) break;
        }
      }

      if (!container) {
        console.error('[YT] #yt-host not found in DOM! pipWindow=', !!pipWindow);
        playerInitPromiseRef.current = null;
        return reject(new Error('#yt-host not found in DOM'));
      }
      
      container.innerHTML = ''; // Clear zombie iframes

      const div = doc.createElement('div');
      div.id = 'yt-player-inner';
      // Ensure placeholder video is hidden via opacity so YouTube iframe initializes properly
      if (!useAppStore.getState().currentVideoId) {
        div.style.opacity = '0';
        div.style.pointerEvents = 'none';
      }
      container.appendChild(div);

      const isElectron = !!(window as any).electron || /electron/i.test(navigator.userAgent);
      // Always pass the current window's origin to YouTube so it knows where to send postMessages.
      const ytOrigin = window.location.protocol !== 'file:' ? window.location.origin : undefined;

      console.log('[YT] Creating player, isElectron=', isElectron, 'origin=', ytOrigin);

      let isResolved = false;
      const readyTimeout = setTimeout(() => {
        if (!isResolved) {
          console.warn('[YT] onReady timeout reached');
          isResolved = true;
          playerInitPromiseRef.current = null;
          if (playerRef.current) {
            resolve(playerRef.current);
          } else {
            reject(new Error('YouTube player initialization timed out'));
          }
        }
      }, 4000);

      playerRef.current = new YTAPI.Player(div, {
        height: '100%',
        width: '100%',
        videoId: 'jNQXAC9IVRw', // Provide a valid placeholder ID to prevent Error 2 on init
        playerVars: {
          autoplay: 0,
          controls: 0, // Always 0 (Concord custom overlay)
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
             clearTimeout(readyTimeout);
             console.log('[YT] onReady fired! player=', !!event.target);
             try {
               const iframe = playerRef.current?.getIframe?.();
               if (iframe && !/autoplay/.test(iframe.getAttribute('allow') || '')) {
                 iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
               }
               // Keep placeholder invisible unless there is an actual track
               if (iframe && !useAppStore.getState().currentVideoId) {
                 iframe.style.opacity = '0';
                 iframe.style.pointerEvents = 'none';
               }
             } catch {
               // ignore
             }
             // Apply initial CC state (off by default)
             applyCCState(isCCEnabledRef.current);
             
             // Refresh available qualities right on player ready
             refreshAvailableQualities();

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

              // Inject CSS to hide YouTube native overlay UI elements.
              // Works in Electron because webSecurity:false lifts same-origin restrictions.
              const injectYTOverrideCSS = () => {
                try {
                  const iframe = playerRef.current?.getIframe?.() as HTMLIFrameElement | undefined;
                  const doc = iframe?.contentDocument ?? (iframe?.contentWindow as any)?.document;
                  if (doc?.head && !doc.getElementById('concord-yt-override')) {
                    const s = doc.createElement('style');
                    s.id = 'concord-yt-override';
                    s.textContent = [
                      '.ytp-chrome-top',
                      '.ytp-show-cards-title',
                      '.ytp-watermark',
                      '.ytp-youtube-button',
                      '.ytp-title',
                      '.ytp-title-text',
                      '.ytp-title-channel',
                      '.ytp-title-expand-button',
                      '.ytp-title-subtext',
                      '.ytp-gradient-top',
                      '.ytp-pause-overlay',
                      '.ytp-endscreen-content',
                      '.ytp-ce-element',
                      '.ytp-chrome-bottom',
                      '.ytp-gradient-bottom',
                      '.ytp-pause-overlay-container',
                      '.ytp-scroll-min',
                      '.ytp-paid-content-overlay',
                      '.ytp-bezel-text',
                      '.ytp-contextmenu',
                      '.ytp-impression-link',
                      '.annotation',
                      '.ytp-cards-teaser',
                      '.ytp-cards-button',
                      '.ytp-ce-covering-overlay',
                      '.ytp-ce-video',
                      '.ytp-ce-channel',
                      '.ytp-ce-element-show',
                      '.ytp-expand-pause-overlay',
                    ].join(',') + ' { display:none !important; }';
                    doc.head.appendChild(s);
                  }
                } catch { /* cross-origin or not yet loaded — retry below */ }
              };
              injectYTOverrideCSS();
              setTimeout(injectYTOverrideCSS, 2000);

             if (!isResolved) {
               isResolved = true;
               playerInitPromiseRef.current = null;
               resolve(playerRef.current!);
             }
          },
          onError: (event: any) => {
            console.error('[YT] Player error:', event.data);
            const code = event.data;
            let msg = 'Erro ao reproduzir vídeo do YouTube.';
            if (code === 150 || code === 101) {
              msg = 'Este vídeo não permite reprodução incorporada fora do YouTube.';
            } else if (code === 100) {
              msg = 'Vídeo do YouTube não encontrado ou privado.';
            } else if (code === 2) {
              msg = 'ID do vídeo inválido.';
            }
            notifyInChat(msg);
            useAppStore.getState().setIsPlaying(false);
            useAppStore.getState().setIsBuffering(false);
            if (currentTokenRef.current !== null) {
              onMusicEnded(currentTokenRef.current);
            }
          },
          onPlaybackQualityChange: (event: any) => {
            console.log('[YT] onPlaybackQualityChange fired:', event.data);
            refreshAvailableQualities();
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

              // Query available resolutions from player immediately and after stream stabilizes
              refreshAvailableQualities();
              setTimeout(refreshAvailableQualities, 1000);
              setTimeout(refreshAvailableQualities, 2500);

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
                // When PiP is active, the PiP window handles queue advancement via
                // sendAction('skip') on its own ENDED event — suppress here to avoid double-skip
                const { isPiPActive } = useAppStore.getState();
                if (!isPiPActive) {
                  onMusicEnded(currentTokenRef.current);
                }
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

    playerInitPromiseRef.current = promise;
    return promise;
  }, [onMusicEnded, applyCCState]);

  const playYouTube = useCallback(
    async (videoId: string, startSeconds: number, token: number) => {
      currentTokenRef.current = token;
      suppressEndedRef.current = false;

      // Sempre que um novo vídeo for reproduzido, pré-selecionar qualidade automática
      targetQualityRef.current = 'auto';
      availableQualitiesRef.current = ['auto'];
      useAppStore.getState().setYtAvailableQualities(['auto']);

      // Force-unmute Electron audio pipeline before loading so audio isn't blocked
      if (typeof (window as any).electron?.forceUnmute === 'function') {
        (window as any).electron.forceUnmute();
      }

      useAppStore.getState().setCurrentVideoId(videoId);
      useAppStore.getState().setMusicStartTime(Date.now() - (startSeconds * 1000));
      useAppStore.getState().setIsPlaying(true);

      let player: YT.Player;
      try {
        player = await ensurePlayer();
      } catch (err) {
        console.warn('[YT] Failed to ensure player on first attempt, retrying...', err);
        playerInitPromiseRef.current = null;
        player = await ensurePlayer();
      }
      try {
        const iframe = player.getIframe?.();
        if (iframe) {
          iframe.style.display = 'block';
          iframe.style.opacity = '1';
          iframe.style.visibility = 'visible';
          iframe.style.pointerEvents = 'auto';
        }
      } catch {}

      try {
        (player as any).loadVideoById({
          videoId,
          startSeconds: Math.floor(startSeconds),
          suggestedQuality: 'default'
        });
      } catch {
        player.loadVideoById(videoId, Math.floor(startSeconds));
      }
      try {
        player.playVideo?.();
      } catch (e) {
        console.warn('[YT] playVideo call error:', e);
      }
      applyCCState(isCCEnabledRef.current);

      // Pré-selecionar qualidade automática no stream recém-carregado
      setTimeout(() => {
        forceQualityOnPlayer('default');
      }, 500);

      const { ytVol, callMuted } = useAudioStore.getState();
      const { isPiPActive } = useAppStore.getState();
      const targetVol = (callMuted || isPiPActive) ? 0 : ytVol;
      player.setVolume(targetVol);
      if (targetVol > 0) player.unMute();
    },
    [ensurePlayer, applyCCState, forceQualityOnPlayer]
  );

  const stopYouTube = useCallback(async () => {
    suppressEndedRef.current = true;
    targetQualityRef.current = 'auto';
    if (volumeIntervalRef.current) clearInterval(volumeIntervalRef.current);
    try {
      if (playerRef.current) {
        playerRef.current.pauseVideo?.();
        playerRef.current.seekTo?.(0, true);
        const iframe = playerRef.current.getIframe?.();
        if (iframe) {
          iframe.style.visibility = 'hidden';
          iframe.style.opacity = '0';
        }
      }
    } catch {}
    useAppStore.getState().setCurrentVideoId(null);
    useAppStore.getState().setIsPlaying(false);

    const store = useAppStore.getState();
    if (store.isPiPActive) {
      (window as any).electron?.closePipWindow?.();
      store.setPiPActive(false);
    }
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

  // Passively listen for YouTube postMessage 'infoDelivery' events which broadcast available resolutions
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      try {
        let data = e.data;
        if (typeof data === 'string') {
          if (!data.includes('infoDelivery') && !data.includes('availableQualityLevels')) return;
          data = JSON.parse(data);
        }
        if (data?.event === 'infoDelivery' && data?.info) {
          const levels = data.info.availableQualityLevels;
          if (Array.isArray(levels) && levels.length > 0) {
            const sorted = sortYouTubeQualities(levels);
            const current = useAppStore.getState().ytAvailableQualities;
            if (current.join(',') !== sorted.join(',')) {
              console.log('[YT] Native qualities via infoDelivery:', sorted);
              useAppStore.getState().setYtAvailableQualities(sorted);
              availableQualitiesRef.current = sorted;
            }
          }
        }
      } catch {}
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
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
    playYouTube, stopYouTube, pauseYouTube, resumeYouTube, applyYTVolume, seekTo, unlock, prewarm, getCurrentTime, getDuration, setCC, setQuality, getAvailableQualities, getQuality, refreshAvailableQualities
  }), [playYouTube, stopYouTube, pauseYouTube, resumeYouTube, applyYTVolume, seekTo, unlock, prewarm, getCurrentTime, getDuration, setCC, setQuality, getAvailableQualities, getQuality, refreshAvailableQualities]);
}

