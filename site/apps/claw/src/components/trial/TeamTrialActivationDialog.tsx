"use client";

import Image from "next/image";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import {
  Button,
  Carousel,
  CarouselContent,
  CarouselItem,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  type CarouselApi,
} from "@hypercli/shared-ui";

const CAROUSEL_INTERVAL_MS = 4_500;

export type TeamTrialFeatureId = "chat" | "files" | "integrations" | "skills" | "scheduled" | "desktop";

const TRIAL_FEATURES = [
  {
    id: "integrations",
    src: "/images/team-trial/feature-image-03.png",
    alt: "Connected Gmail, HubSpot, Linear, and Slack workflow",
  },
  {
    id: "skills",
    src: "/images/team-trial/feature-image-04.png",
    alt: "Agent skills catalog with active and available skills",
  },
  {
    id: "scheduled",
    src: "/images/team-trial/feature-image-05.png",
    alt: "Recurring weekday standup automation schedule",
  },
  {
    id: "desktop",
    src: "/images/team-trial/feature-image-06.png",
    alt: "Remote desktop opening inside a HyperCLI browser tab",
  },
  {
    id: "chat",
    src: "/images/team-trial/feature-image-01.png",
    alt: "Agent summarizing a customer renewal call and highlighting risk",
  },
  {
    id: "files",
    src: "/images/team-trial/feature-image-02.png",
    alt: "Chat composer attaching a vendor contract PDF",
  },
] as const satisfies ReadonlyArray<{ id: TeamTrialFeatureId; src: string; alt: string }>;

function featureIndex(featureId: TeamTrialFeatureId): number {
  return TRIAL_FEATURES.findIndex((feature) => feature.id === featureId);
}

export interface TeamTrialActivationDialogProps {
  open: boolean;
  checkoutPending?: boolean;
  initialFeature?: TeamTrialFeatureId;
  onOpenChange: (open: boolean) => void;
  onStartTrial: () => void;
}

export function TeamTrialActivationDialog({
  open,
  checkoutPending = false,
  initialFeature = "integrations",
  onOpenChange,
  onStartTrial,
}: TeamTrialActivationDialogProps) {
  const [api, setApi] = useState<CarouselApi>();
  const initialFeatureIndex = featureIndex(initialFeature);
  const [selectedIndex, setSelectedIndex] = useState(initialFeatureIndex);
  const [userPaused, setUserPaused] = useState(false);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reducedMotion = useReducedMotion();
  const autoPlayPaused = Boolean(reducedMotion) || userPaused;

  useEffect(() => {
    if (!api) return;
    const syncSelection = () => setSelectedIndex(api.selectedScrollSnap());
    syncSelection();
    api.on("select", syncSelection);
    api.on("reInit", syncSelection);
    return () => {
      api.off("select", syncSelection);
      api.off("reInit", syncSelection);
    };
  }, [api]);

  useEffect(() => {
    if (!open || !api) return;
    api.scrollTo(initialFeatureIndex);
  }, [api, initialFeatureIndex, open]);

  useEffect(() => {
    if (!open) return;
    const syncVisibility = () => setPageVisible(document.visibilityState === "visible");
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, [open]);

  const advanceCarousel = useEffectEvent(() => api?.scrollNext());

  useEffect(() => {
    if (
      !open ||
      !api ||
      autoPlayPaused ||
      pointerInside ||
      focusInside ||
      !pageVisible
    ) return;
    const timeout = window.setTimeout(advanceCarousel, CAROUSEL_INTERVAL_MS);
    return () => window.clearTimeout(timeout);
  }, [api, autoPlayPaused, focusInside, open, pageVisible, pointerInside, selectedIndex]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="team-trial-activation-dialog"
        closeLabel="Close free trial offer"
        overlayClassName="z-[10020] bg-black/75 backdrop-blur-sm motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          headingRef.current?.focus();
        }}
        className="z-[10021] h-[min(600px,calc(100dvh-1rem))] w-[min(1120px,calc(100vw-1rem))] max-w-none grid-rows-[minmax(220px,0.78fr)_minmax(0,1.22fr)] gap-0 overflow-hidden rounded-[18px] border-[#303036] bg-[#18181b] p-0 text-[#f7f7f8] shadow-[0_36px_120px_rgba(0,0,0,0.68)] motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none sm:h-[min(600px,calc(100dvh-2rem))] sm:w-[min(1120px,calc(100vw-2rem))] sm:max-w-none md:grid-cols-[1fr_1fr] md:grid-rows-1 [&>button:last-child]:z-30 [&>button:last-child]:text-[#d7d7da] max-sm:inset-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none"
      >
        <DialogDescription className="sr-only">
          Try Team free for seven days with no charge today. Cancel anytime.
        </DialogDescription>

        <section
          aria-label="HyperCLI capabilities"
          onPointerEnter={() => setPointerInside(true)}
          onPointerLeave={() => setPointerInside(false)}
          onFocusCapture={() => setFocusInside(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setFocusInside(false);
          }}
          className="relative min-h-0 overflow-hidden border-b border-white/10 bg-[#ef8d94] md:border-b-0 md:border-r"
        >
          <Carousel
            setApi={setApi}
            opts={{ loop: true, align: "start", startIndex: initialFeatureIndex }}
            className="h-full [&_[data-slot=carousel-content]]:h-full"
            aria-label="Trial features"
          >
            <CarouselContent className="ml-0 h-full">
              {TRIAL_FEATURES.map((feature, index) => (
                <CarouselItem
                  key={feature.src}
                  className="relative isolate h-full overflow-hidden pl-0 [contain:layout_paint]"
                  aria-label={`${index + 1} of ${TRIAL_FEATURES.length}`}
                >
                  <TrialFeatureImage feature={feature} priority={index === 0} />
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>

          <div className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/20 bg-white/15 px-3 py-2 shadow-[0_10px_28px_rgba(44,21,37,0.16)] backdrop-blur-md sm:bottom-7">
            <button
              type="button"
              onClick={() => setUserPaused((paused) => !paused)}
              aria-label={reducedMotion ? "Feature carousel autoplay disabled" : userPaused ? "Play feature carousel" : "Pause feature carousel"}
              aria-pressed={autoPlayPaused}
              disabled={Boolean(reducedMotion)}
              className="mr-0.5 flex h-6 w-6 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {autoPlayPaused ? <Play className="h-3 w-3 fill-current" /> : <Pause className="h-3 w-3 fill-current" />}
            </button>
            <div className="flex items-center gap-2" role="group" aria-label="Choose a trial feature">
              {TRIAL_FEATURES.map((feature, index) => (
                <button
                  key={feature.src}
                  type="button"
                  onClick={() => api?.scrollTo(index)}
                  aria-label={`Show feature ${index + 1}`}
                  aria-current={selectedIndex === index ? "step" : undefined}
                  className={`h-2 rounded-full bg-white transition-[width,opacity] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent ${selectedIndex === index ? "w-8 opacity-100" : "w-2 opacity-90 hover:opacity-100"}`}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-col justify-center bg-[#18181b] px-6 py-9 sm:px-10 sm:py-12 md:px-12">
          <div className="mx-auto w-full max-w-[30rem]">
            <DialogTitle
              ref={headingRef}
              tabIndex={-1}
              className="max-w-[14ch] text-balance text-[clamp(2rem,4.5vw,3.35rem)] font-medium leading-[1.02] tracking-[-0.04em] text-white outline-none"
            >
              Try Team free for 7 days
            </DialogTitle>
            <p className="mt-5 max-w-[34ch] text-pretty text-[clamp(1rem,1.7vw,1.25rem)] leading-[1.5] text-[#a5a5ad]">
              Give your agents connected tools, shared files, skills, automations, and a cloud desktop.
            </p>
            <p className="mt-4 text-[15px] font-medium leading-6 text-[#d7d7dc] sm:text-[16px]">
              No charge today. Cancel anytime.
            </p>
            <Button
              type="button"
              data-testid="team-trial-activation-confirm"
              disabled={checkoutPending}
              onClick={onStartTrial}
              className="mt-8 h-16 w-full rounded-[18px] bg-[#5f86f7] px-6 text-[18px] font-semibold text-[#101b3d] shadow-none hover:bg-[#7396fa] focus-visible:ring-[#9bb3ff] disabled:cursor-wait sm:h-[4.5rem] sm:text-[20px]"
            >
              {checkoutPending ? "Opening secure checkout..." : "Start my 7-day trial"}
            </Button>
            <p className="mt-4 text-center text-[13px] leading-5 text-[#7f7f88] sm:text-[14px]">
              We&apos;ll remind you before your trial ends.
            </p>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function TrialFeatureImage({
  feature,
  priority,
}: {
  feature: (typeof TRIAL_FEATURES)[number];
  priority: boolean;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="absolute inset-0 min-h-0 min-w-0 overflow-hidden bg-[#d9828d]">
      {failed ? (
        <div
          role="img"
          aria-label={`${feature.alt}. Preview unavailable.`}
          className="flex h-full w-full items-center justify-center px-8 text-center text-sm font-medium text-white/90"
        >
          Feature preview unavailable
        </div>
      ) : (
        <Image
          src={feature.src}
          alt={feature.alt}
          fill
          priority={priority}
          unoptimized
          sizes="(max-width: 767px) 100vw, 50vw"
          onError={() => setFailed(true)}
          className="h-full w-full max-w-full select-none object-cover"
        />
      )}
    </div>
  );
}
