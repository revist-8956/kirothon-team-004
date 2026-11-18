import type { ReactNode } from "react";

/**
 * Pass-through layout. Each page under /notifications calls `requireUser`
 * with its own path, so login returns the user to that exact page (compose,
 * schedule with its draft, or a response status link). A guard here would
 * run in parallel with the page and could redirect with a generic path.
 */
export default function NotificationsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
