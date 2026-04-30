export type ShowoffAction = () => void | Promise<void>;

export interface ShowoffStep {
  id: string;
  targetId: string;
  eyebrow: string;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: ShowoffAction;
  capabilities?: readonly string[];
  completeOnAction?: boolean;
}
