import type { ProjectDetection } from '../types';
import type { CollectedUpload } from './folderUpload';

export async function safeFetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(input, init);
  const rawText = await res.text();

  let parsed: unknown = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const preview = rawText.replace(/<[^>]+>/g, ' ').trim().slice(0, 140);
      if (res.status === 413) {
        throw new Error('حجم الطلب كبير جداً على الخادم الوسيط');
      }
      throw new Error(
        `استجاب الخادم بتنسيق غير متوقع (HTTP ${res.status}): ${preview || 'تعذر الاتصال بالخادم'}`,
      );
    }
  }

  if (!res.ok) {
    const errObj = parsed as { error?: string } | null;
    throw new Error(
      errObj?.error || `فشل الطلب برمز حالة HTTP ${res.status}`,
    );
  }

  return parsed as T;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

export interface InlineUploadPayload {
  kind: 'zip' | 'folder';
  dataBase64?: string;
  files?: Array<{ relPath: string; dataBase64: string }>;
}

const CHUNK_BYTE_LIMIT = Math.floor(2.5 * 1024 * 1024); // 2.5 MB raw -> ~3.3 MB JSON base64
const INLINE_RAW_LIMIT = Math.floor(2.8 * 1024 * 1024); // ~3.7 MB JSON base64 (fits Vercel 4.5 MB limit)
const UPLOAD_CONCURRENCY = 3;

async function encodeFilesParallel(
  items: Array<{ file: File; relPath: string }>,
): Promise<Array<{ relPath: string; dataBase64: string; size: number }>> {
  const results: Array<{ relPath: string; dataBase64: string; size: number }> = [];
  const validItems = items.filter((item) => item.file.size <= 8 * 1024 * 1024);
  const CONCURRENCY = 8;
  for (let i = 0; i < validItems.length; i += CONCURRENCY) {
    const slice = validItems.slice(i, i + CONCURRENCY);
    const encoded = await Promise.all(
      slice.map(async (item) => {
        const buf = await item.file.arrayBuffer();
        return {
          relPath: item.relPath,
          dataBase64: arrayBufferToBase64(buf),
          size: item.file.size,
        };
      }),
    );
    results.push(...encoded);
  }
  return results;
}

export async function uploadAndInspectChunked(
  upload: CollectedUpload,
  onProgress?: (percent: number) => void,
  options?: { preferInline?: boolean },
): Promise<{
  uploadId: string;
  detection: ProjectDetection;
  inlinePayload?: InlineUploadPayload;
}> {
  const totalRawBytes =
    upload.kind === 'zip' && upload.zipFile
      ? upload.zipFile.size
      : (upload.files || []).reduce((acc, f) => acc + f.file.size, 0);

  if (options?.preferInline && totalRawBytes > 0 && totalRawBytes <= INLINE_RAW_LIMIT) {
    onProgress?.(25);
    let inlinePayload: InlineUploadPayload;

    if (upload.kind === 'zip' && upload.zipFile) {
      const buf = await upload.zipFile.arrayBuffer();
      inlinePayload = {
        kind: 'zip',
        dataBase64: arrayBufferToBase64(buf),
      };
    } else if (upload.files && upload.files.length > 0) {
      const encoded = await encodeFilesParallel(upload.files);
      inlinePayload = {
        kind: 'folder',
        files: encoded.map(({ relPath, dataBase64 }) => ({ relPath, dataBase64 })),
      };
    } else {
      throw new Error('لم يتم اختيار أي ملفات صالحة للرفع');
    }

    onProgress?.(65);
    const inspected = await safeFetchJson<{ detection: ProjectDetection }>(
      '/api/inspect-inline',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inlinePayload),
      },
    );
    onProgress?.(100);
    return {
      uploadId: '__inline__',
      detection: inspected.detection,
      inlinePayload,
    };
  }

  const { uploadId } = await safeFetchJson<{ uploadId: string }>(
    '/api/uploads/start',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: upload.kind }),
    },
  );

  if (upload.kind === 'zip' && upload.zipFile) {
    const file = upload.zipFile;
    const total = Math.max(file.size, 1);
    let offset = 0;

    while (offset < file.size) {
      const end = Math.min(offset + CHUNK_BYTE_LIMIT, file.size);
      const sliceBuf = await file.slice(offset, end).arrayBuffer();
      const dataBase64 = arrayBufferToBase64(sliceBuf);

      await safeFetchJson<{ ok: boolean }>(
        `/api/uploads/${encodeURIComponent(uploadId)}/chunk`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataBase64 }),
        },
      );

      offset = end;
      onProgress?.(Math.min(92, Math.round((offset / total) * 92)));
    }
  } else if (upload.files && upload.files.length > 0) {
    onProgress?.(10);
    const encodedFiles = await encodeFilesParallel(upload.files);
    const totalBytes = Math.max(
      encodedFiles.reduce((acc, f) => acc + f.size, 0),
      1,
    );

    const batches: Array<{
      files: Array<{ relPath: string; dataBase64: string }>;
      bytes: number;
    }> = [];
    let currentFiles: Array<{ relPath: string; dataBase64: string }> = [];
    let currentBytes = 0;

    for (const item of encodedFiles) {
      if (currentFiles.length > 0 && currentBytes + item.size > CHUNK_BYTE_LIMIT) {
        batches.push({ files: currentFiles, bytes: currentBytes });
        currentFiles = [];
        currentBytes = 0;
      }
      currentFiles.push({ relPath: item.relPath, dataBase64: item.dataBase64 });
      currentBytes += item.size;
    }
    if (currentFiles.length > 0) {
      batches.push({ files: currentFiles, bytes: currentBytes });
    }

    let sentBytes = 0;
    let cursor = 0;

    const runWorker = async () => {
      while (cursor < batches.length) {
        const idx = cursor++;
        const batch = batches[idx];
        await safeFetchJson<{ ok: boolean }>(
          `/api/uploads/${encodeURIComponent(uploadId)}/chunk`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: batch.files }),
          },
        );
        sentBytes += batch.bytes;
        onProgress?.(Math.min(92, Math.round((sentBytes / totalBytes) * 92)));
      }
    };

    const workers = Array.from(
      { length: Math.min(UPLOAD_CONCURRENCY, Math.max(batches.length, 1)) },
      () => runWorker(),
    );
    await Promise.all(workers);
  } else {
    throw new Error('لم يتم اختيار أي ملفات صالحة للرفع');
  }

  const inspected = await safeFetchJson<{ detection: ProjectDetection }>(
    `/api/uploads/${encodeURIComponent(uploadId)}/inspect`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
  onProgress?.(100);

  return { uploadId, detection: inspected.detection };
}
