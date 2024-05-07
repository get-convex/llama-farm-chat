import { useCallback, useEffect, useState } from "react";
import { usePrevious } from "react-use";

type UseStickyChat = {
  hasNewMessages: boolean;
  scrollToBottom: () => void;
};

type Message = any;
export function useStickyChat(
  scrollContainer?: HTMLDivElement,
  messages?: Message[]
): UseStickyChat {
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [scrollTop, setScrollTop] = useState<number>();

  const scrollToBottom = useCallback(() => {
    if (scrollContainer) {
      scrollContainer.scroll({
        behavior: "smooth",
        left: scrollContainer.scrollLeft,
        top: scrollContainer.scrollHeight,
      });
    }
  }, [scrollContainer]);

  const isStuck =
    // Is the scroll element scrolled to the bottom?
    messages
      ? scrollContainer && (scrollTop === undefined || scrollTop === 0)
      : true;

  // Keep track of scroll position.
  useEffect(() => {
    function updateScrollPosition() {
      setScrollTop(scrollContainer?.scrollTop);
    }
    scrollContainer &&
      scrollContainer.addEventListener("scroll", updateScrollPosition);

    return function cleanup() {
      scrollContainer?.removeEventListener("scroll", updateScrollPosition);
    };
  }, [scrollContainer]);

  // Enforce stickiness.
  useEffect(() => {
    if (isStuck) {
      scrollToBottom();
    }
  }, [messages, isStuck, scrollToBottom]);

  const previousMessages = usePrevious(messages);
  useEffect(() => {
    if (isStuck) {
      setHasNewMessages(false);
    }
  }, [isStuck]);
  // Keep track of whether the scrollbar is stuck to the bottom.
  useEffect(() => {
    if (previousMessages !== messages) {
      setHasNewMessages(!isStuck);
    }
  }, [previousMessages, messages, isStuck]);

  return {
    hasNewMessages,
    scrollToBottom,
  };
}
