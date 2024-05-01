/**
 * v0 by Vercel.
 * @see https://v0.dev/t/K673lo5tOKY
 * Documentation: https://v0.dev/docs#integrating-generated-code-into-your-nextjs-app
 */
import { Button } from "@/components/ui/button";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Link } from "@/components/typography/link";
import { AvatarImage, AvatarFallback, Avatar } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Cross2Icon, GearIcon, HamburgerMenuIcon } from "@radix-ui/react-icons";
import { ja } from "date-fns/locale";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./components/ui/popover";

export default function App() {
  return (
    <div className="bg-my-white-baja">
      <div className="container flex h-screen flex-col md:flex-row max-w-6xl overflow-hidden">
        <div className="flex flex-col  md:w-72 md:border-r border-b md:border-b-0 border-my-dark-green dark:border-my-light-tusk">
          <div className="flex justify-between bg-my-light-green p-4">
            <ThreadsMenuButton />
            <h1 className="text-2xl">🦙 farm</h1>
            <div className="flex">
              <Button size="icon" variant="ghost">
                <PlusIcon className="w-5 h-5" />
              </Button>
              <Button size="icon" variant="ghost">
                <GearIcon className="w-5 h-5" />
              </Button>
            </div>
          </div>
          <div className="flex-1 flex-col hidden md:block">
            <Threads />
          </div>
        </div>
        <div className="flex-1 h-screen bg-my-light-tusk dark:bg-my-dark-green flex flex-col border-my-dark-green md:border-l-0">
          <div className="flex items-center justify-between bg-my-light-green p-4 w-full">
            <h2 className="text-2xl ">Group</h2>
            <Button size="icon" variant="ghost">
              <MoreHorizontalIcon className="w-5 h-5" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="px-2 mt-4 space-y-4">
              <div className="flex gap-3">
                <span
                  className="my-auto py-1.5 rounded-full bg-my-neutral-sprout p-2 text-4xl"
                  title="ian"
                >
                  🦙
                </span>
                <div className="bg-my-white-baja dark:bg-my-neutral-sprout dark:text-my-dark-green p-3 rounded-md max-w-[80%]">
                  <p className="text-sm">
                    Attached the latest design files. alksjdflsjkasldkjfas;l hey
                    hey
                    <br />
                    hey
                    <br />
                    hey
                  </p>
                  hey
                  <br />
                </div>
              </div>
              <div className="flex flex-row-reverse  gap-3">
                <span className="my-auto py-1.5 rounded-full bg-my-light-green p-2 text-2xl">
                  IM
                </span>
                <div className="bg-my-neutral-sprout dark:bg-my-light-green dark:text-my-light-tusk p-3 rounded-md max-w-[80%]">
                  <p className="text-sm">
                    Looks good, thanks for sending those over!
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Avatar>
                  <AvatarImage src="/placeholder-user.jpg" />
                  <AvatarFallback>MJ</AvatarFallback>
                </Avatar>
                <div className="bg-my-white-baja dark:bg-my-neutral-sprout dark:text-my-dark-green p-3 rounded-md max-w-[80%]">
                  <p className="text-sm">
                    Let me know if you have any other questions!
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="p-2 mt-4 flex items-center gap-2">
            <Textarea
              className="flex-1 resize-none   bg-my-neutral-sprout dark:placeholder-my-dark-green dark:text-my-light-tusk dark:bg-my-light-green"
              placeholder="Type your message..."
            />
            <Send
              className={
                "my-light-green fill-my-light-green disabled:cursor-not-allowed"
              }
              title={"hi"}
              disabled
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ThreadsMenuButton() {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <Popover onOpenChange={(open) => setShowMenu(open)}>
      <PopoverTrigger asChild>
        <Button
          className="md:hidden hover:bg-my-neutral-sprout dark:hover:bg-my-dark-green transition-colors"
          variant="ghost"
          size="icon"
          // onClick={() => setShowMenu(!showMenu)}
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

function MoreHorizontalIcon(props: any) {
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
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}

function Send(props: any) {
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

function PlusIcon(props: any) {
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

function Threads() {
  return (
    <div className="h-full bg-my-neutral-sprout dark:bg-my-dark-green flex-1 flex-col gap-4">
      <div className="flex flex-col gap-2 overflow-y-auto">
        <Link
          className="flex items-center gap-3 p-3 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          href="#"
        >
          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">John Doe</h3>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                2h ago
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-1">
              Hey, did you see the latest update?
            </p>
          </div>
        </Link>
        <Link
          className="flex items-center gap-3 p-3 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          href="#"
        >
          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Sarah Anderson</h3>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                4h ago
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-1">
              I think we should discuss the project timeline.
            </p>
          </div>
        </Link>
        <Link
          className="flex items-center gap-3 p-3 rounded-md bg-my-light-tusk dark:bg-my-light-green transition-colors"
          href="#"
        >
          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between">
              <h3 className="text-sm  font-medium">Michael Johnson</h3>
              <span className="text-xs text-my-dark-green">6h ago</span>
            </div>
            <p className="text-sm text-my-dark-green line-clamp-1">
              Attached the latest design files.
            </p>
          </div>
        </Link>
        <Link
          className="flex items-center gap-3 p-3 rounded-md hover:bg-my-light-tusk dark:hover:bg-my-light-green transition-colors"
          href="#"
        >
          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Lisa Wilson</h3>
              <span className="text-xs text-my-dark-green dark:text-my-neutral-sprout">
                8h ago
              </span>
            </div>
            <p className="text-sm text-my-dark-green dark:text-my-neutral-sprout line-clamp-1">
              Let's discuss the new feature proposal.
            </p>
          </div>
        </Link>
      </div>{" "}
    </div>
  );
}
