# ImTun listing map provider

## Selection

Use **MapLibre Native** as the mobile renderer with **MapTiler-hosted vector maps** as the tile/data service. Do not use `tile.openstreetmap.org` as the app's production tile service.

- MapLibre Native is BSD 2-Clause licensed. Preserve the required copyright and license notices in source and binary redistributions.
- MapTiler requires visible, linked attribution on every map: **© MapTiler** and **© OpenStreetMap contributors**. Free accounts also require the MapTiler logo.
- OpenStreetMap data is available under the ODbL; attribution must remain visible and the data license must be respected.
- The OpenStreetMap Foundation's public tile service is best-effort and imposes identification, caching, and no-bulk-download requirements. A hosted tile provider avoids relying on that shared service for the app.

References:

- [MapLibre Native license](https://github.com/maplibre/maplibre-native/blob/main/LICENSE.md)
- [MapTiler attribution requirements](https://docs.maptiler.com/guides/map-design/attribution/add-attribution/)
- [MapTiler data copyright and attribution](https://www.maptiler.com/copyright/)
- [OpenStreetMap copyright and ODbL](https://www.openstreetmap.org/copyright)
- [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/)

## Activation requirements

Keep the marketplace map shell unavailable until the mobile MapLibre integration is compatible with the app's Expo native build, a MapTiler account and mobile key are configured through the approved environment/secrets flow, and the API supplies server-controlled verification status for listing locations. The current API response has no such verification status, so resident-entered coordinates are not eligible for in-app pins. Existing external OpenStreetMap links remain available.

Only render coordinates when `locationVerificationStatus` is exactly `verified` and both values are finite numbers within latitude/longitude bounds. The verification status must be server-controlled; client-entered listing data must not be allowed to set it.
