import { MouseEvent, useCallback, useState } from "react";
import { api } from "@convex/_generated/api";
import { useSessionMutation } from "convex-helpers/react/sessions";
import { useNavigate } from "react-router-dom";

export function useStartThread() {
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
  return [startThreadHandler, startingThread] as const;
}
