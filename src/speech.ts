import fs from "fs";
import speech from "@google-cloud/speech";
import ffmpeg from "fluent-ffmpeg";

const client = new speech.SpeechClient();

const config = {
  encoding: "LINEAR16" as const,
  sampleRateHertz: 44100,
  languageCode: "ja-JP",
};

const ffmpegSync = (fileName: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const newFileName = fileName + ".mono.wav";
    ffmpeg()
      .input(fileName)
      .inputFormat("s32le")
      .outputOptions(["-map_channel", "0.0.0", newFileName])
      .save(newFileName)
      .on("end", () => {
        resolve(newFileName);
      })
      .on("error", (err) => {
        reject(new Error(err.message));
      });
  });
};

export const recognize_from_b64 = async (b64: string) => {
  const api_endpoint = process.env.API_ENDPOINT
  const api_key = process.env.API_KEY
  const initial_response = await fetch(`${api_endpoint}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${api_key}`
    },
    body: JSON.stringify({
      "input": {
        "language": "ja",
        "model": "large-v3",
      "audio_base64": b64
      },
    })
  });
  const job_id = (await initial_response.json()).id;
  let response = null;
  while (response === null) {
    const job_response = await fetch(`${api_endpoint}/status/${job_id}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${api_key}`
      }
    });
    response = await job_response.json();
    if (response.status === "FAILED") {
      throw new Error(response.error);
    }
    if (response.status === "IN_PROGRESS" || response.status === "IN_QUEUE") {
      response = null;
    }
  }
  return response.output.transcription;
};

export const recognize_from_file = async (fileName: string) => {
  const newFileName = await ffmpegSync(fileName);
  const response = await recognize_from_b64(fs.readFileSync(newFileName).toString("base64"));
  fs.unlinkSync(newFileName);
  return response;
};
