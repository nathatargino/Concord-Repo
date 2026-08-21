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

    return dest.stream;
  }, []);

  const attachRemoteStream = useCallback((audioEl: HTMLAudioElement, stream: MediaStream, userId: string) => {
    try {
      const ctx = audioNodes?.ctx ?? getOrCreateCtx();
      const source = ctx.createMediaStreamSource(stream);
      const gainNode = ctx.createGain();
      const dest = ctx.createMediaStreamDestination();

      const { remoteVol, callMuted } = useAudioStore.getState();
      gainNode.gain.value = callMuted ? 0 : remoteVol / 100;

      source.connect(gainNode);
      gainNode.connect(dest);
      gainNode.connect(ctx.destination);

      remoteGains.set(userId, gainNode);
      audioEl.srcObject = dest.stream;

      monitorSpeaking(stream, userId);
    } catch {
      audioEl.srcObject = stream;
    }
  }, []);

  const applyMicSettings = useCallback(() => {
    if (!audioNodes) return;
    const { micVol, micMuted } = useAudioStore.getState();
    audioNodes.micGain.gain.value = micMuted ? 0 : micVol / 100;
    if (micTrack) micTrack.enabled = !micMuted;
  }, []);

  const applyRemoteSettings = useCallback(() => {
    const { remoteVol, callMuted } = useAudioStore.getState();
    remoteGains.forEach((gain) => {
      gain.gain.value = callMuted ? 0 : remoteVol / 100;
    });
  }, []);

  const removeRemoteGain = useCallback((userId: string) => {
    remoteGains.delete(userId);
    stopSpeaking(userId);
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

export function monitorSpeaking(stream: MediaStream, userId: string) {
  const ctx = new AudioContext();
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
