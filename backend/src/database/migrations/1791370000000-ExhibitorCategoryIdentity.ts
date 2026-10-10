import { MigrationInterface, QueryRunner } from 'typeorm';

/** Duplicate identity means the same maker/team and project in the same category. */
export class ExhibitorCategoryIdentity1791370000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(String.raw`
      ALTER TABLE exhibitor_categories ADD COLUMN exhibitor_name_key text, ADD COLUMN project_key text;
      UPDATE exhibitor_categories ec SET
        exhibitor_name_key = lower(regexp_replace(btrim(e.name), '\s+', ' ', 'g')),
        project_key = lower(regexp_replace(btrim(e.project), '\s+', ' ', 'g'))
        FROM exhibitors e WHERE e.id = ec.exhibitor_id;
      ALTER TABLE exhibitor_categories ALTER COLUMN exhibitor_name_key SET NOT NULL,
        ALTER COLUMN project_key SET NOT NULL;
      ALTER TABLE exhibitor_categories ADD CONSTRAINT unique_exhibitor_identity_per_category
        UNIQUE (category_id, exhibitor_name_key, project_key) DEFERRABLE INITIALLY DEFERRED;

      CREATE FUNCTION set_exhibitor_category_identity() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        SELECT lower(regexp_replace(btrim(name), '\s+', ' ', 'g')),
               lower(regexp_replace(btrim(project), '\s+', ' ', 'g'))
          INTO NEW.exhibitor_name_key, NEW.project_key
          FROM exhibitors WHERE id = NEW.exhibitor_id FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Exhibitor does not exist' USING ERRCODE = '23503'; END IF;
        RETURN NEW;
      END; $$;
      CREATE TRIGGER set_exhibitor_category_identity BEFORE INSERT OR UPDATE ON exhibitor_categories
        FOR EACH ROW EXECUTE FUNCTION set_exhibitor_category_identity();

      CREATE FUNCTION sync_exhibitor_category_identity() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE exhibitor_categories SET
          exhibitor_name_key = lower(regexp_replace(btrim(NEW.name), '\s+', ' ', 'g')),
          project_key = lower(regexp_replace(btrim(NEW.project), '\s+', ' ', 'g'))
          WHERE exhibitor_id = NEW.id;
        RETURN NEW;
      END; $$;
      CREATE TRIGGER sync_exhibitor_category_identity AFTER UPDATE OF name, project ON exhibitors
        FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.project IS DISTINCT FROM NEW.project)
        EXECUTE FUNCTION sync_exhibitor_category_identity();
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TRIGGER sync_exhibitor_category_identity ON exhibitors;
      DROP FUNCTION sync_exhibitor_category_identity();
      DROP TRIGGER set_exhibitor_category_identity ON exhibitor_categories;
      DROP FUNCTION set_exhibitor_category_identity();
      ALTER TABLE exhibitor_categories DROP CONSTRAINT unique_exhibitor_identity_per_category,
        DROP COLUMN exhibitor_name_key, DROP COLUMN project_key;`);
  }
}
