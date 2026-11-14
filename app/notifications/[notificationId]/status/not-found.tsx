import { RouteNotFoundState } from "@/components/states";

import { appRoutes } from "@/components/navigation";

export default function NotificationStatusNotFound() {
  return <RouteNotFoundState href={appRoutes.sent} actionLabel="보낸 알림으로 이동" />;
}
