import { ConvexProvider, ConvexReactClient } from "convex/react";
import React from "react";
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
dayjs.extend(relativeTime);

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <App />,
      children: [
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
  { basename: import.meta.env.VITE_BASEPATH }
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      <SessionProvider useStorage={useLocalStorage}>
        <RouterProvider router={router} />
      </SessionProvider>
    </ConvexProvider>
  </React.StrictMode>
);
