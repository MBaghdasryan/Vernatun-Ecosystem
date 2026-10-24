import os
import unittest

os.environ.update({
    "VERNATUN_TEST_EDGE_ID": "edge-building01",
    "VERNATUN_TEST_TENANT_ID": "9e8e581c-d8cf-4bb4-9548-d6e1e961e090",
    "VERNATUN_TEST_BUILDING_ID": "a6e398fc-2f1d-4724-9db4-11e7874683c7",
    "VERNATUN_TEST_DEVICE_ID": "Barrier-01",
    "VERNATUN_TEST_DEVICE_UUID": "b40f54f2-fd70-4024-b4b1-63fe65963a90",
    "VERNATUN_EDGE_LOCAL_API_KEY": "unit-test-only-key",
})

from server import dry_run_decision


class DryRunPolicyTests(unittest.TestCase):
    def setUp(self):
        self.command = {
            "commandId": "test-command",
            "idempotencyKey": "test-idempotency",
            "tenantId": "9e8e581c-d8cf-4bb4-9548-d6e1e961e090",
            "buildingId": "a6e398fc-2f1d-4724-9db4-11e7874683c7",
            "edgeDeviceId": "Barrier-01",
            "capability": "BARRIER.OPEN",
            "context": {"edgeId": "edge-building01"},
        }

    def test_only_exact_test_barrier_is_simulated_without_actuation(self):
        status, result = dry_run_decision(self.command, "unit-test-only-key")
        self.assertEqual(status, 200)
        self.assertEqual(result["execution"], "DRY_RUN")
        self.assertFalse(result["physicalAction"])

    def test_cloud_thingsboard_device_uuid_is_also_test_only(self):
        self.command.pop("edgeDeviceId")
        self.command["deviceId"] = "b40f54f2-fd70-4024-b4b1-63fe65963a90"
        status, result = dry_run_decision(self.command, "unit-test-only-key")
        self.assertEqual(status, 200)
        self.assertFalse(result["physicalAction"])

    def test_rejects_other_device(self):
        self.command["edgeDeviceId"] = "Lobby-Door-01"
        status, result = dry_run_decision(self.command, "unit-test-only-key")
        self.assertEqual(status, 403)
        self.assertFalse(result["physicalAction"])

    def test_rejects_other_capability(self):
        self.command["capability"] = "DOOR.UNLOCK"
        status, result = dry_run_decision(self.command, "unit-test-only-key")
        self.assertEqual(status, 403)
        self.assertFalse(result["physicalAction"])

    def test_rejects_wrong_tenant_or_building(self):
        self.command["tenantId"] = "another-tenant"
        status, result = dry_run_decision(self.command, "unit-test-only-key")
        self.assertEqual(status, 403)
        self.assertFalse(result["physicalAction"])

    def test_rejects_wrong_edge(self):
        self.command["context"]["edgeId"] = "another-edge"
        status, result = dry_run_decision(self.command, "unit-test-only-key")
        self.assertEqual(status, 403)
        self.assertFalse(result["physicalAction"])

    def test_rejects_wrong_local_key(self):
        status, result = dry_run_decision(self.command, "wrong-key")
        self.assertEqual(status, 401)
        self.assertFalse(result["physicalAction"])


if __name__ == "__main__":
    unittest.main()
