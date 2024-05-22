import { ConvexProvider, ConvexReactClient } from "convex/react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { EmptyPage } from "./EmptyPage";
import { Chat } from "./Chat";
import "./index.css";
import { SessionProvider } from "convex-helpers/react/sessions";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { useLocalStorage } from "usehooks-ts";

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { LlamaWorker, LlamaProvider } from "./LlamaWorker";
import { Toaster } from "./components/ui/toaster";
dayjs.extend(relativeTime);

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

const router = createBrowserRouter(
  [
    {
      path: "/",
      errorElement: <EmptyPage />,
      element: <App />,
      children: [
        {
          path: "/worker",
          element: <LlamaWorker />,
        },
        {
          path: "/:uuid",
          element: <Chat />,
        },
        {
          path: "/",
          element: <EmptyPage />,
        },
      ],
    },
  ],
  { basename: import.meta.env.VITE_BASEPATH },
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ConvexProvider client={convex}>
    <LlamaProvider>
      <SessionProvider useStorage={useLocalStorage}>
        <RouterProvider router={router} />
        <Toaster />
      </SessionProvider>
    </LlamaProvider>
  </ConvexProvider>,
);
