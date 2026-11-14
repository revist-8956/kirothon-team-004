import type { ReactNode } from "react";

import { requireUser } from "@/application/authentication";

export default async function FriendsLayout({ children }: Readonly<{ children: ReactNode }>) {
  await requireUser("/friends");

  return children;
}
