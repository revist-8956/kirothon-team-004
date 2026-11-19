import { redirect } from "next/navigation";

import { appRoutes } from "@/components/navigation";

/**
 * The app has no landing page: `/` opens the received notifications. A
 * signed-out visitor is sent on to `/login` by the inbox guard and returns
 * to `/inbox` after signing in.
 */
export default function HomePage(): never {
  redirect(appRoutes.inbox);
}
