export interface Entry {
  uri: string;
  name: string;
  directory: boolean;
  extension: string;
}
export interface Column {
  uri: string;
  name: string;
  entries: Entry[];
  selected?: string;
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
  busy: boolean;
  error?: string;
}
export type ClientMessage =
  | { type: "ready" | "refresh" }
  | { type: "root"; uri: string }
  | { type: "select"; uri: string; column: number }
  | { type: "open" | "external" | "reveal" | "copy"; uri: string }
  | { type: "options"; showHidden: boolean; foldersFirst: boolean };
