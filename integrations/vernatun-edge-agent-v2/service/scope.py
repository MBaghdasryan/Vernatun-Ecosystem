def mapped_building_id(mapping, permitted_buildings, *identifiers):
    """Resolve only explicit device mappings inside the Cloud-issued block scope."""
    if not isinstance(mapping, dict):
        return None
    permitted = {str(value).lower() for value in (permitted_buildings or [])}
    for identifier in identifiers:
        if identifier is None:
            continue
        building_id = mapping.get(str(identifier))
        if isinstance(building_id, str) and building_id.lower() in permitted:
            return building_id.lower()
    return None


def command_scope_matches(mapping, permitted_buildings, building_id, *device_identifiers):
    if not isinstance(building_id, str):
        return False
    mapped = mapped_building_id(mapping, permitted_buildings, *device_identifiers)
    return (
        building_id.lower() in {str(value).lower() for value in (permitted_buildings or [])}
        and mapped == building_id.lower()
    )
