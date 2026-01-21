"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@hypercli/shared-ui";
import { ExternalLink } from "lucide-react";

const deployments = [
  {
    id: "dep_1",
    name: "llama-3-70b-prod",
    model: "Llama 3 70B",
    status: "running",
    region: "us-east-1",
    createdAt: "2 hours ago",
  },
  {
    id: "dep_2",
    name: "mistral-7b-staging",
    model: "Mistral 7B",
    status: "running",
    region: "eu-west-1",
    createdAt: "1 day ago",
  },
  {
    id: "dep_3",
    name: "flux-dev-test",
    model: "Flux.1 Dev",
    status: "stopped",
    region: "us-west-2",
    createdAt: "3 days ago",
  },
  {
    id: "dep_4",
    name: "whisper-large-v3",
    model: "Whisper Large V3",
    status: "running",
    region: "us-east-1",
    createdAt: "5 days ago",
  },
];

const statusVariants: Record<string, "success" | "secondary" | "destructive"> = {
  running: "success",
  stopped: "secondary",
  failed: "destructive",
};

export function RecentDeployments() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Recent Deployments</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Created</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deployments.map((deployment) => (
              <TableRow key={deployment.id}>
                <TableCell className="font-medium">{deployment.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {deployment.model}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariants[deployment.status]}>
                    {deployment.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {deployment.region}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {deployment.createdAt}
                </TableCell>
                <TableCell>
                  <button className="text-muted-foreground hover:text-foreground transition-colors">
                    <ExternalLink className="h-4 w-4" />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
