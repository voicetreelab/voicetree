import { useState } from "react";
import {
  Settings,
  Download,
  Trash2,
  Moon,
  Sun,
  Info
} from "lucide-react";
import { cn } from "@/lib/utils";

interface MenuItem {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  className?: string;
}

interface RadialMenuProps {
  onToggleDarkMode: () => void;
  onClearHistory: () => void;
  isDarkMode: boolean;
}

export default function RadialMenu({
  onToggleDarkMode,
  onClearHistory,
  isDarkMode
}: RadialMenuProps) {
  const [isHovered, setIsHovered] = useState(false);

  const menuItems: MenuItem[] = [
    {
      icon: isDarkMode ? Sun : Moon,
      label: isDarkMode ? "Light Mode" : "Dark Mode",
      onClick: onToggleDarkMode,
      className: "hover:bg-primary/20"
    },
    {
      icon: Settings,
      label: "Settings",
      onClick: () => console.log("Settings clicked"),
      className: "hover:bg-primary/20"
    },
    {
      icon: Download,
      label: "Export",
      onClick: () => console.log("Export clicked"),
      className: "hover:bg-primary/20"
    },
    {
      icon: Trash2,
      label: "Clear History",
      onClick: onClearHistory,
      className: "hover:bg-destructive/20"
    },
    {
      icon: Info,
      label: "About",
      onClick: () => console.log("About clicked"),
      className: "hover:bg-primary/20"
    }
  ];

  return (
    <div
      className="fixed right-4 top-1/2 -translate-y-1/2 z-50"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Menu Items - Semicircle layout */}
      <div className={cn(
        "absolute right-0 top-1/2 -translate-y-1/2 transition-all duration-300",
        isHovered ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      )}>
        {menuItems.map((item, index) => {
          const angle = -180 + (index * 36); // Spread items in a semicircle on the left
          const radius = 70; // Distance from center
          const x = Math.cos(angle * Math.PI / 180) * radius;
          const y = Math.sin(angle * Math.PI / 180) * radius;

          return (
            <button
              key={index}
              onClick={() => {
                item.onClick();
              }}
              className={cn(
                "absolute right-0 top-1/2 -translate-y-1/2 p-2 rounded-full",
                "bg-card border shadow-lg",
                "transition-all duration-300 group",
                "hover:scale-110",
                item.className
              )}
              style={{
                transform: isHovered
                  ? `translate(${x}px, ${y}px) scale(1)`
                  : 'translate(0, 0) scale(0)',
                transitionDelay: isHovered ? `${index * 30}ms` : '0ms'
              }}
            >
              <div className="flex items-center gap-2">
                <item.icon className="h-4 w-4" />
                <span className={cn(
                  "absolute right-full mr-2 px-2 py-1 rounded-md",
                  "bg-popover text-popover-foreground text-sm",
                  "opacity-0 group-hover:opacity-100 transition-opacity",
                  "whitespace-nowrap shadow-lg border"
                )}>
                  {item.label}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Hover Trigger Area - Small icons on right edge */}
      <div className="flex flex-col gap-2">
        {!isHovered && menuItems.slice(0, 3).map((item, index) => (
          <div
            key={index}
            className={cn(
              "p-2 rounded-l-lg",
              "bg-card/80 border-l border-t border-b",
              "text-muted-foreground",
              "transition-all duration-200"
            )}
          >
            <item.icon className="h-4 w-4" />
          </div>
        ))}
      </div>
    </div>
  );
}