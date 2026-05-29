import { useCallback, useState, type ReactNode } from "react";
import { AppSidebar, type SidebarTab } from "@/components/sidebar/AppSidebar";
import { OverviewPage } from "@/components/overview/OverviewPage";
import { ProjectsPage } from "@/components/projects/ProjectsPage";
import { SessionsPage } from "@/components/sessions/SessionsPage";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { AboutPage } from "@/components/about/AboutPage";
import { ALL_PROJECTS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export default function App() {
  const [tab, setTab] = useState<SidebarTab>("overview");
  const [selectedProject, setSelectedProject] = useState<string>(ALL_PROJECTS);

  const jumpToOverview = useCallback((projectPath: string) => {
    setSelectedProject(projectPath);
    setTab("overview");
  }, []);

  const panels: Record<SidebarTab, ReactNode> = {
    overview: (
      <OverviewPage
        selectedProject={selectedProject}
        onSelectedProjectChange={setSelectedProject}
      />
    ),
    projects: <ProjectsPage onJump={jumpToOverview} />,
    sessions: <SessionsPage />,
    settings: <SettingsPage />,
    about: <AboutPage />,
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex">
      <AppSidebar active={tab} onChange={setTab} />
      <main className="flex-1 min-w-0 overflow-hidden">
        {(Object.keys(panels) as SidebarTab[]).map((key) => (
          <div
            key={key}
            className={cn("h-full w-full", tab === key ? "block" : "hidden")}
          >
            {panels[key]}
          </div>
        ))}
      </main>
    </div>
  );
}
