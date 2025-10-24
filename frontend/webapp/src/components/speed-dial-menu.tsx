import { useState } from "react";
import { Settings, Download, Moon, Sun, Info } from "lucide-react";
import "./speed-dial-menu.css";

interface SpeedDialMenuProps {
  onToggleDarkMode: () => void;
  isDarkMode: boolean;
  onExport?: () => void;
}

export default function SpeedDialMenu({
  onToggleDarkMode,
  isDarkMode,
  onExport
}: SpeedDialMenuProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const menuItems = [
    {
      icon: isDarkMode ? Sun : Moon,
      label: isDarkMode ? "Light Mode" : "Dark Mode",
      onClick: onToggleDarkMode,
      className: ""
    },
    {
      icon: Settings,
      label: "Settings",
      onClick: () => console.log("Settings"),
      className: ""
    },
    {
      icon: Download,
      label: "Backup & Reset",
      onClick: () => onExport?.(),
      className: ""
    },
    {
      icon: Info,
      label: "About",
      onClick: () => console.log("About"),
      className: ""
    }
  ];

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const containerHeight = rect.height;

    // Find which item is closest to mouse position
    const itemHeight = containerHeight / menuItems.length;
    const closestIndex = Math.floor(mouseY / itemHeight);
    setHoveredIndex(Math.min(Math.max(0, closestIndex), menuItems.length - 1));
  };

  return (
    <div
      className="speed-dial-container"
      data-testid="speed-dial-container"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoveredIndex(null)}
    >
      {menuItems.map((item, index) => {
        const Icon = item.icon;
        // Calculate distance from hovered item
        const distance = hoveredIndex !== null ? Math.abs(hoveredIndex - index) : 999;
        const isNearHover = distance <= 1; // Item is hovered or adjacent

        // Calculate scale based on distance
        const scale = hoveredIndex !== null
          ? (distance === 0 ? 1.2 : distance === 1 ? 1.1 : 1.0)
          : 1.0;

        return (
          <button
            key={index}
            onClick={item.onClick}
            className={`speed-dial-item speed-dial-item-${index} ${item.className} ${
              isNearHover ? 'speed-dial-item-near' : ''
            } ${hoveredIndex === index ? 'speed-dial-item-hovered' : ''}`}
            data-testid={`speed-dial-item-${index}`}
            aria-label={item.label}
            style={{
              '--distance': distance,
              '--scale': scale,
            } as React.CSSProperties}
          >
            <Icon className="speed-dial-icon" />
            <span className="speed-dial-label">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}