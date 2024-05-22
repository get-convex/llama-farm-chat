import { MouseEvent, useCallback, useState } from "react";
import { api } from "@convex/_generated/api";
import { useSessionMutation } from "convex-helpers/react/sessions";
import { isRateLimitError } from "convex-helpers/server/rateLimit";
import { useNavigate } from "react-router-dom";
import { toast } from "./components/ui/use-toast";
import dayjs from "dayjs";

export function useStartThread() {
  const navigate = useNavigate();
  const startThread = useSessionMutation(api.chat.startThread);
  const [startingThread, setStartingThread] = useState(false);

  const startThreadHandler = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (startingThread) return;
      setStartingThread(true);
      startThread({})
        .then((uuid) => navigate(`/${uuid}`, { replace: true }))
        .catch((e) => {
          if (isRateLimitError(e)) {
            if (e.data.name === "createUser") {
              toast({
                title: "Sorry, too many people are creating accounts",
                description: `You can try again in ${dayjs(e.data.retryAt).fromNow()}.`,
              });
            } else {
              toast({
                title: "You're creating chat groups too quickly",
                description: `You can create another in ${dayjs(e.data.retryAt).fromNow()}.`,
              });
            }
          } else {
            console.error(e);
          }
        })
        .finally(() => setStartingThread(false));
    },
    [navigate, startThread, startingThread],
  );
  return [startThreadHandler, startingThread] as const;
}
