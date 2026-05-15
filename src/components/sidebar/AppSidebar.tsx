import { Code2, Home, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type SidebarTab = "overview" | "about";

interface NavItem {
  id: SidebarTab;
  label: string;
  icon: typeof Home;
}

const TOP_ITEMS: NavItem[] = [
  { id: "overview", label: "概况", icon: Home },
  { id: "about", label: "关于", icon: Info },
];

interface AppSidebarProps {
  active: SidebarTab;
  onChange: (tab: SidebarTab) => void;
}

export function AppSidebar({ active, onChange }: AppSidebarProps) {
  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = active === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onChange(item.id)}
        className={cn(
          "w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        aria-pressed={isActive}
      >
        <Icon className="size-4 shrink-0" />
        <span className="leading-none">{item.label}</span>
      </button>
    );
  };

  return (
    <aside className="w-[200px] shrink-0 border-r bg-background flex flex-col">
      <div className="flex items-center gap-2 px-4 py-4 border-b">
        <div className="size-8 rounded-md bg-blue-600 text-white flex items-center justify-center">
          <Code2 className="size-4" />
        </div>
        <div className="text-sm font-semibold leading-tight">AI Code Stats</div>
      </div>
      <nav className="flex-1 flex flex-col gap-1 p-2">
        {TOP_ITEMS.map(renderItem)}
      </nav>
    </aside>
  );
}
