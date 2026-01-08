import { Transform, TransformCallback } from "stream";
import { GEMINI_INPUT_AUDIO_CONFIG, GEMINI_OUTPUT_AUDIO_CONFIG } from "../audio/audio.constants";

function upsample16to24Mono(chunk: Buffer): Buffer {
  const samples = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 2);
  const out = new Int16Array(Math.ceil(samples.length * 1.5));

  let o = 0;
  for (let i = 0; i + 1 < samples.length; i += 2) {
    const s0 = samples[i];
    const s1 = samples[i + 1];
    out[o++] = s0;
    out[o++] = (s0 + s1) / 2;
    out[o++] = s1;
  }

  if (samples.length % 2 === 1) {
    out[o++] = samples[samples.length - 1];
  }

  return Buffer.from(out.buffer, out.byteOffset, o * 2);
}

/**
 * Gemini Live Mock
 * ----------------
 * Logs PCM flow and up-samples 16 kHz mono to 24 kHz mono to mimic Gemini output.
 */
export function geminiLiveStream(): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      console.log(
        "🧠 Gemini mock received PCM:",
        chunk.length,
        "bytes",
        `${GEMINI_INPUT_AUDIO_CONFIG.rate}Hz`,
        `${GEMINI_INPUT_AUDIO_CONFIG.channels}ch`
      );

      const upsampled = upsample16to24Mono(chunk);

      console.log(
        "🧠 Gemini mock returning PCM:",
        upsampled.length,
        "bytes",
        `${GEMINI_OUTPUT_AUDIO_CONFIG.rate}Hz`,
        `${GEMINI_OUTPUT_AUDIO_CONFIG.channels}ch`
      );

      callback(null, upsampled);
    },
  });
}
