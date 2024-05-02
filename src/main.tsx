import { ConvexProvider, ConvexReactClient } from "convex/react";
import React from "react";
import ReactDOM from "react-dom/client";
import App, { Chat } from "./App";
import "./index.css";
import { SessionProvider } from "convex-helpers/react/sessions";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        path: "/:uuid",
        element: <Chat />,
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </ConvexProvider>
  </React.StrictMode>
);
