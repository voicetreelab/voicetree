import React from "react";

export interface Tab {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface TabViewProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

// borderBottomColor: "#00ff85",
export default function TabView({
  tabs,
  activeTab,
  onTabChange,
}: TabViewProps) {
  return (
    <div>
      <div className="flex flex-row justify-between">
        <img src="/soniox.svg" alt="Soniox Logo" className="w-24 h-auto" />
        {/* Tab Navigation */}
        <div className="flex justify-center border-gray-200">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`px-4 py-2 font-medium text-xl border-b-4 mb-2 transition-colors ${
                activeTab === tab.id
                  ? "border-[#00ff85] text-white"
                  : "border-transparent text-white hover:text-white-700"
              }`}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div>{tabs.find((tab) => tab.id === activeTab)?.content}</div>
    </div>
  );
}
