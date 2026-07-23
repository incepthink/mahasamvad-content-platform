export type PublishResult = Readonly<{
  postId: string;
  postUrl: string;
}>;

// Thrown for any upstream (X / Facebook) failure. The message is what the API
// surfaces to the user, so it must be readable on its own; keep the raw upstream
// error in `cause` for logs.
export class SocialPublishError extends Error {
  constructor(message: string, options?: ErrorOptions | undefined) {
    super(message, options);
    this.name = 'SocialPublishError';
  }
}
