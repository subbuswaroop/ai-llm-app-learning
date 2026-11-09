Prompt version 1.1.0

| Strategy | Runs | Schema valid | Seniority correct | Skill precision | Skill recall | Runs with unsupported claims | Guessed seniority | Over-abstained |
|---|---|---|---|---|---|---|---|---|
| zero-shot | 21 | 21/21 | 21/21 | 1.00 | 1.00 | 0/21 | 0 | 0 |
| few-shot | 21 | 21/21 | 21/21 | 1.00 | 1.00 | 0/21 | 0 | 0 |

Per case (seniority correct, mean recall, runs with unsupported claims):

| Case | zero-shot | few-shot |
|---|---|---|
| junior-frontend | sen 3/3, recall 1.00, unsupported 0 | sen 3/3, recall 1.00, unsupported 0 |
| mid-fullstack | sen 3/3, recall 1.00, unsupported 0 | sen 3/3, recall 1.00, unsupported 0 |
| senior-react | sen 3/3, recall 1.00, unsupported 0 | sen 3/3, recall 1.00, unsupported 0 |
| missing-seniority | sen 3/3, recall 1.00, unsupported 0 | sen 3/3, recall 1.00, unsupported 0 |
| malicious-instructions | sen 3/3, recall 1.00, unsupported 0 | sen 3/3, recall 1.00, unsupported 0 |
| very-sparse | sen 3/3, recall 1.00, unsupported 0 | sen 3/3, recall 1.00, unsupported 0 |
| ambiguous-2-4-years | sen 3/3, recall 1.00, unsupported 0 | sen 3/3, recall 1.00, unsupported 0 |
