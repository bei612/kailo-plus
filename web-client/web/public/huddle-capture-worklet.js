// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/public/worklet.js (SttTapProcessor).
// DD-125(3): the original capture tap, unchanged in behaviour. Accumulates mono Float32 PCM and
// posts 960-sample (20 ms at 48 kHz) frames to the main thread, where the Web host encodes them
// with WebCodecs Opus. When `transmitting` is false (muted, or push-to-talk released) incoming
// frames are discarded and the buffer is reset, so nothing is encoded or sent.
class HuddleCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(960);
    this.offset = 0;
    this.transmitting = true;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === "ptt") {
        this.transmitting = e.data.active;
      }
    };
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    if (!this.transmitting) {
      this.offset = 0;
      return true;
    }
    const remaining = this.buffer.length - this.offset;
    const toCopy = Math.min(input.length, remaining);
    this.buffer.set(input.subarray(0, toCopy), this.offset);
    this.offset += toCopy;
    if (this.offset >= this.buffer.length) {
      this.port.postMessage(this.buffer, [this.buffer.buffer]);
      this.buffer = new Float32Array(960);
      this.offset = 0;
      if (toCopy < input.length) {
        const leftover = input.subarray(toCopy);
        this.buffer.set(leftover);
        this.offset = leftover.length;
      }
    }
    return true;
  }
}

registerProcessor("huddle-capture-processor", HuddleCaptureProcessor);
