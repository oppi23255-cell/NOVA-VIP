export interface CollectedUpload {
  kind: 'zip' | 'folder';
  label: string;
  zipFile?: File;
  files?: Array<{ file: File; relPath: string }>;
  totalBytes: number;
}

const SKIP_SEGMENTS = new Set(['node_modules', '.git', '__MACOSX', '.DS_Store']);

function shouldSkipPath(relPath: string): boolean {
  const parts = relPath.split('/');
  return parts.some((p) => SKIP_SEGMENTS.has(p));
}

async function readEntryRecursively(
  entry: FileSystemEntry,
  prefix: string,
  out: Array<{ file: File; relPath: string }>,
): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject);
    });
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!shouldSkipPath(relPath)) {
      out.push({ file, relPath });
    }
    return;
  }

  if (entry.isDirectory) {
    if (SKIP_SEGMENTS.has(entry.name)) return;
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();

    const readBatch = (): Promise<FileSystemEntry[]> =>
      new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });

    let batch = await readBatch();
    while (batch.length > 0) {
      const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      for (const child of batch) {
        await readEntryRecursively(child, nextPrefix, out);
      }
      batch = await readBatch();
    }
  }
}

export async function collectFromDropEvent(
  dataTransfer: DataTransfer,
): Promise<CollectedUpload | null> {
  const items = Array.from(dataTransfer.items || []);
  const entries = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => Boolean(e));

  if (
    entries.length === 1 &&
    entries[0].isFile &&
    entries[0].name.toLowerCase().endsWith('.zip')
  ) {
    const file = dataTransfer.files[0];
    if (!file) return null;
    return {
      kind: 'zip',
      label: file.name,
      zipFile: file,
      totalBytes: file.size,
    };
  }

  if (entries.length > 0) {
    const collected: Array<{ file: File; relPath: string }> = [];
    for (const entry of entries) {
      await readEntryRecursively(entry, '', collected);
    }
    if (collected.length === 0) return null;
    const totalBytes = collected.reduce((acc, item) => acc + item.file.size, 0);
    const rootLabel =
      entries.length === 1 ? entries[0].name : `${collected.length} ملف`;
    return {
      kind: 'folder',
      label: rootLabel,
      files: collected,
      totalBytes,
    };
  }

  const droppedFiles = Array.from(dataTransfer.files || []);
  if (droppedFiles.length === 1 && droppedFiles[0].name.toLowerCase().endsWith('.zip')) {
    return {
      kind: 'zip',
      label: droppedFiles[0].name,
      zipFile: droppedFiles[0],
      totalBytes: droppedFiles[0].size,
    };
  }
  if (droppedFiles.length > 0) {
    const mapped = droppedFiles
      .map((f) => ({
        file: f,
        relPath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
      }))
      .filter((item) => !shouldSkipPath(item.relPath));
    return {
      kind: 'folder',
      label: droppedFiles.length === 1 ? droppedFiles[0].name : `${mapped.length} ملف`,
      files: mapped,
      totalBytes: mapped.reduce((acc, i) => acc + i.file.size, 0),
    };
  }

  return null;
}

export function collectFromFileList(
  fileList: FileList,
  kind: 'zip' | 'folder' | 'files',
): CollectedUpload | null {
  const arr = Array.from(fileList);
  if (arr.length === 0) return null;

  if (kind === 'zip' || (arr.length === 1 && arr[0].name.toLowerCase().endsWith('.zip'))) {
    const zip = arr[0];
    return {
      kind: 'zip',
      label: zip.name,
      zipFile: zip,
      totalBytes: zip.size,
    };
  }

  const mapped = arr
    .map((f) => ({
      file: f,
      relPath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
    }))
    .filter((item) => !shouldSkipPath(item.relPath));

  if (mapped.length === 0) return null;
  const firstRoot =
    arr.length === 1
      ? arr[0].name
      : mapped[0].relPath.split('/')[0] || 'فولدر المشروع';
  return {
    kind: 'folder',
    label: firstRoot,
    files: mapped,
    totalBytes: mapped.reduce((acc, item) => acc + item.file.size, 0),
  };
}

export function buildFormDataFromUpload(
  upload: CollectedUpload,
  extraFields?: Record<string, string>,
): FormData {
  const fd = new FormData();
  if (extraFields) {
    for (const [k, v] of Object.entries(extraFields)) {
      fd.append(k, v);
    }
  }
  if (upload.kind === 'zip' && upload.zipFile) {
    fd.append('zipFile', upload.zipFile);
  } else if (upload.files) {
    const paths = upload.files.map((item) => item.relPath);
    fd.append('paths', JSON.stringify(paths));
    for (const item of upload.files) {
      fd.append('files', item.file, item.file.name);
    }
  }
  return fd;
}
