import type { ChatMessage as ChatMessageType, ChatAttachment, ChatPendingFile } from "@/hooks/useGatewayChat";
import type { HTMLMotionProps } from "framer-motion";

// ── Variant types ──

export type FeatureVariant = "off" | "v1" | "v2" | "v3";
export type ThinkingVariant = FeatureVariant;
export type TimestampVariant = FeatureVariant;
export type BubblesVariant = FeatureVariant;
export type NameVariant = FeatureVariant;
export type AnimationVariant = FeatureVariant;
export type ThemeVariant = FeatureVariant;
export type StreamingVariant = FeatureVariant;

export interface ChatMessageProps {
  message: ChatMessageType;
  inlineAudioUrl?: string | null;
  agentId?: string | null;
  timestampVariant?: TimestampVariant;
  nameVariant?: NameVariant;
  bubblesVariant?: BubblesVariant;
  animationVariant?: AnimationVariant;
  themeVariant?: ThemeVariant;
  streamingVariant?: StreamingVariant;
  isStreaming?: boolean;
  agentName?: string;
  senderName?: string;
  isGroupChat?: boolean;
}

export type { ChatMessageType, ChatAttachment, ChatPendingFile, HTMLMotionProps };
