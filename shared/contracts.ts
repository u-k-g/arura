import type { DataModel } from "../convex/_generated/server.ts";
import type { Message, Turn } from "./model.ts";

export type Doc<Table extends keyof DataModel> = DataModel[Table]["document"];
export type Workspace = {
  deviceId: string;
  readBaseline?: number;
  reads?: Doc<"conversationReads">[];
  conversations: Doc<"conversations">[];
  folders: Doc<"folders">[];
  notices: Doc<"notices">[];
  connection: Doc<"connection"> | null;
  settings: Record<string, unknown> & {
    hiddenModels?: string[];
    autoArchiveDays?: number;
    archiveDays?: number;
  };
  recentCursor: string;
  recentHasMore: boolean;
};
export type ConversationPage = {
  page: Doc<"conversations">[];
  isDone: boolean;
  continueCursor: string;
};
export type Transcript = {
  pages: (Omit<Doc<"pages">, "messages"> & { messages: Message[] })[];
  turn: Turn | null;
  commands: Doc<"commands">[];
};
export type ArtifactList = {
  items: (Doc<"artifacts"> & { title: string })[];
  pending: number;
  failures: number;
  hasMore: boolean;
};
export type RpcEvent = {
  type?: string;
  session_id?: string;
  seq?: number;
  payload?: Record<string, unknown>;
};
export type RpcFrame = {
  id?: number;
  method?: string;
  params?: RpcEvent;
  error?: { message: string; code?: number };
  result?: RpcResult;
};
export type RpcResult = Record<string, unknown> & {
  session_id?: string;
  type?: string;
  message?: string;
  text?: string;
  status?: string;
  dispatch?: RpcResult;
  remaining?: string[];
  events?: (RpcFrame & RpcEvent)[];
  profiles?: {
    name: string;
    display_name?: string;
    canonical_session?: {
      resolved_id?: string;
      id?: string;
      last_active?: number;
      started_at?: number;
    };
    ui_meta?: Record<string, { title?: string }>;
  }[];
  control?: Record<
    string,
    {
      status?: string;
      interval_seconds?: number;
      contract?: { verification?: string };
    }
  >;
  inflight?: {
    assistant?: string;
    started_at?: number;
    status?: string;
    error?: string;
  };
  pending_approval?: Record<string, unknown>;
  pending_clarify?: Record<string, unknown>;
};
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}
