import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@convex/_generated/api";
import { Emojis } from "@shared/config";
import Markdown from "marked-react";
import DOMPurify from "dompurify";
import {
  useSessionIdArg,
  useSessionMutation,
  useSessionQuery,
} from "convex-helpers/react/sessions";
import { usePaginatedQuery } from "convex/react";
import dayjs from "dayjs";
import React, { MouseEvent, useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { cn } from "./lib/utils";
import { useStickyChat } from "./useStickyChat";

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
    <div className="flex h-full flex-col justify-between">
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
    </div>
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
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement>();
  const handleScrollContainer = useCallback((node: HTMLDivElement) => {
    setScrollContainer(node);
  }, []);
  const { hasNewMessages, scrollToBottom } = useStickyChat(
    scrollContainer,
    messages
  );
  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    <div className="flex flex-1 min-h-0 relative">
      {hasNewMessages && <NewMessages onClick={scrollToBottom} />}
      <div
        className="overflow-x-hidden overflow-y-auto flex-1 flex flex-col-reverse items-end px-2 space-y-4"
        ref={handleScrollContainer}
      >
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
                  className={cn("flex flex-col max-w-[80%]", {
                    "items-end": message.userId === me?._id,
                  })}
                >
                  <div
                    className={cn(
                      message.role === "assistant"
                        ? "bg-my-neutral-sprout dark:bg-my-light-green dark:text-my-light-tusk"
                        : "bg-my-white-baja dark:bg-my-neutral-sprout/80 dark:text-my-dark-green",
                      "p-3 rounded-md max-w-[40vw]"
                    )}
                  >
                    <p className="text-sm whitespace-break-spaces">
                      {message.state === "failed"
                        ? "I have failed you ☠️"
                        : message.state === "timedOut"
                          ? "⌛️"
                          : message.state === "pending"
                            ? "waiting for a 🦙..."
                            : (
                                <Markdown>
                                  {message.message? DOMPurify.sanitize(message.message) : "🦙💬"}
                                </Markdown>
                              ) || "..."}
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
    </div>
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
    <form
      className="p-2 mt-4 flex items-center gap-2 w-full"
      onSubmit={sendSubmit}
    >
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

function NewMessages({ onClick }: { onClick(): void }) {
  return (
    <Button
      className="absolute bottom-0 right-10 z-10 motion-safe:animate-bounceIn"
      size="sm"
      type="button"
      onClick={onClick}
    >
      New Messages
    </Button>
  );
}
