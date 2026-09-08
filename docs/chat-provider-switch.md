# Switch chat to GPT with the old production frontend

Frontend `11bb6c2d3d0d27f0f95abaa2d9005d6d458f8cf8` sends chat messages with
`content` and `attachments`, but no `provider`. Backend `b379910a318edb6ffcbe678a629e6c5cd158bb08`
therefore selects the shared `qwen` fallback. OpenAI model/key variables alone
cannot change that selection on the original backend.

The backend change following that commit adds `CHAT_DEFAULT_PROVIDER`. It is
resolved before attachment validation and model dispatch. Precedence is:

1. An explicit `provider` in the request.
2. The API's `CHAT_DEFAULT_PROVIDER` (`openai` or `qwen`, case-insensitive).
3. The existing shared Qwen fallback when the variable is unset or blank.

An invalid nonblank value fails before a message is saved. This setting affects
only general chat; `ARTICLE_PROVIDER` and the Qwen connection settings retain
their existing behavior. No frontend change, migration, or n8n change is needed.

## Deploy on EC2

Build and publish an API image containing this backend change. For `old-ui`, the
repository's **api image** workflow must be triggered manually on that
branch after pushing the change: automatic builds only run on `main`. Use the
short SHA image tag printed by the workflow, not `latest` (non-default branch
builds do not update `latest`).

In EC2's `deploy/.env.prod`, add:

```dotenv
CHAT_DEFAULT_PROVIDER=openai
```

Keep the existing `OPENAI_API_KEY` in that same file. The optional model settings
remain:

```dotenv
OPENAI_MISC_CHAT_MODEL=gpt-5.6-sol
OPENAI_MISC_CHAT_REASONING_EFFORT=low
```

Set `API_TAG` in EC2's `deploy/.env` to the built image's short SHA, then run from
the `deploy` directory:

```bash
docker compose pull api
docker compose up -d --force-recreate api
```

The container reads `deploy/.env.prod`, not the repository root `.env`. An env
edit alone cannot add this capability to the original `b379910` image, and
`docker compose restart` does not load changed environment values.

Send a message from the existing production frontend and inspect the saved
assistant message's `model` through the chat detail response. It should match
`OPENAI_MISC_CHAT_MODEL`. Verify the request omits `provider`; a newer client
explicitly requesting Qwen still takes precedence over this default.

To switch these legacy requests back, set `CHAT_DEFAULT_PROVIDER=qwen` and
recreate the API container. Keep `QWEN_*` configured for that lane.
