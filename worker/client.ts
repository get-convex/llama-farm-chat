import inquirer from "inquirer";
import dotenv from "dotenv";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { retryWithBackoff } from "@shared/llm";
import { CONFIG, completions, pullOllama } from "./ollama";
import { appendFile } from "fs";
import { doWork, waitForWork } from "@shared/worker";

dotenv.config({ path: [".env", ".env.local"] });

async function main() {
  const key = process.env.WORKER_API_KEY?.replace('"', "") || undefined;
  const url = process.env.VITE_CONVEX_URL || undefined;
  const answers = await inquirer.prompt(
    [
      {
        type: "input",
        name: "convexUrl",
        message: ".convex.cloud URL?",
      },
      {
        type: "input",
        name: "apiKey",
        message: "Worker API key?",
      },
    ],
    { apiKey: key, convexUrl: url },
  );
  const { apiKey, convexUrl } = answers;
  if (!key) {
    appendFile(".env", `\nWORKER_API_KEY=${apiKey}\n`, (err) => {
      if (err) throw err;
      console.log("Saved WORKER_API_KEY to .env");
    });
  }
  if (!url) {
    appendFile(".env", `\nVITE_CONVEX_URL=${convexUrl}\n`, (err) => {
      if (err) throw err;
      console.log("Saved VITE_CONVEX_URL to .env");
    });
  }
  if (!apiKey || !convexUrl) {
    throw new Error(
      "Missing environment variables WORKER_API_KEY or CONVEX_URL",
    );
  }
  const client = new ConvexClient(convexUrl);
  console.log("Loading llama3...");
  await retryWithBackoff(async () => {
    try {
      const resp = await pullOllama(CONFIG.chatModel);
      console.log(await resp.text());
    } catch (e) {
      console.error(e);
      throw { error: String(e), retry: true };
    }
  });
  console.log("Loaded ✅");
  for (;;) {
    console.debug("Waiting for work...");
    await waitForWork(client);
    console.debug("Attempting work...");
    let work = await client.mutation(api.workers.giveMeWork, { apiKey });
    while (work) {
      const start = Date.now();
      work = await doWork(work, client, apiKey, completions, CONFIG.chatModel);
      console.log("Finished:", Date.now() - start, "ms");
    }
  }
}
main().then(console.log).catch(console.error);
