import { Transform, TransformCallback } from "stream";

/**
 * Upsamples 24 kHz mono PCM to 48 kHz using zero-order hold (sample duplication).
 */
export function upsample24to48(): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      const samples = new Int16Array(
        chunk.buffer,
        chunk.byteOffset,
        chunk.byteLength / 2
      );
      const out = new Int16Array(samples.length * 2);

      for (let i = 0, o = 0; i < samples.length; i += 1, o += 2) {
        const s = samples[i];
        out[o] = s;
        out[o + 1] = s;
      }

      callback(null, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
    },
  });
}
