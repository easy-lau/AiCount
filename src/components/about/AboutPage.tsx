import { Info, Mail, Tag } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Info className="size-5 text-muted-foreground" />
          关于
        </h1>
      </header>
      <Card>
        <CardContent className="p-5 space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <Tag className="size-4 text-muted-foreground shrink-0" />
            <span className="tabular-nums">v1.0.0</span>
          </div>
          <div className="flex items-center gap-2">
            <Mail className="size-4 text-muted-foreground shrink-0" />
            <a
              href="mailto:liuxing@authine.com"
              className="text-foreground underline underline-offset-2 hover:text-primary"
            >
              liuxing@authine.com
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
