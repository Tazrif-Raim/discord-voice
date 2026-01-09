import prism from "prism-media";
import { DISCORD_AUDIO_CONFIG } from "./audio.constants";

export function opusDecoder() {
  return new prism.opus.Decoder({
    rate: DISCORD_AUDIO_CONFIG.rate,
    channels: DISCORD_AUDIO_CONFIG.channels,
    frameSize: DISCORD_AUDIO_CONFIG.frameSize,
  });
}
