import dayjs from "dayjs";
import { Button } from "@/components/ui/button";
import { api } from "@convex/_generated/api";
import {
  useSessionMutation,
  useSessionQuery,
} from "convex-helpers/react/sessions";
import { Link, useNavigate, useParams } from "react-router-dom";
import { cn } from "./lib/utils";
import { useStartThread } from "./useStartThread";

export function Threads() {
  const { uuid } = useParams();
  const leaveThread = useSessionMutation(api.chat.leaveThread);
  const threads = useSessionQuery(api.chat.listThreads);
  const navigate = useNavigate();
  const [startThread, startingThread] = useStartThread();
  if (!uuid && threads?.length) {
    navigate(`/${threads[0].uuid}`, { replace: true });
  }

  return (
    <div className="h-full bg-my-neutral-sprout dark:bg-my-dark-green flex-1 flex-col gap-4">
      <div className="flex flex-col gap-2 overflow-y-auto">
        {threads?.length ? (
          threads.map((thread) => (
            <div
              key={thread.uuid}
              className={cn(
                uuid === thread.uuid &&
                  "bg-my-light-tusk dark:bg-my-light-green",
                "group relative items-center flex hover:bg-my-light-tusk dark:hover:bg-my-light-green"
              )}
            >
              <Button
                className="absolute h-8 w-8 hidden group-hover:flex right-2 p-1  transition-colors rounded-full bg-my-light-green/50 dark:bg-my-dark-green/50 text-my-light-tusk dark:text-my-neutral-sprout hover:bg-my-light-green dark:hover:bg-my-dark-green"
                onClick={(e) => {
                  e.preventDefault();
                  const next = threads?.find(
                    (t) => t.uuid !== thread.uuid
                  )?.uuid;
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
          ))
        ) : (
          <Button
            className="mt-4 whitespace-pre-wrap"
            variant={"ghost"}
            disabled={startingThread}
            onClick={startThread}
          >
            Start a new conversation with ➕
          </Button>
        )}
      </div>
    </div>
  );
}

export function XIcon(props: React.ComponentPropsWithoutRef<"svg">) {
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
