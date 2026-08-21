import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const STORAGE_KEY = 'concord_audio_v1';

interface AudioState {
  ytVol: number;
  micVol: number;
  remoteVol: number;
  micMuted: boolean;
  callMuted: boolean;
  noiseSuppression: boolean;

  setYtVol: (v: number) => void;
  setMicVol: (v: number) => void;
  setRemoteVol: (v: number) => void;
  toggleMicMute: () => void;
  toggleCallMute: () => void;
  toggleNoiseSuppression: () => void;
  resetAll: () => void;
}

const defaults = {
  ytVol: 80,
  micVol: 100,
  remoteVol: 100,
  micMuted: false,
  callMuted: false,
  noiseSuppression: true,
};

export const useAudioStore = create<AudioState>()(
  persist(
    (set) => ({
      ...defaults,
      setYtVol: (ytVol) => set({ ytVol: Math.min(100, Math.max(0, ytVol)) }),
      setMicVol: (micVol) => set({ micVol: Math.min(200, Math.max(0, micVol)) }),
      setRemoteVol: (remoteVol) => set({ remoteVol: Math.min(200, Math.max(0, remoteVol)) }),
      toggleMicMute: () => set((s) => ({ micMuted: !s.micMuted })),
      toggleCallMute: () => set((s) => ({ callMuted: !s.callMuted })),
      toggleNoiseSuppression: () => set((s) => ({ noiseSuppression: !s.noiseSuppression })),
      resetAll: () => set(defaults),
    }),
    {
      name: STORAGE_KEY,
    }
  )
);
