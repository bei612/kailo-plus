// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src-tauri/src/huddle/playout.rs and
// mobile/HUDDLES.md (per-peer buffering, mixing, drift bound).
// DD-125(3): the Web playout mixer. Each remote peer has its own PCM queue (decoded 48 kHz mono
// from WebCodecs). A peer starts playing once 3 frames (60 ms) are buffered, keeps at most
// 10 frames (200 ms) by dropping the oldest samples, and its queue is dropped when the peer
// leaves. All peers are summed and clipped into the single output.
const FRAME = 960;
const START_SAMPLES = 3 * FRAME;
const MAX_SAMPLES = 10 * FRAME;

class HuddlePlayoutProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.peers = new Map();
    this.port.onmessage = (e) => {
      const message = e.data;
      if (!message) return;
      if (message.type === "pcm") {
        let peer = this.peers.get(message.peer);
        if (!peer) {
          peer = { chunks: [], offset: 0, buffered: 0, started: false };
          this.peers.set(message.peer, peer);
        }
        peer.chunks.push(message.samples);
        peer.buffered += message.samples.length;
        while (peer.buffered > MAX_SAMPLES && peer.chunks.length > 0) {
          const dropped = peer.chunks.shift();
          peer.buffered -= dropped.length - peer.offset;
          peer.offset = 0;
        }
        if (peer.buffered >= START_SAMPLES) peer.started = true;
      } else if (message.type === "remove") {
        this.peers.delete(message.peer);
      } else if (message.type === "clear") {
        this.peers.clear();
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    output.fill(0);
    for (const peer of this.peers.values()) {
      if (!peer.started) continue;
      let written = 0;
      while (written < output.length && peer.chunks.length > 0) {
        const chunk = peer.chunks[0];
        const take = Math.min(output.length - written, chunk.length - peer.offset);
        for (let i = 0; i < take; i += 1) output[written + i] += chunk[peer.offset + i];
        written += take;
        peer.offset += take;
        peer.buffered -= take;
        if (peer.offset >= chunk.length) {
          peer.chunks.shift();
          peer.offset = 0;
        }
      }
      // Underrun: wait for the startup threshold again rather than crackling.
      if (peer.chunks.length === 0) peer.started = false;
    }
    for (let i = 0; i < output.length; i += 1) {
      const sample = output[i];
      output[i] = sample > 1 ? 1 : sample < -1 ? -1 : sample;
    }
    for (let channel = 1; channel < outputs[0].length; channel += 1) outputs[0][channel].set(output);
    return true;
  }
}

registerProcessor("huddle-playout-processor", HuddlePlayoutProcessor);
