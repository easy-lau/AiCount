import { useState } from "react";
import { AppSidebar, type SidebarTab } from "@/components/sidebar/AppSidebar";
import { OverviewPage } from "@/components/overview/OverviewPage";
import { AboutPage } from "@/components/about/AboutPage";
import { cn } from "@/lib/utils";

export default function App() {
  const [tab, setTab] = useState<SidebarTab>("overview");

  return (
    <div className="h-screen w-screen overflow-hidden flex">
      <AppSidebar active={tab} onChange={setTab} />
      <main className="flex-1 min-w-0 overflow-hidden">
        <div
          className={cn("h-full w-full", tab === "overview" ? "block" : "hidden")}
        >
          <OverviewPage />
        </div>
        <div
          className={cn("h-full w-full", tab === "about" ? "block" : "hidden")}
        >
          <AboutPage />
        </div>
      </main>
    </div>
  );
}
