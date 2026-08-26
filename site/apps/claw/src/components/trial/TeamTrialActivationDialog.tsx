"use client";

import Image from "next/image";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { BellRing, CalendarClock, Pause, Play, Rocket } from "lucide-react";
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

const TRIAL_FEATURES = [
  {
    src: "/images/team-trial/feature-image-03.png",
    alt: "Connected Gmail, HubSpot, Linear, and Slack workflow",
  },
  {
    src: "/images/team-trial/feature-image-04.png",
    alt: "Agent skills catalog with active and available skills",
  },
  {
    src: "/images/team-trial/feature-image-05.png",
    alt: "Recurring weekday standup automation schedule",
  },
  {
    src: "/images/team-trial/feature-image-06.png",
    alt: "Remote desktop opening inside a HyperCLI browser tab",
  },
  {
    src: "/images/team-trial/feature-image-01.png",
    alt: "Agent summarizing a customer renewal call and highlighting risk",
  },
  {
    src: "/images/team-trial/feature-image-02.png",
    alt: "Chat composer attaching a vendor contract PDF",
  },
] as const;

function trialEndLabel(now: Date): string {
  const trialEnd = new Date(now);
  trialEnd.setDate(trialEnd.getDate() + 7);
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    ...(trialEnd.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  }).format(trialEnd);
}

export interface TeamTrialActivationDialogProps {
  open: boolean;
  checkoutPending?: boolean;
  onOpenChange: (open: boolean) => void;
  onStartTrial: () => void;
}

export function TeamTrialActivationDialog({
  open,
  checkoutPending = false,
  onOpenChange,
  onStartTrial,
}: TeamTrialActivationDialogProps) {
  const [api, setApi] = useState<CarouselApi>();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reducedMotion = useReducedMotion();
  const autoPlayPaused = Boolean(reducedMotion) || userPaused;
  const endsOn = trialEndLabel(new Date());

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
          Start a seven-day free trial to use tools, files, skills, automations, and desktop access.
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
            opts={{ loop: true, align: "start" }}
            className="h-full [&_[data-slot=carousel-content]]:h-full"
            aria-label="Trial features"
          >
            <CarouselContent className="ml-0 h-full">
              {TRIAL_FEATURES.map((feature, index) => (
                <CarouselItem
                  key={feature.src}
                  className="relative h-full pl-0"
                  aria-label={`${index + 1} of ${TRIAL_FEATURES.length}`}
                >
                  <Image
                    src={feature.src}
                    alt={feature.alt}
                    fill
                    priority={index === 0}
                    unoptimized
                    sizes="(max-width: 767px) 100vw, 50vw"
                    className="object-cover"
                  />
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

        <section className="flex min-h-0 flex-col bg-[#18181b]">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-7 pt-7 sm:px-8 sm:pb-8 sm:pt-9">
            <DialogTitle
              ref={headingRef}
              tabIndex={-1}
              className="max-w-[26ch] text-balance text-[clamp(1.55rem,2.2vw,1.875rem)] font-medium leading-[1.1] tracking-[-0.03em] text-white outline-none"
            >
              Unlock the full HyperCLI experience
            </DialogTitle>
            <p className="mt-3 max-w-[42rem] text-[15px] leading-6 text-[#a5a5ad] sm:text-[16px]">
              See what your agent can do with full access for 7 days. Connect your tools, work with files, run skills, automate recurring work, and use its own desktop.
            </p>

            <ol className="mt-7 space-y-0 sm:mt-8">
              <TrialMoment
                icon={<Rocket className="h-4 w-4" />}
                title="Your trial starts today"
                detail="Full access begins immediately."
              />
              <TrialMoment
                icon={<BellRing className="h-4 w-4" />}
                title="We'll remind you before it ends"
                detail="No surprise charges."
              />
              <TrialMoment
                icon={<CalendarClock className="h-4 w-4" />}
                title={`Your trial ends ${endsOn}`}
                detail="Cancel anytime."
                last
              />
            </ol>
          </div>

          <footer className="flex shrink-0 justify-end border-t border-white/10 bg-[#1d1d20] px-5 py-4 sm:px-8 sm:py-5">
            <Button
              type="button"
              data-testid="team-trial-activation-confirm"
              disabled={checkoutPending}
              onClick={onStartTrial}
              className="h-12 w-full rounded-xl bg-[#5f86f7] px-6 text-[16px] font-semibold text-[#101b3d] shadow-none hover:bg-[#7396fa] focus-visible:ring-[#9bb3ff] disabled:cursor-wait sm:w-auto"
            >
              {checkoutPending ? "Opening checkout..." : "Start 7-day free trial"}
            </Button>
          </footer>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function TrialMoment({
  icon,
  title,
  detail,
  last = false,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  last?: boolean;
}) {
  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4">
      <div className="flex flex-col items-center">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#2a2a2e] text-white">
          {icon}
        </span>
        {!last ? <span aria-hidden="true" className="my-2 h-8 w-px bg-white/10" /> : null}
      </div>
      <div className={last ? "pt-0.5" : "pb-4 pt-0.5"}>
        <h3 className="text-[17px] font-semibold leading-6 text-white">{title}</h3>
        <p className="mt-1 text-[14px] leading-5 text-[#96969f] sm:text-[15px] sm:leading-6">{detail}</p>
      </div>
    </li>
  );
}
