import { useState } from "react";
import {
  Settings,
  Download,
  Trash2,
  Moon,
  Sun,
  Info,
  MoreVertical,
  FileText,
  Share2
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface FloatingMenuProps {
  onToggleDarkMode: () => void;
  onClearHistory: () => void;
  isDarkMode: boolean;
}

export default function FloatingMenu({
  onToggleDarkMode,
  onClearHistory,
  isDarkMode
}: FloatingMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="fixed right-4 top-1/2 -translate-y-1/2 z-50"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "flex flex-col gap-1 p-3 rounded-l-xl",
              "bg-card/80 hover:bg-card",
              "border-l border-t border-b border-border",
              "shadow-md hover:shadow-lg",
              "transition-all duration-200",
              "focus:outline-none"
            )}
          >
            <MoreVertical className="h-4 w-4 text-muted-foreground" />
            <Settings className="h-4 w-4 text-muted-foreground" />
            <FileText className="h-4 w-4 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          side="left"
          align="center"
          className="w-56"
        >
          <DropdownMenuItem onClick={onToggleDarkMode}>
            {isDarkMode ? (
              <>
                <Sun className="mr-2 h-4 w-4" />
                <span>Light Mode</span>
              </>
            ) : (
              <>
                <Moon className="mr-2 h-4 w-4" />
                <span>Dark Mode</span>
              </>
            )}
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => console.log("Settings")}>
            <Settings className="mr-2 h-4 w-4" />
            <span>Settings</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => console.log("Export")}>
            <Download className="mr-2 h-4 w-4" />
            <span>Export Data</span>
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => console.log("Share")}>
            <Share2 className="mr-2 h-4 w-4" />
            <span>Share</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={onClearHistory}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            <span>Clear History</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => console.log("About")}>
            <Info className="mr-2 h-4 w-4" />
            <span>About VoiceTree</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}