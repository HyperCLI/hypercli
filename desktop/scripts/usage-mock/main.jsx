import "../../src/index.css";
import { createRoot } from "react-dom/client";
import { UsagePanel } from "../../src/components/UsagePanel";

document.documentElement.classList.add("dark");

const TABS = ["General", "Usage & billing", "Usage", "Updates"];

function App() {
  return (
    <div className="flex min-h-screen items-start justify-center bg-background p-8">
      <div className="modal-card modal-card-wide">
        <div className="flex items-center gap-4 border-b border-border px-5">
          {TABS.map((tab) => (
            <span
              key={tab}
              className={`relative py-2.5 text-[12px] ${
                tab === "Usage"
                  ? "font-semibold text-foreground"
                  : "text-text-secondary"
              }`}
            >
              {tab}
              {tab === "Usage" && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" />
              )}
            </span>
          ))}
        </div>
        <div className="p-5">
          <UsagePanel />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
