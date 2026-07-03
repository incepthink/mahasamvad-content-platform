# Project Context

## Vision

The DGIPR Marathi Content Platform will support Maharashtra government communication teams by turning official notes, resolutions, press notes, and scheme information into polished Marathi content.

The platform is designed to keep Marathi as the primary language while preserving factual accuracy and making the production flow modular and auditable.

## Planned Mahasamvad Ingestion Flow

Historical Mahasamvad articles will be used as style references, not as the source of truth for new factual content.

The intended future flow is:

1. Discover article URLs from the Mahasamvad website.
2. Fetch and extract article content using Readability.js.
3. Clean and normalize the Marathi text.
4. Extract metadata such as title, date, district, department, category, and source URL.
5. Save the full original article.
6. Split cleaned articles into paragraph-aware chunks.
7. Generate multilingual embeddings for each chunk.
8. Store articles, chunks, metadata, and vectors in Supabase PostgreSQL using pgvector.
9. Accept new user notes or uploaded official documents.
10. Extract and verify names, designations, dates, amounts, scheme names, locations, and other important facts.
11. Retrieve similar Mahasamvad articles as writing-style references.
12. Generate a Marathi article using verified facts and style references.
13. Validate the generated article so factual claims are not invented.
14. Generate a matching Marathi poster using the same verified facts.
15. Allow the poster to be opened and edited in Canva through the Canva API.

## Implementation Boundaries

- Existing Mahasamvad content is for structure and style guidance.
- New official notes and documents are the factual source of truth.
- Business logic must remain in code, not hidden inside large automation workflows.
- Secrets and credentials must stay out of version control.

