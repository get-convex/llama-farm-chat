# llama farm

Local LLM workers backing a hosted AI Chat (with streaming)

Featuring:

- [Ollama](https://ollama.com/) for `llama3` or other models.
- [Convex](https://convex.dev/) for the backend & laptop client work queue.
- All TypeScript with shared types between the workers, web UI, and backend.
- Vite for a Chat UI to show how it works.

This project allows you to run a cloud-hosted website backed by LLMs running on
local machines that are **not** exposed to public internet traffic.

- Run as many local machines as you want to increase throughput.
- Requests will be pulled by local machines from the work queue.
- Each client currently runs one request at a time locally.

## How it works

     🧑‍💻💬👩‍💻💬👨‍💻💬  Users
        \ | /
         🌐  Convex w/ DB: messages, users, workers, jobs, api keys, etc.
         / \
        |  |  Websocket to pull jobs
       💻 💻 ...  Convex client on a laptop / fly.io / etc.
       🦙 🦙 ...  Ollama running llama3

- There's a hosted website with a ChatGPT-like UI.
- The website subscribes to a Convex backend for application data.
- When a user makes a request to Convex that requires an LLM, a job is put in a work queue.
- Each laptop / machine runs Ollama locally along with a Convex client subscribing to new work
  - Each worker has their own API key to authenticate requests.
- When there's work to do, it requests a job transactionally (no two clients will work on the same request at once).
- When the job is done, it posts the response back to the Convex backend.
- If the response is streaming, it sends partial results as it goes.
- The client's subscription automatically updates as the data changes (automatic Convex behavior).
- While a job is in progress, the worker will periodically let the server know it's still working.
- If the job fails, it tries to report the failure. In these cases we can retry by re-submitting to the queue.
- If the worker doesn't report progress after a grace period, the server will mark the request as failed.
  - It currently doesn't issue retries, since the nature of GPT chat is that after
    a minute of waiting, a user has probably moved on or sent another message.
- When the worker is killed, it stops subscribing to work. Other active workers will continue.
  - Note: It doesn't exit cleanly right now (the request it is working on will time out),
    but it wouldn't be hard to add if you need it.
- If requests come in faster than they can be processed, a queue will develop.
  - This allows the system to handle bursts of requests, but also means users may wait a long time.
  - It wouldn't be hard to implement an algorithm that meets your needs to shed load: e.g. CoDel.

## Setup

### 1. Install Ollama and start it.

https://ollama.com/

### 2. Run Convex & your webapp locally

Later we'll show you how to run the frontend in the cloud, but to iterate it's
easier to work on the UI locally. [Convex](https://convex.dev) will run in the
cloud by default. Read below for details on
[running everything locally](#running-everything-locally).

```sh
npm i
npm run dev
```

This will involve signing up for if you don't already have an account.
Note: you don't have to run this on every machine

### 3. Start a worker client to process requests from your site

1. For each client (laptop), you'll need to get an API key:

   ```sh
   npx convex dev --once --configure # If you haven't configured the
   npx convex run workers:signMeUp # Optional parameter: '{ "name": "laptop A" }'
   > "your-uuid"
   ```

   Save the value in `.env.local`:

   ```sh
   WORKER_API_KEY="your-uuid"
   ```

2. Install [bun](https://bun.sh) if you don't already have it.

3. From the root of this repo, run:
   ```sh
   npm run worker
   ```
   This subscribes to the work queue and runs commands against Ollama.

### 4. Host your webapp in the cloud

Follow [these docs](https://docs.convex.dev/production) to deploy your webapp
to production. At a high level there's a few steps:

1. Deploying your web app to
   [Netlify](https://docs.convex.dev/production/hosting/netlify) /
   [Vercel](https://docs.convex.dev/production/hosting/vercel) / Amplify / etc.
   and optionally connect a custom domain.
2. As part of your build, it will do a `npx convex deploy` which pushes to prod.
3. Re-issue API keys for the production deployment:

   ```sh
   # The JSON argument is optional but useful for tracking devices.
   npx convex run --prod workers:signMeUp '{ "name": "laptop A" }'
   ```

   Or copy all your data from dev with `npx convex export --path dev.zip` and `npx convex import dev.zip --prod`.
   Make sure to update your workers to use the new convex URL & api key
   It pulls them from env variables `VITE_CONVEX_URL`, `WORKER_API_KEY`, and saves them to .env.local
   so if you're running your worker from the same repo you develop from, your worker will hit the dev backend
   unless you edit `VITE_CONVEX_URL=https://my-animal-123.convex.cloud` in `.env`.

### Running everything locally (including the Convex backend)

You can run the [open source backend locally](https://stack.convex.dev/developing-with-the-oss-backend).

I've simplified the setup to download and run the binary with:

```sh
# You need to have just installed: https://github.com/casey/just
just run-local-backend
```

This will override the url that the frontend uses to talk to the backend in .env.local
and sync your code to the local backend.

You can then change your package.json scripts from `convex dev ...` to `just convex dev ...` and
the normal commands `npm run dev` will work. To run other Convex commands, swap `npx` for `just`:
e.g. `just convex run ...` instead of `npx convex run ...`.

The Justfile has some smart logic to switch between the local backend and cloud based on whether
your VITE_CONVEX_URL is pointing to a cloud address, so you can just comment/uncomment those
to switch back and forth.

### Revoking API keys

- You can see API keys by going to the [Convex dashboard](https://dashboard.convex.dev/)
  or running `npx convex data workers`.
- You can revoke a single key by manually deleting the row and re-issuing a key.
- You can refresh (revoke & re-issue) a single key from the CLI:
  ```sh
  npx convex run --prod workers:refreshMyKey '{ "apiKey": "your-uuid" }'
  ```
  **Note**: having access to the API key is not sufficient to refresh it. You have to
  also have Convex credentials for the deployment, either through the CLI login,
  dashboard login, or a `CONVEX_DEPLOY_KEY` environment variable.
- If these keys are all leaked, you can clear them all from the dashboard or with:
  ```sh
  npx convex import --table workers --replace --format jsonLines /dev/null
  ```
