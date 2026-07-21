import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AlertTriangle, Check, Info, Trash2 } from "lucide-react";

function ThemeGallery() {
  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <div className="mx-auto max-w-5xl space-y-8">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">HyperCLI themes</p>
          <h1 className="mt-2 text-4xl font-bold">Semantic surface gallery</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
            A stable reference for typography, controls, feedback, and layered surfaces.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            ["Background", "bg-background"],
            ["Surface", "bg-surface-low"],
            ["Elevated", "bg-surface-high"],
          ].map(([label, tone]) => (
            <div key={label} className={`${tone} rounded-2xl border border-border p-5 shadow-sm`}>
              <p className="font-semibold">{label}</p>
              <p className="mt-2 text-sm text-text-muted">Muted supporting copy remains readable.</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Controls</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            <button className="rounded-lg bg-button-primary px-4 py-2 text-sm font-semibold text-button-primary-foreground hover:bg-button-primary-hover">Primary</button>
            <button className="rounded-lg border border-border bg-surface-low px-4 py-2 text-sm font-semibold hover:bg-surface-high">Secondary</button>
            <button className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground"><Trash2 className="mr-2 inline h-4 w-4" />Delete</button>
            <button disabled className="rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground opacity-60">Disabled</button>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <input aria-label="Project name" defaultValue="Research workspace" className="h-10 rounded-lg border border-input bg-input-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring" />
            <select aria-label="Region" className="h-10 rounded-lg border border-input bg-input-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring" defaultValue="us-east">
              <option value="us-east">US East</option>
              <option value="eu-west">EU West</option>
            </select>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-success/30 bg-success/10 p-4 text-sm text-success"><Check className="mr-2 inline h-4 w-4" />Connection healthy</div>
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning"><AlertTriangle className="mr-2 inline h-4 w-4" />Action required</div>
          <div className="rounded-xl border border-info/30 bg-info/10 p-4 text-sm text-info"><Info className="mr-2 inline h-4 w-4" />Deployment queued</div>
        </section>

        <section className="rounded-2xl border border-terminal-border bg-terminal-background p-5 text-terminal-foreground" style={{ colorScheme: "dark" }}>
          <p className="font-mono text-xs text-terminal-muted">hypercli shell</p>
          <pre className="mt-3 overflow-x-auto bg-transparent p-0 text-sm text-terminal-live">$ hyper agents list{"\n"}research-agent  RUNNING</pre>
        </section>
      </div>
    </main>
  );
}

const meta = {
  title: "Theme/Semantic Gallery",
  component: ThemeGallery,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ThemeGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = {};
