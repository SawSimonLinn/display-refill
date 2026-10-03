# Contract fixtures

Synthetic JSON shared by TypeScript tests, the mock vision adapter and the iOS
mock client. Every key follows the snake_case convention in `src/json.ts`.

- `api/health.ok.json` — `GET /api/v1/health` when configuration is valid.
- `api/error.configuration-invalid.json` — error envelope shape (503).
- `vision/response-v1.mixed.json` — copy of `context/examples/vision-response.json`:
  one known count and one unknown, occluded slot. Returned by the mock adapter.

Fixtures are not evidence that a feature works; they pin wire shapes.
