CREATE TABLE unit_floor_links(
 unit_id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 building_id uuid NOT NULL,
 floor_id uuid,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 FOREIGN KEY(unit_id,building_id,organization_id) REFERENCES units(id,building_id,organization_id),
 FOREIGN KEY(floor_id,building_id,organization_id) REFERENCES floors(id,building_id,organization_id)
);
