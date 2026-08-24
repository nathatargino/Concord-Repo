let audioCtx: AudioContext | null = null;

const getCtx = () => {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
};

const playTone = (
  frequencies: number[],
  type: OscillatorType = 'sine',
  duration = 0.15,
  delay = 0.15,
  volume = 0.1
) => {
  try {
    const ctx = getCtx();
    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      
      const startTime = ctx.currentTime + i * delay;
      osc.frequency.setValueAtTime(freq, startTime);
      
      // Envelopes para evitar "clicks" no áudio
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(volume, startTime + 0.02);
      gain.gain.linearRampToValueAtTime(0, startTime + duration);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(startTime);
      osc.stop(startTime + duration);
    });
  } catch (err) {
    console.warn('Audio play failed:', err);
  }
};

// Sons parecidos com o Discord (usando tons puros e intervalos agradáveis)
export const playJoinSound = () => playTone([440, 554], 'sine', 0.15, 0.15, 0.1); // Lá, Dó# (Subindo)
export const playLeaveSound = () => playTone([554, 440], 'sine', 0.15, 0.15, 0.1); // Dó#, Lá (Descendo)
export const playScreenShareStartSound = () => playTone([523.25, 659.25], 'triangle', 0.1, 0.1, 0.05); // Dó, Mi (rápido)
export const playScreenShareStopSound = () => playTone([659.25, 523.25], 'triangle', 0.1, 0.1, 0.05); // Mi, Dó (rápido)
