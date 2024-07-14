import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@convex/_generated/api";
import Markdown from "marked-react";
import DOMPurify from "dompurify";
import {
  Authenticated,
  Unauthenticated,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import dayjs from "dayjs";
import React, { MouseEvent, useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cn } from "./lib/utils";
import { useStickyChat } from "./useStickyChat";
import { toast } from "./components/ui/use-toast";
import { isRateLimitError } from "convex-helpers/server/rateLimit";
import { SignIn, SignOut } from "./SignIn";

export function Chat() {
  const { uuid } = useParams();
  const me = useQuery(api.users.me);
  const threads = useQuery(api.chat.listThreads);
  const navigate = useNavigate();
  useEffect(() => {
    if (!uuid && threads?.length) {
      navigate(`/${threads[0].uuid}`, { replace: true });
    }
  }, [uuid, threads, navigate]);
  const thread = threads?.find((t) => t.uuid === uuid);

  return (
    <div className="flex h-full flex-col justify-between">
      <div className="flex h-[4rem] w-full items-center justify-between bg-my-light-green p-4">
        <h2 className="text-2xl">{thread?.names.join("+")}</h2>
        <Unauthenticated>
          <SignIn />
        </Unauthenticated>
        <Authenticated>
          <div className="flex gap-2">
            {me && me.isAnonymous === false ? (
              <img
                src={me.image}
                alt={me.name}
                title={me.name}
                className="h-8 w-8 rounded-full"
              />
            ) : (
              <div className="text-4xl">{me?.name}</div>
            )}
            <SignOut />
          </div>
        </Authenticated>
      </div>

      <Authenticated>
        {uuid ? (
          <>
            <Messages />
            {thread ? <SendMessage /> : <JoinThread />}
          </>
        ) : null}
      </Authenticated>
      <Unauthenticated>
        <div className="mt-4 p-2 text-center">
          <SignIn />
        </div>
      </Unauthenticated>
    </div>
  );
}

function Messages() {
  const { uuid } = useParams();
  const me = useQuery(api.users.me);
  const {
    results: messages,
    loadMore,
    status,
  } = usePaginatedQuery(api.chat.getThreadMessages, uuid ? { uuid } : "skip", {
    initialNumItems: 20,
  });
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement>();
  const handleScrollContainer = useCallback((node: HTMLDivElement) => {
    setScrollContainer(node);
  }, []);
  const { hasNewMessages, scrollToBottom } = useStickyChat(
    scrollContainer,
    messages,
  );
  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    <div className="relative flex min-h-0 flex-1">
      {hasNewMessages && <NewMessages onClick={scrollToBottom} />}
      <div
        className="flex flex-1 flex-col-reverse items-end space-y-4 overflow-y-auto overflow-x-hidden px-2"
        ref={handleScrollContainer}
      >
        {messages &&
          messages.map((message) =>
            message.role === "system" ? null : (
              <div
                key={message.id}
                className={cn("flex  w-full gap-3", {
                  "flex-row-reverse": message.userId === me?._id,
                })}
              >
                {message.role === "assistant" ? (
                  <span className="my-auto rounded-full bg-my-light-green  p-2 py-1.5 text-2xl">
                    🦙
                  </span>
                ) : message.image ? (
                  <img
                    src={message.image}
                    alt={message.name}
                    title={message.name}
                    className="h-8 w-8 rounded-full"
                  />
                ) : (
                  <span
                    title={message.name}
                    className="my-auto py-1.5 text-3xl"
                  >
                    {message.name}
                  </span>
                )}
                <div
                  className={cn("flex max-w-[80%] flex-col", {
                    "items-end": message.userId === me?._id,
                  })}
                >
                  <div
                    className={cn(
                      message.role === "assistant"
                        ? "bg-my-neutral-sprout dark:bg-my-light-green dark:text-my-light-tusk"
                        : "bg-my-white-baja dark:bg-my-neutral-sprout/80 dark:text-my-dark-green",
                      "max-w-[40vw] rounded-md p-3",
                    )}
                  >
                    <div className="whitespace-break-spaces text-sm">
                      {message.state === "failed"
                        ? "I have failed you ☠️"
                        : message.state === "timedOut"
                          ? "⌛️"
                          : message.state === "pending"
                            ? "waiting for a 🦙..."
                            : (
                                <Markdown>
                                  {message.message
                                    ? DOMPurify.sanitize(message.message)
                                    : "🦙💬"}
                                </Markdown>
                              ) || "..."}
                    </div>
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
            ),
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
  const joinThread = useMutation(api.chat.joinThread);
  return uuid ? (
    <div className="mt-4 flex justify-center p-2">
      <Button
        className="w-full"
        onClick={() =>
          void joinThread({ uuid }).catch((e) => {
            console.error(e);
            if (isRateLimitError(e)) {
              if (e.data.name === "createUser") {
                toast({
                  title: "Sorry, too many people are creating accounts",
                  description: `You can try again in ${dayjs(e.data.retryAt).fromNow()}.`,
                });
              } else {
                toast({
                  title: "You're joining threads too quickly",
                  description: `You can join another in ${dayjs(e.data.retryAt).fromNow()}.`,
                });
              }
            }
          })
        }
      >
        Join
      </Button>
    </div>
  ) : null;
}

function SendMessage() {
  const { uuid } = useParams();
  const [messageToSend, setMessageToSend] = useState("");
  const sendMessage = useMutation(api.chat.sendMessage);
  const sendSubmit = useCallback(
    (e: MouseEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!uuid || !messageToSend) return;
      const message = messageToSend;
      setMessageToSend("");
      sendMessage({ message, model: "llama3", uuid })
        .then((rateLimited) => {
          if (rateLimited) {
            console.error("Rate limited", rateLimited);
            setMessageToSend((messageToSend) => messageToSend || message);
            toast({
              title: "You're sending messages too quickly",
              description: `You can send another in ${dayjs(rateLimited.retryAt).fromNow()}.`,
            });
          }
        })
        .catch((e) => {
          if (isRateLimitError(e)) {
            toast({
              title: "Sorry, too many people are creating accounts",
              description: `You can try again in ${dayjs(e.data.retryAt).fromNow()}.`,
            });
          } else {
            console.error(e);
          }
          setMessageToSend((messageToSend) => messageToSend || message);
        });
    },
    [uuid, messageToSend, sendMessage],
  );

  return (
    <form
      className="mt-4 flex w-full items-center gap-2 p-2"
      onSubmit={sendSubmit}
    >
      <Input
        type="text"
        value={messageToSend}
        onChange={(e) => setMessageToSend(e.target.value)}
        className="flex-1 resize-none bg-my-neutral-sprout dark:bg-my-light-green dark:text-my-light-tusk dark:placeholder-my-dark-green"
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
      className="motion-safe:animate-bounceIn absolute bottom-0 right-10 z-10"
      size="sm"
      type="button"
      onClick={onClick}
    >
      New Messages
    </Button>
  );
}
