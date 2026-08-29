import { useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAppStore } from '../stores/useAppStore';
import { playScreenShareStartSound, playScreenShareStopSound } from '../utils/soundEffects';
import { EchoFilter } from '../utils/echoFilter';

type EmitFn = (event: string, ...args: unknown[]) => void;
type GetRemoteStreamsFn = () => Map<string, MediaStream>;

export function useScreenShare(
  emit: EmitFn,
  addScreenShareTrack: (stream: MediaStream) => void,
  removeScreenShareTrack: () => void,
  getRemoteAudioStreams?: GetRemoteStreamsFn,
) {
  const streamRef = useRef<MediaStream | null>(null);
  const echoFilterRef = useRef<EchoFilter | null>(null);

  /** Dispose any active echo filter */
  const disposeEchoFilter = useCallback(() => {
    echoFilterRef.current?.dispose();
    echoFilterRef.current = null;
  }, []);

  /**
   * Process the loopback audio through the echo filter so that remote
   * participants' voices (already playing through the speakers) are
   * subtracted from the captured audio before it is sent via WebRTC.
   *
   * Returns a *new* MediaStream whose audio track is the filtered one.
   */
  const filterLoopbackEcho = useCallback((stream: MediaStream): MediaStream => {
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack || !getRemoteAudioStreams) return stream;

    const remoteStreams = getRemoteAudioStreams();
    if (remoteStreams.size === 0) return stream;

    // Clean any previous filter
    disposeEchoFilter();

    const filter = new EchoFilter();
    const cleanTrack = filter.start(audioTrack, remoteStreams);
    echoFilterRef.current = filter;

    if (cleanTrack && cleanTrack !== audioTrack) {
      // Build a new stream: original video + filtered audio
      const filtered = new MediaStream();
      stream.getVideoTracks().forEach((t) => filtered.addTrack(t));
      filtered.addTrack(cleanTrack);
      return filtered;
    }

    return stream;
  }, [getRemoteAudioStreams, disposeEchoFilter]);

  const stopScreenShare = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    disposeEchoFilter();
    removeScreenShareTrack();
    emit('stop_screen_share');
    useAppStore.getState().setAmSharing(false);
    useAppStore.getState().setScreenShare(null, null);
    playScreenShareStopSound();
    toast('🖥️ Compartilhamento encerrado', { duration: 2000 });
  }, [emit, removeScreenShareTrack, disposeEchoFilter]);

  const startScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
          frameRate: { ideal: 30, max: 60 },
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          systemAudio: 'include',
        } as any,
      });

      streamRef.current = stream;

      // Filter echo from the loopback audio before sending via WebRTC
      const processed = filterLoopbackEcho(stream);
      addScreenShareTrack(processed);

      emit('start_screen_share');
      useAppStore.getState().setAmSharing(true);
      playScreenShareStartSound();

      // Listen for user stopping via browser UI
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopScreenShare();
      });

      const hasAudio = stream.getAudioTracks().length > 0;
      toast.success(hasAudio
        ? '🖥️ Compartilhamento de tela com áudio iniciado!'
        : '🖥️ Compartilhamento de tela iniciado!');
    } catch (err: unknown) {
      // NotAllowedError / AbortError = user cancelled the picker → silent
      if (err instanceof Error && err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        toast.error('Erro ao compartilhar tela');
        console.error('[ScreenShare] startScreenShare error:', err);
      }
    }
  }, [emit, addScreenShareTrack, stopScreenShare, filterLoopbackEcho]);

  const changeScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
          frameRate: { ideal: 30, max: 60 },
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          systemAudio: 'include',
        } as any,
      });

      // Stop previous tracks to release previous window/screen
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;

      // Re-apply echo filter for the new stream
      const processed = filterLoopbackEcho(stream);
      addScreenShareTrack(processed);

      // Listen for user stopping via browser UI
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopScreenShare();
      });

      toast.success('🖥️ Transmissão de tela alterada!');
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        toast.error('Erro ao trocar tela');
        console.error('[ScreenShare] changeScreenShare error:', err);
      }
    }
  }, [addScreenShareTrack, stopScreenShare, filterLoopbackEcho]);

  return { startScreenShare, stopScreenShare, changeScreenShare, streamRef };
}

