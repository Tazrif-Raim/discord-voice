import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  VoiceState,
  CommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  VoiceConnectionStatus,
  AudioPlayerStatus,
  EndBehaviorType,
  VoiceConnection,
  AudioPlayer,
  StreamType,
} from "@discordjs/voice";
import { createVoicePipeline } from "./audio/createVoicePipeline";
import { getGeminiSession, destroyGeminiSession, GeminiLiveSession } from "./gemini/GeminiLiveSession";
import { Readable } from "stream";

// Create Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

// Conversation state machine
type ConversationState = 'IDLE' | 'LISTENING' | 'WAITING_FOR_RESPONSE' | 'PLAYING';

// Store active connections and players
const connections = new Map<string, VoiceConnection>();
const players = new Map<string, AudioPlayer>();
const geminiSessions = new Map<string, GeminiLiveSession>(); // guildId -> GeminiLiveSession
const activeSpeakers = new Map<string, string>(); // guildId -> userId
const activeStreams = new Map<string, any>(); // guildId -> opusStream subscription
const activePipelines = new Map<string, Readable>(); // guildId -> pipeline stream
const conversationStates = new Map<string, ConversationState>(); // guildId -> state

// Bot ready event
client.once("ready", async () => {
  console.log(`Logged in as ${client.user?.tag}!`);

  // Register slash commands
  const commands = [
    new SlashCommandBuilder()
      .setName("join")
      .setDescription("Join your voice channel"),
    new SlashCommandBuilder()
      .setName("leave")
      .setDescription("Leave the voice channel"),
  ];

  try {
    console.log("Registering slash commands...");
    await client.application?.commands.set(commands);
    console.log("Slash commands registered!");
  } catch (error) {
    console.error("Error registering commands:", error);
  }
});

// Handle slash commands
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === "join") {
    await handleJoinCommand(interaction);
  } else if (commandName === "leave") {
    await handleLeaveCommand(interaction);
  }
});

// Handle /join command
async function handleJoinCommand(interaction: CommandInteraction) {
  await interaction.deferReply();

  const member = interaction.member as any;
  const voiceChannel = member?.voice?.channel;

  if (!voiceChannel) {
    await interaction.editReply("You need to be in a voice channel first!");
    return;
  }

  try {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guildId!,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
      debug: true, // Enable debug logging for voice connection
      daveEncryption: false, // Disable DAVE E2EE to avoid decryption issues
    });

    // Store connection
    connections.set(interaction.guildId!, connection);

    // Wait for connection to be ready
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

    // Set up audio player
    const player = createAudioPlayer();
    players.set(interaction.guildId!, player);
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Playing, () => {
      console.log(`▶️ Player started playing for guild ${interaction.guildId}`);
    });

    // Note: AudioPlayerStatus.Idle is handled in setupVoiceReceiver for speaker lock release

    // Start listening to voice
    setupVoiceReceiver(connection, player, interaction.guildId!);

    // Connect to Gemini Live API (persistent session for this guild)
    try {
      const geminiSession = await getGeminiSession(interaction.guildId!, {
        systemInstruction: "You are a helpful and friendly AI voice companion in a Discord voice channel. Your name is \"Bini\". Keep responses concise and conversational.",
      });
      geminiSessions.set(interaction.guildId!, geminiSession);
      conversationStates.set(interaction.guildId!, 'IDLE'); // Initialize state
      console.log(`🧠 Gemini session established for guild ${interaction.guildId}`);
    } catch (error) {
      console.error("Failed to connect to Gemini:", error);
      await interaction.editReply(
        `✅ Joined ${voiceChannel.name}! ⚠️ But failed to connect to Live API.`
      );
      return;
    }

    await interaction.editReply(
      `✅ Joined ${voiceChannel.name}! Ready for voice conversation!`
    );
  } catch (error) {
    console.error("Error joining voice channel:", error);
    await interaction.editReply("❌ Failed to join the voice channel!");
  }
}

// Handle /leave command
async function handleLeaveCommand(interaction: CommandInteraction) {
  await interaction.deferReply();

  const guildId = interaction.guildId!;
  const connection = connections.get(guildId);

  if (!connection) {
    await interaction.editReply("I'm not in a voice channel!");
    return;
  }

  connection.destroy();
  connections.delete(guildId);
  players.delete(guildId);

  // Cleanup Gemini session
  destroyGeminiSession(guildId);
  geminiSessions.delete(guildId);

  // Cleanup active streams and pipelines if any
  const stream = activeStreams.get(guildId);
  if (stream) stream.destroy();
  activeStreams.delete(guildId);
  
  const pipeline = activePipelines.get(guildId);
  if (pipeline) pipeline.destroy();
  activePipelines.delete(guildId);
  
  activeSpeakers.delete(guildId);
  conversationStates.delete(guildId);

  await interaction.editReply("✅ Left the voice channel!");
}

// Set up voice receiver to listen and stream to Gemini
function setupVoiceReceiver(
  connection: VoiceConnection,
  player: AudioPlayer,
  guildId: string
) {
  const receiver = connection.receiver;

  // Clean up resources when player goes idle (finished playing Gemini response)
  player.on(AudioPlayerStatus.Idle, () => {
    const currentState = conversationStates.get(guildId);
    console.log(`🔄 Player idle - current state: ${currentState}`);
    
    // Only clean up if we were in PLAYING state
    if (currentState === 'PLAYING') {
      console.log(`🔄 Player finished playing - ready for next interaction`);
      
      // Destroy the old pipeline stream to clean up event listeners
      const oldPipeline = activePipelines.get(guildId);
      if (oldPipeline) {
        oldPipeline.destroy();
        activePipelines.delete(guildId);
        console.log(`🧹 Destroyed old pipeline for guild ${guildId}`);
      }
      
      // Destroy old opus stream
      const oldStream = activeStreams.get(guildId);
      if (oldStream) {
        try { oldStream.destroy(); } catch (e) { /* ignore */ }
        activeStreams.delete(guildId);
      }
      
      activeSpeakers.delete(guildId);
      conversationStates.set(guildId, 'IDLE');
      console.log(`✅ State -> IDLE - ready for new conversation`);
    }
  });
  
  // Track when player starts playing
  player.on(AudioPlayerStatus.Playing, () => {
    const currentState = conversationStates.get(guildId);
    if (currentState === 'WAITING_FOR_RESPONSE') {
      conversationStates.set(guildId, 'PLAYING');
      console.log(`🔊 State -> PLAYING (Gemini is responding)`);
    }
  });

  receiver.speaking.on("start", async (userId) => {
    // Ignore bot itself
    if (userId === client.user?.id) return;

    const currentState = conversationStates.get(guildId) || 'IDLE';
    console.log(`🎤 Speaking start event - user: ${userId}, state: ${currentState}`);

    // Only accept new speech in IDLE state
    if (currentState !== 'IDLE') {
      console.log(`⏳ Ignoring speech - not in IDLE state (current: ${currentState})`);
      return;
    }

    // Get the persistent Gemini session
    const geminiSession = geminiSessions.get(guildId);
    if (!geminiSession || !geminiSession.connected) {
      console.warn(`🧠 No active Gemini session for guild ${guildId}`);
      return;
    }

    console.log(`🎤 User ${userId} started speaking - setting up pipeline`);
    activeSpeakers.set(guildId, userId);
    conversationStates.set(guildId, 'LISTENING');
    console.log(`🎧 State -> LISTENING`);

    // Subscribe with Manual behavior (no auto-timeout)
    const opusStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.Manual,
      },
    });

    activeStreams.set(guildId, opusStream);

    // Build the pipeline with persistent Gemini session
    const pipelineStream = createVoicePipeline(opusStream, geminiSession);
    activePipelines.set(guildId, pipelineStream); // Track pipeline for cleanup

    // Create resource
    const resource = createAudioResource(pipelineStream, {
      inputType: StreamType.Opus,
    });

    // Play immediately
    player.play(resource);

    // Error handling
    opusStream.on("error", (error) => {
      console.error(`Error in opus stream for ${userId}:`, error);
      releaseSpeaker(guildId, userId);
    });

    pipelineStream.on("error", (error) => {
      console.error(`Error in pipeline stream for ${userId}:`, error);
      releaseSpeaker(guildId, userId);
    });

    // When pipeline ends (Gemini finished responding), clean up
    pipelineStream.on("end", () => {
      console.log(`📤 Pipeline ended for ${userId}`);
    });
  });

  receiver.speaking.on("end", (userId) => {
    if (activeSpeakers.get(guildId) !== userId) return;
    
    const currentState = conversationStates.get(guildId);
    console.log(`🎤 User ${userId} stopped speaking - state: ${currentState}`);
    
    if (currentState === 'LISTENING') {
      conversationStates.set(guildId, 'WAITING_FOR_RESPONSE');
      console.log(`⏳ State -> WAITING_FOR_RESPONSE (Gemini processing...)`);
      
      // Important: Don't destroy the stream yet - let Gemini process the buffered audio
      // The silence after speech helps Gemini's VAD detect end of utterance
    }
  });
}

function releaseSpeaker(guildId: string, userId: string) {
  if (activeSpeakers.get(guildId) === userId) {
    const stream = activeStreams.get(guildId);
    if (stream) {
      try {
        stream.destroy();
      } catch (e) {
        console.error("Error destroying stream", e);
      }
      activeStreams.delete(guildId);
    }
    activeSpeakers.delete(guildId);
  }
}

// Handle disconnection
client.on("voiceStateUpdate", (oldState: VoiceState, newState: VoiceState) => {
  // If bot was disconnected
  if (oldState.member?.id === client.user?.id && !newState.channelId) {
    const guildId = oldState.guild.id;
    const connection = connections.get(guildId);
    if (connection) {
      connection.destroy();
      connections.delete(guildId);
      players.delete(guildId);
      
      // Cleanup Gemini session
      destroyGeminiSession(guildId);
      geminiSessions.delete(guildId);
      
      releaseSpeaker(guildId, activeSpeakers.get(guildId) || "");
    }
  }
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error("❌ DISCORD_TOKEN environment variable is not set!");
  console.log("Please set your bot token: set DISCORD_TOKEN=your_token_here");
  process.exit(1);
}

client.login(token);
