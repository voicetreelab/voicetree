import type {JSX} from "react";
import { type RecorderState } from "@soniox/speech-to-text-web";

interface StatusDisplayProps {
  state: RecorderState;
}

export default function StatusDisplay({ state }: StatusDisplayProps): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-2 h-2 rounded-full ${
          state === "Running"
            ? "bg-green-500 animate-pulse"
            : state === "FinishingProcessing"
            ? "bg-yellow-500"
            : state === "Error"
            ? "bg-red-500"
            : "bg-gray-400"
        }`}
      ></div>
      <span className="text-sm text-gray-600">{state}</span>
    </div>
  );
}
