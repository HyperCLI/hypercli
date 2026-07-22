"use client";

import { useId } from "react";

type RectFrame = readonly [x: number, y: number, width: number, height: number];

const GRID_A = [
  [32, 32, 94, 94],
  [138, 32, 94, 94],
  [32, 138, 94, 94],
  [138, 138, 94, 94],
] as const;

const WIDE_A = [
  [32, 32, 48, 94],
  [92, 32, 140, 94],
  [32, 138, 140, 94],
  [184, 138, 48, 94],
] as const;

const COMPACT_A = [
  [32, 32, 48, 94],
  [92, 32, 80, 94],
  [92, 138, 80, 94],
  [184, 138, 48, 94],
] as const;

const TALL_A = [
  [32, 32, 48, 200],
  [92, 32, 80, 94],
  [92, 138, 80, 94],
  [184, 32, 48, 200],
] as const;

const SWAPPED_A = [
  [32, 138, 48, 94],
  [92, 32, 80, 94],
  [92, 138, 80, 94],
  [184, 32, 48, 94],
] as const;

const GRID_B = [
  [32, 138, 94, 94],
  [32, 32, 94, 94],
  [138, 138, 94, 94],
  [138, 32, 94, 94],
] as const;

const WIDE_B = [
  [32, 138, 140, 94],
  [32, 32, 48, 94],
  [184, 138, 48, 94],
  [92, 32, 140, 94],
] as const;

const COMPACT_B = [
  [92, 138, 80, 94],
  [32, 32, 48, 94],
  [184, 138, 48, 94],
  [92, 32, 80, 94],
] as const;

const TALL_B = [
  [92, 138, 80, 94],
  [32, 32, 48, 200],
  [184, 32, 48, 200],
  [92, 32, 80, 94],
] as const;

const SWAPPED_B = [
  [92, 138, 80, 94],
  [32, 138, 48, 94],
  [184, 32, 48, 94],
  [92, 32, 80, 94],
] as const;

const SQUARE_ITERATION_A = [
  GRID_A,
  WIDE_A,
  COMPACT_A,
  TALL_A,
  SWAPPED_A,
] as const;

const SQUARE_ITERATION_B = [
  GRID_B,
  WIDE_B,
  COMPACT_B,
  TALL_B,
  SWAPPED_B,
] as const;

const CODE_PHASE_HOLD_FRAMES = [
  SWAPPED_B,
  SWAPPED_B,
  SWAPPED_B,
  SWAPPED_B,
  SWAPPED_B,
  SWAPPED_B,
  SWAPPED_B,
  SWAPPED_B,
] as const;

const SQUARE_PHASE_FRAMES = [
  ...SQUARE_ITERATION_A,
  ...SQUARE_ITERATION_B,
] as const;

const PANEL_FRAMES = [
  ...SQUARE_PHASE_FRAMES,
  ...CODE_PHASE_HOLD_FRAMES,
  GRID_A,
] as const;

type CodeRowFrame = readonly [x: number, y: number, width: number, height: number];

const CODE_ROWS_INITIAL = [
  [52.5, 67.9, 159, 15.4],
  [52.5, 98.7, 118, 15.4],
  [52.5, 129.4, 138.5, 15.4],
  [52.5, 160.2, 76.9, 15.4],
  [52.5, 191, 159, 15.4],
  [52.5, 221.7, 118, 15.4],
  [52.5, 252.5, 138.5, 15.4],
  [52.5, 283.3, 76.9, 15.4],
  [52.5, 314, 159, 15.4],
  [52.5, 344.8, 118, 15.4],
] as const satisfies readonly CodeRowFrame[];

const PANEL_COUNT = 4;
const CODE_FRAME_START_INDEX = SQUARE_PHASE_FRAMES.length;
const CODE_DETAIL_START_INDEX = CODE_FRAME_START_INDEX;
const CODE_FRAME_END_INDEX = CODE_FRAME_START_INDEX + CODE_PHASE_HOLD_FRAMES.length - 1;
const LAYOUT_RETURN_INDEX = CODE_FRAME_END_INDEX + 1;
const FRAME_STEP_SECONDS = 0.44;
const DURATION_SECONDS = (PANEL_FRAMES.length - 1) * FRAME_STEP_SECONDS;
const DURATION = `${DURATION_SECONDS}s`;
const KEY_TIMES = PANEL_FRAMES.map((_, index) => index / (PANEL_FRAMES.length - 1)).join(";");
const KEY_SPLINES = Array.from({ length: PANEL_FRAMES.length - 1 }, () => "0.45 0 0.2 1").join(";");
const LAST_FRAME_INDEX = PANEL_FRAMES.length - 1;
const percentForFrame = (index: number) => ((index / LAST_FRAME_INDEX) * 100).toFixed(2);
const CODE_START_PERCENT = percentForFrame(CODE_FRAME_START_INDEX);
const CODE_END_PERCENT = percentForFrame(CODE_FRAME_END_INDEX);
const PANEL_FADE_OUT_START_PERCENT = (((CODE_FRAME_START_INDEX - 0.85) / LAST_FRAME_INDEX) * 100).toFixed(2);
const PANEL_FADE_OUT_END_PERCENT = (((CODE_FRAME_START_INDEX + 0.2) / LAST_FRAME_INDEX) * 100).toFixed(2);
const CODE_FADE_IN_START_PERCENT = (((CODE_FRAME_START_INDEX - 0.45) / LAST_FRAME_INDEX) * 100).toFixed(2);
const CODE_DETAIL_FADE_IN_START_PERCENT = (((CODE_DETAIL_START_INDEX + 0.45) / LAST_FRAME_INDEX) * 100).toFixed(2);
const CODE_DETAIL_FULL_PERCENT = (((CODE_DETAIL_START_INDEX + 1.05) / LAST_FRAME_INDEX) * 100).toFixed(2);
const CODE_FADE_OUT_START_PERCENT = (((CODE_FRAME_END_INDEX + 0.25) / LAST_FRAME_INDEX) * 100).toFixed(2);
const LAYOUT_FADE_IN_START_PERCENT = (((LAYOUT_RETURN_INDEX - 0.45) / LAST_FRAME_INDEX) * 100).toFixed(2);
const CODE_SCROLL_DISTANCE = 144;

interface AgentLayoutAnimationProps {
  className?: string;
  title?: string;
  appearance?: "subtle" | "solid";
  showCodePhase?: boolean;
}

function panelValuesFor(panelIndex: number, valueIndex: number) {
  return PANEL_FRAMES.map((frame) => frame[panelIndex][valueIndex]).join(";");
}

function GeometryAnimations({ panelIndex }: { panelIndex: number }) {
  return (
    <>
      <animate
        attributeName="x"
        values={panelValuesFor(panelIndex, 0)}
        dur={DURATION}
        keyTimes={KEY_TIMES}
        calcMode="spline"
        keySplines={KEY_SPLINES}
        repeatCount="indefinite"
      />
      <animate
        attributeName="y"
        values={panelValuesFor(panelIndex, 1)}
        dur={DURATION}
        keyTimes={KEY_TIMES}
        calcMode="spline"
        keySplines={KEY_SPLINES}
        repeatCount="indefinite"
      />
      <animate
        attributeName="width"
        values={panelValuesFor(panelIndex, 2)}
        dur={DURATION}
        keyTimes={KEY_TIMES}
        calcMode="spline"
        keySplines={KEY_SPLINES}
        repeatCount="indefinite"
      />
      <animate
        attributeName="height"
        values={panelValuesFor(panelIndex, 3)}
        dur={DURATION}
        keyTimes={KEY_TIMES}
        calcMode="spline"
        keySplines={KEY_SPLINES}
        repeatCount="indefinite"
      />
    </>
  );
}

function AnimatedPanel({
  panelIndex,
  appearance,
}: {
  panelIndex: number;
  appearance: "subtle" | "solid";
}) {
  const isSolid = appearance === "solid";

  return (
    <g>
      <rect rx="14" fill="white" opacity={isSolid ? "0.98" : "0.045"}>
        <GeometryAnimations panelIndex={panelIndex} />
      </rect>
      <rect
        rx="14"
        fill="none"
        stroke="white"
        strokeOpacity={isSolid ? "0" : "0.1"}
        strokeWidth="1"
        strokeDasharray="10 6"
        vectorEffect="non-scaling-stroke"
      >
        <GeometryAnimations panelIndex={panelIndex} />
      </rect>
    </g>
  );
}

function StaticPanel({
  frame,
  appearance,
}: {
  frame: RectFrame;
  appearance: "subtle" | "solid";
}) {
  const [x, y, width, height] = frame;
  const isSolid = appearance === "solid";

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx="14" fill="white" opacity={isSolid ? "0.98" : "0.045"} />
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx="14"
        fill="none"
        stroke="white"
        strokeOpacity={isSolid ? "0" : "0.1"}
        strokeWidth="1"
        strokeDasharray="10 6"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

function CodeRow({ rowIndex }: { rowIndex: number }) {
  const [x, y, width, height] = CODE_ROWS_INITIAL[rowIndex];

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx="7.7" fill="white" opacity="0.13" />
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx="7.7"
        fill="none"
        stroke="white"
        strokeOpacity="0.16"
        strokeWidth="1"
        strokeDasharray="10 6"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

export function AgentLayoutAnimation({
  className = "h-8 w-8",
  title = "Agent workspace layout",
  appearance = "subtle",
  showCodePhase = true,
}: AgentLayoutAnimationProps) {
  const rawId = useId().replace(/:/g, "");
  const clipId = `agent-layout-code-clip-${rawId}`;
  const iconShadowId = `agent-layout-code-icon-shadow-${rawId}`;
  const topFadeId = `agent-layout-code-top-fade-${rawId}`;
  const bottomFadeId = `agent-layout-code-bottom-fade-${rawId}`;

  return (
    <svg
      viewBox="32 32 200 200"
      role="img"
      aria-label={title}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="32" y="32" width="200" height="200" rx="14" />
        </clipPath>
        <filter
          id={iconShadowId}
          x="45.75"
          y="189"
          width="40"
          height="40"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#000000" floodOpacity="0.05" />
        </filter>
        <linearGradient id={topFadeId} x1="132" y1="32" x2="132" y2="101.23" gradientUnits="userSpaceOnUse">
          <stop offset="0.25" stopColor="#0A0A0A" />
          <stop offset="1" stopColor="#0A0A0A" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={bottomFadeId} x1="132" y1="232" x2="132" y2="162.77" gradientUnits="userSpaceOnUse">
          <stop offset="0.25" stopColor="#0A0A0A" />
          <stop offset="1" stopColor="#0A0A0A" stopOpacity="0" />
        </linearGradient>
      </defs>
      <style>
        {`
          .agent-layout-static {
            display: none;
          }

          .agent-layout-panel-group {
            animation: agent-layout-panels ${DURATION} linear infinite;
          }

          .agent-layout-code-group {
            opacity: 0;
            animation: agent-layout-code ${DURATION} linear infinite;
          }

          .agent-layout-code-detail {
            opacity: 0;
            animation: agent-layout-code-detail ${DURATION} linear infinite;
          }

          .agent-layout-code-scroll {
            animation: agent-layout-code-scroll ${DURATION} linear infinite;
          }

          @keyframes agent-layout-panels {
            0%, ${PANEL_FADE_OUT_START_PERCENT}% {
              opacity: 1;
            }

            ${PANEL_FADE_OUT_END_PERCENT}%, ${CODE_END_PERCENT}% {
              opacity: 0;
            }

            ${LAYOUT_FADE_IN_START_PERCENT}%, 100% {
              opacity: 1;
            }
          }

          @keyframes agent-layout-code {
            0%, ${CODE_FADE_IN_START_PERCENT}% {
              opacity: 0;
            }

            ${CODE_START_PERCENT}%, ${CODE_END_PERCENT}% {
              opacity: 1;
            }

            ${CODE_FADE_OUT_START_PERCENT}%, 100% {
              opacity: 0;
            }
          }

          @keyframes agent-layout-code-detail {
            0%, ${CODE_DETAIL_FADE_IN_START_PERCENT}% {
              opacity: 0;
            }

            ${CODE_DETAIL_FULL_PERCENT}%, ${CODE_END_PERCENT}% {
              opacity: 1;
            }

            ${CODE_FADE_OUT_START_PERCENT}%, 100% {
              opacity: 0;
            }
          }

          @keyframes agent-layout-code-scroll {
            0%, ${CODE_DETAIL_FULL_PERCENT}% {
              transform: translateY(0);
            }

            ${CODE_FADE_OUT_START_PERCENT}%, 100% {
              transform: translateY(-${CODE_SCROLL_DISTANCE}px);
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .agent-layout-animated {
              display: none;
            }

            .agent-layout-panel-group,
            .agent-layout-code-group,
            .agent-layout-code-detail,
            .agent-layout-code-scroll {
              animation: none;
            }

            .agent-layout-static {
              display: inline;
            }
          }
        `}
      </style>
      <g className="agent-layout-animated">
        <g className={showCodePhase ? "agent-layout-panel-group" : undefined}>
          {Array.from({ length: PANEL_COUNT }, (_, panelIndex) => (
            <AnimatedPanel
              key={`agent-layout-panel-${panelIndex}`}
              panelIndex={panelIndex}
              appearance={appearance}
            />
          ))}
        </g>
        {showCodePhase && (
          <g className="agent-layout-code-group">
            <rect
              x="32"
              y="32"
              width="200"
              height="200"
              rx="14"
              fill="none"
              stroke="white"
              strokeOpacity="0.24"
              strokeWidth="1"
              strokeDasharray="10 6"
              vectorEffect="non-scaling-stroke"
            />
            <g clipPath={`url(#${clipId})`}>
              <g className="agent-layout-code-detail">
                <g className="agent-layout-code-scroll">
                  {CODE_ROWS_INITIAL.map((_, rowIndex) => (
                    <CodeRow key={`agent-layout-code-row-${rowIndex}`} rowIndex={rowIndex} />
                  ))}
                </g>
              </g>
              <rect x="32" y="32" width="200" height="69.23" fill={`url(#${topFadeId})`} />
              <rect x="32" y="162.77" width="200" height="69.23" fill={`url(#${bottomFadeId})`} />
              <g filter={`url(#${iconShadowId})`} className="agent-layout-code-detail">
                <rect x="47.75" y="190" width="36" height="36" rx="10" fill="#5F5F5F" />
                <rect
                  x="48.25"
                  y="190.5"
                  width="35"
                  height="35"
                  rx="9.5"
                  fill="none"
                  stroke="white"
                  strokeOpacity="0.32"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d="M69.75 210.67L72.42 208L69.75 205.33M61.75 205.33L59.08 208L61.75 210.67M67.42 202.67L64.08 213.33"
                  stroke="#FAFAFA"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            </g>
          </g>
        )}
      </g>
      <g className="agent-layout-static" aria-hidden="true">
        {GRID_A.map((frame, panelIndex) => (
          <StaticPanel
            key={`agent-layout-static-panel-${panelIndex}`}
            frame={frame}
            appearance={appearance}
          />
        ))}
      </g>
    </svg>
  );
}
