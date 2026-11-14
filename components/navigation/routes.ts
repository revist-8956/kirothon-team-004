export const appRoutes = {
  inbox: "/inbox",
  sent: "/sent",
  friends: "/friends",
  groups: "/groups",
  composePersonal: "/notifications/new?mode=personal",
  composeGroup: "/notifications/new?mode=group",
  schedule: "/notifications/new/schedule",
} as const;

export function groupDetailRoute(groupId: string) {
  return `/groups/${encodeURIComponent(groupId)}`;
}

export function notificationStatusRoute(notificationId: string) {
  return `/notifications/${encodeURIComponent(notificationId)}/status`;
}
