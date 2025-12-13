import type { Token } from "@soniox/speech-to-text-web";
import { useEffect, useRef, type RefObject } from "react";

export default function useAutoScroll(tokens: Token[]): RefObject<HTMLDivElement | null> {
  const ref: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({
      top: ref.current.scrollHeight,
      behavior: "smooth",
    });
  }, [tokens]);

  return ref;
}
