const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const Ids = {
  selectQueue: "queue:select",
  refresh: "queue:refresh",
  leave: "queue:leave",
  leaveConfirm: "queue:leave:confirm",
  leaveCancel: "queue:leave:cancel",
  myStatus: "queue:status",
  joinOpen: "queue:join-open",
  joinModal: "queue:join",
  joinModalPrefix: "queue:join:",
  afk: "queue:afk",
  lineup: "queue:lineup",
  dispatch: "admin:dispatch",
  adminSelectQueue: "admin:queue",
  adminSelectEntry: "admin:entry",
  adminPause: "admin:pause",
  adminOpen: "admin:open",
  adminClose: "admin:close",
  adminClear: "admin:clear",
  adminClearConfirm: "admin:clear:confirm",
  adminClearCancel: "admin:clear:cancel",
  adminRefresh: "admin:refresh",
  adminSkip: "admin:skip",
  adminComplete: "admin:complete",
  adminRemove: "admin:remove",
  adminMoveUp: "admin:move-up",
  adminMoveDown: "admin:move-down",
  sendJoSelect: "sendjo:queue",
  sendJoModal: "sendjo:modal",
  sendJoYesPrefix: "sendjo:yes:",
  sendJoNoPrefix: "sendjo:no:",
  joinJobFieldPrefix: "j:",
};

export function parseJoinModal(customId: string): "pending" | string | null {
  if (customId === Ids.joinModal) return "pending";
  if (!customId.startsWith(Ids.joinModalPrefix)) return null;
  const queueId = customId.slice(Ids.joinModalPrefix.length);
  return UUID_RE.test(queueId) ? queueId : null;
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function joinJobBoundFieldId(queueId: string, bound: "max" | "min"): string {
  return `${Ids.joinJobFieldPrefix}${bound}:${queueId}`;
}

export function parseSendJoButton(
  customId: string,
): { accepted: boolean; token: string } | null {
  if (customId.startsWith(Ids.sendJoYesPrefix)) {
    const token = customId.slice(Ids.sendJoYesPrefix.length);
    return UUID_RE.test(token) ? { accepted: true, token } : null;
  }
  if (customId.startsWith(Ids.sendJoNoPrefix)) {
    const token = customId.slice(Ids.sendJoNoPrefix.length);
    return UUID_RE.test(token) ? { accepted: false, token } : null;
  }
  return null;
}
