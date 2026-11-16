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

const CHUNK_BYTE_LIMIT = 1024 * 1024; // 1 MB raw -> ~1.33 MB JSON base64

export async function uploadAndInspectChunked(
  upload: CollectedUpload,
  onProgress?: (percent: number) => void,
): Promise<{ uploadId: string; detection: ProjectDetection }> {
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
      onProgress?.(Math.min(95, Math.round((offset / total) * 95)));
    }
  } else if (upload.files && upload.files.length > 0) {
    const totalBytes = Math.max(
      upload.files.reduce((acc, f) => acc + f.file.size, 0),
      1,
    );
    let sentBytes = 0;
    let batch: Array<{ relPath: string; dataBase64: string }> = [];
    let batchBytes = 0;

    for (const item of upload.files) {
      // Skip individual files > 8 MB to avoid single-chunk proxy rejection
      if (item.file.size > 8 * 1024 * 1024) {
        sentBytes += item.file.size;
        continue;
      }
      const buf = await item.file.arrayBuffer();
      const b64 = arrayBufferToBase64(buf);

      if (batch.length > 0 && batchBytes + item.file.size > CHUNK_BYTE_LIMIT) {
        await safeFetchJson<{ ok: boolean }>(
          `/api/uploads/${encodeURIComponent(uploadId)}/chunk`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: batch }),
          },
        );
        batch = [];
        batchBytes = 0;
      }

      batch.push({ relPath: item.relPath, dataBase64: b64 });
      batchBytes += item.file.size;
      sentBytes += item.file.size;
      onProgress?.(Math.min(95, Math.round((sentBytes / totalBytes) * 95)));
    }

    if (batch.length > 0) {
      await safeFetchJson<{ ok: boolean }>(
        `/api/uploads/${encodeURIComponent(uploadId)}/chunk`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: batch }),
        },
      );
    }
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
