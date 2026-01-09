import { Transform, TransformCallback } from "stream";

/**
 * Naively downsamples 48 kHz mono PCM to 16 kHz by taking every 3rd sample.
 */
export function downsample48to16(): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      const samples = new Int16Array(
        chunk.buffer,
        chunk.byteOffset,
        chunk.byteLength / 2
      );
      const outLength = Math.floor(samples.length / 3);
      const out = new Int16Array(outLength);

      for (let i = 0, o = 0; o < outLength; i += 3, o += 1) {
        out[o] = samples[i];
      }

      callback(null, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
    },
  });
}
