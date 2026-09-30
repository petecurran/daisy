// Web MIDI input. Normalises raw messages into simple events for the rest of the app.

export async function connectMidi(handlers) {
  if (!navigator.requestMIDIAccess) throw new Error('This browser has no Web MIDI. Use Chromium.');
  const access = await navigator.requestMIDIAccess({ sysex: false });

  const attach = () => {
    const names = [];
    handlers.onOutputs?.([...access.outputs.values()]);
    for (const input of access.inputs.values()) {
      input.onmidimessage = (e) => handle(e.data, input.name);
      names.push(input.name);
    }
    handlers.onDevices?.(names);
  };

  const handle = (data, source) => {
    const [status, d1, d2] = data;
    const type = status & 0xf0;
    const channel = status & 0x0f;
    handlers.onRaw?.({ type, channel, d1, d2, source });
    if (type === 0x90 && d2 > 0) handlers.onNoteOn?.(d1, d2, channel);
    else if (type === 0x80 || (type === 0x90 && d2 === 0)) handlers.onNoteOff?.(d1, channel);
    else if (type === 0xb0) handlers.onCC?.(d1, d2, channel);
    else if (type === 0xe0) handlers.onPitchBend?.((((d2 << 7) | d1) - 8192) / 8192, channel);
  };

  access.onstatechange = attach;
  attach();
  return access;
}
