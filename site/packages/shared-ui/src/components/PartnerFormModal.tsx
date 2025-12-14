"use client";

import { useState, useEffect } from "react";

interface PartnerFormModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const companySizes = [
  { value: "1-10", label: "1-10 employees" },
  { value: "11-50", label: "11-50 employees" },
  { value: "51-200", label: "51-200 employees" },
  { value: "201-500", label: "201-500 employees" },
  { value: "500+", label: "500+ employees" },
];

export default function PartnerFormModal({ isOpen, onClose }: PartnerFormModalProps) {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
    role: "",
    companySize: "",
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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    const form = e.currentTarget;
    const formDataToSend = new FormData(form);

    try {
      await fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(formDataToSend as any).toString(),
      });
      setSubmitted(true);
      setTimeout(() => {
        onClose();
        setSubmitted(false);
        setFormData({ name: "", email: "", company: "", role: "", companySize: "", message: "" });
      }, 2500);
    } catch (error) {
      console.error("Form submission error:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative bg-[#111315] rounded-2xl shadow-2xl border border-[#2A2D2F] max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#6B7280] hover:text-white transition z-10"
          aria-label="Close modal"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="p-8">
          {!submitted ? (
            <>
              <div className="mb-6">
                <h2 className="text-2xl font-semibold text-white mb-2">Become a Partner</h2>
                <p className="text-[#9BA0A2] text-sm">
                  Join our partner network and start delivering AI infrastructure to your clients.
                </p>
              </div>

              <form
                name="partner-inquiry"
                method="POST"
                data-netlify="true"
                netlify-honeypot="bot-field"
                onSubmit={handleSubmit}
              >
                <input type="hidden" name="form-name" value="partner-inquiry" />
                <p className="hidden">
                  <label>
                    Don't fill this out: <input name="bot-field" />
                  </label>
                </p>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="name" className="block text-sm font-medium text-[#D4D6D7] mb-1.5">
                        Name <span className="text-[#38D39F]">*</span>
                      </label>
                      <input
                        type="text"
                        id="name"
                        name="name"
                        required
                        value={formData.name}
                        onChange={handleChange}
                        className="w-full px-3.5 py-2.5 bg-[#0B0D0E] border border-[#2A2D2F] rounded-lg focus:ring-2 focus:ring-[#38D39F]/50 focus:border-[#38D39F] outline-none transition text-white placeholder:text-[#6B7280] text-sm"
                        placeholder="John Doe"
                      />
                    </div>

                    <div>
                      <label htmlFor="email" className="block text-sm font-medium text-[#D4D6D7] mb-1.5">
                        Work Email <span className="text-[#38D39F]">*</span>
                      </label>
                      <input
                        type="email"
                        id="email"
                        name="email"
                        required
                        value={formData.email}
                        onChange={handleChange}
                        className="w-full px-3.5 py-2.5 bg-[#0B0D0E] border border-[#2A2D2F] rounded-lg focus:ring-2 focus:ring-[#38D39F]/50 focus:border-[#38D39F] outline-none transition text-white placeholder:text-[#6B7280] text-sm"
                        placeholder="john@company.com"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="company" className="block text-sm font-medium text-[#D4D6D7] mb-1.5">
                        Company <span className="text-[#38D39F]">*</span>
                      </label>
                      <input
                        type="text"
                        id="company"
                        name="company"
                        required
                        value={formData.company}
                        onChange={handleChange}
                        className="w-full px-3.5 py-2.5 bg-[#0B0D0E] border border-[#2A2D2F] rounded-lg focus:ring-2 focus:ring-[#38D39F]/50 focus:border-[#38D39F] outline-none transition text-white placeholder:text-[#6B7280] text-sm"
                        placeholder="Acme Inc."
                      />
                    </div>

                    <div>
                      <label htmlFor="role" className="block text-sm font-medium text-[#D4D6D7] mb-1.5">
                        Your Role
                      </label>
                      <input
                        type="text"
                        id="role"
                        name="role"
                        value={formData.role}
                        onChange={handleChange}
                        className="w-full px-3.5 py-2.5 bg-[#0B0D0E] border border-[#2A2D2F] rounded-lg focus:ring-2 focus:ring-[#38D39F]/50 focus:border-[#38D39F] outline-none transition text-white placeholder:text-[#6B7280] text-sm"
                        placeholder="CTO, Partner, etc."
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="companySize" className="block text-sm font-medium text-[#D4D6D7] mb-1.5">
                      Company Size
                    </label>
                    <select
                      id="companySize"
                      name="companySize"
                      value={formData.companySize}
                      onChange={handleChange}
                      className="w-full px-3.5 py-2.5 bg-[#0B0D0E] border border-[#2A2D2F] rounded-lg focus:ring-2 focus:ring-[#38D39F]/50 focus:border-[#38D39F] outline-none transition text-white text-sm appearance-none cursor-pointer"
                      style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236B7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: "right 0.75rem center",
                        backgroundSize: "1.25rem",
                      }}
                    >
                      <option value="" className="bg-[#0B0D0E]">Select company size</option>
                      {companySizes.map((size) => (
                        <option key={size.value} value={size.value} className="bg-[#0B0D0E]">
                          {size.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="message" className="block text-sm font-medium text-[#D4D6D7] mb-1.5">
                      How can we help? <span className="text-[#38D39F]">*</span>
                    </label>
                    <textarea
                      id="message"
                      name="message"
                      required
                      rows={3}
                      value={formData.message}
                      onChange={handleChange}
                      className="w-full px-3.5 py-2.5 bg-[#0B0D0E] border border-[#2A2D2F] rounded-lg focus:ring-2 focus:ring-[#38D39F]/50 focus:border-[#38D39F] outline-none transition resize-none text-white placeholder:text-[#6B7280] text-sm"
                      placeholder="Tell us about the AI solutions you want to offer your clients..."
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="mt-6 w-full bg-[#38D39F] hover:bg-[#45E4AE] text-[#0B0D0E] font-semibold py-3 px-6 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSubmitting ? "Submitting..." : "Submit Application"}
                </button>

                <p className="mt-4 text-xs text-[#6B7280] text-center">
                  We'll review your application and get back to you within 48 hours.
                </p>
              </form>
            </>
          ) : (
            <div className="text-center py-10">
              <div className="mb-5 inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#38D39F]/10">
                <svg
                  className="h-8 w-8 text-[#38D39F]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Application Received</h3>
              <p className="text-[#9BA0A2] text-sm">
                Thank you for your interest in partnering with us.<br />
                We'll be in touch soon.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
