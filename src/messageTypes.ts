export interface Entry {
  uri: string;
  name: string;
  directory: boolean;
  extension: string;
  modified?: number;
}
export interface Column {
  uri: string;
  name: string;
  entries: Entry[];
  selected?: string;
  collapsed?: boolean;
  error?: string;
}
export interface Metadata {
  name: string;
  extension: string;
  size: number;
  path: string;
}
export interface ExplorerState {
  type: "state";
  roots: { uri: string; name: string }[];
  root: string;
  columns: Column[];
  metadata?: Metadata;
  showHidden: boolean;
  foldersFirst: boolean;
  sortBy?: "name" | "modified";
  busy: boolean;
  operationBusy?: boolean;
  error?: string;
}
export interface OperationMessage {
  type: "operation";
  requestId: string;
  action:
    | "transfer"
    | "move"
    | "trash"
    | "rename"
    | "add"
    | "upload-start"
    | "upload-chunk"
    | "upload-finish"
    | "upload-cancel";
  uris?: string[];
  target?: string;
  copy?: boolean;
  uploadId?: string;
  relativePath?: string;
  data?: string;
  offset?: number;
  directory?: boolean;
}
export type ClientMessage =
  | OperationMessage
  | { type: "ready" | "refresh" }
  | { type: "root"; uri: string }
  | { type: "select"; uri: string; column: number; toggle?: boolean }
  | { type: "open" | "external" | "reveal" | "copy"; uri: string }
  | {
      type: "options";
      showHidden: boolean;
      foldersFirst: boolean;
      sortBy?: "name" | "modified";
    };
