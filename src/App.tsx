import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
dayjs.extend(relativeTime);

import React, { MouseEvent, useCallback, useEffect, useState } from "react";
import { usePaginatedQuery } from "convex/react";

import { Cross2Icon, HamburgerMenuIcon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import { api } from "@convex/_generated/api";
import {
  useSessionIdArg,
  useSessionMutation,
  useSessionQuery,
} from "convex-helpers/react/sessions";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "./lib/utils";
import {
  useNavigate,
  useLocation,
  useParams,
  Link,
  Outlet,
} from "react-router-dom";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "./components/ui/scroll-area";
import { Emojis } from "@shared/config";

export default function App() {
  const navigate = useNavigate();
  const startThread = useSessionMutation(api.chat.startThread);

  const startThreadHandler = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      startThread({})
        .then((uuid) => navigate(`/${uuid}`, { replace: true }))
        .catch(console.error);
    },
    [navigate, startThread]
  );

  return (
    <div className="bg-my-white-baja dark:bg-black">
      <div className="container flex h-screen flex-col md:flex-row max-w-6xl overflow-hidden">
        <div className="flex flex-col md:w-72 md:border-r border-b md:border-b-0 border-my-dark-green dark:border-my-light-tusk">
          <div className="flex h-[4rem] justify-between bg-my-light-green p-4">
            <ThreadsMenuButton />
            <h1 className="text-2xl">🦙 farm</h1>
            <div className="flex">
              <Button size="icon" variant="ghost" onClick={startThreadHandler}>
                <PlusIcon className="w-5 h-5" />
              </Button>
            </div>
          </div>
          <div className="flex-1 flex-col hidden md:block">
            <Threads />
          </div>
        </div>
        <div className="flex-1 overflow-hidden bg-my-light-tusk dark:bg-my-dark-green flex flex-col border-my-dark-green md:border-l-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

function ThreadsMenuButton() {
  const [showMenu, setShowMenu] = useState(false);
  const location = useLocation();
  const popoverRef = React.useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setShowMenu(false);
    if (showMenu) popoverRef.current?.click();
  }, [location]);

  return (
    <Popover onOpenChange={(open) => setShowMenu(open)}>
      <PopoverTrigger ref={popoverRef} asChild>
        <Button
          className="md:hidden hover:bg-my-neutral-sprout dark:hover:bg-my-dark-green transition-colors"
          variant="ghost"
          size="icon"
          onClick={() => setShowMenu(!showMenu)}
        >
          {showMenu ? (
            <Cross2Icon className="h-6 w-6" />
          ) : (
            <HamburgerMenuIcon className="h-6 w-6" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="bg-my-neutral-sprout dark:bg-my-dark-green"
        side="bottom"
        align="start"
      >
        <Threads />
      </PopoverContent>
    </Popover>
  );
}

function Threads() {
  const { uuid } = useParams();
  const leaveThread = useSessionMutation(api.chat.leaveThread);
  const threads = useSessionQuery(api.chat.listThreads);
  const navigate = useNavigate();
  if (!threads) return null;
  if (!uuid && threads.length) {
    navigate(`/${threads[0].uuid}`, { replace: true });
  }

  return (
    <div className="h-full bg-my-neutral-sprout dark:bg-my-dark-green flex-1 flex-col gap-4">
      <div className="flex flex-col gap-2 overflow-y-auto">
        {threads.map((thread) => (
          <div
            key={thread.uuid}
            className={cn(
              uuid === thread.uuid && "bg-my-light-tusk dark:bg-my-light-green",
              "group relative items-center flex hover:bg-my-light-tusk dark:hover:bg-my-light-green"
            )}
          >
            <Button
              className="absolute h-8 w-8 hidden group-hover:flex right-2 p-1  transition-colors rounded-full bg-my-light-green/50 dark:bg-my-dark-green/50 text-my-light-tusk dark:text-my-neutral-sprout hover:bg-my-light-green dark:hover:bg-my-dark-green"
              onClick={(e) => {
                e.preventDefault();
                const next = threads?.find((t) => t.uuid !== thread.uuid)?.uuid;
                leaveThread({ uuid: thread.uuid })
                  .then(() => navigate(`/${next}` || "", { replace: true }))
                  .catch(console.error);
              }}
            >
              <XIcon className="" />
            </Button>
            <Link
              className="flex-1 space-y-1  items-center gap-3 p-3 rounded-md  transition-colors"
              to={`/${thread.uuid}`}
            >
              <p className={cn("text-sm font-medium")}>
                {thread.description || "..."}
              </p>
              <div className="flex  items-center justify-between">
                <p className="text-sm  text-my-dark-green dark:text-my-neutral-sprout line-clamp-1">
                  {thread.names.filter(Boolean).join(" ")}
                </p>
                <span className="group-hover:hidden text-xs text-my-dark-green dark:text-my-neutral-sprout">
                  created {dayjs(thread.createdAt).fromNow()}
                </span>
              </div>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyPage() {
  const navigate = useNavigate();
  const startThread = useSessionMutation(api.chat.startThread);
  const [startingThread, setStartingThread] = useState(false);

  const startThreadHandler = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setStartingThread(true);
      startThread({})
        .then((uuid) => navigate(`/${uuid}`, { replace: true }))
        .then(() => setStartingThread(false))
        .catch(console.error);
    },
    [navigate, startThread]
  );
  return (
    <div className="flex-1 flex flex-col gap-4 items-center justify-center">
      <h2 className="text-4xl">Welcome to llama farm!</h2>
      <p className="text-lg text-center">
        Start a new conversation with one of the 🦙s on our farm. 🧑‍🌾
        <br />
        Send the link 🔗 of a conversation for friends to join 👯.
      </p>
      <pre>
        {"💬🧑‍💻-🌐-🧑‍💻💬"}
        <br />
        {"     / \\ "}
        <br />
        {"   | | | | "}
        <br />
        {"  💻💻💻💻 "}
        <br />
        {"  🦙🦙🦙🦙"}
      </pre>
      <Button
        variant={"default"}
        disabled={startingThread}
        onClick={startThreadHandler}
      >
        Start a new conversation
      </Button>
      <p className="text-lg text-center mt-40">
        All of the responses are generated by <code>llama3</code> running on
        personal computers. <br />
        <span className="text-sm">
          ...without exposing themselves to inbound traffic or requiring load
          balancing, <br />
          using a technique called "work stealing" 🤓
        </span>
        <br />
        Run your own farm to have a group chat with friends augmented with 🦙s,
        <br />
        Or you can use the public farm to start.
      </p>
    </div>
  );
}

export function Chat() {
  const { uuid } = useParams();
  const me = useSessionQuery(api.users.me);
  const updateName = useSessionMutation(api.users.updateName);
  const threads = useSessionQuery(api.chat.listThreads);
  const thread = threads?.find((t) => t.uuid === uuid);
  const shuffleName = useCallback(() => {
    updateName({
      name: Emojis[Math.floor(Math.random() * Emojis.length)],
    }).catch(console.error);
  }, [updateName]);

  return (
    <>
      <div className="flex h-[4rem] items-center justify-between bg-my-light-green p-4 w-full">
        <h2 className="text-2xl">{thread?.names.join("+")}</h2>
        <Button
          size="icon"
          className="text-4xl hover:bg-transparent"
          variant="ghost"
          onClick={shuffleName}
        >
          {me?.name}
        </Button>
      </div>

      {uuid ? (
        <>
          <Messages />
          {thread ? <SendMessage /> : <JoinThread />}
        </>
      ) : null}
    </>
  );
}

function Messages() {
  const { uuid } = useParams();
  const me = useSessionQuery(api.users.me);
  const {
    results: messages,
    loadMore,
    status,
  } = usePaginatedQuery(
    api.chat.getThreadMessages,
    useSessionIdArg(uuid ? { uuid } : "skip"),
    { initialNumItems: 10 }
  );

  return (
    <>
      <div className="relative overflow-x-hidden overflow-y-auto flex-1 flex flex-col-reverse items-end px-2 space-y-4">
        {messages &&
          messages.map((message) =>
            message.role === "system" ? null : (
              <div
                key={message.id}
                className={cn("flex  gap-3 w-full", {
                  "flex-row-reverse": message.userId === me?._id,
                })}
              >
                {message.role === "assistant" ? (
                  <span className="my-auto py-1.5 rounded-full  bg-my-light-green p-2 text-2xl">
                    🦙
                  </span>
                ) : (
                  <span
                    title={message.name}
                    className="my-auto py-1.5 text-3xl"
                  >
                    {message.name}
                  </span>
                )}
                <div
                  className={cn("flex flex-col", {
                    "items-end": message.userId === me?._id,
                  })}
                >
                  <div
                    className={cn(
                      message.role === "assistant"
                        ? "bg-my-neutral-sprout dark:bg-my-light-green dark:text-my-light-tusk"
                        : "bg-my-white-baja dark:bg-my-neutral-sprout/80 dark:text-my-dark-green",
                      "p-3 rounded-md max-w-[80%]"
                    )}
                  >
                    <p className="text-sm whitespace-break-spaces">
                      {message.message ||
                        (message.state === "pending"
                          ? "waiting for a 🦙..."
                          : message.state !== "inProgress"
                            ? "⚠️"
                            : "...")}
                    </p>
                  </div>
                  <div
                    className={cn("flex px-1", {
                      "flex-row-reverse": message.userId === me?._id,
                    })}
                  >
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {dayjs(message.sentAt).fromNow()}
                    </span>
                  </div>
                </div>
              </div>
            )
          )}
        {status === "CanLoadMore" && (
          <Button
            onClick={() => loadMore(10)}
            variant="secondary"
            size="sm"
            className="w-full"
          >
            Load more
          </Button>
        )}
      </div>
    </>
  );
}

function JoinThread() {
  const { uuid } = useParams();
  const joinThread = useSessionMutation(api.chat.joinThread);
  return uuid ? (
    <div className="p-2 mt-4 flex justify-center">
      <Button
        className="w-full"
        onClick={() => void joinThread({ uuid }).catch(console.error)}
      >
        Join
      </Button>
    </div>
  ) : null;
}

function SendMessage() {
  const { uuid } = useParams();
  const [messageToSend, setMessageToSend] = useState("");
  const sendMessage = useSessionMutation(api.chat.sendMessage);
  const sendSubmit = useCallback(
    (e: MouseEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!uuid || !messageToSend) return;
      const message = messageToSend;
      setMessageToSend("");
      sendMessage({ message, model: "llama3", uuid })
        // .then(() => {})
        .catch((e) => {
          console.error(e);
          setMessageToSend((messageToSend) => messageToSend || message);
        });
    },
    [uuid, messageToSend, sendMessage]
  );

  return (
    <form className="p-2 mt-4 flex items-center gap-2" onSubmit={sendSubmit}>
      <Input
        type="text"
        value={messageToSend}
        onChange={(e) => setMessageToSend(e.target.value)}
        className="flex-1 resize-none bg-my-neutral-sprout dark:placeholder-my-dark-green dark:text-my-light-tusk dark:bg-my-light-green"
        placeholder="Type your message..."
      />
      <Send
        type="submit"
        className={
          "my-light-green fill-my-light-green disabled:cursor-not-allowed"
        }
        title={"hi"}
        disabled={!uuid || !messageToSend}
      />
    </form>
  );
}

function Send(props: React.ComponentPropsWithoutRef<"button">) {
  return (
    <button {...props}>
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M1.51 21L22.5 12L1.51 3L1.5 10L16.5 12L1.5 14L1.51 21Z"
          className={props.className}
        />
      </svg>
    </button>
  );
}

function PlusIcon(props: React.ComponentPropsWithoutRef<"svg">) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

function XIcon(props: React.ComponentPropsWithoutRef<"svg">) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
