import type { ReactNode } from "react";

import { requireUser } from "@/application/authentication";

export default async function SentLayout({ children }: Readonly<{ children: ReactNode }>) {
  await requireUser("/sent");

  return children;
}
