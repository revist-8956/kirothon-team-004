import { RouteNotFoundState } from "@/components/states";

import { appRoutes } from "@/components/navigation";

export default function FriendsNotFound() {
  return <RouteNotFoundState href={appRoutes.friends} actionLabel="친구 목록으로 이동" />;
}
