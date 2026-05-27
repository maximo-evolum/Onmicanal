"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MENU_WIDTH = 220;

export default function AppMenu({ trigger, children }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  function calculatePosition() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportPadding = 12;
    const left = Math.max(
      viewportPadding,
      Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - viewportPadding)
    );
    setPosition({ top: rect.bottom + 8, left });
  }

  function toggle() {
    if (!open) calculatePosition();
    setOpen((value) => !value);
  }

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }

    function handleReposition() {
      calculatePosition();
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [open]);

  return (
    <>
      <span ref={triggerRef} onClick={toggle} style={{ display: "inline-flex" }}>
        {trigger}
      </span>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              className="app-menu-portal"
              style={{ position: "fixed", top: position.top, left: position.left, zIndex: 99999 }}
              onClick={() => setOpen(false)}
            >
              {children}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
