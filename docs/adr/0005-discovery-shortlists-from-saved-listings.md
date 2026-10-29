# Discovery shortlists from saved listing files, not through a board port inside one module

Discovery runs in two stages joined by a file of normalised listings. A pull stage asks one job board adapter for its listings and saves them; a pure shortlist module then dedupes, qualifies, expires, matches and orders every saved listing the same way, whichever board it came from, and returns what it dropped and why. An architecture review proposed one module that calls the boards itself through a board port, with a fake board in tests. We chose the file because the WhatRuns pull takes minutes and a shortlist is made many times from one pull; the single-module shape would have needed a caching adapter that exists only to make the script usable, and the board-specific risk (the Rocketship build id, paging, retries) is tested just as well on recorded payloads behind a fake fetch.

## Considered options

- **One module behind a board port**: rejected because of the cache it forces, and because it couples the shortlist rules to the pull's failure modes.
- **Per-board rules**, exempting Rocketship from the title gate because its search is title-driven: rejected because the gate's misses (such as "Engineering" against the "Engineer" expansion pattern, #27) belong in `qualifies`, and a listing that is dropped is reported, never lost.
