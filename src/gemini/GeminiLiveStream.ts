import { Duplex } from "stream";
import { GeminiLiveSession } from "./GeminiLiveSession";
import {
  GEMINI_INPUT_AUDIO_CONFIG,
  GEMINI_OUTPUT_AUDIO_CONFIG,
} from "../audio/audio.constants";

/**
 * Creates a Duplex stream that interfaces with a Gemini Live session.
 *
 * Input: 16-bit PCM, 16kHz, mono (from Discord pipeline)
 * Output: 16-bit PCM, 24kHz, mono (from Gemini)
 *
 * The session must already be connected before creating this stream.
 */
export function geminiLiveStream(session: GeminiLiveSession): Duplex {
  let audioHandler: ((chunk: Buffer) => void) | null = null;
  let isDestroyed = false;

  console.log("🔌 Creating new Gemini Live stream");

  const stream = new Duplex({
    readableHighWaterMark: 1024 * 16,
    writableHighWaterMark: 1024 * 16,

    write(chunk: Buffer, _encoding, callback) {
      // Send PCM audio to Gemini
      if (session.connected && !isDestroyed) {
        console.log(
          "🎤 Sending to Gemini:",
          chunk.length,
          "bytes",
          `${GEMINI_INPUT_AUDIO_CONFIG.rate}Hz`,
          `${GEMINI_INPUT_AUDIO_CONFIG.channels}ch`
        );
        session.sendAudio(chunk);
      }
      callback();
    },

    read() {
      // Reading is driven by the audio event handler
    },

    destroy(error, callback) {
      console.log("🔌 Destroying Gemini Live stream");
      isDestroyed = true;
      // Clean up event listener
      if (audioHandler) {
        session.removeListener("audio", audioHandler);
        audioHandler = null;
      }
      callback(error);
    },
  });

  // Listen for audio from Gemini and push to readable side
  audioHandler = (chunk: Buffer) => {
    if (isDestroyed) return;
    console.log(
      "🔊 Received from Gemini:",
      chunk.length,
      "bytes",
      `${GEMINI_OUTPUT_AUDIO_CONFIG.rate}Hz`,
      `${GEMINI_OUTPUT_AUDIO_CONFIG.channels}ch`
    );
    stream.push(chunk);
  };

  session.on("audio", audioHandler);

  // Handle session disconnection
  session.once("disconnected", () => {
    if (!isDestroyed) {
      stream.push(null); // End the stream
    }
  });

  // Handle interruptions - could emit an event if needed
  session.on("interrupted", () => {
    console.log("🔇 Audio interrupted by Gemini");
  });

  return stream;
}
