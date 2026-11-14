import type { ReactNode } from "react";

import { requireUser } from "@/application/authentication";

export default async function GroupsLayout({ children }: Readonly<{ children: ReactNode }>) {
  await requireUser("/groups");

  return children;
}
