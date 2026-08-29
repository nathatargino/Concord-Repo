/**
 * EchoFilter – removes voice-chat echo from screen-share loopback audio.
 *
 * When sharing with system audio (loopback), ALL system sounds are captured,
 * including the remote participants' voices playing through the speakers.
 * This filter subtracts the known remote voice streams (inverted and
 * delay-compensated) from the loopback signal so peers no longer hear
 * themselves.
 *
 * The cancellation reduces echo energy significantly (~10-20 dB) even though
 * perfect phase alignment isn't guaranteed due to variable DAC / driver latency.
 */

interface RemoteSource {
  source: MediaStreamAudioSourceNode;
  delay: DelayNode;
  gain: GainNode;
}

export class EchoFilter {
  private ctx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private loopbackSource: MediaStreamAudioSourceNode | null = null;
  private remoteSources: RemoteSource[] = [];
  private processedTrack: MediaStreamTrack | null = null;

  /**
   * Build the filter graph and return a *processed* audio track that has the
   * remote voice streams subtracted from the loopback.
   *
   * @param loopbackTrack  – raw loopback audio track from getDisplayMedia
   * @param remoteStreams   – current remote voice MediaStreams (peerId → stream)
   * @param remoteGainValues – optional map of peerId → current gain value (0-1)
   *                           so we can match the volume the speakers are playing
   * @returns processed MediaStreamTrack, or the original if no remotes / on error
   */
  start(
    loopbackTrack: MediaStreamTrack,
    remoteStreams: Map<string, MediaStream>,
    remoteGainValues?: Map<string, number>,
  ): MediaStreamTrack {
    try {
      // Use 48 kHz to match WebRTC's preferred sample-rate
      this.ctx = new AudioContext({ sampleRate: 48_000 });
      this.dest = this.ctx.createMediaStreamDestination();

      // ── 1. Loopback passthrough ────────────────────────────────────
      const loopbackOnly = new MediaStream([loopbackTrack]);
      this.loopbackSource = this.ctx.createMediaStreamSource(loopbackOnly);
      this.loopbackSource.connect(this.dest);

      if (remoteStreams.size === 0) {
        this.processedTrack = this.dest.stream.getAudioTracks()[0] ?? null;
        return this.processedTrack ?? loopbackTrack;
      }

      // ── 2. Estimate playback latency ───────────────────────────────
      // outputLatency tells us how long audio takes to reach the DAC.
      // The same latency applies to <audio> elements feeding the speakers,
      // so the loopback capture of those elements is delayed by roughly
      // this amount relative to the raw MediaStream.
      const rawDelay = (this.ctx as any).outputLatency as number | undefined;
      const estimatedDelay = Math.max(rawDelay ?? 0.03, 0.015); // floor 15 ms

      // ── 3. Subtract each remote stream ─────────────────────────────
      remoteStreams.forEach((stream, peerId) => {
        const audioTrack = stream.getAudioTracks()[0];
        if (!audioTrack || audioTrack.readyState === 'ended') return;

        const source = this.ctx!.createMediaStreamSource(new MediaStream([audioTrack]));

        // Align with the loopback capture delay
        const delay = this.ctx!.createDelay(1.0);
        delay.delayTime.value = estimatedDelay;

        // Invert the signal. Use -0.8 instead of -1 to avoid over-cancellation
        // artifacts when the delay estimate isn't perfectly aligned.
        // If we know the actual gain applied to this user's audio, scale accordingly.
        const userGain = remoteGainValues?.get(peerId) ?? 1;
        const invertGain = this.ctx!.createGain();
        invertGain.gain.value = -0.8 * userGain;

        source.connect(delay);
        delay.connect(invertGain);
        invertGain.connect(this.dest!);

        this.remoteSources.push({ source, delay, gain: invertGain });
      });

      this.processedTrack = this.dest.stream.getAudioTracks()[0] ?? null;
      return this.processedTrack ?? loopbackTrack;
    } catch (err) {
      console.warn('[EchoFilter] Initialisation failed, using raw loopback:', err);
      this.dispose();
      return loopbackTrack;
    }
  }

  /** Tear down the entire filter graph and release resources. */
  dispose(): void {
    for (const r of this.remoteSources) {
      try { r.source.disconnect(); } catch { /* */ }
      try { r.delay.disconnect(); } catch { /* */ }
      try { r.gain.disconnect(); } catch { /* */ }
    }
    this.remoteSources = [];

    try { this.loopbackSource?.disconnect(); } catch { /* */ }
    this.loopbackSource = null;

    try { this.dest?.disconnect(); } catch { /* */ }
    this.dest = null;

    if (this.ctx) {
      this.ctx.close().catch(() => { /* */ });
      this.ctx = null;
    }

    this.processedTrack = null;
  }
}
