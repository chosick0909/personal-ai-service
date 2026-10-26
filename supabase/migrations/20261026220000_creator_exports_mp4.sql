-- The finished video is also stored on its own (output-<rev>.mp4) so students can play or save it without unzipping.
update storage.buckets set allowed_mime_types = array['application/zip','video/mp4'] where id = 'creator-exports';
