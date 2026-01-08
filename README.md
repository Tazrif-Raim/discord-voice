# Discord Voice Bot

A Discord bot that can join voice channels, listen to users, and respond using Gemini Live Native Audio.

## Features

- ✅ Join voice channels with `/join` command
- ✅ Leave voice channels with `/leave` command
- ✅ Listen to voice and repeat it back (echo bot)
- ✅ AI voice agent integration using Gemini Live Native Audio

## Setup

### Prerequisites

1. **Node.js** (v16.9.0 or higher)
2. **A Discord Bot Token**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create a new application
   - Go to "Bot" section and create a bot
   - Copy the token
   - Enable these Privileged Gateway Intents:
     - Presence Intent
     - Server Members Intent
     - Message Content Intent

3. **Bot Permissions**
   - When inviting the bot, make sure it has these permissions:
     - Connect (voice)
     - Speak (voice)
     - Use Voice Activity
     - Send Messages
     - Use Slash Commands

### Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up your bot token:
   ```bash
   create a .env file based on .env.example
   ```

4. Run the bot:
   ```bash
   npm start
   ```

## Usage

1. Invite the bot to your Discord server
2. Join a voice channel
3. Use `/join` to make the bot join your channel
4. Start speaking - the bot will repeat what you say!
5. Use `/leave` to make the bot leave the channel

## Development

```bash
# Run in development mode with auto-reload
npm run dev

# Build TypeScript
npm run build

# Run compiled JavaScript
npm run start:prod
```

## How It Works

1. **Voice Connection**: Uses `@discordjs/voice` to connect to Discord voice channels
2. **Audio Receiving**: Listens to user audio streams using Discord's voice receiver
3. **Audio Playback**: Captures audio data and plays it back through the same connection
4. **Execution Flow**: Discord Opus (48k stereo) → Opus Decoder → PCM 48k stereo → Downmix (stereo → mono) → PCM 48k mono → Downsample (48k → 16k) → PCM 16k mono → Gemini Live → PCM 24k mono → Upsample (24k → 48k) → PCM 48k mono → Upmix (mono → stereo) → PCM 48k stereo → Opus Encoder → Discord Voice

## Future Enhancements

- [x] Integrate AI voice assistant (Gemini)
- [x] Add audio processing/filtering
- [ ] Support multiple simultaneous speakers
- [ ] Add voice command recognition
- [ ] Implement audio quality settings
