"use client";

import { Card, CardHeader, CardTitle, CardContent, Button } from "@hypercli/shared-ui";
import { Plus, Upload, BookOpen, Terminal } from "lucide-react";

const actions = [
  {
    label: "New Deployment",
    description: "Deploy a new model",
    icon: Plus,
    variant: "default" as const,
  },
  {
    label: "Upload Model",
    description: "Upload custom weights",
    icon: Upload,
    variant: "outline" as const,
  },
  {
    label: "View Docs",
    description: "API documentation",
    icon: BookOpen,
    variant: "outline" as const,
  },
  {
    label: "Open CLI",
    description: "Terminal access",
    icon: Terminal,
    variant: "outline" as const,
  },
];

export function QuickActions() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {actions.map((action) => (
          <Button
            key={action.label}
            variant={action.variant}
            className="w-full justify-start gap-3 h-auto py-3"
          >
            <action.icon className="h-5 w-5" />
            <div className="text-left">
              <div className="font-medium">{action.label}</div>
              <div className="text-xs text-muted-foreground">
                {action.description}
              </div>
            </div>
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}
