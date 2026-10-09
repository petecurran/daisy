// Tiny event bus: the audio side announces what's happening; the visuals listen.
//   note {note, vel, preset, loop}   noteoff {note}   drum {sound, vel}
//   knob {index, page, value}         pad {index, down}   step {inBar, barSteps}
//   chord {name}   solo {part, note, vel, dur, expr, frac, sweepSec, color, square} (Claude's solos)

const listeners = new Map();

export const bus = {
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  },
  emit(type, data) {
    for (const fn of listeners.get(type) || []) fn(data);
  },
  // Emit when audio scheduled for context time `t` actually plays.
  emitAt(ctx, t, type, data) {
    const ms = (t - ctx.currentTime) * 1000;
    if (ms <= 1) bus.emit(type, data);
    else setTimeout(() => bus.emit(type, data), ms);
  },
};
