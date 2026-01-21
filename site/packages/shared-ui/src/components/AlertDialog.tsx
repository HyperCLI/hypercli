"use client";

import React from "react";
import Modal from "./Modal";

interface AlertDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  type?: "info" | "warning" | "error" | "success";
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void | Promise<void>;
  showCancel?: boolean;
}

export default function AlertDialog({
  isOpen,
  onClose,
  title,
  message,
  type = "info",
  confirmText = "OK",
  cancelText = "Cancel",
  onConfirm,
  showCancel = false,
}: AlertDialogProps) {
  const [isLoading, setIsLoading] = React.useState(false);

  const handleConfirm = async () => {
    if (onConfirm) {
      setIsLoading(true);
      try {
        await onConfirm();
        onClose();
      } catch (error) {
        console.error("Error in confirm handler:", error);
      } finally {
        setIsLoading(false);
      }
    } else {
      onClose();
    }
  };

  const getIconColor = () => {
    switch (type) {
      case "error":
        return "text-[#d05f5f]";
      case "warning":
        return "text-[#e0a85f]";
      case "success":
        return "text-[#3ad8a0]";
      default:
        return "text-[#38d39f]";
    }
  };

  const getIcon = () => {
    switch (type) {
      case "error":
        return (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case "warning":
        return (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      case "success":
        return (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      default:
        return (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  const getButtonColor = () => {
    switch (type) {
      case "error":
        return "bg-[#d05f5f] hover:bg-[#c04f4f] text-white";
      case "warning":
        return "bg-[#e0a85f] hover:bg-[#d09850] text-[#0b0d0e]";
      case "success":
        return "bg-[#3ad8a0] hover:bg-[#2dc890] text-[#0b0d0e]";
      default:
        return "bg-[#38d39f] hover:bg-[#45e4ae] text-[#0b0d0e]";
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="sm">
      <div className="space-y-4">
        <div className="flex gap-3">
          <div className={`flex-shrink-0 ${getIconColor()}`}>
            {getIcon()}
          </div>
          <p className="text-foreground text-sm leading-relaxed">{message}</p>
        </div>

        <div className="flex gap-3 justify-end pt-2">
          {showCancel && (
            <button
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-sm font-medium text-white bg-[#1d1f21] border border-[#2a2d2f] rounded-lg hover:bg-[#2a2d2f] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {cancelText}
            </button>
          )}
          <button
            onClick={handleConfirm}
            disabled={isLoading}
            className={`px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${getButtonColor()}`}
          >
            {isLoading ? "Processing..." : confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}
