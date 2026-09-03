'use client';

// /new-video-workflow — a new Gemini video conversation.
//
// The conversation row is NOT created here. It is created by the first turn (see
// useNewVideoWorkflow), so opening this page and walking away leaves nothing behind, and the
// rail never fills with empty rows that everyone can see.

import { NewVideoWorkspace } from '../../components/NewVideoWorkspace';

export default function NewVideoWorkflowPage() {
  return <NewVideoWorkspace conversationId={null} />;
}
