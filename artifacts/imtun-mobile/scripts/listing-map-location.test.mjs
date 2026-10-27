import assert from 'node:assert/strict';
import test from 'node:test';
import { verifiedListingCoordinates } from '../lib/resident/listingText.ts';

test('only returns coordinates explicitly marked verified and within geographic bounds', () => {
  assert.deepEqual(
    verifiedListingCoordinates({ locationVerificationStatus: 'verified', latitude: 40.18, longitude: 44.51 }),
    { latitude: 40.18, longitude: 44.51 },
  );
  assert.equal(verifiedListingCoordinates({ latitude: 40.18, longitude: 44.51 }), null);
  assert.equal(verifiedListingCoordinates({ locationVerificationStatus: 'pending', latitude: 40.18, longitude: 44.51 }), null);
  assert.equal(verifiedListingCoordinates({ locationVerificationStatus: 'verified', latitude: 91, longitude: 44.51 }), null);
  assert.equal(verifiedListingCoordinates({ locationVerificationStatus: 'verified', latitude: 40.18, longitude: Number.NaN }), null);
  assert.equal(verifiedListingCoordinates({ locationVerificationStatus: 'verified', latitude: '40.18', longitude: 44.51 }), null);
});
