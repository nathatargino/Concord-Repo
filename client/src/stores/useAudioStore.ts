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
  localMutedUsers: string[];

  setYtVol: (v: number) => void;
  setMicVol: (v: number) => void;
  setRemoteVol: (v: number) => void;
  setMicMuted: (v: boolean) => void;
  toggleMicMute: () => void;
  toggleCallMute: () => void;
  toggleNoiseSuppression: () => void;
  toggleLocalMuteUser: (userId: string) => void;
  resetAll: () => void;
}

const defaults = {
  ytVol: 80,
  micVol: 100,
  remoteVol: 100,
  micMuted: false,
  callMuted: false,
  noiseSuppression: true,
  localMutedUsers: [],
};

export const useAudioStore = create<AudioState>()(
  persist(
    (set) => ({
      ...defaults,
      setYtVol: (ytVol) => set({ ytVol: Math.min(100, Math.max(0, ytVol)) }),
      setMicVol: (micVol) => set({ micVol: Math.min(200, Math.max(0, micVol)) }),
      setRemoteVol: (remoteVol) => set({ remoteVol: Math.min(200, Math.max(0, remoteVol)) }),
      setMicMuted: (micMuted) => set({ micMuted }),
      toggleMicMute: () => set((s) => ({ micMuted: !s.micMuted })),
      toggleCallMute: () => set((s) => ({ callMuted: !s.callMuted })),
      toggleNoiseSuppression: () => set((s) => ({ noiseSuppression: !s.noiseSuppression })),
      toggleLocalMuteUser: (userId: string) => set((s) => {
        const isMuted = s.localMutedUsers.includes(userId);
        return {
          localMutedUsers: isMuted
            ? s.localMutedUsers.filter((id) => id !== userId)
            : [...s.localMutedUsers, userId],
        };
      }),
      resetAll: () => set(defaults),
    }),
    {
      name: STORAGE_KEY,
    }
  )
);
