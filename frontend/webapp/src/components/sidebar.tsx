import { useState, useEffect } from "react";

interface SidebarProps {
  children: React.ReactNode;
}

export default function Sidebar({ children }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Listen for custom toggle event
  useEffect(() => {
    const handleToggle = () => setIsOpen(prev => !prev);
    window.addEventListener('toggleSidebar', handleToggle);
    return () => window.removeEventListener('toggleSidebar', handleToggle);
  }, []);

  const menuItems = [
    { id: "voicetree", label: "VoiceTree", icon: "🌳" },
    { id: "transcribe", label: "Transcribe", icon: "🎤" },
    { id: "translate", label: "Translate", icon: "🌐" },
    { id: "settings", label: "Settings", icon: "⚙️" },
  ];

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 bg-white shadow-xl transform transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        } w-64`}
      >
        {/* Sidebar Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-xl font-semibold text-gray-800">VoiceTree</h2>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="p-4 space-y-2">
          {menuItems.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100 transition-colors text-gray-700 hover:text-gray-900"
            >
              <span className="text-xl">{item.icon}</span>
              <span className="font-medium">{item.label}</span>
            </a>
          ))}
        </nav>

        {/* Sidebar Footer */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t">
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">VoiceTree © 2024</span>
          </div>
        </div>
      </div>

      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Main Content Area */}
      <div className="flex-1">
        {children}
      </div>
    </div>
  );
}