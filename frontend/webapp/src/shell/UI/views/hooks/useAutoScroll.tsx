import type { Token } from "@soniox/speech-to-text-web";
import { useEffect, useRef, type RefObject } from "react";

export default function useAutoScroll(tokens: Token[]): RefObject<HTMLDivElement | null> {
  const ref: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);
  const prevTokenCountRef: RefObject<number> = useRef(0);

  useEffect(() => {
    const currentTokenCount: number = tokens.length;

    // Only auto-scroll if we have NEW tokens (length increased)
    if (currentTokenCount > prevTokenCountRef.current) {
      ref.current?.scrollTo({
        top: ref.current.scrollHeight,
        behavior: "smooth",
      });

      // Update the previous count
      prevTokenCountRef.current = currentTokenCount;
    }
  }, [tokens.length]); // Depend on LENGTH, not the array reference

  return ref;
}
