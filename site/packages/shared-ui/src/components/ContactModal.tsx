"use client";

import { useEffect, useId, useState } from "react";

interface ContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  source: string;
  heading?: string;
  description?: string;
  submitLabel?: string;
  successHeading?: string;
  successMessage?: string;
  messageMode?: "required" | "optional" | "hidden";
}

export default function ContactModal({
  isOpen,
  onClose,
  source,
  heading = "Get Started",
  description = "Fill out the form below and we'll get back to you within 24 hours.",
  submitLabel = "Send Message",
  successHeading = "Thank You!",
  successMessage = "We'll be in touch shortly.",
  messageMode = "required",
}: ContactModalProps) {
  const headingId = useId();
  const descriptionId = useId();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
    message: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen, onClose]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    const form = e.currentTarget;
    const formDataToSend = new FormData(form);

    try {
      await fetch("/__forms.html", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(formDataToSend as any).toString(),
      });
      setSubmitted(true);
      setTimeout(() => {
        onClose();
        setSubmitted(false);
        setFormData({ name: "", email: "", company: "", message: "" });
      }, 2000);
    } catch (error) {
      console.error("Form submission error:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        className="relative bg-card rounded-2xl shadow-2xl border border-border max-w-md w-full max-h-[90vh] overflow-y-auto"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition"
          aria-label="Close modal"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="p-8">
          {!submitted ? (
            <>
              <h2 id={headingId} className="text-3xl font-bold text-foreground mb-2">{heading}</h2>
              <p id={descriptionId} className="text-muted-foreground mb-6">{description}</p>

              <form
                name="contact"
                method="POST"
                data-netlify="true"
                netlify-honeypot="bot-field"
                onSubmit={handleSubmit}
              >
                <input type="hidden" name="form-name" value="contact" />
                <input type="hidden" name="source" value={source} />
                <p className="hidden">
                  <label>
                    Don&apos;t fill this out: <input name="bot-field" />
                  </label>
                </p>

                <div className="space-y-4">
                  <div>
                    <label htmlFor="name" className="block text-sm font-semibold text-foreground mb-1">
                      Name *
                    </label>
                    <input
                      type="text"
                      id="name"
                      name="name"
                      required
                      value={formData.name}
                      onChange={handleChange}
                      className="w-full px-4 py-2 bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none transition text-foreground placeholder:text-muted-foreground"
                      placeholder="John Doe"
                    />
                  </div>

                  <div>
                    <label htmlFor="email" className="block text-sm font-semibold text-foreground mb-1">
                      Email *
                    </label>
                    <input
                      type="email"
                      id="email"
                      name="email"
                      required
                      value={formData.email}
                      onChange={handleChange}
                      className="w-full px-4 py-2 bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none transition text-foreground placeholder:text-muted-foreground"
                      placeholder="john@company.com"
                    />
                  </div>

                  <div>
                    <label htmlFor="company" className="block text-sm font-semibold text-foreground mb-1">
                      Company
                    </label>
                    <input
                      type="text"
                      id="company"
                      name="company"
                      value={formData.company}
                      onChange={handleChange}
                      className="w-full px-4 py-2 bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none transition text-foreground placeholder:text-muted-foreground"
                      placeholder="Your Company"
                    />
                  </div>

                  {messageMode !== "hidden" ? (
                    <div>
                      <label htmlFor="message" className="block text-sm font-semibold text-foreground mb-1">
                        Message {messageMode === "required" ? "*" : "(optional)"}
                      </label>
                      <textarea
                        id="message"
                        name="message"
                        required={messageMode === "required"}
                        rows={4}
                        value={formData.message}
                        onChange={handleChange}
                        className="w-full px-4 py-2 bg-input-background border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent outline-none transition resize-none text-foreground placeholder:text-muted-foreground"
                        placeholder="Tell us about your needs..."
                      />
                    </div>
                  ) : null}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="mt-6 w-full bg-primary hover:bg-primary-hover text-primary-foreground font-semibold py-3 px-6 rounded-lg text-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors glow-primary"
                >
                  {isSubmitting ? "Sending..." : submitLabel}
                </button>
              </form>
            </>
          ) : (
            <div className="text-center py-8">
              <div className="mb-4">
                <svg
                  className="h-16 w-16 text-success mx-auto"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 id={headingId} className="text-2xl font-bold text-foreground mb-2">{successHeading}</h3>
              <p id={descriptionId} className="text-muted-foreground">{successMessage}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
