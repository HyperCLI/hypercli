import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { hasAgentVoice, validateAgentAvatarFile, validateAgentVoiceFile, type AgentSummary } from "../api";
import { usePersona } from "../personas";
import { Avatar } from "./Avatar";

export function IdentityModalShell({
  title,
  subtitle,
  onClose,
  dropLabel,
  onDropFile,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  dropLabel?: string;
  onDropFile?: (file: File) => void;
  children: ReactNode;
}) {
  const [dropOver, setDropOver] = useState(false);
  const dropDepthRef = useRef(0);
  const dropHandlers = onDropFile
    ? {
        onDragEnter: (event: DragEvent<HTMLElement>) => {
          event.preventDefault();
          dropDepthRef.current += 1;
          setDropOver(true);
        },
        onDragOver: (event: DragEvent<HTMLElement>) => event.preventDefault(),
        onDragLeave: (event: DragEvent<HTMLElement>) => {
          event.preventDefault();
          dropDepthRef.current = Math.max(0, dropDepthRef.current - 1);
          if (dropDepthRef.current === 0) setDropOver(false);
        },
        onDrop: (event: DragEvent<HTMLElement>) => {
          event.preventDefault();
          dropDepthRef.current = 0;
          setDropOver(false);
          const file = event.dataTransfer.files.length > 0 ? event.dataTransfer.files[0] : null;
          if (file) onDropFile(file);
        },
      }
    : {};
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <main
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal-card relative flex max-h-[86vh] w-[360px] max-w-[calc(100vw-32px)] flex-col overflow-hidden ${dropOver ? "ring-1 ring-accent" : ""}`}
        onClick={(event) => event.stopPropagation()}
        {...dropHandlers}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold">{title}</div>
            <div className="text-[11px] text-text-secondary">{subtitle}</div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {dropOver && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-accent/10">
            <span className="text-[12px] font-medium text-accent">{dropLabel}</span>
          </div>
        )}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-text-secondary hover:bg-active-row hover:text-foreground transition-colors"
        >
          <X size={15} />
        </button>
      </main>
    </div>
  );
}

export function AvatarPickerModal({
  agent,
  onClose,
  onUpload,
  onDelete,
}: {
  agent: AgentSummary;
  onClose: () => void;
  onUpload: (id: string, file: File) => void;
  onDelete: (id: string) => void;
}) {
  const persona = usePersona(agent.id);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const applyFile = (file: File) => {
    const problem = validateAgentAvatarFile(file);
    if (problem) {
      setHint(problem);
      return;
    }
    setHint(null);
    onUpload(agent.id, file);
    onClose();
  };

  return (
    <IdentityModalShell
      title="Change avatar"
      subtitle="PNG, JPEG, WebP or GIF."
      onClose={onClose}
      dropLabel="Drop an image to upload"
      onDropFile={applyFile}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          applyFile(file);
        }}
      />
      {hint && (
        <p className="text-[10px] text-error leading-snug">{hint}</p>
      )}
      <div className={`flex justify-center ${hint ? "mt-3" : ""}`}>
        <Avatar
          name={agent.name}
          url={agent.avatar_url}
          size={56}
          color={persona.color}
          icon={persona.icon}
        />
      </div>
      <div className="mt-4 flex items-center justify-between">
        {agent.avatar_url ? (
          <button
            type="button"
            onClick={() => {
              onDelete(agent.id);
              onClose();
            }}
            className="text-[12px] text-error hover:underline"
          >
            Remove avatar
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="ui-secondary-button"
        >
          Choose image
        </button>
      </div>
    </IdentityModalShell>
  );
}

export function VoicePickerModal({
  agent,
  voiceApiUnavailable,
  onClose,
  onUpload,
  onDelete,
}: {
  agent: AgentSummary;
  voiceApiUnavailable: boolean;
  onClose: () => void;
  onUpload: (id: string, file: File) => void;
  onDelete: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const voiceSet = hasAgentVoice(agent);
  const status = voiceApiUnavailable
    ? "Voice upload is not available in this environment."
    : voiceSet
      ? "Voice set"
      : "No voice yet";

  const applyFile = (file: File) => {
    const problem = validateAgentVoiceFile(file);
    if (problem) {
      setHint(problem);
      return;
    }
    setHint(null);
    onUpload(agent.id, file);
    onClose();
  };

  return (
    <IdentityModalShell
      title="Change voice"
      subtitle={status}
      onClose={onClose}
      dropLabel="Drop an audio clip to upload"
      onDropFile={voiceApiUnavailable ? undefined : applyFile}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.mp4,video/mp4,video/webm"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          applyFile(file);
        }}
      />
      {hint && (
        <p className="text-[10px] text-error leading-snug">{hint}</p>
      )}
      <div className={`flex items-center justify-between ${hint ? "mt-3" : ""}`}>
        {voiceSet && !voiceApiUnavailable ? (
          <button
            type="button"
            onClick={() => {
              onDelete(agent.id);
              onClose();
            }}
            className="text-[12px] text-error hover:underline"
          >
            Remove voice
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={voiceApiUnavailable}
          onClick={() => inputRef.current?.click()}
          className="ui-secondary-button disabled:opacity-40"
        >
          Choose audio
        </button>
      </div>
    </IdentityModalShell>
  );
}
