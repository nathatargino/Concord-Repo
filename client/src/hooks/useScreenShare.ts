import { useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAppStore } from '../stores/useAppStore';
import { playScreenShareStartSound, playScreenShareStopSound } from '../utils/soundEffects';
import { EchoFilter } from '../utils/echoFilter';

type EmitFn = (event: string, ...args: unknown[]) => void;
type GetRemoteStreamsFn = () => Map<string, MediaStream>;

/** Helper function to request display media (opens picker once without modal loops) */
async function captureDisplayMedia(): Promise<MediaStream> {
  return await navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: { ideal: 30, max: 60 },
    },
    audio: true,
    systemAudio: 'include',
    selfBrowserSurface: 'include',
    surfaceSwitching: 'include',
    monitorTypeSurfaces: 'include',
  } as any);
}

export function useScreenShare(
  emit: EmitFn,
  addScreenShareTrack: (stream: MediaStream) => void,
  removeScreenShareTrack: () => void,
  getRemoteAudioStreams?: GetRemoteStreamsFn,
) {
  const streamRef = useRef<MediaStream | null>(null);
  const echoFilterRef = useRef<EchoFilter | null>(null);
  const isRequestingRef = useRef<boolean>(false); // Trava contra cliques duplos / chamadas concorrentes

  /** Dispose any active echo filter */
  const disposeEchoFilter = useCallback(() => {
    try {
      echoFilterRef.current?.dispose();
    } catch (e) {
      console.warn('[ScreenShare] Error disposing echo filter:', e);
    }
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
    try {
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack || !getRemoteAudioStreams) return stream;

      const remoteStreams = getRemoteAudioStreams();
      if (!remoteStreams || remoteStreams.size === 0) return stream;

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
    } catch (err) {
      console.warn('[ScreenShare] Error in filterLoopbackEcho, using raw stream:', err);
      return stream;
    }
  }, [getRemoteAudioStreams, disposeEchoFilter]);

  const stopScreenShare = useCallback(() => {
    isRequestingRef.current = false;
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
    if (isRequestingRef.current || useAppStore.getState().amSharing) {
      return; // Ignora cliques repetidos / concorrentes
    }
    isRequestingRef.current = true;

    try {
      const stream = await captureDisplayMedia();
      streamRef.current = stream;

      // Filter echo from the loopback audio before sending via WebRTC
      const processed = filterLoopbackEcho(stream);
      addScreenShareTrack(processed);

      emit('start_screen_share');
      useAppStore.getState().setAmSharing(true);
      playScreenShareStartSound();

      // Listen for user stopping via browser UI (e.g. Chrome's "Stop sharing" floating bar)
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          stopScreenShare();
        };
      }

      const hasAudio = stream.getAudioTracks().length > 0;
      if (hasAudio) {
        toast.success('🖥️ Compartilhando tela com áudio!');
      } else {
        toast('🖥️ Compartilhando sem áudio. (Dica: selecione "Tela inteira" ou "Guia" para transmitir som)', {
          icon: '💡',
          duration: 4500,
        });
      }
    } catch (err: unknown) {
      // NotAllowedError / AbortError = usuário cancelou o picker → silencioso
      if (err instanceof Error) {
        if (err.name === 'NotReadableError') {
          toast.error('O Windows bloqueou a captura de som do sistema. Compartilhe pela "Guia do Opera" ou desative som espacial/modo exclusivo no Windows.', { duration: 6000 });
        } else if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
          toast.error('Erro ao compartilhar tela');
        }
        if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
          console.error('[ScreenShare] startScreenShare error:', err);
        }
      }
    } finally {
      isRequestingRef.current = false; // Sempre libera a trava
    }
  }, [emit, addScreenShareTrack, stopScreenShare, filterLoopbackEcho]);

  const changeScreenShare = useCallback(async () => {
    if (isRequestingRef.current) return;
    isRequestingRef.current = true;

    try {
      const stream = await captureDisplayMedia();

      // Stop previous tracks to release previous window/screen
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;

      // Re-apply echo filter for the new stream
      const processed = filterLoopbackEcho(stream);
      addScreenShareTrack(processed);

      // Listen for user stopping via browser UI
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          stopScreenShare();
        };
      }

      toast.success('🖥️ Transmissão de tela alterada!');
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        toast.error('Erro ao trocar tela');
        console.error('[ScreenShare] changeScreenShare error:', err);
      }
    } finally {
      isRequestingRef.current = false;
    }
  }, [addScreenShareTrack, stopScreenShare, filterLoopbackEcho]);

  return { startScreenShare, stopScreenShare, changeScreenShare, streamRef };
}

