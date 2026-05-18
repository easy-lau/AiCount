import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OverviewQuery } from "@/types";

interface Props {
  query: OverviewQuery;
}

export function ExportButton({ query }: Props) {
  const [exported, setExported] = useState(false);

  async function handleExport(format: "csv" | "json") {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const destPath = await save({
        defaultPath: `aicount-${today}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!destPath) return;
      await invoke("export_overview", { query, format, destPath });
      setExported(true);
      setTimeout(() => setExported(false), 2000);
    } catch (e) {
      alert(`Export failed: ${e}`);
    }
  }

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <Button type="button" variant="outline" className="gap-1.5">
          <Download className="h-4 w-4" />
          {exported ? "Exported ✓" : "Export"}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-[120px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <DropdownMenuPrimitive.Item
            className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
            onSelect={() => handleExport("csv")}
          >
            Export CSV
          </DropdownMenuPrimitive.Item>
          <DropdownMenuPrimitive.Item
            className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
            onSelect={() => handleExport("json")}
          >
            Export JSON
          </DropdownMenuPrimitive.Item>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
