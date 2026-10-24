import { getKryomCodeAPI } from "./ipc";
import type {
  CreateFileResult,
  CreateFolderResult,
  DeleteResult,
  FileEntry,
  RenameResult,
  WriteFileResult,
} from "../types/filesystem";

export const filesystemService = {
  selectProject(): Promise<string | null> {
    return getKryomCodeAPI().selectProject();
  },

  readDirectory(directoryPath: string): Promise<FileEntry[]> {
    return getKryomCodeAPI().readDirectory(directoryPath);
  },

  readFile(filePath: string): Promise<string> {
    return getKryomCodeAPI().readFile(filePath);
  },

  writeFile(
    filePath: string,
    content: string,
  ): Promise<WriteFileResult> {
    return getKryomCodeAPI().writeFile(filePath, content);
  },

  createFile(filePath: string): Promise<CreateFileResult> {
    return getKryomCodeAPI().createFile(filePath);
  },

  createFolder(
    directoryPath: string,
  ): Promise<CreateFolderResult> {
    return getKryomCodeAPI().createFolder(directoryPath);
  },

  rename(
    oldPath: string,
    newPath: string,
  ): Promise<RenameResult> {
    return getKryomCodeAPI().rename(oldPath, newPath);
  },

  delete(
    targetPath: string,
    targetType: "file" | "directory",
  ): Promise<DeleteResult> {
    return getKryomCodeAPI().delete(targetPath, targetType);
  },
};