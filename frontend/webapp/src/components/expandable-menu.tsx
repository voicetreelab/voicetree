import { useState } from "react";
import {
  Settings,
  Download,
  Trash2,
  Moon,
  Sun,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ExpandableMenuProps {
  onToggleDarkMode: () => void;
  onClearHistory: () => void;
  isDarkMode: boolean;
}

export default function ExpandableMenu({
  onToggleDarkMode,
  onClearHistory,
  isDarkMode
}: ExpandableMenuProps) {
  const [isHovered, setIsHovered] = useState(false);

  const menuItems = [
    {
      icon: isDarkMode ? Sun : Moon,
      label: isDarkMode ? "Light Mode" : "Dark Mode",
      onClick: onToggleDarkMode,
      color: "hover:bg-primary/20"
    },
    {
      icon: Settings,
      label: "Settings",
      onClick: () => console.log("Settings"),
      color: "hover:bg-primary/20"
    },
    {
      icon: Download,
      label: "Export",
      onClick: () => console.log("Export"),
      color: "hover:bg-primary/20"
    },
    {
      icon: Trash2,
      label: "Clear History",
      onClick: onClearHistory,
      color: "hover:bg-destructive/20"
    },
    {
      icon: Info,
      label: "About",
      onClick: () => console.log("About"),
      color: "hover:bg-primary/20"
    }
  ];

  return (
    <div
      className="fixed right-0 top-1/2 -translate-y-1/2 z-50"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Menu container */}
      <div className="relative">
        {menuItems.map((item, index) => {
          // Calculate position for semicircle layout
          const totalItems = menuItems.length;
          const angleRange = 180; // semicircle
          const startAngle = -90 - (angleRange / 2);
          const angleStep = angleRange / (totalItems - 1);
          const angle = startAngle + (index * angleStep);
          const radius = isHovered ? 80 : 0;

          // Convert to radians and calculate position
          const radian = (angle * Math.PI) / 180;
          const x = Math.cos(radian) * radius;
          const y = Math.sin(radian) * radius;

          return (
            <button
              key={index}
              onClick={item.onClick}
              className={cn(
                "absolute right-4 top-1/2 -translate-y-1/2",
                "flex items-center gap-2",
                "bg-card border rounded-full shadow-lg",
                "transition-all duration-300 ease-out",
                "group",
                item.color,
                !isHovered && index !== Math.floor(totalItems / 2) && "opacity-0 pointer-events-none"
              )}
              style={{
                transform: `translate(${-x}px, ${y - (index - Math.floor(totalItems / 2)) * 40}px) translateY(-50%)`,
                transitionDelay: isHovered ? `${index * 30}ms` : '0ms',
                padding: isHovered ? '12px' : '8px',
                width: isHovered ? 'auto' : '40px',
                height: isHovered ? 'auto' : '40px',
              }}
            >
              <item.icon className={cn(
                "transition-all duration-300",
                isHovered ? "h-4 w-4" : "h-5 w-5"
              )} />

              {/* Label - only visible when expanded */}
              <span className={cn(
                "overflow-hidden transition-all duration-300 whitespace-nowrap text-sm font-medium",
                isHovered ? "max-w-[100px] opacity-100" : "max-w-0 opacity-0"
              )}>
                {item.label}
              </span>
            </button>
          );
        })}

        {/* Collapsed state - show stacked icons */}
        {!isHovered && (
          <div className="fixed right-4 top-1/2 -translate-y-1/2 flex flex-col gap-2">
            {menuItems.slice(1, 4).map((item, index) => (
              <div
                key={index}
                className="p-2 rounded-full bg-card/50 border shadow-sm"
              >
                <item.icon className="h-4 w-4 text-muted-foreground" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}