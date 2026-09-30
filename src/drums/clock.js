// Sends MIDI clock (24 ticks per beat) to the MPK so its arpeggiator and note repeat follow our
// tempo. Runs all the time, not just while the drums play, because with an external clock source
// the MPK's arp stops completely when clock stops.

const LOOKAHEAD = 0.12;
const TICK_MS = 20;
const ROUND_TRIP_MS = 4; // clock out -> arp note back in over USB

export class MidiClock {
  constructor(ctx, getBpm) {
    this.ctx = ctx;
    this.getBpm = getBpm;
    this.output = null;
    this.next = ctx.currentTime + 0.05;
    setInterval(() => this.tick(), TICK_MS);
  }

  setOutput(output) { this.output = output; }

  // Re-phase so clock ticks line up with a drum step at audio time t.
  align(t) { this.next = t; }

  // Audio-clock time -> the performance.now() time a MIDI message should leave, early enough
  // that the arp note it causes is *heard* at time t alongside the drums.
  toSendTime(t) {
    const ts = this.ctx.getOutputTimestamp();
    const heardAt = ts.performanceTime + (t - ts.contextTime) * 1000;
    const inputToEar = ((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000;
    return heardAt - inputToEar - ROUND_TRIP_MS;
  }

  tick() {
    const tickDur = 60 / this.getBpm() / 24;
    const now = this.ctx.currentTime;
    if (this.next < now - 0.1) this.next = now; // page was asleep; don't burst-send the backlog
    while (this.next < now + LOOKAHEAD) {
      if (this.output) {
        try {
          this.output.send([0xf8], Math.max(performance.now(), this.toSendTime(this.next)));
        } catch { this.output = null; }
      }
      this.next += tickDur;
    }
  }
}
