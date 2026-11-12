# Collectors Toy — GitHub Pages edition

Static snapshot containing 12 prepared MTG sets. No Node API is required at runtime.

Enable **Settings → Pages → Source → GitHub Actions** in this repository, then run the Publish GitHub Pages workflow (or push to main).

Expected URL: https://Starvick26.github.io/collectors-toy/

Collections, binders and settings are stored in each browser's IndexedDB, not in GitHub. Export/import a backup to transfer from localhost. Card images still require access to Scryfall CDN.

Data: Scryfall and MTGJSON; Magic: The Gathering belongs to Wizards of the Coast. This is an unofficial simulator. Third-party PackSim packaging photos are excluded because redistribution rights have not been verified. Original illustrated packaging is included instead.

To refresh this snapshot, import sets in the original server project and rerun the sibling export-pages.mjs utility. Review and commit the changes in this separate repository. The original server project is not modified.
