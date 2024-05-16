import React, { MouseEvent, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { api } from "@convex/_generated/api";
import { Cross2Icon, HamburgerMenuIcon } from "@radix-ui/react-icons";
import { useSessionMutation, useSessionQuery } from "convex-helpers/react/sessions";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Threads } from "./Threads";
import { LlamaStatus } from "./LlamaWorker";
import { useQuery } from "convex/react";
import { Input } from "./components/ui/input";

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
    [navigate, startThread],
  );

  const [searchString, setSearchString] = useState("");
  const searchMessages = useSessionQuery(api.chat.searchMessages, { searchString, });

  return (
    <div className="flex h-screen flex-col bg-my-white-baja dark:bg-black">
      <div className="container flex h-full flex-col overflow-hidden md:flex-row">
        <div className="flex flex-col border-b border-my-dark-green dark:border-my-light-tusk md:w-72 md:border-b-0 md:border-r">
          <div className="flex h-[4rem] justify-between bg-my-light-green p-4">
            <ThreadsMenuButton />
            <h1 className="text-2xl">🦙 farm</h1>
            <div className="flex">
              <Button size="icon" variant="ghost" onClick={startThreadHandler}>
                <PlusIcon className="h-5 w-5" />
              </Button>
            </div>
          </div>
          <div className="p-2 " >
            <Input
              type="text"
              value={searchString}
              onChange={(e) => setSearchString(e.target.value)}
              className="resize-none  bg-my-neutral-sprout dark:bg-my-light-green dark:text-my-light-tusk dark:placeholder-my-dark-green"
              placeholder="Search for a message"
            />
          </div>
          <div className="relative ">
            <ul className="absolute z-50 bg-my-white-baja">{searchMessages?.map((msg) => <li className="border-b-2 border-my-neutral-sprout p-1">{msg.message.length > 100 ? msg.message.slice(0, 100) + ".." : msg.message}</li>)}</ul>
          </div>
          <div></div>
          <div className="hidden flex-1 flex-col md:block">
            <Threads />
          </div>
        </div>
        <div className="flex h-full flex-1 flex-col overflow-hidden border-my-dark-green bg-my-light-tusk dark:bg-my-dark-green md:border-l-0">
          <Outlet />
        </div>
      </div>
      <footer className="container">
        <div className=" flex h-16 items-center justify-between bg-my-light-green">
          <LlamaStatus />
          <div className="h-full justify-end gap-2  p-2">
            <a
              href="https://www.convex.dev/"
              className="no-underline"
              target="_blank"
            >
              <span>Powered by</span>
              <ConvexLogo />
            </a>
          </div>
        </div>
      </footer>
    </div >
  );
}

function ThreadsMenuButton() {
  const [showMenu, setShowMenu] = useState(false);
  const location = useLocation();
  const popoverRef = React.useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setShowMenu(false);
    if (showMenu) popoverRef.current?.click();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  return (
    <Popover onOpenChange={(open) => setShowMenu(open)}>
      <PopoverTrigger ref={popoverRef} asChild>
        <Button
          className="transition-colors hover:bg-my-neutral-sprout dark:hover:bg-my-dark-green md:hidden"
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
