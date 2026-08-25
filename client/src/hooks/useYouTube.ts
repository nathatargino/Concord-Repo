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
  return new Promise((resolve) => {
    if (ytApiReady) return resolve();
    ytReadyCallbacks.push(resolve);
    if (ytApiLoaded) return;
    ytApiLoaded = true;

    window.onYouTubeIframeAPIReady = () => {
      ytApiReady = true;
      ytReadyCallbacks.forEach((cb) => cb());
      ytReadyCallbacks.length = 0;
    };

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
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

  const ensurePlayer = useCallback((): Promise<YT.Player> => {
    return new Promise(async (resolve) => {
      await loadYTApi();

      if (playerRef.current) return resolve(playerRef.current);

      const container = document.getElementById('yt-host');
      if (!container) return;

      const div = document.createElement('div');
      div.id = 'yt-player-inner';
      container.appendChild(div);

      playerRef.current = new window.YT.Player('yt-player-inner', {
        height: '1',
        width: '1',
        playerVars: { 
          autoplay: 1, 
          controls: 0, 
          modestbranding: 1,
          ...(window.location.protocol !== 'file:' && { origin: window.location.origin })
        },
        events: {
          onReady: () => resolve(playerRef.current!),
          onStateChange: (e: YT.OnStateChangeEvent) => {
            if (e.data === window.YT.PlayerState.ENDED) {
              if (!suppressEndedRef.current && currentTokenRef.current !== null) {
                onMusicEnded(currentTokenRef.current);
              }
              useAppStore.getState().setIsPlaying(false);
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

      const player = await ensurePlayer();
      player.loadVideoById(videoId, Math.floor(startSeconds));

      const { ytVol, callMuted } = useAudioStore.getState();
      const targetVol = callMuted ? 0 : ytVol;
      player.setVolume(targetVol);
      if (targetVol > 0) player.unMute();
      
      useAppStore.getState().setIsPlaying(true);
    },
    [ensurePlayer]
  );

  const stopYouTube = useCallback(async () => {
    suppressEndedRef.current = true;
    playerRef.current?.stopVideo();
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
    if (unlockedRef.current) return;
    unlockedRef.current = true;
    if (useAppStore.getState().isPlaying) return;

    try {
      const player = await ensurePlayer();
      player.mute();
      player.playVideo();
      setTimeout(() => {
        if (useAppStore.getState().isPlaying) return;
        player.stopVideo();
        player.unMute();
      }, 500);
    } catch {
      // ignore
    }
  }, [ensurePlayer]);

  return { playYouTube, stopYouTube, pauseYouTube, resumeYouTube, applyYTVolume, unlock };
}
