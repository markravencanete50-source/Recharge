// Reads a multipart upload with a size cap, without holding extra copies of the body: an
// oversized Content-Length is refused before reading, and the bytes are counted as they stream
// into the form parser, so a missing or false length can't get round the cap either.
export async function boundedFormData(request: Request, limit: number): Promise<FormData | 'too-large' | null> {
  const type = request.headers.get('Content-Type');
  if (!type?.startsWith('multipart/form-data;') || !request.body) return null;
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > limit) return 'too-large';
  let size = 0, over = false;
  const counted = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > limit) { over = true; controller.error(new Error('too-large')); return; }
      controller.enqueue(chunk);
    },
  }));
  try { return await new Response(counted, { headers: { 'Content-Type': type } }).formData(); }
  catch { return over ? 'too-large' : null; }
}
