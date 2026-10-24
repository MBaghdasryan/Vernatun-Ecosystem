import os
import unittest

os.environ["VERNATUN_TEST_DEVICE_UUID"] = "b40f54f2-fd70-4024-b4b1-63fe65963a90"
from server import device_inventory


class ThingsBoardSimulationTests(unittest.TestCase):
    def test_inventory_contains_only_the_named_test_barrier(self):
        inventory = device_inventory()
        self.assertFalse(inventory["hasNext"])
        self.assertEqual(len(inventory["data"]), 1)
        device = inventory["data"][0]
        self.assertEqual(device["name"], "Barrier-01")
        self.assertEqual(device["id"]["id"], "b40f54f2-fd70-4024-b4b1-63fe65963a90")
        self.assertEqual(device["deviceProfileName"], "Vernatun Barrier")
        self.assertIn("no actuator", device["label"])


if __name__ == "__main__":
    unittest.main()
