import { ConvexReactClient } from "convex/react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { EmptyPage } from "./EmptyPage";
import { Chat } from "./Chat";
import "./index.css";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { LlamaWorker, LlamaProvider } from "./LlamaWorker";
import { Toaster } from "./components/ui/toaster";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
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
  <ConvexAuthProvider client={convex}>
    <LlamaProvider>
      <RouterProvider router={router} />
      <Toaster />
    </LlamaProvider>
  </ConvexAuthProvider>,
);
