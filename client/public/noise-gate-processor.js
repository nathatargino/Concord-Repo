/**
 * NoiseGateProcessor — AudioWorklet processor for Concord Voice.
 *
 * Professional Voice Activity Detection (VAD) & Spectral Hysteresis Gate (Discord/Krisp style):
 * - Isolated voice-band sidechain (~250 Hz to ~4000 Hz) to eliminate key clicks and desk rumbles
 * - Dual hysteresis thresholds: openThreshold (target) and closeThreshold (target - 6 dB)
 * - 220ms hold/hangover time to preserve sentence endings, soft syllables and breath
 * - Ultra-fast 2ms attack and smooth 140ms exponential release
 * - Configurable soft attenuation floor (-34 dB / 0.02 or 0.005) preventing artificial "dead air"
 * - Adaptive noise floor estimation for auto-sensitivity mode
 */
class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -45, minValue: -80, maxValue: 0, automationRate: 'k-rate' },
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'autoSensitivity', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();

    const sr = typeof sampleRate !== 'undefined' ? sampleRate : 48000;

    // Sidechain voice-band filter (~250 Hz High-Pass and ~4000 Hz Low-Pass)
    const fHp = 250;
    const fLp = 4000;
    this._hpAlpha = Math.exp((-2 * Math.PI * fHp) / sr);
    this._lpAlpha = 1 - Math.exp((-2 * Math.PI * fLp) / sr);

    this._hpX = 0;
    this._hpY = 0;
    this._lpY = 0;

    // Dynamic state
    this._currentGain = 1.0;
    this._gateState = 'open'; // 'open' | 'hold' | 'closed'
    this._holdSamples = Math.round(0.22 * sr); // 220ms hold time
    this._holdCounter = this._holdSamples;

    // Adaptive noise floor estimator
    this._noiseFloorDb = -60.0;

    // Attenuation floor (0.02 = -34 dB for RNNoise, 0.005 = -46 dB for standard)
    this._floorGain = 0.02;

    // Listen for configuration messages from main thread
    this.port.onmessage = (event) => {
      if (event.data && typeof event.data.floorGain === 'number') {
        this._floorGain = Math.max(0.001, Math.min(0.2, event.data.floorGain));
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input.length) return true;

    const enabledParam = parameters.enabled ? parameters.enabled[0] : 1;

    // Passthrough when gate is disabled
    if (enabledParam < 0.5) {
      this._currentGain = 1.0;
      this._gateState = 'open';
      this._holdCounter = this._holdSamples;
      for (let c = 0; c < input.length; c++) {
        output[c].set(input[c]);
      }
      return true;
    }

    const thresholdParam = parameters.threshold ? parameters.threshold[0] : -45;
    const autoSensParam = parameters.autoSensitivity ? parameters.autoSensitivity[0] : 1;
    const sr = typeof sampleRate !== 'undefined' ? sampleRate : 48000;

    const mono = input[0];
    const len = mono.length;

    // ── 1. Voice-band Sidechain Filtering & RMS Energy Calculation ──
    let sumSq = 0;
    for (let i = 0; i < len; i++) {
      const x = mono[i];

      // High-Pass (removes desk thumps, AC hum, sub-bass)
      const hp = this._hpAlpha * (this._hpY + x - this._hpX);
      this._hpX = x;
      this._hpY = hp;

      // Low-Pass (removes keyboard clicks, mouse clicks, high sibilance)
      const bp = this._lpY + this._lpAlpha * (hp - this._lpY);
      this._lpY = bp;

      sumSq += bp * bp;
    }

    const rms = Math.sqrt(sumSq / len);
    const rmsDb = 20 * Math.log10(Math.max(rms, 1e-6));

    // ── 2. Adaptive Noise Floor Estimator ──
    if (this._gateState !== 'open' || rmsDb < this._noiseFloorDb + 6) {
      if (rmsDb < this._noiseFloorDb) {
        this._noiseFloorDb = this._noiseFloorDb * 0.96 + rmsDb * 0.04;
      } else {
        this._noiseFloorDb = this._noiseFloorDb * 0.998 + rmsDb * 0.002;
      }
      this._noiseFloorDb = Math.min(-34, Math.max(-80, this._noiseFloorDb));
    }

    // ── 3. Target Threshold Determination ──
    let targetThresholdDb = thresholdParam;
    if (autoSensParam >= 0.5) {
      const adaptive = Math.max(thresholdParam, this._noiseFloorDb + 9);
      targetThresholdDb = Math.min(-34, Math.max(-58, adaptive));
    }

    // ── 4. Dual Hysteresis & Hold (Hangover) Time ──
    const openThresholdDb = targetThresholdDb;
    const closeThresholdDb = targetThresholdDb - 6.0;

    if (rmsDb >= openThresholdDb) {
      this._gateState = 'open';
      this._holdCounter = this._holdSamples;
    } else if (this._gateState === 'open' || this._gateState === 'hold') {
      if (rmsDb >= closeThresholdDb) {
        this._gateState = 'open';
        this._holdCounter = this._holdSamples;
      } else {
        this._holdCounter -= len;
        if (this._holdCounter > 0) {
          this._gateState = 'hold';
        } else {
          this._gateState = 'closed';
        }
      }
    } else {
      this._gateState = 'closed';
    }

    // ── 5. Envelope Follower & Gain Application ──
    const targetGain = (this._gateState === 'open' || this._gateState === 'hold') ? 1.0 : this._floorGain;

    // Attack 2ms, Release 140ms
    const attackCoeff = 1 - Math.exp(-1 / (sr * 0.002));
    const releaseCoeff = 1 - Math.exp(-1 / (sr * 0.140));

    for (let i = 0; i < len; i++) {
      if (this._currentGain < targetGain) {
        this._currentGain += attackCoeff * (targetGain - this._currentGain);
      } else {
        this._currentGain += releaseCoeff * (targetGain - this._currentGain);
      }

      for (let c = 0; c < input.length; c++) {
        output[c][i] = input[c][i] * this._currentGain;
      }
    }

    return true;
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
