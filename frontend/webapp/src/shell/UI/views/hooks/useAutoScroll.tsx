import type { Token } from "@soniox/speech-to-text-web";
import { useEffect, useRef } from "react";

export default function useAutoScroll(tokens: Token[]) {
  const ref: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/node_modules/@types/react/index").RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);
  const prevTokenCountRef: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/node_modules/@types/react/index").RefObject<number> = useRef(0);

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
