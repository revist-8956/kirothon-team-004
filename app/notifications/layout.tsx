import type { ReactNode } from "react";

import { requireUser } from "@/application/authentication";

export default async function NotificationsLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  await requireUser("/notifications/new");

  return children;
}
