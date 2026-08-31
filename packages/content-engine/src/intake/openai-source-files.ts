// Uploading a source file to OpenAI and referencing it by id — the transport the new /dlo
// lane rests on.
//
// The old lane turned every document into TEXT first: page by page, one model call per page,
// minutes of waiting before an officer saw anything. The new one never does that. A PDF,
// DOCX, TXT or photograph is uploaded ONCE, and every later call — the name check, the
// article itself — carries only the returned id as an `input_file` (or `input_image`) part.
// The bytes cross the wire once per document rather than once per page per call.
//
// WHY THE UPLOAD HAPPENS AT ATTACH TIME, not at generate time: the officer is typing their
// note while it runs, so the wait is spent on work they were going to do anyway. It is the
// same trade /chat makes for its attachments (see the 0048 milestone in AGENTS.md), and it
// is the whole reason this lane feels immediate where the page-by-page one did not.
//
// THE FILES ARE NOT DELETED WHEN THE READ FINISHES, which is the one place this differs from
// `openai-doc.ts`. There, a chunk is uploaded, read into text, and the upload is rubbish the
// moment the text exists. Here the file IS the source — there is no text standing in for it —
// so it must still be there for a retry, for a second article from the same intake, and for
// an article-feedback round. `deleteSourceFile` exists for the caller that is abandoning an
// upload it just made (a create that failed after the upload succeeded), not as cleanup after
// a successful read.

import { openAiFetch } from '../http/openai-request.js';

const FILES_URL = 'https://api.openai.com/v1/files';

// Generous: a 50 MB scan on a slow uplink is a real upload, not a hung request.
const UPLOAD_TIMEOUT_MS = Number.parseInt(
  process.env.OPENAI_FILE_UPLOAD_TIMEOUT_MS ?? `${10 * 60_000}`,
  10,
);

function requireApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set.');
  return key;
}

/**
 * What one uploaded source is, once it is on OpenAI. Stored on the intake's `files` jsonb
 * entry, which is why it is a plain serializable shape and carries no bytes.
 */
export type SourceFileRef = Readonly<{
  fileId: string;
  // Decides which Responses part the file becomes: a photograph is `input_image`, everything
  // else `input_file`. Kept as the caller's own word for the source rather than a MIME type,
  // because that is what the intake row already stores.
  kind: 'document' | 'image';
  // The officer's own file name, used only to label the source inside the prompt so the model
  // can say which document a fact came from. Never shown to OpenAI as the upload's name.
  name: string;
}>;

type UploadedFileResponse = Readonly<{ id?: unknown }>;

// A plain ASCII upload name keeps the multipart body predictable, and the real name travels
// in the prompt instead. The extension is preserved because the API infers how to parse the
// file from it — a PDF uploaded as `source` with no extension is rejected.
function uploadName(fileName: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(fileName.trim());
  return match ? `source.${match[1]!.toLowerCase()}` : 'source';
}

/**
 * Uploads one source file and returns the id every later call references.
 *
 * `purpose: 'user_data'` is the documented purpose for model inputs — the same one /chat's
 * attachment upload and `openai-doc.ts`'s chunk upload use.
 */
export async function uploadSourceFile(
  data: Buffer,
  fileName: string,
  contentType: string,
): Promise<string> {
  const formData = new FormData();
  formData.append('purpose', 'user_data');
  formData.append(
    'file',
    new Blob([new Uint8Array(data)], { type: contentType }),
    uploadName(fileName),
  );
  const response = await openAiFetch(FILES_URL, {
    label: `source upload (${fileName})`,
    apiKey: requireApiKey(),
    // The 'ocr' lane, not 'default': this is document reading traffic, and putting it in the
    // serialized article lane would make one officer's upload block another's generation.
    lane: 'ocr',
    timeoutMs: UPLOAD_TIMEOUT_MS,
    formData,
  });
  const uploaded = (await response.json()) as UploadedFileResponse;
  if (typeof uploaded.id !== 'string' || uploaded.id === '') {
    throw new Error(
      `${fileName}: OpenAI accepted the file but returned no reusable file id.`,
    );
  }
  return uploaded.id;
}

/**
 * Best-effort removal of an upload the caller is abandoning. Never throws: the caller is
 * already handling a failure, and a leaked file is a far smaller problem than a second error
 * thrown while reporting the first.
 */
// It bypasses openAiFetch deliberately, exactly as `openai-doc.ts`'s cleanup does: that
// transport is POST-only, and its retry ladder is sized for calls whose failure costs money.
// What an undeleted file costs is org storage, so the failure is logged loudly enough to
// notice a leak.
export async function deleteSourceFile(fileId: string): Promise<void> {
  try {
    const response = await fetch(`${FILES_URL}/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${requireApiKey()}` },
    });
    if (!response.ok) {
      console.warn(
        `[source-files] could not delete ${fileId} (HTTP ${response.status}); it will count against org storage.`,
      );
    }
  } catch (error) {
    console.warn(`[source-files] could not delete ${fileId}:`, error);
  }
}
