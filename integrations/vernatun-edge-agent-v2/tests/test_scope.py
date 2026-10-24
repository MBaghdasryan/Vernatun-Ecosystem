import unittest

from service.scope import command_scope_matches, mapped_building_id


class BlockScopeTests(unittest.TestCase):
    def setUp(self):
        self.building_a = "building-a"
        self.building_b = "building-b"
        self.building_outside = "building-outside"
        self.mapping = {
            "tb-device-a": self.building_a,
            "barrier-1": self.building_a,
            "tb-device-b": self.building_b,
        }
        self.permitted = {self.building_a, self.building_b}

    def test_resolves_uuid_and_name_only_from_explicit_mapping(self):
        self.assertEqual(mapped_building_id(self.mapping, self.permitted, "tb-device-a"), self.building_a)
        self.assertEqual(mapped_building_id(self.mapping, self.permitted, "barrier-1"), self.building_a)
        self.assertIsNone(mapped_building_id(self.mapping, self.permitted, "unknown-device"))

    def test_rejects_mapping_outside_cloud_block_membership(self):
        self.mapping["misconfigured-device"] = self.building_outside
        self.assertIsNone(mapped_building_id(self.mapping, self.permitted, "misconfigured-device"))

    def test_uuid_case_does_not_expand_or_break_the_cloud_scope(self):
        uppercase = self.building_a.upper()
        self.mapping["case-device"] = uppercase
        self.assertEqual(mapped_building_id(self.mapping, self.permitted, "case-device"), self.building_a)

    def test_commands_require_both_permitted_building_and_matching_device_mapping(self):
        self.assertTrue(command_scope_matches(
            self.mapping, self.permitted, self.building_b, "tb-device-b"
        ))
        self.assertFalse(command_scope_matches(
            self.mapping, self.permitted, self.building_a, "tb-device-b"
        ))
        self.assertFalse(command_scope_matches(
            self.mapping, self.permitted, self.building_outside, "tb-device-a"
        ))


if __name__ == "__main__":
    unittest.main()
