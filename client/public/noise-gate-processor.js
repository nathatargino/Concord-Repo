/**
 * NoiseGateProcessor — AudioWorklet processor for real-time noise gate.
 *
 * Calculates RMS envelope of the input signal and applies a smooth
 * gate (attack/release) to suppress audio below the configured threshold.
 * This effectively silences background noise when the user is not speaking.
 *
 * Parameters (AudioParam):
 *  - threshold: gate threshold in dBFS (default -50, range -100 to 0)
 *  - attack:    gate opening speed in seconds (default 0.005)
 *  - release:   gate closing speed in seconds (default 0.05)
 */
class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -50, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
      { name: 'attack',    defaultValue: 0.005, minValue: 0.001, maxValue: 0.1, automationRate: 'k-rate' },
      { name: 'release',   defaultValue: 0.05,  minValue: 0.01,  maxValue: 0.5, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this._envelope = 0;    // current envelope level (linear)
    this._gateGain = 0;    // smoothed gate gain (0 = closed, 1 = open)
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input.length) return true;

    const thresholdDb = parameters.threshold[0];
    const attackTime  = parameters.attack[0];
    const releaseTime = parameters.release[0];

    // Convert dB threshold to linear amplitude
    const thresholdLin = Math.pow(10, thresholdDb / 20);

    // Smoothing coefficients (based on sample rate)
    const attackCoeff  = 1 - Math.exp(-1 / (sampleRate * attackTime));
    const releaseCoeff = 1 - Math.exp(-1 / (sampleRate * releaseTime));

    for (let channel = 0; channel < input.length; channel++) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];

      for (let i = 0; i < inputChannel.length; i++) {
        const sample = inputChannel[i];
        const absSample = Math.abs(sample);

        // Track envelope (peak follower with release)
        if (absSample > this._envelope) {
          this._envelope = absSample;
        } else {
          this._envelope *= 0.9995; // slow decay for envelope tracking
        }

        // Gate decision
        const isAboveThreshold = this._envelope > thresholdLin;

        // Smooth gate gain transitions
        if (isAboveThreshold) {
          this._gateGain += attackCoeff * (1 - this._gateGain);
        } else {
          this._gateGain += releaseCoeff * (0 - this._gateGain);
        }

        // Apply gate
        outputChannel[i] = sample * this._gateGain;
      }
    }

    return true;
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
