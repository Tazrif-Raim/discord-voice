import { GoogleGenAI, Modality, Session } from "@google/genai";
import { EventEmitter } from "events";
import { GEMINI_INPUT_AUDIO_CONFIG } from "../audio/audio.constants";

const MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

export interface GeminiLiveSessionConfig {
  systemInstruction?: string;
}

/**
 * Manages a persistent Gemini Live API session.
 * Handles WebSocket connection, audio streaming, and response handling.
 */
export class GeminiLiveSession extends EventEmitter {
  private ai: GoogleGenAI;
  private session: Session | null = null;
  private isConnected = false;
  private config: GeminiLiveSessionConfig;
  private responseQueue: Buffer[] = [];
  private messageLoopRunning = false;

  constructor(config: GeminiLiveSessionConfig = {}) {
    super();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not set");
    }
    this.ai = new GoogleGenAI({ apiKey });
    this.config = config;
  }

  /**
   * Connect to Gemini Live API
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      console.log("🧠 Gemini session already connected");
      return;
    }

    console.log("🧠 Connecting to Gemini Live API...");

    try {
      this.session = await this.ai.live.connect({
        model: MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: this.config.systemInstruction || "You are a helpful and friendly AI assistant, your name is \"Bini.\" Keep responses concise and conversational.",
        },
        callbacks: {
          onopen: () => {
            console.log("🧠 Connected to Gemini Live API");
            this.isConnected = true;
            this.emit("connected");
          },
          onmessage: (message: any) => {
            this.handleMessage(message);
          },
          onerror: (error: any) => {
            console.error("🧠 Gemini Live API error:", error.message || error);
            this.emit("error", error);
          },
          onclose: (event: any) => {
            console.log("🧠 Gemini Live API connection closed:", event?.reason || "Unknown reason");
            this.isConnected = false;
            this.session = null;
            this.emit("disconnected");
          },
        },
      });

      // Start message processing loop
      this.startMessageLoop();
    } catch (error) {
      console.error("🧠 Failed to connect to Gemini Live API:", error);
      throw error;
    }
  }

  /**
   * Handle incoming messages from Gemini
   */
  private handleMessage(message: any): void {
    // Handle interruption - clear audio queue
    if (message.serverContent?.interrupted) {
      console.log("🧠 Gemini interrupted - clearing audio queue");
      this.responseQueue.length = 0;
      this.emit("interrupted");
      return;
    }

    // Handle model turn with audio parts
    if (message.serverContent?.modelTurn?.parts) {
      for (const part of message.serverContent.modelTurn.parts) {
        if (part.inlineData?.data) {
          // Decode base64 audio data
          const audioBuffer = Buffer.from(part.inlineData.data, "base64");
          this.responseQueue.push(audioBuffer);
        }
      }
    }

    // Handle turn complete
    if (message.serverContent?.turnComplete) {
      console.log("🧠 Gemini turn complete");
      this.emit("turnComplete");
    }
  }

  /**
   * Start the message processing loop
   */
  private startMessageLoop(): void {
    if (this.messageLoopRunning) return;
    this.messageLoopRunning = true;

    const processQueue = () => {
      if (!this.isConnected) {
        this.messageLoopRunning = false;
        return;
      }

      while (this.responseQueue.length > 0) {
        const chunk = this.responseQueue.shift()!;
        this.emit("audio", chunk);
      }

      setImmediate(processQueue);
    };

    processQueue();
  }

  /**
   * Send PCM audio data to Gemini
   * @param pcmData - 16-bit PCM, 16kHz, mono audio buffer
   */
  private audioChunkCount = 0;
  
  sendAudio(pcmData: Buffer): void {
    if (!this.session || !this.isConnected) {
      console.warn("🧠 Cannot send audio - not connected");
      return;
    }

    // Convert to base64 for API
    const base64Audio = pcmData.toString("base64");

    try {
      this.session.sendRealtimeInput({
        audio: {
          data: base64Audio,
          mimeType: `audio/pcm;rate=${GEMINI_INPUT_AUDIO_CONFIG.rate}`,
        },
      });
      
      // Log every 50 chunks (about 1 second of audio) to reduce noise
      this.audioChunkCount++;
      if (this.audioChunkCount % 50 === 0) {
        console.log(`📡 Gemini WebSocket: sent ${this.audioChunkCount} audio chunks`);
      }
    } catch (error) {
      console.error("🧠 Error sending audio to Gemini:", error);
    }
  }

  /**
   * Disconnect from Gemini Live API
   */
  disconnect(): void {
    if (this.session) {
      console.log("🧠 Disconnecting from Gemini Live API...");
      this.session.close();
      this.session = null;
      this.isConnected = false;
      this.responseQueue.length = 0;
      this.messageLoopRunning = false;
    }
  }

  /**
   * Check if session is connected
   */
  get connected(): boolean {
    return this.isConnected;
  }
}

// Session manager for multiple guilds
const sessions = new Map<string, GeminiLiveSession>();

/**
 * Get or create a Gemini Live session for a guild
 */
export async function getGeminiSession(guildId: string, config?: GeminiLiveSessionConfig): Promise<GeminiLiveSession> {
  let session = sessions.get(guildId);
  
  if (!session || !session.connected) {
    session = new GeminiLiveSession(config);
    sessions.set(guildId, session);
    await session.connect();
  }
  
  return session;
}

/**
 * Destroy a Gemini Live session for a guild
 */
export function destroyGeminiSession(guildId: string): void {
  const session = sessions.get(guildId);
  if (session) {
    session.disconnect();
    sessions.delete(guildId);
  }
}
