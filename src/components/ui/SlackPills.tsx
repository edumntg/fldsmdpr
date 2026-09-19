import { ArrowUpRight, ArrowDownLeft, AtSign, MessageSquareText, Hourglass } from "lucide-react";
import type { AppNotification } from "../../lib/types";
import { Chip } from "./Chip";

/** Direction + kind of a Slack item: "You sent · awaiting reply", "DM from X", "Mention", "Thread". */
export function SlackPills({ n, compact = false }: { n: AppNotification; compact?: boolean }) {
  if (n.source !== "slack") return null;
  const sent = n.meta?.direction === "sent";
  const kind = n.meta?.kind;
  return (
    <>
      {sent ? (
        <Chip tone="accent">
          <ArrowUpRight size={10} />
          You sent
        </Chip>
      ) : (
        <Chip>
          <ArrowDownLeft size={10} />
          {compact ? "Received" : `From ${n.meta?.from ?? "someone"}`}
        </Chip>
      )}
      {n.type === "follow_up" && (
        <Chip tone="warning">
          <Hourglass size={10} />
          Awaiting reply
        </Chip>
      )}
      {kind === "dm" && <Chip tone="neutral">DM</Chip>}
      {kind === "mention" && (
        <Chip tone="neutral">
          <AtSign size={10} />
          Mention
        </Chip>
      )}
      {kind === "thread" && (
        <Chip tone="neutral">
          <MessageSquareText size={10} />
          Thread
        </Chip>
      )}
    </>
  );
}
