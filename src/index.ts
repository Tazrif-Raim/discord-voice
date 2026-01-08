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

// Create Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

// Store active connections and players
const connections = new Map<string, VoiceConnection>();
const players = new Map<string, AudioPlayer>();
const activeSpeakers = new Map<string, string>(); // guildId -> userId
const activeStreams = new Map<string, any>(); // guildId -> opusStream subscription

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

    player.on(AudioPlayerStatus.Idle, () => {
      console.log(`⏹️ Player went idle in guild ${interaction.guildId}`);
    });

    // Start listening to voice
    setupVoiceReceiver(connection, player, interaction.guildId!);

    await interaction.editReply(
      `✅ Joined ${voiceChannel.name}! Ready for real-time streaming.`
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

  // Cleanup active streams if any
  const stream = activeStreams.get(guildId);
  if (stream) stream.destroy();
  activeStreams.delete(guildId);
  activeSpeakers.delete(guildId);

  await interaction.editReply("✅ Left the voice channel!");
}

// Set up voice receiver to listen and repeat
function setupVoiceReceiver(
  connection: VoiceConnection,
  player: AudioPlayer,
  guildId: string
) {
  const receiver = connection.receiver;

  receiver.speaking.on("start", (userId) => {
    // Ignore bot itself
    if (userId === client.user?.id) return;

    // Speaker lock: Ignore if someone else is already speaking
    if (activeSpeakers.has(guildId)) {
      // If it's not the same user, ignore.
      if (activeSpeakers.get(guildId) !== userId) return;

      // If it IS the same user, we check if we already have a stream.
      if (activeStreams.has(guildId)) return;
    }

    console.log(`🎤 User ${userId} started speaking`);
    activeSpeakers.set(guildId, userId);

    // Subscribe with Manual behavior (no auto-timeout)
    const opusStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.Manual,
      },
    });

    activeStreams.set(guildId, opusStream);

    // Build the pipeline
    const pipelineStream = createVoicePipeline(opusStream);

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
  });

  receiver.speaking.on("end", (userId) => {
    // If the active speaker stops, we unlock
    if (activeSpeakers.get(guildId) === userId) {
      console.log(`User ${userId} stopped speaking`);
      releaseSpeaker(guildId, userId);
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
    const connection = connections.get(oldState.guild.id);
    if (connection) {
      connection.destroy();
      connections.delete(oldState.guild.id);
      players.delete(oldState.guild.id);
      releaseSpeaker(
        oldState.guild.id,
        activeSpeakers.get(oldState.guild.id) || ""
      );
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
