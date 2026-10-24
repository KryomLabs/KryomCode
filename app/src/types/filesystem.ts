/**
 * Filesystem types derived from the existing Electron preload API.
 * Keep vite-env.d.ts as the single source of truth for IPC contracts.
 */

export type FileEntry =
  Awaited<ReturnType<KryomCodeAPI["readDirectory"]>>[number];

export type FileEntryType = FileEntry["type"];

export type WriteFileResult =
  Awaited<ReturnType<KryomCodeAPI["writeFile"]>>;

export type CreateFileResult =
  Awaited<ReturnType<KryomCodeAPI["createFile"]>>;

export type CreateFolderResult =
  Awaited<ReturnType<KryomCodeAPI["createFolder"]>>;

export type RenameResult =
  Awaited<ReturnType<KryomCodeAPI["rename"]>>;

export type DeleteResult =
  Awaited<ReturnType<KryomCodeAPI["delete"]>>;