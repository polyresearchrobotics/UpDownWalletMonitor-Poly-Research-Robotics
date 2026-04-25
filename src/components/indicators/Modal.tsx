"use client";

import { useEffect } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  widthClass?: string;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  widthClass = "max-w-[720px]",
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 py-16 overflow-y-auto"
      style={{ background: "rgba(4, 5, 8, 0.72)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className={`card w-full ${widthClass} relative`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-start justify-between gap-6 px-7 md:px-8 pt-7 pb-5"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <div className="text-[15px] font-semibold text-[var(--foreground)]">
              {title}
            </div>
            {description && (
              <div className="mt-1 text-[12.5px] text-[var(--muted-foreground)]">
                {description}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn btn-ghost h-8 w-8 p-0"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="px-7 md:px-8 py-7">{children}</div>
      </div>
    </div>
  );
}
