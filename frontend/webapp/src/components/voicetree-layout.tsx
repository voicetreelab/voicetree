import { useState, useEffect, useRef, useCallback } from "react";
import useVoiceTreeClient from "@/hooks/useVoiceTreeClient";
import getAPIKey from "@/utils/get-api-key";
import { type Token } from "@soniox/speech-to-text-web";
import SpeedDialMenu from "./speed-dial-menu";

interface HistoryEntry {
  id: string;
  text: string;
  timestamp: Date;
  source: 'speech' | 'text';
}

const MAX_HISTORY_ENTRIES = 50;
const HISTORY_STORAGE_KEY = 'voicetree-history';

export default function VoiceTreeLayout() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const lastSentText = useRef<string>("");

  const {
    finalTokens,
  } = useVoiceTreeClient({
    apiKey: getAPIKey,
  });

  // Dark mode management
  useEffect(() => {
    const isDark = localStorage.getItem('darkMode') === 'true';
    setIsDarkMode(isDark);
    if (isDark) {
      document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleDarkMode = () => {
    const newDarkMode = !isDarkMode;
    setIsDarkMode(newDarkMode);
    localStorage.setItem('darkMode', String(newDarkMode));
    if (newDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  // Load history from localStorage on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        const historyWithDates = parsed.map((entry: HistoryEntry & { timestamp: string }) => ({
          ...entry,
          timestamp: new Date(entry.timestamp)
        }));
        setHistory(historyWithDates);
      } catch (err) {
        console.warn('Failed to load history from localStorage:', err);
        localStorage.removeItem(HISTORY_STORAGE_KEY);
      }
    }
  }, []);

  // Save history to localStorage whenever it changes
  useEffect(() => {
    if (history.length > 0) {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    }
  }, [history]);

  // Extract text from tokens for display
  const getTranscriptText = (tokens: Token[]): string => {
    return tokens
      .filter(token => token.text !== "<end>")
      .map(token => token.text)
      .join("");
  };

  // Add entry to history with limit management
  const addToHistory = useCallback((text: string, source: 'speech' | 'text') => {
    const newEntry: HistoryEntry = {
      id: `${Date.now()}-${Math.random()}`,
      text,
      timestamp: new Date(),
      source
    };

    setHistory(prev => {
      const updated = [...prev, newEntry];
      if (updated.length > MAX_HISTORY_ENTRIES) {
        return updated.slice(updated.length - MAX_HISTORY_ENTRIES);
      }
      return updated;
    });
  }, []);

  // Clear all history
  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(HISTORY_STORAGE_KEY);
  };

  // Send text to VoiceTree
  const sendToVoiceTree = useCallback(async (text: string, source: 'speech' | 'text' = 'text') => {
    if (!text.trim() || text === lastSentText.current) return;

    lastSentText.current = text;

    // Always add to history, regardless of server status
    addToHistory(text, source);

    try {
      const response = await fetch("http://localhost:8000/send-text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      if (response.ok) {
        await response.json(); // Server response handled but result not used to avoid warnings
      } else {
        console.error(`Server error: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      console.error("Error sending to VoiceTree:", err);
      console.error("Cannot connect to VoiceTree server (http://localhost:8000)");
    }
  }, [addToHistory]);

  // Continuously send final tokens to server
  useEffect(() => {
    const currentText = getTranscriptText(finalTokens);
    if (currentText && currentText !== lastSentText.current) {
      sendToVoiceTree(currentText, 'speech');
    }
  }, [finalTokens, sendToVoiceTree]);

  return (
    <div className="h-screen bg-background overflow-hidden relative">
      {/* Hamburger Menu Button - Top Left */}
      <button
        onClick={() => {
          // Trigger sidebar open - will need to pass this up or use context
          const event = new CustomEvent('toggleSidebar');
          window.dispatchEvent(event);
        }}
        className="fixed top-4 left-4 z-50 p-2 rounded-lg hover:bg-accent transition-colors"
        aria-label="Toggle menu"
      >
        <svg className="w-6 h-6 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>


      {/* Main Canvas Area (for future cytoscape.js) */}
      <div className="pt-28 h-full">
        <div className="h-full flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <svg
              className="w-24 h-24 mx-auto mb-4 opacity-20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            >
              <circle cx="12" cy="12" r="3" />
              <circle cx="6" cy="6" r="2" />
              <circle cx="18" cy="6" r="2" />
              <circle cx="6" cy="18" r="2" />
              <circle cx="18" cy="18" r="2" />
              <path d="M12 9 L6 6" />
              <path d="M12 9 L18 6" />
              <path d="M12 15 L6 18" />
              <path d="M12 15 L18 18" />
            </svg>
            <p className="text-sm">Graph visualization will appear here</p>
            <p className="text-xs text-muted-foreground/60 mt-2">Powered by Cytoscape.js</p>
          </div>
        </div>
      </div>

      {/* Speed Dial Menu */}
      <SpeedDialMenu
        onToggleDarkMode={toggleDarkMode}
        onClearHistory={clearHistory}
        isDarkMode={isDarkMode}
      />
    </div>
  );
}