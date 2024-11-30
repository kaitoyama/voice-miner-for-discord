import dotenv from "dotenv";
import fs from "fs";
import { Readable } from "stream";
import {Client, GatewayIntentBits, Partials, Snowflake,Events,ChannelType} from "discord.js";
import { VoiceConnection,joinVoiceChannel,EndBehaviorType,createAudioPlayer  } from "@discordjs/voice";
import { OpusEncoder } from "@discordjs/opus";
import { recognize_from_b64, recognize_from_file } from "./speech";
import prism from "prism-media";

dotenv.config();

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildBans,
		GatewayIntentBits.GuildEmojisAndStickers,
		GatewayIntentBits.GuildIntegrations,
		GatewayIntentBits.GuildWebhooks,
		GatewayIntentBits.GuildInvites,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.GuildPresences,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildMessageReactions,
		GatewayIntentBits.GuildMessageTyping,
		GatewayIntentBits.DirectMessages,
		GatewayIntentBits.DirectMessageReactions,
		GatewayIntentBits.DirectMessageTyping,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildScheduledEvents,
	],
	partials: [
		Partials.User,
		Partials.Channel,
		Partials.GuildMember,
		Partials.Message,
		Partials.Reaction,
		Partials.GuildScheduledEvent,
		Partials.ThreadMember,
	],
});

client.login(process.env.DISCORD_BOT_TOKEN);

let voiceConnections = new Map<Snowflake, VoiceConnection>();

const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);

client.on("ready", () => {
  console.log("Ready...");
});

const start_command = ["議事録取って", "議事録開始", "!start"];
const stop_command = ["議事録とめて", "議事録終了", "!stop"];

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild) return;

  if (start_command.includes(message.content)) {
    if (message.member && message.member.voice.channel) {
      if (message.member.voice.channel.type === ChannelType.GuildStageVoice){
        message.reply("ステージチャンネルでは使えません");
        return;
      }
      const connection = await joinVoiceChannel({
        channelId: message.member.voice.channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });
      voiceConnections.set(message.guild.id, connection);
      connection.playOpusPacket(SILENCE_FRAME);
      const receiver = connection.receiver;
      receiver.speaking.on("start", (userId) => {
        const user = client.users.cache.get(userId);
        const audioStream = receiver.subscribe(userId, {
          end: {
            behavior: EndBehaviorType.AfterSilence,
            duration: 1000,
          },
        });
    
        const encoder = new OpusEncoder(48000, 2);
        const opusDecoder = new prism.opus.Decoder({
          frameSize: 960,
          channels: 2,
          rate: 48000,
        });
        const writeStream = fs.createWriteStream('temp.pcm');
        audioStream.pipe(opusDecoder).pipe(writeStream)
        let buffer: Buffer[] = []; 
        audioStream.once("end", async () => {
          audioStream.destroy();
          // close write stream
          writeStream.end();
          // pcm convert to mp3
          const pcmBuffer = fs.readFileSync('temp.pcm');
          
          // calculate duration
          const duration = pcmBuffer.length / 48000 / 4;
          console.log("duration: " + duration)
          if (duration > 5){
            // copy file output.pcm
            fs.copyFileSync('temp.pcm', 'output.pcm');
            // convert to mp3
            const ffmpeg = require('fluent-ffmpeg');
            ffmpeg('output.pcm')
              .inputFormat('s32le')
              .audioFrequency(48000)
              .audioChannels(2)
              .audioCodec('libmp3lame')
              .on('end', async () => {
                // base64 encode
                const bytes = Buffer.from(fs.readFileSync('output.mp3')).toString("base64");
                // save as file
                const result = await recognize_from_b64(bytes);
                console.log(result);
                if (user){
                  message.channel.send(`${user.username}@${message.member?.voice.channel?.name}: ${result}`);
                }
              })
              .save('output.mp3');
          }
        });
          
      });
    } else {
      message.reply("ボイスチャンネルに入ってから言ってくださる？");
    }
  } else if (stop_command.includes(message.content)) {
    const connection = voiceConnections.get(message.guild.id);
    if (connection) {
      connection.disconnect();
      voiceConnections.delete(message.guild.id);
    }
  }
});

setInterval(() => {
  voiceConnections.forEach((value, key) => {
    value.playOpusPacket(SILENCE_FRAME);
  });
}, 10000);
