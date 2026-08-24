import { useCallback } from 'react';
import { useAudioStore } from '../stores/useAudioStore';

interface AudioNodes {
  ctx: AudioContext;
  micSource: MediaStreamAudioSourceNode;
  micGain: GainNode;
  destination: MediaStreamAudioDestinationNode;
  analyser: AnalyserNode;
}

const speakingAnimations = new Map<string, number>();
const remoteGains = new Map<string, GainNode>();

let audioNodes: AudioNodes | null = null;
let micTrack: MediaStreamTrack | null = null;

function getOrCreateCtx(): AudioContext {
  if (!audioNodes) {
    // Will be created on first mic access
  }
  return (audioNodes?.ctx ?? new AudioContext()) as AudioContext;
}

export function useAudio() {


  const processMicStream = useCallback((rawStream: MediaStream): MediaStream => {
    const ctx = new AudioContext({ sampleRate: 48000 });
    const source = ctx.createMediaStreamSource(rawStream);
    const gainNode = ctx.createGain();
    const dest = ctx.createMediaStreamDestination();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    source.connect(gainNode);
    gainNode.connect(dest);
    gainNode.connect(analyser);

    const { micVol } = useAudioStore.getState();
    gainNode.gain.value = micVol / 100;

    micTrack = rawStream.getAudioTracks()[0] ?? null;

    audioNodes = { ctx, micSource: source, micGain: gainNode, destination: dest, analyser };

    // Ao invés de retornar o dest.stream (que perde a supressão de ruído e cancelamento 
    // de eco por passar pela Web Audio API), retornamos o rawStream original para o WebRTC.
    return rawStream;
  }, []);

  const attachRemoteStream = useCallback((audioEl: HTMLAudioElement, stream: MediaStream, userId: string) => {
    try {
      const { remoteVol, callMuted, localMutedUsers, userVolumes } = useAudioStore.getState();
      const userVol = userVolumes[userId] ?? 100;
      
      const isLocalMuted = localMutedUsers.includes(userId);
      audioEl.srcObject = stream;
      audioEl.volume = 0; // Controlled by Web Audio API GainNode instead
      audioEl.muted = true;
      
      // Force play to overcome some browser policies
      audioEl.play().catch(e => console.warn('[useAudio] Autoplay prevented:', e));

      // Reuse the active context for speaking detection so it isn't suspended
      const activeCtx = audioNodes?.ctx ?? getOrCreateCtx();

      let gainNode = remoteGains.get(userId);
      if (!gainNode) {
        const source = activeCtx.createMediaStreamSource(stream);
        gainNode = activeCtx.createGain();
        source.connect(gainNode);
        gainNode.connect(activeCtx.destination);
        remoteGains.set(userId, gainNode);
      }

      gainNode.gain.value = (callMuted || isLocalMuted) ? 0 : (remoteVol / 100) * (userVol / 100);

      monitorSpeaking(stream, userId, activeCtx);
    } catch (err) {
      console.warn('[useAudio] attachRemoteStream failed', err);
    }
  }, []);

  const applyMicSettings = useCallback(() => {
    if (!audioNodes) return;
    const { micVol, micMuted } = useAudioStore.getState();
    audioNodes.micGain.gain.value = micMuted ? 0 : micVol / 100;
    if (micTrack) micTrack.enabled = !micMuted;
  }, []);

  const applyRemoteSettings = useCallback(() => {
    const { remoteVol, callMuted, localMutedUsers, userVolumes } = useAudioStore.getState();
    document.querySelectorAll<HTMLAudioElement>('audio[id^="remote-audio-"]').forEach((audio) => {
      const userId = audio.id.replace('remote-audio-', '');
      const isLocalMuted = localMutedUsers.includes(userId);
      const userVol = userVolumes[userId] ?? 100;
      
      const gainNode = remoteGains.get(userId);
      if (gainNode) {
        gainNode.gain.value = (callMuted || isLocalMuted) ? 0 : (remoteVol / 100) * (userVol / 100);
      } else {
        audio.volume = isLocalMuted ? 0 : (remoteVol / 100);
        audio.muted = callMuted || isLocalMuted;
      }
    });
  }, []);

  const removeRemoteGain = useCallback((userId: string) => {
    stopSpeaking(userId);
    const gain = remoteGains.get(userId);
    if (gain) {
      gain.disconnect();
      remoteGains.delete(userId);
    }
  }, []);

  return {
    processMicStream,
    attachRemoteStream,
    applyMicSettings,
    applyRemoteSettings,
    removeRemoteGain,
    getMicTrack: () => micTrack,
  };
}

// ─── SPEAKING DETECTION ─────────────────────────────────────────────

export function monitorSpeaking(stream: MediaStream, userId: string, activeCtx?: AudioContext) {
  const ctx = activeCtx || new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);

  function tick() {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += Math.abs(v - 128);
    const avg = sum / data.length;

    const el = document.getElementById(`user-${userId}`);
    if (el) {
      if (avg > 8) el.classList.add('speaking-glow');
      else el.classList.remove('speaking-glow');
    }

    speakingAnimations.set(userId, requestAnimationFrame(tick));
  }

  tick();
}

export function stopSpeaking(userId: string) {
  const raf = speakingAnimations.get(userId);
  if (raf) cancelAnimationFrame(raf);
  speakingAnimations.delete(userId);

  const el = document.getElementById(`user-${userId}`);
  el?.classList.remove('speaking-glow');
}
