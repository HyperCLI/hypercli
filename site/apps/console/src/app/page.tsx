import { Card, CardHeader, CardTitle, CardContent, Badge } from "@hypercli/shared-ui";
import { Activity, Cpu, Zap, Clock } from "lucide-react";
import { RecentDeployments } from "@/components/RecentDeployments";
import { QuickActions } from "@/components/QuickActions";

const stats = [
  {
    title: "Active Deployments",
    value: "12",
    change: "+2 from last week",
    icon: Activity,
    trend: "up",
  },
  {
    title: "GPU Hours Used",
    value: "847",
    change: "This month",
    icon: Cpu,
    trend: "neutral",
  },
  {
    title: "API Requests",
    value: "1.2M",
    change: "+18% from last month",
    icon: Zap,
    trend: "up",
  },
  {
    title: "Avg Response Time",
    value: "45ms",
    change: "-12% from last month",
    icon: Clock,
    trend: "down",
  },
];

export default function DashboardPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Monitor your deployments and infrastructure
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {stats.map((stat) => (
          <Card key={stat.title} className="hover:border-primary/30 transition-colors">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{stat.value}</div>
              <p className="text-xs text-muted-foreground mt-1">
                <Badge
                  variant={
                    stat.trend === "up"
                      ? "success"
                      : stat.trend === "down"
                      ? "destructive"
                      : "secondary"
                  }
                  className="mr-2"
                >
                  {stat.trend === "up" ? "↑" : stat.trend === "down" ? "↓" : "→"}
                </Badge>
                {stat.change}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Deployments */}
        <div className="lg:col-span-2">
          <RecentDeployments />
        </div>

        {/* Quick Actions */}
        <div>
          <QuickActions />
        </div>
      </div>
    </div>
  );
}
