import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
dayjs.extend(relativeTime);

import { usePaginatedQuery } from "convex/react";
import React, { MouseEvent, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@convex/_generated/api";
import { Cross2Icon, HamburgerMenuIcon } from "@radix-ui/react-icons";
import { Emojis } from "@shared/config";
import {
  useSessionIdArg,
  useSessionMutation,
  useSessionQuery,
} from "convex-helpers/react/sessions";
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { cn } from "./lib/utils";

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
    <div className="bg-my-white-baja flex flex-col dark:bg-black h-screen">
      <div className="container h-full flex flex-col md:flex-row overflow-hidden">
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
      <footer className="container flex h-16 items-center ">
        <div className="p-2 bg-my-light-green w-full h-full flex justify-end gap-2">
          <Link to="https://www.convex.dev/" className="no-underline">
            <span>Powered by</span>
            <ConvexLogo />
          </Link>
        </div>
      </footer>
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
  const scrollViewRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    console.log(
      "scrolling",
      messages?.length,
      scrollViewRef.current?.scrollHeight
    );
    scrollViewRef.current?.scrollTo({
      top: scrollViewRef?.current?.scrollHeight || 0,
      behavior: "smooth",
    });
  }, [messages]);

  return (
    <>
      <ScrollArea className="flex-1" ref={scrollViewRef}>
        <div className="flex flex-col-reverse px-2 mt-4 space-y-4">
          {messages &&
            messages.map((message) =>
              message.role === "system" ? null : (
                <div
                  key={message.id}
                  className={cn("flex  gap-3", {
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
      </ScrollArea>
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

function ConvexLogo() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="126"
      height="20"
      fill="none"
      className="fill-black dark:fill-white"
    >
      <g clipPath="url(#logo_svg__a)">
        <path d="M3.185 17.467Q.358 14.938.358 10 .357 5.063 3.243 2.533 6.125.004 11.127.003q2.075-.001 3.672.305a11.6 11.6 0 0 1 3.055 1.034v5.339q-2.269-1.133-5.15-1.133-2.54 0-3.749 1.01Q7.744 7.57 7.745 10q-.001 2.35 1.192 3.4 1.19 1.054 3.77 1.053 2.73 0 5.19-1.335v5.585q-2.73 1.295-6.807 1.294c-3.388 0-6.02-.844-7.905-2.53M19.538 9.997q0-4.897 2.653-7.448 2.654-2.55 8-2.549c3.59 0 6.273.85 8.058 2.549q2.67 2.549 2.671 7.448 0 9.996-10.73 9.997-10.652.004-10.652-9.997M32.75 13.4q.786-1.055.786-3.4 0-2.307-.786-3.38-.788-1.073-2.56-1.073-1.73.002-2.5 1.073-.768 1.073-.768 3.38 0 2.35.768 3.4.768 1.054 2.5 1.053 1.77-.002 2.56-1.053M42.603.404h6.767l.193 1.458q1.116-.81 2.845-1.336A12.3 12.3 0 0 1 55.985 0q3.422 0 5 1.782c1.051 1.188 1.576 3.02 1.576 5.505v12.305h-7.228V8.055q0-1.296-.558-1.862c-.372-.38-.995-.565-1.867-.565q-.806 0-1.653.385a4.6 4.6 0 0 0-1.424.992v12.587h-7.228zM62.582.405h7.536l3.461 11.252L77.041.405h7.536l-7.192 19.187H69.77zM86.852 17.942c-2.171-1.714-3.187-4.69-3.187-7.903 0-3.13.808-5.708 2.654-7.49S90.976 0 94.526 0q4.898 0 7.71 2.388 2.81 2.39 2.811 6.517v3.362H91.302c.342.998.775 1.72 1.839 2.166q1.598.67 4.45.668 1.703 0 3.47-.282c.415-.068 1.098-.174 1.458-.254v4.665c-1.796.513-4.19.77-6.89.77-3.632-.003-6.605-.343-8.777-2.058m10.601-9.804c0-.95-1.04-2.995-3.129-2.995-1.884 0-3.129 2.013-3.129 2.995z"></path>
        <path d="M110.723 9.836 103.955.405h7.844l13.843 19.187h-7.92l-3.077-4.292-3.078 4.292h-7.883zM117.548.405h7.808l-5.993 8.4-3.965-5.383z"></path>
      </g>
      <defs>
        <clipPath id="logo_svg__a">
          <path d="M0 0h126v20H0z"></path>
        </clipPath>
      </defs>
    </svg>
  );
}
