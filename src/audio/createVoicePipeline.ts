import prism from "prism-media";
import { Readable } from "stream";
import { geminiLiveMock } from "../gemini/GeminiLiveMock";

export const AUDIO_CONFIG = {
  rate: 48000,
  channels: 2,
  frameSize: 960,
};

/**
 * Creates a real-time voice pipeline:
 * Opus → PCM → Gemini → PCM → Opus
 *
 * DO NOT BUFFER AUDIO.
 */
export function createVoicePipeline(opusStream: Readable): Readable {
  const decoder = new prism.opus.Decoder({
    rate: AUDIO_CONFIG.rate,
    channels: AUDIO_CONFIG.channels,
    frameSize: AUDIO_CONFIG.frameSize,
  });

  const encoder = new prism.opus.Encoder({
    rate: AUDIO_CONFIG.rate,
    channels: AUDIO_CONFIG.channels,
    frameSize: AUDIO_CONFIG.frameSize,
  });

  decoder.on("data", (pcm) => {
    console.log("🔊 PCM flowing:", pcm.length);
  });

  return opusStream.pipe(decoder).pipe(geminiLiveMock()).pipe(encoder);
}
