-- /chat reads a PDF through the File Search tool instead of Responses file input.
--
-- WHY: `input_file` puts the whole document in the request, and OpenAI caps that path at
-- 50 MB of file input per request. File Search is a different product with a different
-- ceiling — 512 MB per file, 5,000,000 tokens per file, 10,000 files per vector store — so
-- an officer's 200 MB scanned compendium is answerable where it previously could not even
-- be uploaded.
--
-- ONE VECTOR STORE PER THREAD, not per file. The Responses file_search tool takes a
-- `vector_store_ids` array, but in practice only the FIRST id is searched, so a chat with
-- three PDFs must have all three in ONE store or the officer silently loses two of them.
-- The store is created lazily on the first document turn and deleted with the thread —
-- unlike the source objects in storage, which are deliberately left behind, because a
-- vector store is billed per GB per day and nothing else would ever come back for it.
--
-- `chat_files.vector_store_id` records the store a file has finished indexing into. It is
-- what makes attaching idempotent: a follow-up turn about the same PDF re-uses the index
-- instead of paying to chunk and embed it again.
--
-- Additive and nullable on both tables. The columns 0048 left behind stay as they are.

alter table chat_threads
  add column if not exists vector_store_id text;

alter table chat_files
  add column if not exists vector_store_id text;
