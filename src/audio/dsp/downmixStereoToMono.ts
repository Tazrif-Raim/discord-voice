import { Transform, TransformCallback } from "stream";

/**
 * Downmixes 48 kHz stereo PCM (16-bit LE) to mono by averaging channels.
 */
export function downmixStereoToMono(): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      const samples = new Int16Array(
        chunk.buffer,
        chunk.byteOffset,
        chunk.byteLength / 2
      );
      const out = new Int16Array(samples.length / 2);

      for (let i = 0, o = 0; i < samples.length; i += 2, o += 1) {
        const l = samples[i];
        const r = samples[i + 1];
        out[o] = (l + r) / 2;
      }

      callback(null, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
    },
  });
}
