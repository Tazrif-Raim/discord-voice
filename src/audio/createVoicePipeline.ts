import { Readable } from "stream";
import { downmixStereoToMono } from "./dsp/downmixStereoToMono";
import { downsample48to16 } from "./dsp/downsample48to16";
import { upmixMonoToStereo } from "./dsp/upmixMonoToStereo";
import { upsample24to48 } from "./dsp/upsample24to48";
import { opusDecoder } from "./opusDecoder";
import { opusEncoder } from "./opusEncoder";
import { geminiLiveStream } from "../gemini/GeminiLiveStream";

/**
 * Creates a real-time voice pipeline:
 * Discord Opus (48k stereo) → Opus Decoder → PCM 48k stereo → Downmix (stereo → mono) → PCM 48k mono → Downsample (48k → 16k) → PCM 16k mono → Gemini Live → PCM 24k mono → Upsample (24k → 48k) → PCM 48k mono → Upmix (mono → stereo) → PCM 48k stereo → Opus Encoder → Discord Voice
 */
export function createVoicePipeline(opusStream: Readable): Readable {
  return opusStream
    .pipe(opusDecoder())
    .pipe(downmixStereoToMono())
    .pipe(downsample48to16())
    .pipe(geminiLiveStream())
    .pipe(upsample24to48())
    .pipe(upmixMonoToStereo())
    .pipe(opusEncoder());
}
