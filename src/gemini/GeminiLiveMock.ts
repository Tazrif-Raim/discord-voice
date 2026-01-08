import { Duplex } from "stream";

/**
 * Gemini Live Mock
 * ----------------
 * Acts as a transparent PCM passthrough.
 * This mimics Gemini Live's streaming interface without altering audio.
 *
 * IMPORTANT:
 * - No buffering
 * - No transforms
 * - No async delays
 */
export function geminiLiveMock(): Duplex {
  return new Duplex({
    readableHighWaterMark: 1024,
    writableHighWaterMark: 1024,

    write(chunk, _encoding, callback) {
      // PCM in
      console.log("🧠 Gemini mock received PCM:", chunk.length);

      // Pass through immediately
      this.push(chunk);
      callback();
    },

    read() {
      // No-op: push is driven by write()
    },

    final(callback) {
      this.push(null);
      callback();
    },
  });
}
